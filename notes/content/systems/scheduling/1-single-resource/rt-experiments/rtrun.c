// rtrun: release a periodic task set on one CPU under SCHED_FIFO with
// rate-monotonic priorities ("rm") or under SCHED_DEADLINE ("edf"), and
// report every job's response time against its implicit deadline (D = T).
//
// usage: rtrun rm|edf DURATION_MS BUDGET_PCT [CPUSET_TASKS_FILE [SLACK_US]] < tasks
//   tasks: one "C_us T_us" pair per line.
//   SCHED_DEADLINE runtime = C * (100 + BUDGET_PCT) / 100 + SLACK_US (default
//   200 us). The runtime is only an overrun guard: the wakeup path and the
//   clock reads are charged to the thread, and a job that exceeds its runtime
//   is throttled until its next period. Threads ask for SIGXCPU on overrun
//   (SCHED_FLAG_DL_OVERRUN); the count is printed to stderr as "overruns N".
// Each job spins until its thread has consumed C of CPU time
// (CLOCK_THREAD_CPUTIME_ID), so C is the job's execution time exactly and
// preemption does not change the amount of work. Output, one line per job:
//   task release_ns start_ns finish_ns response_ns missed(0/1)
// (times relative to the synchronous release t0; start is when the job first
// ran after its release, so start - release is release latency.)
#define _GNU_SOURCE
#include <errno.h>
#include <linux/sched.h>
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

struct sched_attr_k {
  uint32_t size, sched_policy;
  uint64_t sched_flags;
  int32_t sched_nice;
  uint32_t sched_priority;
  uint64_t sched_runtime, sched_deadline, sched_period;
};

#define MAXT 32
#define MAXJ 200000
typedef struct { int task; int64_t rel, start, fin; } job_t;

static int n, edf, budget_pct;
static int64_t slack_ns = 200000;
static atomic_int overruns;
static void on_xcpu(int sig) { (void)sig; atomic_fetch_add(&overruns, 1); }
static int64_t C[MAXT], T[MAXT], dur_ns, t0;
static int prio[MAXT];
static job_t *jobs[MAXT];
static int njobs[MAXT];
static pthread_barrier_t bar;
static volatile int setup_err;

static int64_t now(clockid_t c) {
  struct timespec ts; clock_gettime(c, &ts);
  return (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

static void *worker(void *arg) {
  int i = (int)(intptr_t)arg;
  if (edf) {
    struct sched_attr_k a = {0};
    a.size = sizeof a; a.sched_policy = SCHED_DEADLINE;
    a.sched_flags = 0x04;  // SCHED_FLAG_DL_OVERRUN: SIGXCPU when a job overruns its runtime
    a.sched_runtime = (uint64_t)(C[i] * (100 + budget_pct) / 100 + slack_ns);
    a.sched_deadline = a.sched_period = (uint64_t)T[i];
    if (syscall(SYS_sched_setattr, 0, &a, 0)) {
      fprintf(stderr, "sched_setattr task %d: %s\n", i, strerror(errno));
      setup_err = 1;
    }
  } else {
    struct sched_param p = {.sched_priority = prio[i]};
    if (pthread_setschedparam(pthread_self(), SCHED_FIFO, &p)) {
      fprintf(stderr, "SCHED_FIFO task %d failed\n", i); setup_err = 1;
    }
  }
  pthread_barrier_wait(&bar);
  pthread_barrier_wait(&bar);  // main sets t0 between the two barriers
  if (setup_err) return NULL;
  for (int64_t k = 0;; k++) {
    int64_t rel = t0 + k * T[i];
    if (rel - t0 >= dur_ns || njobs[i] >= MAXJ) break;
    struct timespec ts = {rel / 1000000000LL, rel % 1000000000LL};
    while (clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &ts, NULL) == EINTR) {}
    int64_t start = now(CLOCK_MONOTONIC);
    int64_t c0 = now(CLOCK_THREAD_CPUTIME_ID);
    while (now(CLOCK_THREAD_CPUTIME_ID) - c0 < C[i]) {}
    int64_t fin = now(CLOCK_MONOTONIC);
    jobs[i][njobs[i]++] = (job_t){i, rel - t0, start - t0, fin - t0};
  }
  return NULL;
}

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: rtrun rm|edf DURATION_MS BUDGET_PCT [cpuset tasks file] < tasks\n"); return 2; }
  edf = !strcmp(argv[1], "edf");
  dur_ns = atoll(argv[2]) * 1000000LL;
  budget_pct = atoi(argv[3]);
  if (argc > 5) slack_ns = atoll(argv[5]) * 1000LL;
  signal(SIGXCPU, on_xcpu);
  if (argc > 4) {
    FILE *f = fopen(argv[4], "w");
    if (!f || fprintf(f, "%d\n", getpid()) < 0 || fclose(f)) { perror("cpuset"); return 1; }
  }
  long long c, t;
  while (n < MAXT && scanf("%lld %lld", &c, &t) == 2) { C[n] = c * 1000; T[n] = t * 1000; n++; }
  // Rate-monotonic priorities: shorter period -> higher SCHED_FIFO priority.
  for (int i = 0; i < n; i++) {
    int rank = 0;
    for (int j = 0; j < n; j++) if (T[j] < T[i] || (T[j] == T[i] && j < i)) rank++;
    prio[i] = 90 - rank;
  }
  if (mlockall(MCL_CURRENT | MCL_FUTURE)) perror("mlockall");
  struct sched_param mp = {.sched_priority = 95};
  sched_setscheduler(0, SCHED_FIFO, &mp);  // main thread outranks the workers while it sets up
  pthread_barrier_init(&bar, NULL, n + 1);
  pthread_t th[MAXT];
  for (int i = 0; i < n; i++) {
    jobs[i] = calloc(MAXJ, sizeof(job_t));
    pthread_create(&th[i], NULL, worker, (void *)(intptr_t)i);
  }
  pthread_barrier_wait(&bar);
  t0 = now(CLOCK_MONOTONIC) + 50000000LL;  // synchronous release 50 ms from now
  pthread_barrier_wait(&bar);
  for (int i = 0; i < n; i++) pthread_join(th[i], NULL);
  if (setup_err) return 3;
  fprintf(stderr, "overruns %d\n", atomic_load(&overruns));
  for (int i = 0; i < n; i++)
    for (int k = 0; k < njobs[i]; k++) {
      job_t *j = &jobs[i][k];
      int64_t r = j->fin - j->rel;
      printf("%d %lld %lld %lld %lld %d\n", i, (long long)j->rel, (long long)j->start, (long long)j->fin, (long long)r, r > T[i]);
    }
  return 0;
}
