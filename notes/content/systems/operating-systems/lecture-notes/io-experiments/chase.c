/* Dependent-load latency over working sets from 16 KiB to 1 GiB.
 * A random cyclic permutation of 64-byte lines defeats the prefetchers, so each
 * load waits for the previous one. Build: cc -O2 -o chase chase.c
 * Output: working-set bytes, ns per load (median of 5 passes). */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <time.h>
#include <sys/mman.h>
static double now(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*1e9+t.tv_nsec;}
static uint64_t rng=88172645463325252ull;
static uint64_t xr(void){rng^=rng<<13;rng^=rng>>7;rng^=rng<<17;return rng;}
static int cmp(const void*a,const void*b){double x=*(double*)a,y=*(double*)b;return x<y?-1:x>y;}
int main(void){
  size_t max=1ul<<30;
  char *buf=mmap(0,max,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
  madvise(buf,max,MADV_HUGEPAGE);
  for(size_t ws=16384; ws<=max; ws*=2){
    size_t n=ws/64; size_t *idx=malloc(n*sizeof *idx);
    for(size_t i=0;i<n;i++) idx[i]=i;
    for(size_t i=n-1;i>0;i--){size_t j=xr()%(i+1),t=idx[i];idx[i]=idx[j];idx[j]=t;}
    for(size_t i=0;i<n;i++) *(void**)(buf+idx[i]*64)=buf+idx[(i+1)%n]*64;
    free(idx);
    long steps=20000000; double r[5]; void *p=buf;
    for(long i=0;i<(long)n*2;i++) p=*(void**)p; /* warm */
    for(int k=0;k<5;k++){double t=now(); for(long i=0;i<steps;i++) p=*(void**)p; r[k]=(now()-t)/steps;}
    qsort(r,5,sizeof *r,cmp);
    printf("%zu %.2f %p\n",ws,r[2],p==0?(void*)1:(void*)0);
    fflush(stdout);
  }
}
