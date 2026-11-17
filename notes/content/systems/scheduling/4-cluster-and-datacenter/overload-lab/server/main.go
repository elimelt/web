// Command server is a small HTTP server whose handler burns a requested amount
// of CPU, behind one of five admission policies. It is the system under test
// for the admission-control note; see ../README.md for how it is run.
package main

import (
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"log"
	"math"
	"net/http"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// burn performs n rounds of SHA-256 over a 32-byte block, yielding the
// processor every 1000 rounds (about 90 us here) so that the connection
// goroutines are not stuck behind a full time slice of another handler.
func burn(n int) byte {
	var b [32]byte
	for i := 0; i < n; i++ {
		b = sha256.Sum256(b[:])
		if i%1000 == 999 {
			runtime.Gosched()
		}
	}
	return b[0]
}

var sink atomic.Uint32

// ---- policies -------------------------------------------------------------

// A policy decides whether a request may start. admit blocks while the
// request waits in a queue; it returns a release function, or ok=false if the
// request is shed.
type policy interface {
	admit(ctx context.Context) (release func(), ok bool)
	snapshot() map[string]float64
}

// none admits everything: one goroutine per request, as net/http does.
type none struct{}

func (none) admit(context.Context) (func(), bool) { return func() {}, true }
func (none) snapshot() map[string]float64         { return nil }

// fixed rejects a request when `limit` requests are already in progress.
type fixed struct {
	limit    int64
	inflight atomic.Int64
}

func (f *fixed) admit(context.Context) (func(), bool) {
	if f.inflight.Add(1) > f.limit {
		f.inflight.Add(-1)
		return nil, false
	}
	return func() { f.inflight.Add(-1) }, true
}
func (f *fixed) snapshot() map[string]float64 { return map[string]float64{"limit": float64(f.limit)} }

// waiter is one request waiting in a FIFO queue for a worker slot.
type waiter struct {
	enq  time.Time
	done chan bool // true: admitted, false: shed
}

// queued runs `workers` requests at a time and holds the rest in a FIFO queue.
// With codel=false the queue is bounded by count (maxLen) and a request waits
// as long as it takes. With codel=true it applies the controlled-delay rule of
// Maurer, "Fail at Scale" (ACM Queue 2015): if the queue has not been empty
// in the last `interval`, a request may wait at most `target`; otherwise it
// may wait at most `interval`.
type queued struct {
	mu        sync.Mutex
	workers   int
	busy      int
	q         *list.List
	maxLen    int
	codel     bool
	target    time.Duration
	interval  time.Duration
	lastEmpty time.Time
}

func newQueued(workers, maxLen int, codel bool, target, interval time.Duration) *queued {
	return &queued{workers: workers, q: list.New(), maxLen: maxLen, codel: codel, target: target, interval: interval, lastEmpty: time.Now()}
}

// limitNow is the longest a request may have waited at time now.
func (p *queued) limitNow(now time.Time) time.Duration {
	if !p.codel {
		return math.MaxInt64
	}
	if p.q.Len() == 0 || now.Sub(p.lastEmpty) < p.interval {
		return p.interval
	}
	return p.target
}

// dispatch hands free worker slots to waiters, shedding any that have waited
// longer than the current limit. Called with mu held.
func (p *queued) dispatch(now time.Time) {
	for p.busy < p.workers && p.q.Len() > 0 {
		lim := p.limitNow(now)
		e := p.q.Front()
		w := p.q.Remove(e).(*waiter)
		if now.Sub(w.enq) > lim {
			w.done <- false
			continue
		}
		p.busy++
		w.done <- true
	}
	if p.q.Len() == 0 {
		p.lastEmpty = now
	}
}

func (p *queued) admit(ctx context.Context) (func(), bool) {
	now := time.Now()
	p.mu.Lock()
	if p.q.Len() == 0 {
		p.lastEmpty = now
	}
	if p.busy < p.workers && p.q.Len() == 0 {
		p.busy++
		p.mu.Unlock()
		return p.release, true
	}
	if p.maxLen > 0 && p.q.Len() >= p.maxLen {
		p.mu.Unlock()
		return nil, false
	}
	w := &waiter{enq: now, done: make(chan bool, 1)}
	p.q.PushBack(w)
	p.mu.Unlock()
	if <-w.done {
		return p.release, true
	}
	return nil, false
}

func (p *queued) release() {
	p.mu.Lock()
	p.busy--
	p.dispatch(time.Now())
	p.mu.Unlock()
}

func (p *queued) snapshot() map[string]float64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return map[string]float64{"queue": float64(p.q.Len())}
}

// gradient is an adaptive concurrency limit after Netflix's concurrency-limits
// library. Requests over the limit are rejected. RTT is measured from
// admission to completion and averaged over windows of at least 50 ms and 10
// samples (shortRTT). At the end of each window,
//
//	newLimit = limit * clamp(ref / shortRTT, 0.5, 1) + queueSize
//
// smoothed as limit = 0.8*limit + 0.2*newLimit. Two variants differ in the
// reference latency `ref`:
//
//	v1 ("Performance Under Load", 2018): ref = the minimum RTT seen, and
//	   queueSize = sqrt(limit).
//	v2 (Gradient2Limit): ref = 1.5 * longRTT, an exponential average of
//	   shortRTT over about 600 windows that decays when it exceeds twice
//	   shortRTT, and queueSize = 4. The limit does not grow while fewer than
//	   limit/2 requests are in progress.
type gradient struct {
	mu        sync.Mutex
	v2        bool
	limit     float64
	inflight  int
	minRTT    float64 // seconds
	longRTT   float64
	longN     int
	sum       float64
	n         int
	peak      int // most requests in progress during the window
	nextReset time.Time
}

