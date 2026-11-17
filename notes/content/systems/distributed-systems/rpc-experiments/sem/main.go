// Command sem runs a UDP request/reply RPC whose procedure has a side effect
// that is not idempotent: each execution appends a record to a ledger file and
// returns the ledger's new length. Counting ledger records per call ID after a
// run gives the number of times the server executed each call.
//
//	sem server -mode alo|amo [-recover] -ledger FILE -port P
//	sem client -calls N -conc C -attempts A -timeout 20ms -port P > calls.txt
//
// alo (at least once) executes every request that arrives. amo (at most once)
// keeps a table from call ID to the reply it sent and answers a duplicate from
// that table without executing again. With -recover, the server rebuilds the
// table from the ledger when it starts, so the table survives a crash of the
// server process.
//
// The client prints one line per call: "id attempts ok", where ok is 1 if a
// reply arrived and 0 if the client gave up.
package main

import (
	"bufio"
	"encoding/binary"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Wire format: request = id (8 bytes); reply = id (8 bytes) + result (8 bytes).

func server(mode string, recover bool, ledgerPath string, port int) {
	f, err := os.OpenFile(ledgerPath, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o644)
	if err != nil {
		log.Fatal(err)
	}
	done := map[uint64]uint64{} // call ID -> result already returned (amo only)
	var length uint64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		length++
		if recover {
			fields := strings.Fields(sc.Text())
			id, _ := strconv.ParseUint(fields[0], 10, 64)
			res, _ := strconv.ParseUint(fields[1], 10, 64)
			done[id] = res
		}
	}
	pc, err := net.ListenPacket("udp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("ready")
	buf := make([]byte, 64)
	reply := make([]byte, 16)
	for {
		n, addr, err := pc.ReadFrom(buf)
		if err != nil || n < 8 {
			continue
		}
		id := binary.BigEndian.Uint64(buf)
		res, seen := done[id]
		if !(mode == "amo" && seen) {
			// Execute: the side effect is one write(2) of one ledger record.
			length++
			res = length
			if _, err := f.WriteString(fmt.Sprintf("%d %d\n", id, res)); err != nil {
				log.Fatal(err)
			}
			if mode == "amo" {
				done[id] = res
			}
		}
		binary.BigEndian.PutUint64(reply, id)
		binary.BigEndian.PutUint64(reply[8:], res)
		pc.WriteTo(reply, addr)
	}
}

func client(calls, conc, attempts int, timeout time.Duration, port int) {
	type rec struct {
		id       uint64
		attempts int
		ok       bool
	}
	out := make(chan rec, 1024)
	var wg sync.WaitGroup
	per := calls / conc
	for w := 0; w < conc; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			c, err := net.Dial("udp", fmt.Sprintf("127.0.0.1:%d", port))
			if err != nil {
				log.Fatal(err)
			}
			req := make([]byte, 8)
			buf := make([]byte, 64)
			for s := 0; s < per; s++ {
				id := uint64(w+1)<<32 | uint64(s)
				binary.BigEndian.PutUint64(req, id)
				ok := false
				a := 0
				for !ok && (attempts == 0 || a < attempts) {
					a++
					c.Write(req)
					deadline := time.Now().Add(timeout)
					for {
						c.SetReadDeadline(deadline)
						n, err := c.Read(buf)
						if err != nil {
							if ne, isNet := err.(net.Error); isNet && ne.Timeout() {
								break
							}
							// ECONNREFUSED while the server is down: wait out
							// the rest of the timeout, then retry.
							time.Sleep(time.Until(deadline))
							break
						}
						if n == 16 && binary.BigEndian.Uint64(buf) == id {
							ok = true
							break
						}
						// A late reply to an earlier call: discard it.
					}
				}
				out <- rec{id, a, ok}
			}
		}(w)
	}
	go func() { wg.Wait(); close(out) }()
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for r := range out {
		ok := 0
		if r.ok {
			ok = 1
		}
		fmt.Fprintf(w, "%d %d %d\n", r.id, r.attempts, ok)
	}
}

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: sem server|client [flags]")
	}
	fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	mode := fs.String("mode", "alo", "alo|amo")
	recover := fs.Bool("recover", false, "rebuild the duplicate table from the ledger at start")
	ledger := fs.String("ledger", "ledger.txt", "ledger file")
	port := fs.Int("port", 47201, "server UDP port")
	calls := fs.Int("calls", 4000, "calls in total")
	conc := fs.Int("conc", 16, "concurrent clients, one outstanding call each")
	attempts := fs.Int("attempts", 4, "sends per call before giving up (0 = unbounded)")
	timeout := fs.Duration("timeout", 20*time.Millisecond, "retransmission timeout")
	fs.Parse(os.Args[2:])
	switch os.Args[1] {
	case "server":
		server(*mode, *recover, *ledger, *port)
	case "client":
		client(*calls, *conc, *attempts, *timeout, *port)
	default:
		log.Fatalf("unknown command %q", os.Args[1])
	}
}
