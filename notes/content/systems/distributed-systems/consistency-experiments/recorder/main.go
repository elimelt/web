// Records concurrent single-register histories from a real etcd cluster, and
// checks recorded histories for linearizability with Porcupine, as an
// independent check on checkers.py.
//
//	recorder record -endpoints 127.0.0.1:23101,127.0.0.1:23102,127.0.0.1:23103 \
//	    -reads serializable -histories 100 -ops 8 -seed 1 -out run.jsonl
//	recorder check -in run.jsonl        # prints one verdict per history
//
// Client c talks only to endpoint c. Writes always go through Raft; with
// -reads serializable a read is answered from the local member's state
// (clientv3.WithSerializable), otherwise etcd's default linearizable read
// (ReadIndex) is used.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/anishathalye/porcupine"
	clientv3 "go.etcd.io/etcd/client/v3"
)

// Op is one completed (or indeterminate) operation on the register.
type Op struct {
	P    int    `json:"p"`    // client (process) index
	Kind string `json:"kind"` // "w" or "r"
	V    int    `json:"v"`    // value written, or value the read returned
	Call int64  `json:"call"` // ns since the history started
	Ret  int64  `json:"ret"`  // ns since the history started; -1 if the outcome is unknown
	Rev  int64  `json:"rev"`  // etcd header revision of the response
	M    int    `json:"m"`    // index of the member that answered, or -1
}

type History struct {
	Run    string `json:"run"`
	Index  int    `json:"index"`
	Reads  string `json:"reads"`
	Spread bool   `json:"spread"`
	Init   int    `json:"init"`
	Ops    []Op   `json:"ops"`
}

const key = "consistency-x"

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: recorder record|check [flags]")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "record":
		record(os.Args[2:])
	case "check":
		check(os.Args[2:])
	default:
		fmt.Fprintln(os.Stderr, "unknown command", os.Args[1])
		os.Exit(2)
	}
}