const (
	gradWindow    = 50 * time.Millisecond
	gradMinLimit  = 2.0
	gradMaxLimit  = 1000.0
	gradSmoothing = 0.2
	gradLongN     = 600
	gradTolerance = 1.5
)

func newGradient(initial float64, v2 bool) *gradient {
	return &gradient{v2: v2, limit: initial, nextReset: time.Now().Add(gradWindow)}
}

func (g *gradient) admit(context.Context) (func(), bool) {
	g.mu.Lock()
	if float64(g.inflight) >= g.limit {
		g.mu.Unlock()
		return nil, false
	}
	g.inflight++
	if g.inflight > g.peak {
		g.peak = g.inflight
	}
	g.mu.Unlock()
	start := time.Now()
	return func() { g.done(time.Since(start).Seconds()) }, true
}

func (g *gradient) done(rtt float64) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.inflight--
	if g.minRTT == 0 || rtt < g.minRTT {
		g.minRTT = rtt
	}
	g.sum += rtt
	g.n++
	now := time.Now()
	if now.Before(g.nextReset) || g.n < 10 {
		return
	}
	short := g.sum / float64(g.n)
	peak := g.peak
	g.sum, g.n, g.peak = 0, 0, g.inflight
	g.nextReset = now.Add(gradWindow)

	var ref, queue float64
	if g.v2 {
		// Exponential average with a warm-up that is a plain mean.
		g.longN++
		if g.longN <= 10 {
			g.longRTT += (short - g.longRTT) / float64(g.longN)
		} else {
			g.longRTT += (short - g.longRTT) * 2 / float64(gradLongN+1)
		}
		if g.longRTT/short > 2 {
			g.longRTT *= 0.95
		}
		if float64(peak) < g.limit/2 {
			return
		}
		ref, queue = gradTolerance*g.longRTT, 4
	} else {
		ref, queue = g.minRTT, math.Sqrt(g.limit)
	}
	grad := math.Max(0.5, math.Min(1, ref/short))
	next := g.limit*grad + queue
	next = g.limit*(1-gradSmoothing) + next*gradSmoothing
	g.limit = math.Max(gradMinLimit, math.Min(gradMaxLimit, next))
}

func (g *gradient) snapshot() map[string]float64 {
	g.mu.Lock()
	defer g.mu.Unlock()
	return map[string]float64{"limit": g.limit, "minRTTms": g.minRTT * 1e3, "longRTTms": g.longRTT * 1e3}
}

// ---- server ---------------------------------------------------------------

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "listen address")
	name := flag.String("policy", "none", "none | fixed | queue | codel | gradient | gradient-v1")
	limit := flag.Int("limit", 16, "fixed: in-flight limit")
	workers := flag.Int("workers", 4, "queue, codel: requests in progress at once")
	maxLen := flag.Int("maxlen", 1000, "queue: queue length bound")
	flag.Parse()

	var p policy
	switch *name {
	case "none":
		p = none{}
	case "fixed":
		p = &fixed{limit: int64(*limit)}
	case "queue":
		p = newQueued(*workers, *maxLen, false, 0, 0)
	case "codel":
		p = newQueued(*workers, 0, true, 5*time.Millisecond, 100*time.Millisecond)
	case "gradient":
		p = newGradient(float64(*limit), true)
	case "gradient-v1":
		p = newGradient(float64(*limit), false)
	default:
		log.Fatalf("unknown policy %q", *name)
	}

	var served, shed, abandoned, arrived, peak atomic.Int64
	var inHandler atomic.Int64
	var wastedNs atomic.Int64 // CPU-handler time spent on requests whose client had left

	mux := http.NewServeMux()
	mux.HandleFunc("/work", func(w http.ResponseWriter, r *http.Request) {
		n, _ := strconv.Atoi(r.URL.Query().Get("n"))
		arrived.Add(1)
		if v := inHandler.Add(1); v > peak.Load() {
			peak.Store(v)
		}
		defer inHandler.Add(-1)
		release, ok := p.admit(r.Context())
		if !ok {
			shed.Add(1)
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		start := time.Now()
		sink.Add(uint32(burn(n))) // the handler does not check for cancellation
		release()
		if r.Context().Err() != nil {
			abandoned.Add(1)
			wastedNs.Add(int64(time.Since(start)))
			return
		}
		served.Add(1)
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"arrived": arrived.Load(), "peak_in_handler": peak.Load(), "served": served.Load(), "shed": shed.Load(), "abandoned": abandoned.Load(),
			"wasted_s": float64(wastedNs.Load()) / 1e9, "policy": p.snapshot(),
		})
	})
	mux.HandleFunc("/calibrate", func(w http.ResponseWriter, r *http.Request) {
		n, _ := strconv.Atoi(r.URL.Query().Get("n"))
		start := time.Now()
		sink.Add(uint32(burn(n)))
		json.NewEncoder(w).Encode(map[string]float64{"seconds": time.Since(start).Seconds()})
	})

	srv := &http.Server{Addr: *addr, Handler: mux}
	var protos http.Protocols
	protos.SetUnencryptedHTTP2(true)
	srv.Protocols = &protos
	srv.HTTP2 = &http.HTTP2Config{MaxConcurrentStreams: 1 << 20}
	log.Printf("policy=%s listening on %s", *name, *addr)
	log.Fatal(srv.ListenAndServe())
}
