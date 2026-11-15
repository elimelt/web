import numpy as np, json
md=open('cms_meta.txt').read().split('\n'); h=md[0].split(); d=dict(zip(h[0::2],h[1::2]))
LWS=int(d['LWS']); n=int(d['n']); N=int(d['N']); T=int(d['T']); NW=int(d['NW']); LW0=int(d['LW0']); D=int(d['D']); NB=int(d['NB']); NF=int(d['NF'])
fcount=np.array(md[1].split()[1:],float)
per=NB+6+2*NF+4
r=np.fromfile('cms_out.bin').reshape(T,2,NW,D,per)
widths=[2**(LW0+LWS*w) for w in range(NW)]
edges=np.r_[0,10**((np.arange(1,NB)-1)/50.0)]  # bin b>=1 covers [10^((b-1)/50),10^(b/50))
def quant(hist,qs):
    c=np.cumsum(hist)/hist.sum(); out=[]
    for q in qs:
        b=np.searchsorted(c,q)
        out.append(0.0 if b==0 else 10**((b-1)/50.0))  # lower edge of bin
    return out
res={'widths':widths,'N':N,'n':n,'T':T,'D':D,'fcount':fcount.tolist(),'cfg':{}}
for m,mn in enumerate(['cm','cs']):
  for wi,w in enumerate(widths):
    for dd in range(1,D+1):
      x=r[:,m,wi,dd-1]  # T x per
      hist=x[:,:NB]
      q=np.array([quant(hist[t],[0.5,0.9,0.99,0.999]) for t in range(T)])
      key=f'{mn}_{w}_{dd}'
      res['cfg'][key]=dict(
        mean_err=(x[:,NB]/n).tolist(), mean_abs=(x[:,NB+1]/n).tolist(), exceed=(x[:,NB+2]/n).tolist(),
        rmse=np.sqrt(x[:,NB+3]/n).tolist(), top1000_rel=(x[:,NB+4]/1000).tolist(), top100_rel=(x[:,NB+5]/100).tolist(),
        exact=(x[:,0]/n).tolist(), q50=q[:,0].tolist(), q90=q[:,1].tolist(), q99=q[:,2].tolist(), q999=q[:,3].tolist(),
        relabs_by_class=(x[:,NB+6:NB+6+NF].mean(0)/np.maximum(fcount,1)).tolist(),
        relsigned_by_class=(x[:,NB+6+NF:NB+6+2*NF].mean(0)/np.maximum(fcount,1)).tolist(),
        frac_rel_gt_0p01=(x[:,NB+6+2*NF+3]/n).tolist(),frac_rel_gt_0p1=(x[:,NB+6+2*NF]/n).tolist(), frac_rel_gt_1=(x[:,NB+6+2*NF+1]/n).tolist(), frac_rel_gt_10=(x[:,NB+6+2*NF+2]/n).tolist())
json.dump(res,open('cms_summary.json','w'))
M=lambda k,f: (np.mean(res['cfg'][k][f]), np.min(res['cfg'][k][f]), np.max(res['cfg'][k][f]))
for w in widths:
  for dd in [1,2,4,8]:
    k=f'cm_{w}_{dd}'; c=res['cfg'][k]; s=res['cfg'][f'cs_{w}_{dd}']
    print(f'w={w:>8} d={dd} eps*N={np.e/w*N:>10.0f} 1row={N/w:>9.1f} | CM mean {np.mean(c["mean_err"]):9.2f} q50 {np.mean(c["q50"]):8.1f} q99 {np.mean(c["q99"]):9.1f} q999 {np.mean(c["q999"]):9.1f} exceed {np.mean(c["exceed"]):.2e} (delta {np.exp(-dd):.2e}) exact {np.mean(c["exact"]):.3f} top100 {np.mean(c["top100_rel"]):.2e} relgt1 {np.mean(c["frac_rel_gt_1"]):.3f}| CS mabs {np.mean(s["mean_abs"]):8.2f} q50 {np.mean(s["q50"]):7.1f} q99 {np.mean(s["q99"]):8.1f} relgt1 {np.mean(s["frac_rel_gt_1"]):.3f} bias {np.mean(s["mean_err"]):.3f}')
