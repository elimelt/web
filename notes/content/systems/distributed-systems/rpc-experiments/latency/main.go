// Command latency measures the cost of one echo call made as a local function
// call, as in-process marshalling only, and as an RPC over loopback using raw
// UDP, raw TCP, HTTP/1.1 with JSON bodies, and gRPC (HTTP/2 + protobuf).
//
//	latency server                      # listen on all transports
//	latency client -mode grpc -n 20000 -size 16
//	latency local -size 16              # local call and marshalling, batched
//
// Each client mode prints one JSON object with per-call latency percentiles.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"runtime"
	"sort"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	pb "google.golang.org/grpc/interop/grpc_testing"
	"google.golang.org/protobuf/proto"
)

const (
	udpAddr  = "127.0.0.1:47101"
	tcpAddr  = "127.0.0.1:47102"
	httpAddr = "127.0.0.1:47103"
	grpcAddr = "127.0.0.1:47104"
)

// echo is the procedure every transport invokes: it returns a copy of its
// argument.
//
//go:noinline
func echo(body []byte) []byte {
	out := make([]byte, len(body))
	copy(out, body)
	return out
}

type jsonMsg struct {
	Body []byte `json:"body"`
}

type grpcServer struct {
	pb.UnimplementedTestServiceServer
}

func (grpcServer) UnaryCall(_ context.Context, in *pb.SimpleRequest) (*pb.SimpleResponse, error) {
	return &pb.SimpleResponse{Payload: &pb.Payload{Body: echo(in.GetPayload().GetBody())}}, nil
}

func serve() {
	// UDP: datagram in, datagram out.
	uc, err := net.ListenPacket("udp", udpAddr)
	if err != nil {
		log.Fatal(err)
	}
	go func() {
		buf := make([]byte, 65536)
		for {
			n, addr, err := uc.ReadFrom(buf)
			if err != nil {
				return
			}
			uc.WriteTo(echo(buf[:n]), addr)
		}
	}()

	// TCP: 4-byte length prefix framing on a persistent connection.
	tl, err := net.Listen("tcp", tcpAddr)
	if err != nil {
		log.Fatal(err)
	}
	go func() {
		for {
			c, err := tl.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				r := bufio.NewReader(c)
				hdr := make([]byte, 4)
				for {
					if _, err := io.ReadFull(r, hdr); err != nil {
						return
					}
					body := make([]byte, binary.BigEndian.Uint32(hdr))
					if _, err := io.ReadFull(r, body); err != nil {
						return
					}
					out := echo(body)
					msg := make([]byte, 4+len(out))
					binary.BigEndian.PutUint32(msg, uint32(len(out)))
					copy(msg[4:], out)
					if _, err := c.Write(msg); err != nil {
						return
					}
				}
			}(c)
		}
	}()

	// HTTP/1.1 + JSON.
	mux := http.NewServeMux()
	mux.HandleFunc("/echo", func(w http.ResponseWriter, r *http.Request) {
		var in jsonMsg
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jsonMsg{Body: echo(in.Body)})
	})
	go func() { log.Fatal(http.ListenAndServe(httpAddr, mux)) }()

	// gRPC over HTTP/2 (cleartext) with protobuf messages.
	gl, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		log.Fatal(err)
	}
	gs := grpc.NewServer()
	pb.RegisterTestServiceServer(gs, grpcServer{})
	go gs.Serve(gl)
	fmt.Println("ready")
	select {}
}

func percentile(sorted []float64, q float64) float64 {
	i := int(q * float64(len(sorted)-1))
	return sorted[i]
}

type result struct {
	Mode  string  `json:"mode"`
	Size  int     `json:"size"`
	N     int     `json:"n"`
	Mean  float64 `json:"mean_us"`
	P50   float64 `json:"p50_us"`
	P90   float64 `json:"p90_us"`
	P99   float64 `json:"p99_us"`
	Min   float64 `json:"min_us"`
	Procs int     `json:"gomaxprocs"`
}

