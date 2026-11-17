// fanout measures fan-out latency against real Redis servers.
//
// A root request sends GET to k distinct leaves (chosen at random from n
// redis-server processes) and completes when every leaf has answered. With
// -hedge D (microseconds), a leaf that has not answered D after the root
// started is sent a second GET on another server, and the first reply wins.
// Requests are issued closed-loop, one root request at a time.
//
// Output (-out prefix): prefix.root holds one int32 per root request, the
// root latency in nanoseconds; prefix.leaf holds k int32 per root request,
// each leaf's latency from its own send to its first reply, in nanoseconds;
// prefix.meta.json records the parameters and the hedge count.
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"math/rand"
	"net"
	"os"
	"sort"
	"sync"
	"syscall"
	"time"
)

type reply struct {
	leaf int // position within the root request
	at   time.Time
}

type conn struct {
	c   net.Conn
	r   *bufio.Reader
	req chan job
}

type job struct {
	leaf int
	out  chan<- reply
	wg   *sync.WaitGroup
}

var getCmd = []byte("*2\r\n$3\r\nGET\r\n$1\r\nk\r\n")

func dial(port int) *conn {
	c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		panic(err)
	}
	c.(*net.TCPConn).SetNoDelay(true)
	cn := &conn{c: c, r: bufio.NewReaderSize(c, 4096), req: make(chan job, 4)}
	go cn.serve()
	return cn
}

// serve writes one GET per job and reads its bulk-string reply.
func (cn *conn) serve() {
	for j := range cn.req {
		if _, err := cn.c.Write(getCmd); err != nil {
			panic(err)
		}
		readBulk(cn.r)
		j.out <- reply{leaf: j.leaf, at: time.Now()}
		j.wg.Done()
	}
}

// hedgeTimer fires after d. Go's runtime timers can fire up to about 1 ms
// late when the process is idle in the network poller, which is longer than
// the delays used here, so the wait is a nanosleep on its own OS thread
// (high-resolution timer) instead.
func hedgeTimer(d time.Duration) <-chan time.Time {
	ch := make(chan time.Time, 1)
	go func() {
		if d > 0 {
			ts := syscall.NsecToTimespec(d.Nanoseconds())
			for syscall.Nanosleep(&ts, &ts) == syscall.EINTR {
			}
		}
		ch <- time.Now()
	}()
	return ch
}

// measureTimer prints the median, p95 and p99 of the time a Go runtime timer
// set for d actually takes to fire.
func measureTimer(d time.Duration) {
	const n = 2000
	took := make([]float64, n)
	for i := range took {
		t := time.Now()
		<-time.After(d)
		took[i] = float64(time.Since(t).Microseconds())
	}
	sort.Float64s(took)
	fmt.Printf("time.After(%v): p50 %.0f us, p95 %.0f us, p99 %.0f us\n", d, took[n/2], took[n*95/100], took[n*99/100])
}

func readBulk(r *bufio.Reader) {
	line, err := r.ReadSlice('\n')
	if err != nil {
		panic(err)
	}
	if line[0] != '$' {
		panic("unexpected reply " + string(line))
	}
	n := 0
	for _, ch := range line[1 : len(line)-2] {
		n = n*10 + int(ch-'0')
	}
	if _, err := r.Discard(n + 2); err != nil {
		panic(err)
	}
}

func main() {
	base := flag.Int("base", 7000, "first Redis port")
	n := flag.Int("n", 64, "number of Redis servers")
	k := flag.Int("k", 16, "fan-out")
	reqs := flag.Int("reqs", 20000, "measured root requests")
	warm := flag.Int("warm", 2000, "warm-up root requests, not recorded")
	hedgeUs := flag.Int("hedge", 0, "hedge delay in microseconds, 0 = off")
	seed := flag.Int64("seed", 1, "seed for leaf choice")
	out := flag.String("out", "run", "output prefix")
	timerUs := flag.Int("timer", 0, "only measure how long time.After(timer us) takes, 2000 trials")
	flag.Parse()
	if *timerUs > 0 {
		measureTimer(time.Duration(*timerUs) * time.Microsecond)
		return
	}

	primary := make([]*conn, *n)
	backup := make([]*conn, *n)
	for i := 0; i < *n; i++ {
		primary[i] = dial(*base + i)
		backup[i] = dial(*base + i)
	}
	rng := rand.New(rand.NewSource(*seed))
	rootLat := make([]int32, 0, *reqs)
	leafLat := make([]int32, 0, *reqs**k)
	hedges := 0
	var spread time.Duration // time from the root's start to its last send
	hedgeDelay := time.Duration(*hedgeUs) * time.Microsecond

	leaves := make([]int, *k)
	sentAt := make([]time.Time, *k)
	first := make([]time.Time, *k)
	got := make([]bool, *k)
	replies := make(chan reply, 2**k)

	for it := 0; it < *warm+*reqs; it++ {
		perm := rng.Perm(*n)
		copy(leaves, perm[:*k])
		var wg sync.WaitGroup
		wg.Add(*k)
		t0 := time.Now()
		for j, l := range leaves {
			sentAt[j] = time.Now()
			got[j] = false
			primary[l].req <- job{leaf: j, out: replies, wg: &wg}
		}
		spreadThis := time.Since(t0)
		remaining := *k
		var timer <-chan time.Time
		if hedgeDelay > 0 {
			timer = hedgeTimer(hedgeDelay - time.Since(t0))
		}
		for remaining > 0 {
			select {
			case r := <-replies:
				if !got[r.leaf] {
					got[r.leaf] = true
					first[r.leaf] = r.at
					remaining--
				}
			case <-timer:
				timer = nil
				for j, l := range leaves {
					if !got[j] {
						hedges++
						wg.Add(1)
						backup[(l+*n/2)%*n].req <- job{leaf: j, out: replies, wg: &wg}
					}
				}
			}
		}
		tEnd := time.Now()
		wg.Wait() // drain losing copies before the connections are reused
		for len(replies) > 0 {
			<-replies
		}
		if it >= *warm {
			spread += spreadThis
			rootLat = append(rootLat, int32(tEnd.Sub(t0).Nanoseconds()))
			for j := range leaves {
				leafLat = append(leafLat, int32(first[j].Sub(sentAt[j]).Nanoseconds()))
			}
		}
	}

	write := func(path string, v []int32) {
		f, err := os.Create(path)
		if err != nil {
			panic(err)
		}
		w := bufio.NewWriter(f)
		binary.Write(w, binary.LittleEndian, v)
		w.Flush()
		f.Close()
	}
	write(*out+".root", rootLat)
	write(*out+".leaf", leafLat)
	meta, _ := json.Marshal(map[string]any{
		"n": *n, "k": *k, "reqs": *reqs, "warm": *warm, "hedge_us": *hedgeUs,
		"seed": *seed, "hedges": hedges,
		"mean_send_spread_ns": spread.Nanoseconds() / int64(*reqs),
	})
	os.WriteFile(*out+".meta.json", meta, 0o644)
}
