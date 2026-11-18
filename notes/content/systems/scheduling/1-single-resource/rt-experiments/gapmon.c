// Busy-loop on the calling CPU under SCHED_FIFO 90 (or SCHED_OTHER with "cfs"),
// record every gap > 200 us between consecutive CLOCK_MONOTONIC reads.
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sched.h>
#include <time.h>
#include <sys/mman.h>
#include <unistd.h>
static long long ns(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*1000000000LL+t.tv_nsec;}
static long long steal3(void){FILE*f=fopen("/proc/stat","r");char l[512];long long s=-1;while(fgets(l,sizeof l,f))if(!strncmp(l,"cpu3 ",5)){long long v[10];sscanf(l+5,"%lld %lld %lld %lld %lld %lld %lld %lld",&v[0],&v[1],&v[2],&v[3],&v[4],&v[5],&v[6],&v[7]);s=v[7];}fclose(f);return s;}
int main(int c,char**v){
  int secs=atoi(v[2]); FILE*f=fopen(v[3],"w"); fprintf(f,"%d\n",getpid()); fclose(f);
  mlockall(MCL_CURRENT|MCL_FUTURE);
  if(!strcmp(v[1],"fifo")){struct sched_param p={.sched_priority=90}; if(sched_setscheduler(0,SCHED_FIFO,&p)){perror("fifo");return 1;}}
  long long s0=steal3(), t0=ns(), prev=t0, end=t0+secs*1000000000LL; int n=0; long long tot=0;
  static long long at[100000], g[100000];
  while(prev<end){long long t=ns(); long long d=t-prev; if(d>200000&&n<100000){at[n]=t-t0;g[n]=d;n++;tot+=d;} prev=t;}
  long long s1=steal3();
  printf("gaps>200us %d total_ms %.1f steal_jiffies %lld\n",n,tot/1e6,s1-s0);
  // top 10
  for(int k=0;k<10&&k<n;k++){int b=0;for(int i=1;i<n;i++)if(g[i]>g[b])b=i; printf("  at %.3f s gap %.2f ms\n",at[b]/1e9,g[b]/1e6); g[b]=-1;}
  return 0;}
