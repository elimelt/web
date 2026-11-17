#!/usr/bin/env python3
"""Cut a short window out of a recorded run for the SnapshotCut figure.

The window holds one snapshot id's uncoordinated cut and Chandy-Lamport cut,
and is bounded on both sides by consistent cuts, so every message with an
endpoint inside the window either is fully inside it, crosses its left edge
(sent earlier, in flight at the start) or crosses its right edge.

Usage:
    python3 figure_trace.py RUN.json SNAPSHOT_ID MIN_EVENTS MAX_EVENTS > trace.json
"""
import itertools
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze  # noqa: E402

path, sid = sys.argv[1], int(sys.argv[2])
lo_size, hi_size = int(sys.argv[3]), int(sys.argv[4])
run = json.load(open(path))
s = run["args"]["seed"]
n,V,bal,sends,recvs=analyze.rebuild(run)
naive=[None]*n; naive_bal=[None]*n
for nd in run['nodes']:
    for e in nd['log']:
        if e[0]=='naive' and e[2]==sid: naive[nd['proc']]=e[5]; naive_bal[nd['proc']]=e[3]
cls=[run['nodes'][j]['cl'][str(sid)] for j in range(n)]
cl=[c['napp'] for c in cls]
lo=[min(naive[j],cl[j]) for j in range(n)]; hi=[max(naive[j],cl[j]) for j in range(n)]
best=None
for dl in itertools.product(range(0,7),repeat=n):
    L=[lo[j]-1-dl[j] for j in range(n)]
    if not analyze.vc_consistent(L,V): continue
    for dh in itertools.product(range(0,7),repeat=n):
        H=[hi[j]+1+dh[j] for j in range(n)]
        if not analyze.vc_consistent(H,V): continue
        sizes=[H[j]-L[j] for j in range(n)]
        if min(sizes)<lo_size or max(sizes)>hi_size: continue
        score=(max(sizes)-min(sizes), -sum(sizes))
        if best is None or score<best[0]: best=(score,L,H)
print(best, file=sys.stderr)
_,L,H=best
# window events
evs=[]; t0=None
logs={nd['proc']:nd['log'] for nd in run['nodes']}
allt=[]
for j in range(n):
    for e in logs[j]:
        if e[0] in('send','recv') and L[j]<e[5]<=H[j]: allt.append(e[4])
t0=min(allt); t1=max(allt)
msgs={}
procs=[]
for j in range(n):
    pe=[]
    for e in logs[j]:
        kind,peer,mid,amt,t,napp=e[:6]
        if kind in('send','recv') and L[j]<napp<=H[j]:
            pe.append({'kind':kind,'t':round((t-t0)/1e3,1),'mid':mid})
            m=msgs.setdefault(mid,{'amount':amt,'from':None,'to':None})
            if kind=='send': m['from']=[j,napp-L[j]]
            else: m['to']=[j,napp-L[j]]
    procs.append(pe)
# include messages crossing the window: sent before L received inside -> from None ; sent inside received after H -> to None
# markers for CL sid
markers=[]
mk_send={}
for j in range(n):
    for e in logs[j]:
        if e[0]=='mk_send' and e[2]==sid: mk_send[(j,e[1])]=(e[5]-L[j],round((e[4]-t0)/1e3,1))
for j in range(n):
    for e in logs[j]:
        if e[0]=='mk_recv' and e[2]==sid:
            src=e[1]; a=mk_send[(src,j)]
            markers.append({'from':[src,a[0]],'tFrom':a[1],'to':[j,e[5]-L[j]],'tTo':round((e[4]-t0)/1e3,1)})
rec_t={}
for j in range(n):
    for e in logs[j]:
        if e[0]=='cl_record' and e[2]==sid: rec_t.setdefault('cl',{})[j]=round((e[4]-t0)/1e3,1)
        if e[0]=='naive' and e[2]==sid: rec_t.setdefault('naive',{})[j]=round((e[4]-t0)/1e3,1)
ids=sorted(msgs, key=lambda m:(msgs[m]['from'] is None, procs[msgs[m]['from'][0]][msgs[m]['from'][1]-1]['t'] if msgs[m]['from'] else procs[msgs[m]['to'][0]][msgs[m]['to'][1]-1]['t']))
label={mid:i for i,mid in enumerate(ids)}
inflight_L=[mid for mid,(sp,sk,a,d) in sends.items() if sk<=L[sp] and recvs[mid][1]>L[recvs[mid][0]]]
chan=[]
for j in range(n):
    for src,ch in cls[j]['chan'].items():
        for mid,a in ch: chan.append({'from':int(src),'to':j,'msg':label[mid]})
out={'source':{'seed':s,'snapshot':sid,'procs':n,'rate':run['args']['rate'],'window_start_events':L},
 'total':run['initial']*n,'base':[bal[j][L[j]] for j in range(n)],
 'inflightAtStart':[label[m] for m in inflight_L if m in label],
 'events':[[{'kind':e['kind'],'t':e['t'],'msg':label[e['mid']]} for e in pe] for pe in procs],
 'messages':[{'amount':msgs[m]['amount'],'src':sends[m][0],'dst':sends[m][3],'from':msgs[m]['from'],'to':msgs[m]['to']} for m in ids],
 'markers':markers,
 'cuts':{'cl':{'cut':[cl[j]-L[j] for j in range(n)],'t':[rec_t['cl'][j] for j in range(n)],'balances':[c['balance'] for c in cls],'channels':chan},
         'naive':{'cut':[naive[j]-L[j] for j in range(n)],'t':[rec_t['naive'][j] for j in range(n)],'balances':naive_bal}}}
assert all(m in label for m in inflight_L), 'in-flight at L must be visible'
# Every cut of the window, checked against the whole run.
sizes=[H[j]-L[j] for j in range(n)]
count=0
for c in itertools.product(*[range(k+1) for k in sizes]):
    if analyze.vc_consistent([L[j]+c[j] for j in range(n)],V): count+=1
out['consistentCuts']=count
out['allCuts']=1
for k in sizes: out['allCuts']*=k+1
json.dump(out,sys.stdout,indent=1)
