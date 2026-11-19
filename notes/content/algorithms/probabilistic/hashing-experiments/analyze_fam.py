import numpy as np, collections, json, sys
lines=open(sys.argv[1] if len(sys.argv)>1 else 'fam.txt').read().split('\n')
hdr=lines[0].split(); n=int(hdr[2]); N=float(hdr[4]); F2=float(hdr[6]); F4=float(hdr[8])
cps=np.array([1e4,1e5,1e6,1e7,n])
d=collections.defaultdict(list)
for l in lines[2:]:
    if not l: continue
    f=l.split(); d[(f[0],f[1])].append([float(x) for x in f[3:]])
ams_theory=np.sqrt(2*(1-F4/F2**2))
out={'n':n,'N':N,'F2':F2,'F4':F4,'ams_theory_rel_sd':ams_theory,'rows':{}}
print('AMS theory rel sd', ams_theory)
rng=np.random.default_rng(0)
for k in sorted(d):
    v=np.array(d[k]); T=len(v); e=v[:,:5]/cps-1
    cm14=v[:,5]/(N/2**14); cm18=v[:,6]/(N/2**18); chi=v[:,7]/16383; Z2=v[:,8]**2/F2
    rec=dict(T=T, hll_median=np.median(e,0).tolist(), hll_mean=e.mean(0).tolist(), hll_sd=e.std(0,ddof=1).tolist(), hll_rms=np.sqrt((e**2).mean(0)).tolist(),
      cm14_mean=cm14.mean(), cm14_sd=cm14.std(ddof=1), cm18_mean=cm18.mean(), cm18_sd=cm18.std(ddof=1), chi_mean=chi.mean(), chi_sd=chi.std(ddof=1),
      ams_mean=Z2.mean(), ams_sd=Z2.std(ddof=1), ams_sd_ratio=Z2.std(ddof=1)/ams_theory,
      ams_sd_boot_se=float(np.std([np.std(rng.choice(Z2,T),ddof=1) for _ in range(2000)])),
      hll_q05=np.quantile(e[:,4],.05), hll_q95=np.quantile(e[:,4],.95), hll_min=e[:,4].min(), hll_max=e[:,4].max(),
      cm18_max=cm18.max(), cm18_frac_above_1_1=(cm18>1.1).mean())
    out['rows']['%s_%s'%k]=rec
    print('%-7s %-6s T=%3d HLL@n med %+.3f sd %.3f | @1e4 med %+.3f sd %.3f | cm14 %.4f±%.4f cm18 %.4f±%.4f chi %.3f | AMS mean %.3f sd %.3f (ratio %.2f, boot se %.3f) | HLL q05 %+.3f q95 %+.3f min %+.3f max %+.3f | cm18 max %.3f'%(k[0],k[1],T,rec['hll_median'][4],rec['hll_sd'][4],rec['hll_median'][0],rec['hll_sd'][0],rec['cm14_mean'],rec['cm14_sd'],rec['cm18_mean'],rec['cm18_sd'],rec['chi_mean'],rec['ams_mean'],rec['ams_sd'],rec['ams_sd_ratio'],rec['ams_sd_boot_se'],rec['hll_q05'],rec['hll_q95'],rec['hll_min'],rec['hll_max'],rec['cm18_max']))
json.dump(out,open('fam_summary.json','w'),indent=1)
