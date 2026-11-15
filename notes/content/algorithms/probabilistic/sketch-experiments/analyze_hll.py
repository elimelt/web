import numpy as np, json
meta=open('hll_meta.txt').read().split('\n')
hdr=meta[0].split(); T=int(hdr[3]); ncp=int(hdr[5])
ps=[int(x) for x in meta[1].split()[1:]]; cp=np.array(meta[2].split()[1:],float)
a=np.fromfile('hll_out.bin',np.float32).reshape(T,ncp,len(ps)*6+4)
est=a[:,:,:len(ps)*6].reshape(T,ncp,len(ps),6).astype(np.float64)
e32=a[:,:,len(ps)*6:].astype(np.float64)
names=['raw','lc','orig','hpp','ertl','hpps']
rel=est/cp[None,:,None,None]-1
rel32=e32/cp[None,:,None]-1
out={'T':T,'cp':cp.tolist(),'ps':ps,'names':names}
rng=np.random.default_rng(0)
def boot_sd(x,B=2000):
    idx=rng.integers(0,len(x),(B,len(x))); s=x[idx].std(axis=1,ddof=1); return np.percentile(s,[2.5,97.5])
final={}
for i,p in enumerate(ps):
    m=2**p; r=rel[:,-1,i,4]; sd=r.std(ddof=1); lo,hi=boot_sd(r)
    rr=rel[:,-1,i,0]
    final[p]=dict(theory=1.04/np.sqrt(m), sd=sd, sd_lo=lo, sd_hi=hi, mean=r.mean(), se_mean=sd/np.sqrt(T),
      within1=(abs(r)<=1.04/np.sqrt(m)).mean(), within2=(abs(r)<=2*1.04/np.sqrt(m)).mean(), within3=(abs(r)<=3*1.04/np.sqrt(m)).mean(),
      raw_sd=rr.std(ddof=1), raw_mean=rr.mean(), bytes6=m*6/8)
    print(p, {k:(round(v,5) if isinstance(v,float) else v) for k,v in final[p].items()})
out['final']=final
# per p, per estimator: mean, sd, rmse, quantiles over n
summ={}
for i,p in enumerate(ps):
    summ[p]={}
    for e,nm in enumerate(names):
        r=rel[:,:,i,e]
        if np.isnan(r).all(): continue
        summ[p][nm]=dict(mean=np.nanmean(r,0).tolist(), sd=np.nanstd(r,0).tolist(), rmse=np.sqrt(np.nanmean(r**2,0)).tolist(),
           q05=np.nanpercentile(r,5,0).tolist(), q50=np.nanpercentile(r,50,0).tolist(), q95=np.nanpercentile(r,95,0).tolist())
out['summ']=summ
s32={}
for e,nm in enumerate(['raw32','orig32','coll32','ertl32']):
    r=rel32[:,:,e]; s32[nm]=dict(mean=r.mean(0).tolist(), sd=r.std(0).tolist(), rmse=np.sqrt((r**2).mean(0)).tolist())
out['s32']=s32
json.dump(out,open('hll_summary.json','w'))
# key report lines
for p in [10,12,14,16]:
    i=ps.index(p); m=2**p
    print('p',p)
    for nm in ['raw','orig','hpp','ertl']+(['hpps'] if p==14 else []):
        r=np.array(summ[p][nm]['rmse']); mn=np.array(summ[p][nm]['mean'])
        # worst rmse over n in [0.1m, 10m] relative to theory
        sel=(cp>=0.1*m)&(cp<=20*m)
        k=np.argmax(r*sel); print('  ',nm,'max rmse over n in [0.1m,20m]: %.4f at n=%d (n/m=%.2f); theory %.4f; max|bias| %.4f'%(r[k],cp[k],cp[k]/m,1.04/np.sqrt(m),np.max(np.abs(mn)*sel)))
i=ps.index(14)
for nm in s32: print(nm,'final mean %.5f sd %.5f'%(s32[nm]['mean'][-1],s32[nm]['sd'][-1]), 'se', s32[nm]['sd'][-1]/np.sqrt(T))
print('ertl64 p14 final mean %.5f sd %.5f'%(summ[14]['ertl']['mean'][-1],summ[14]['ertl']['sd'][-1]))
