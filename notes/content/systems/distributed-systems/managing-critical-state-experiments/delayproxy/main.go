// delayproxy forwards TCP connections from -listen to -target and holds every
// chunk of bytes for -delay before writing it on, in both directions. It
// stands in for netem on kernels built without sch_netem. Chunks keep their
// order; there is no bandwidth limit or loss.
package main

import (
	"flag"
	"io"
	"log"
	"net"
	"runtime"
	"time"
)

type chunk struct {
	due  time.Time
	data []byte
}

// waitUntil sleeps until 1 ms before t, then yields in a loop until t. The
// Go runtime rounds timer sleeps on Linux to whole milliseconds, so a plain
// time.Sleep would add up to 1 ms of error to every chunk.
func waitUntil(t time.Time) {
	if d := time.Until(t) - time.Millisecond; d > 0 {
		time.Sleep(d)
	}
	for time.Now().Before(t) {
		runtime.Gosched()
	}
}

func pipe(dst, src net.Conn, delay time.Duration) {
	q := make(chan chunk, 4096)
	go func() {
		defer close(q)
		for {
			buf := make([]byte, 64<<10)
			n, err := src.Read(buf)
			if n > 0 {
				q <- chunk{time.Now().Add(delay), buf[:n]}
			}
			if err != nil {
				return
			}
		}
	}()
	for c := range q {
		waitUntil(c.due)
		if _, err := dst.Write(c.data); err != nil {
			break
		}
	}
	if tc, ok := dst.(*net.TCPConn); ok {
		tc.CloseWrite()
	}
	io.Copy(io.Discard, src)
}

func main() {
	listen := flag.String("listen", "", "address to listen on")
	target := flag.String("target", "", "address to forward to")
	delay := flag.Duration("delay", 0, "one-way delay added to each direction")
	flag.Parse()
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatal(err)
	}
	for {
		in, err := ln.Accept()
		if err != nil {
			log.Fatal(err)
		}
		go func() {
			out, err := net.Dial("tcp", *target)
			if err != nil {
				in.Close()
				return
			}
			in.(*net.TCPConn).SetNoDelay(true)
			out.(*net.TCPConn).SetNoDelay(true)
			done := make(chan struct{}, 2)
			go func() { pipe(out, in, *delay); done <- struct{}{} }()
			go func() { pipe(in, out, *delay); done <- struct{}{} }()
			<-done
			<-done
			in.Close()
			out.Close()
		}()
	}
}
