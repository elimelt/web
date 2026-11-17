import socket, threading, time, subprocess, statistics, sys, json
def echo():
    s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",9900)); s.listen()
    while True:
        c,_=s.accept(); threading.Thread(target=serve,args=(c,),daemon=True).start()
def serve(c):
    c.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)
    while True:
        d=c.recv(100)
        if not d: break
        c.sendall(d)
threading.Thread(target=echo,daemon=True).start()
out={}
for d in [0,0.5,1,2,5,10]:
    p=subprocess.Popen(["bin/delayproxy","-listen","127.0.0.1:9901","-target","127.0.0.1:9900","-delay",f"{d}ms"])
    time.sleep(0.3)
    if d==0: pass
    c=socket.create_connection(("127.0.0.1",9901)); c.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1)
    xs=[]
    for i in range(200):
        t=time.perf_counter(); c.sendall(b"x"); c.recv(10); xs.append((time.perf_counter()-t)*1e3)
    xs=xs[20:]
    out[d]=(statistics.median(xs), statistics.quantiles(xs,n=100)[98])
    print(f"one-way {d} ms: RTT median {out[d][0]:.3f} p99 {out[d][1]:.3f} expected {2*d}", flush=True)
    c.close(); p.kill(); p.wait()
    threading.Thread(target=echo,daemon=True).start() if False else None
    break_after=False
