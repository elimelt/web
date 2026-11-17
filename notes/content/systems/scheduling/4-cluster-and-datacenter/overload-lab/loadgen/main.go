// Command loadgen offers an open-loop Poisson stream of requests to the
// server, each with an exponentially distributed amount of work and a client
// deadline, and reports goodput: requests answered before the deadline.
//
// Optionally the offered rate steps up for a while (-spike-at, -spike-for,
// -spike-rate), and a failed attempt (a timeout or a 503) is retried at once,
// up to -retries more times, each attempt with a fresh deadline.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"math/rand/v2"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"
)

// attempt is one HTTP request.
type attempt struct {
	sent    float64 // seconds since start
	latency float64 // seconds
	status  int     // 200, 503, or 0 for a client timeout or error
}

// user is one request as the caller sees it: one or more attempts.
type user struct {
	at       float64 // arrival, seconds since start
	ok       bool    // some attempt succeeded
	latency  float64 // arrival to final outcome, seconds
	attempts []attempt
}

func main() {
	url := flag.String("url", "http://127.0.0.1:8080", "server")
	rate := flag.Float64("rate", 500, "offered requests per second")
	dur := flag.Duration("duration", 12*time.Second, "how long to offer load")
	warm := flag.Duration("warmup", 2*time.Second, "excluded from the summary")
	deadline := flag.Duration("deadline", 100*time.Millisecond, "client timeout per attempt")
	meanWork := flag.Float64("work", 1000, "mean SHA-256 rounds per request")
	seed := flag.Uint64("seed", 1, "random seed")
	conns := flag.Int("conns", 16, "HTTP/2 connections, used round robin")
	retries := flag.Int("retries", 0, "extra attempts after a timeout or 503")
	spikeAt := flag.Duration("spike-at", 0, "when the spike starts")
	spikeFor := flag.Duration("spike-for", 0, "how long the spike lasts")
	spikeRate := flag.Float64("spike-rate", 0, "offered rate during the spike")
	flag.Parse()

	var protos http.Protocols
	protos.SetUnencryptedHTTP2(true)
	clients := make([]*http.Client, *conns)
	for i := range clients {
		clients[i] = &http.Client{Transport: &http.Transport{Protocols: &protos}}
	}
	var mu sync.Mutex
	reqNo := 0
	start := time.Now()

	do := func(n int) attempt {
		mu.Lock()
		client := clients[reqNo%len(clients)]
		reqNo++
		mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), *deadline)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/work?n=%d", *url, n), nil)
		t0 := time.Now()
		a := attempt{sent: t0.Sub(start).Seconds()}
		resp, err := client.Do(req)
		if err == nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			a.status = resp.StatusCode
		}
		a.latency = time.Since(t0).Seconds()
		if a.latency > deadline.Seconds() {
			a.status = 0
		}
		return a
	}

	rateAt := func(t float64) float64 {
		if t >= spikeAt.Seconds() && t < (*spikeAt+*spikeFor).Seconds() {
			return *spikeRate
		}
		return *rate
	}
	peak := math.Max(*rate, *spikeRate)

	// Arrivals by thinning a Poisson process of rate `peak`.
	rng := rand.New(rand.NewPCG(*seed, 7))
	var users []*user
	var wg sync.WaitGroup
	next := 0.0
	for {
		next += rng.ExpFloat64() / peak
		if next >= dur.Seconds() {
			break
		}
		keep := true
		if *spikeFor > 0 {
			keep = rng.Float64() < rateAt(next)/peak
		}
		n := int(math.Round(rng.ExpFloat64() * *meanWork))
		if !keep {
			continue
		}
		if wait := time.Until(start.Add(time.Duration(next * 1e9))); wait > 0 {
			time.Sleep(wait)
		}
		u := &user{at: next}
		users = append(users, u)
		wg.Add(1)
		go func(u *user, n int) {
			defer wg.Done()
			for i := 0; i <= *retries; i++ {
				a := do(n)
				u.attempts = append(u.attempts, a)
				if a.status == 200 {
					u.ok = true
					break
				}
			}
			last := u.attempts[len(u.attempts)-1]
			u.latency = last.sent + last.latency - u.at
		}(u, n)
	}
	wg.Wait()

	secs := int(math.Ceil(dur.Seconds()))
	goodPerSec := make([]int, secs)    // users that succeeded, by arrival second
	offeredPerSec := make([]int, secs) // users, by arrival second
	attemptsPerSec := make([]int, secs+1)
	var lat []float64
	var sent, good, shed, timeout, attempts int
	for _, u := range users {
		s := int(u.at)
		offeredPerSec[s]++
		if u.ok {
			goodPerSec[s]++
		}
		for _, a := range u.attempts {
			if i := int(a.sent); i <= secs {
				attemptsPerSec[i]++
			}
		}
		if u.at < warm.Seconds() {
			continue
		}
		sent++
		attempts += len(u.attempts)
		last := u.attempts[len(u.attempts)-1]
		switch {
		case u.ok:
			good++
			lat = append(lat, u.latency)
		case last.status == 503:
			shed++
		default:
			timeout++
		}
	}
	sort.Float64s(lat)
	q := func(p float64) float64 {
		if len(lat) == 0 {
			return -1
		}
		return lat[int(p*float64(len(lat)-1))] * 1000
	}
	span := dur.Seconds() - warm.Seconds()
	json.NewEncoder(os.Stdout).Encode(map[string]any{
		"offered_rps": float64(sent) / span, "goodput_rps": float64(good) / span,
		"shed_rps": float64(shed) / span, "timeout_rps": float64(timeout) / span,
		"attempts_rps": float64(attempts) / span,
		"p50_ms":       q(0.5), "p99_ms": q(0.99),
		"goodput_per_second": goodPerSec, "offered_per_second": offeredPerSec,
		"attempts_per_second": attemptsPerSec[:secs],
	})
}