func record(args []string) {
	fs := flag.NewFlagSet("record", flag.ExitOnError)
	endpoints := fs.String("endpoints", "", "comma-separated client endpoints, one per client")
	reads := fs.String("reads", "linearizable", "linearizable or serializable")
	histories := fs.Int("histories", 100, "number of histories")
	ops := fs.Int("ops", 8, "operations per client per history")
	seed := fs.Int64("seed", 1, "random seed")
	think := fs.Duration("think", 2*time.Millisecond, "maximum think time between a client's operations")
	run := fs.String("run", "", "label stored with every history")
	spread := fs.Bool("spread", false, "give every client all endpoints (clientv3 balances requests across them) instead of one")
	out := fs.String("out", "", "output JSONL file")
	fs.Parse(args)

	eps := strings.Split(*endpoints, ",")
	clients := make([]*clientv3.Client, len(eps))
	for i, ep := range eps {
		mine := []string{ep}
		if *spread {
			mine = eps
		}
		c, err := clientv3.New(clientv3.Config{Endpoints: mine, DialTimeout: 5 * time.Second})
		if err != nil {
			panic(err)
		}
		defer c.Close()
		clients[i] = c
	}
	f, err := os.Create(*out)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	defer w.Flush()

	serial := *reads == "serializable"
	// Member IDs, in endpoint order, so each response can name its member.
	memberIndex := map[uint64]int{}
	for i, c := range clients {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		st, err := c.Status(ctx, eps[i])
		cancel()
		if err != nil {
			panic(err)
		}
		memberIndex[st.Header.MemberId] = i
	}
	member := func(id uint64) int {
		if m, ok := memberIndex[id]; ok {
			return m
		}
		return -1
	}
	for h := 0; h < *histories; h++ {
		hist := History{Run: *run, Index: h, Reads: *reads, Spread: *spread, Init: 0}
		// Reset the register and wait until every member has applied the
		// reset, so no read can return a value from an earlier history.
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		resp, err := clients[0].Put(ctx, key, "0")
		if err != nil {
			panic(err)
		}
		for _, ep := range eps {
			c, err := clientv3.New(clientv3.Config{Endpoints: []string{ep}, DialTimeout: 5 * time.Second})
			if err != nil {
				panic(err)
			}
			for {
				g, err := c.Get(ctx, key, clientv3.WithSerializable())
				if err != nil {
					panic(err)
				}
				if g.Header.Revision >= resp.Header.Revision {
					break
				}
				time.Sleep(200 * time.Microsecond)
			}
			c.Close()
		}
		cancel()

		var mu sync.Mutex
		var wg sync.WaitGroup
		start := time.Now()
		for p := range clients {
			wg.Add(1)
			go func(p int) {
				defer wg.Done()
				r := rand.New(rand.NewSource(*seed*1_000_003 + int64(h)*101 + int64(p)))
				c := clients[p]
				for i := 0; i < *ops; i++ {
					time.Sleep(time.Duration(r.Int63n(int64(*think) + 1)))
					var op Op
					opCtx, opCancel := context.WithTimeout(context.Background(), 5*time.Second)
					if r.Intn(2) == 0 {
						v := (p+1)*100 + i + 1
						call := time.Since(start).Nanoseconds()
						pr, err := c.Put(opCtx, key, strconv.Itoa(v))
						ret := time.Since(start).Nanoseconds()
						op = Op{P: p, Kind: "w", V: v, Call: call, Ret: ret, M: -1}
						if err != nil {
							op.Ret = -1 // the write may or may not have taken effect
						} else {
							op.Rev = pr.Header.Revision
							op.M = member(pr.Header.MemberId)
						}
					} else {
						var opts []clientv3.OpOption
						if serial {
							opts = append(opts, clientv3.WithSerializable())
						}
						call := time.Since(start).Nanoseconds()
						g, err := c.Get(opCtx, key, opts...)
						ret := time.Since(start).Nanoseconds()
						opCancel()
						if err != nil || len(g.Kvs) != 1 {
							continue // a failed read constrains nothing
						}
						v, _ := strconv.Atoi(string(g.Kvs[0].Value))
						op = Op{P: p, Kind: "r", V: v, Call: call, Ret: ret, Rev: g.Header.Revision, M: member(g.Header.MemberId)}
					}
					opCancel()
					mu.Lock()
					hist.Ops = append(hist.Ops, op)
					mu.Unlock()
				}
			}(p)
		}
		wg.Wait()
		b, _ := json.Marshal(hist)
		w.Write(b)
		w.WriteString("\n")
	}
}

// ---- Porcupine check.

type regInput struct {
	write bool
	v     int
}

var registerModel = porcupine.Model{
	Init: func() interface{} { return 0 },
	Step: func(state, input, output interface{}) (bool, interface{}) {
		in := input.(regInput)
		if in.write {
			return true, in.v
		}
		return output.(int) == state.(int), state
	},
	Equal: func(a, b interface{}) bool { return a.(int) == b.(int) },
}

func check(args []string) {
	fs := flag.NewFlagSet("check", flag.ExitOnError)
	in := fs.String("in", "", "JSONL file of histories")
	fs.Parse(args)
	f, err := os.Open(*in)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<26)
	for sc.Scan() {
		var h History
		if err := json.Unmarshal(sc.Bytes(), &h); err != nil {
			panic(err)
		}
		var ops []porcupine.Operation
		for _, o := range h.Ops {
			ret := o.Ret
			if ret < 0 {
				ret = 1 << 62 // indeterminate: may take effect at any later time
			}
			ops = append(ops, porcupine.Operation{ClientId: o.P, Input: regInput{o.Kind == "w", o.V}, Call: o.Call, Output: o.V, Return: ret})
		}
		ok := porcupine.CheckOperations(registerModel, ops)
		fmt.Printf("%s\t%d\t%v\n", h.Run, h.Index, ok)
	}
}