func client(mode string, n, warm, size int) {
	body := bytes.Repeat([]byte{'x'}, size)
	var call func() error
	switch mode {
	case "udp":
		c, err := net.Dial("udp", udpAddr)
		if err != nil {
			log.Fatal(err)
		}
		buf := make([]byte, 65536)
		call = func() error {
			if _, err := c.Write(body); err != nil {
				return err
			}
			c.SetReadDeadline(time.Now().Add(time.Second))
			m, err := c.Read(buf)
			if err != nil || m != size {
				return fmt.Errorf("udp read %d %v", m, err)
			}
			return nil
		}
	case "tcp":
		c, err := net.Dial("tcp", tcpAddr)
		if err != nil {
			log.Fatal(err)
		}
		r := bufio.NewReader(c)
		msg := make([]byte, 4+size)
		binary.BigEndian.PutUint32(msg, uint32(size))
		copy(msg[4:], body)
		hdr := make([]byte, 4)
		call = func() error {
			if _, err := c.Write(msg); err != nil {
				return err
			}
			if _, err := io.ReadFull(r, hdr); err != nil {
				return err
			}
			out := make([]byte, binary.BigEndian.Uint32(hdr))
			_, err := io.ReadFull(r, out)
			return err
		}
	case "http":
		hc := &http.Client{Transport: &http.Transport{MaxIdleConnsPerHost: 1}}
		call = func() error {
			req, _ := json.Marshal(jsonMsg{Body: body})
			resp, err := hc.Post("http://"+httpAddr+"/echo", "application/json", bytes.NewReader(req))
			if err != nil {
				return err
			}
			var out jsonMsg
			err = json.NewDecoder(resp.Body).Decode(&out)
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if err == nil && len(out.Body) != size {
				err = fmt.Errorf("http short body")
			}
			return err
		}
	case "grpc":
		conn, err := grpc.NewClient(grpcAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
		if err != nil {
			log.Fatal(err)
		}
		gc := pb.NewTestServiceClient(conn)
		ctx := context.Background()
		call = func() error {
			out, err := gc.UnaryCall(ctx, &pb.SimpleRequest{Payload: &pb.Payload{Body: body}})
			if err == nil && len(out.GetPayload().GetBody()) != size {
				err = fmt.Errorf("grpc short body")
			}
			return err
		}
	default:
		log.Fatalf("unknown mode %q", mode)
	}
	for i := 0; i < warm; i++ {
		if err := call(); err != nil {
			log.Fatal(err)
		}
	}
	lat := make([]float64, n)
	for i := 0; i < n; i++ {
		t0 := time.Now()
		if err := call(); err != nil {
			log.Fatal(err)
		}
		lat[i] = float64(time.Since(t0).Nanoseconds()) / 1e3
	}
	emit(mode, size, lat)
}

func emit(mode string, size int, lat []float64) {
	sum := 0.0
	for _, v := range lat {
		sum += v
	}
	sort.Float64s(lat)
	json.NewEncoder(os.Stdout).Encode(result{
		Mode: mode, Size: size, N: len(lat), Mean: sum / float64(len(lat)),
		P50: percentile(lat, 0.5), P90: percentile(lat, 0.9), P99: percentile(lat, 0.99),
		Min: lat[0], Procs: runtime.GOMAXPROCS(0),
	})
}

// batched times reps calls of f per sample, because a single local call is
// shorter than the resolution of a pair of clock reads.
func batched(mode string, size, samples, reps int, f func()) {
	for i := 0; i < reps; i++ {
		f()
	}
	lat := make([]float64, samples)
	for s := 0; s < samples; s++ {
		t0 := time.Now()
		for i := 0; i < reps; i++ {
			f()
		}
		lat[s] = float64(time.Since(t0).Nanoseconds()) / 1e3 / float64(reps)
	}
	emit(mode, size, lat)
}

var sink []byte

func local(size int) {
	body := bytes.Repeat([]byte{'x'}, size)
	batched("local", size, 200, 100000, func() { sink = echo(body) })
	batched("json-marshal", size, 200, 2000, func() {
		// Client encodes the request, server decodes it and encodes the reply,
		// client decodes the reply: four codec operations per call.
		b, _ := json.Marshal(jsonMsg{Body: body})
		var in jsonMsg
		json.Unmarshal(b, &in)
		b, _ = json.Marshal(jsonMsg{Body: echo(in.Body)})
		var out jsonMsg
		json.Unmarshal(b, &out)
		sink = out.Body
	})
	batched("proto-marshal", size, 200, 2000, func() {
		b, _ := proto.Marshal(&pb.SimpleRequest{Payload: &pb.Payload{Body: body}})
		var in pb.SimpleRequest
		proto.Unmarshal(b, &in)
		b, _ = proto.Marshal(&pb.SimpleResponse{Payload: &pb.Payload{Body: echo(in.GetPayload().GetBody())}})
		var out pb.SimpleResponse
		proto.Unmarshal(b, &out)
		sink = out.GetPayload().GetBody()
	})
}

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: latency server|client|local [flags]")
	}
	fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	mode := fs.String("mode", "udp", "udp|tcp|http|grpc")
	n := fs.Int("n", 20000, "measured calls")
	warm := fs.Int("warm", 2000, "warmup calls")
	size := fs.Int("size", 16, "payload bytes")
	fs.Parse(os.Args[2:])
	switch os.Args[1] {
	case "server":
		serve()
	case "client":
		client(*mode, *n, *warm, *size)
	case "local":
		local(*size)
	default:
		log.Fatalf("unknown command %q", os.Args[1])
	}
}
