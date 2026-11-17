// bench issues sequential etcd requests from one client and prints the
// latency of each request in microseconds as JSON.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	clientv3 "go.etcd.io/etcd/client/v3"
)

func main() {
	endpoint := flag.String("endpoint", "127.0.0.1:2379", "client endpoint")
	op := flag.String("op", "put", "put | get-linearizable | get-serializable")
	n := flag.Int("n", 300, "measured requests")
	warm := flag.Int("warm", 30, "unmeasured warm-up requests")
	budget := flag.Duration("budget", 20*time.Second, "stop measuring after this long")
	flag.Parse()

	cli, err := clientv3.New(clientv3.Config{Endpoints: []string{*endpoint}, DialTimeout: 5 * time.Second})
	if err != nil {
		log.Fatal(err)
	}
	defer cli.Close()
	val := strings.Repeat("x", 256)
	ctx := context.Background()
	if _, err := cli.Put(ctx, "k0", val); err != nil {
		log.Fatal(err)
	}
	do := func(i int) error {
		var err error
		switch *op {
		case "put":
			_, err = cli.Put(ctx, fmt.Sprintf("k%d", i%1000), val)
		case "get-linearizable":
			_, err = cli.Get(ctx, "k0")
		case "get-serializable":
			_, err = cli.Get(ctx, "k0", clientv3.WithSerializable())
		default:
			log.Fatalf("unknown op %q", *op)
		}
		return err
	}
	for i := 0; i < *warm; i++ {
		if err := do(i); err != nil {
			log.Fatal(err)
		}
	}
	lat := []float64{}
	start := time.Now()
	for i := 0; i < *n && time.Since(start) < *budget; i++ {
		t := time.Now()
		if err := do(i); err != nil {
			log.Fatal(err)
		}
		lat = append(lat, float64(time.Since(t).Nanoseconds())/1e3)
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"op": *op, "endpoint": *endpoint, "us": lat})
}
