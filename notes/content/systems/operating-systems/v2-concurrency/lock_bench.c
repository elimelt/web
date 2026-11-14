// lock_bench.c: throughput and fairness of a shared counter protected by
// different locks, as the number of threads rises.
//
// Every thread loops: acquire, counter++, release, until a stop flag is set.
// There is no work outside the critical section, so this is the worst case
// for contention: every thread wants the lock all the time.
//
// Build: gcc -O2 -pthread -o lock_bench lock_bench.c
// Run:   ./lock_bench <lock> <threads> <millis>
//        lock is one of: racy atomic tas ttas ticket mcs mutex
// Prints one CSV line:
//   lock,threads,millis,total_ops,ops_per_sec,min_thread_ops,max_thread_ops,final_counter
//
// "racy" is not a lock: it does counter = counter + 1 as a separate atomic
// load and atomic store (relaxed), which is exactly the load/add/store race.
// final_counter < total_ops counts the lost updates.
// "atomic" is not a lock either: one lock-free fetch_add per operation.

#define _GNU_SOURCE
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define CACHELINE 64
#define MAX_THREADS 256

static inline void cpu_relax(void) {
#if defined(__x86_64__) || defined(__i386__)
  __builtin_ia32_pause();
#else
  __asm__ __volatile__("" ::: "memory");
#endif
}

// ---- Locks -----------------------------------------------------------------

// Test-and-set: hammer an atomic exchange until it returns 0.
typedef struct {
  _Alignas(CACHELINE) atomic_int held;
} tas_lock;
static void tas_acquire(tas_lock *l) {
  while (atomic_exchange_explicit(&l->held, 1, memory_order_acquire))
    ;
}
static void tas_release(tas_lock *l) {
  atomic_store_explicit(&l->held, 0, memory_order_release);
}

// Test-and-test-and-set: spin on a plain load (served from the local cache)
// and only try the exchange when the lock looks free.
static void ttas_acquire(tas_lock *l) {
  for (;;) {
    while (atomic_load_explicit(&l->held, memory_order_relaxed))
      cpu_relax();
    if (!atomic_exchange_explicit(&l->held, 1, memory_order_acquire))
      return;
  }
}

// Ticket lock: take a number, wait until it is served. FIFO.
typedef struct {
  _Alignas(CACHELINE) atomic_uint next;
  _Alignas(CACHELINE) atomic_uint serving;
} ticket_lock;
static void ticket_acquire(ticket_lock *l) {
  unsigned me = atomic_fetch_add_explicit(&l->next, 1, memory_order_relaxed);
  while (atomic_load_explicit(&l->serving, memory_order_acquire) != me)
    cpu_relax();
}
static void ticket_release(ticket_lock *l) {
  unsigned s = atomic_load_explicit(&l->serving, memory_order_relaxed);
  atomic_store_explicit(&l->serving, s + 1, memory_order_release);
}

// MCS lock (Mellor-Crummey and Scott 1991): each waiter spins on its own
// node, so a release touches one other cache line instead of all of them.
typedef struct mcs_node {
  _Alignas(CACHELINE) _Atomic(struct mcs_node *) next;
  atomic_int locked;
} mcs_node;
typedef struct {
  _Alignas(CACHELINE) _Atomic(mcs_node *) tail;
} mcs_lock;
static void mcs_acquire(mcs_lock *l, mcs_node *me) {
  atomic_store_explicit(&me->next, NULL, memory_order_relaxed);
  atomic_store_explicit(&me->locked, 1, memory_order_relaxed);
  mcs_node *prev = atomic_exchange_explicit(&l->tail, me, memory_order_acq_rel);
  if (prev) {
    atomic_store_explicit(&prev->next, me, memory_order_release);
    while (atomic_load_explicit(&me->locked, memory_order_acquire))
      cpu_relax();
  }
}
static void mcs_release(mcs_lock *l, mcs_node *me) {
  mcs_node *succ = atomic_load_explicit(&me->next, memory_order_acquire);
  if (!succ) {
    mcs_node *expected = me;
    if (atomic_compare_exchange_strong_explicit(&l->tail, &expected, NULL,
                                                memory_order_acq_rel,
                                                memory_order_relaxed))
      return;
    while (!(succ = atomic_load_explicit(&me->next, memory_order_acquire)))
      cpu_relax();
  }
  atomic_store_explicit(&succ->locked, 0, memory_order_release);
}

// ---- Benchmark -------------------------------------------------------------

enum kind { RACY, ATOMIC, TAS, TTAS, TICKET, MCS, MUTEX };
static const char *names[] = {"racy", "atomic", "tas", "ttas",
                              "ticket", "mcs", "mutex"};

static enum kind kind;
static atomic_int stop;
static atomic_int go;

static tas_lock tl;
static ticket_lock kl;
static mcs_lock ml;
static pthread_mutex_t mx = PTHREAD_MUTEX_INITIALIZER;

static struct {
  _Alignas(CACHELINE) atomic_ulong value;
} counter;

typedef struct {
  _Alignas(CACHELINE) unsigned long ops;
  mcs_node node;
} worker;
static worker workers[MAX_THREADS];

// The critical section: a load and a store of the shared counter. Relaxed
// atomics keep the compiler from caching it in a register; the lock (when
// there is one) provides the ordering.
static inline void bump(void) {
  unsigned long v = atomic_load_explicit(&counter.value, memory_order_relaxed);
  atomic_store_explicit(&counter.value, v + 1, memory_order_relaxed);
}

static void *run(void *arg) {
  worker *w = arg;
  unsigned long n = 0;
  while (!atomic_load(&go))
    cpu_relax();
  while (!atomic_load_explicit(&stop, memory_order_relaxed)) {
    switch (kind) {
    case RACY: bump(); break;
    case ATOMIC:
      atomic_fetch_add_explicit(&counter.value, 1, memory_order_relaxed);
      break;
    case TAS: tas_acquire(&tl); bump(); tas_release(&tl); break;
    case TTAS: ttas_acquire(&tl); bump(); tas_release(&tl); break;
    case TICKET: ticket_acquire(&kl); bump(); ticket_release(&kl); break;
    case MCS: mcs_acquire(&ml, &w->node); bump(); mcs_release(&ml, &w->node); break;
    case MUTEX: pthread_mutex_lock(&mx); bump(); pthread_mutex_unlock(&mx); break;
    }
    n++;
  }
  w->ops = n;
  return NULL;
}

int main(int argc, char **argv) {
  if (argc != 4) {
    fprintf(stderr, "usage: %s racy|atomic|tas|ttas|ticket|mcs|mutex threads millis\n", argv[0]);
    return 2;
  }
  int found = 0;
  for (int i = 0; i < (int)(sizeof names / sizeof *names); i++)
    if (!strcmp(argv[1], names[i])) { kind = i; found = 1; }
  int threads = atoi(argv[2]);
  int millis = atoi(argv[3]);
  if (!found || threads < 1 || threads > MAX_THREADS || millis < 1) {
    fprintf(stderr, "bad arguments\n");
    return 2;
  }

  pthread_t tid[MAX_THREADS];
  for (int i = 0; i < threads; i++)
    pthread_create(&tid[i], NULL, run, &workers[i]);

  struct timespec t0, t1;
  clock_gettime(CLOCK_MONOTONIC, &t0);
  atomic_store(&go, 1);
  usleep(millis * 1000);
  atomic_store(&stop, 1);
  clock_gettime(CLOCK_MONOTONIC, &t1);
  // Each thread finishes at most one more operation after the flag; that
  // is at most `threads` operations past t1, negligible against millions.
  for (int i = 0; i < threads; i++)
    pthread_join(tid[i], NULL);
  double secs = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;

  unsigned long total = 0, lo = ~0UL, hi = 0;
  for (int i = 0; i < threads; i++) {
    unsigned long o = workers[i].ops;
    total += o;
    if (o < lo) lo = o;
    if (o > hi) hi = o;
  }
  unsigned long final = atomic_load(&counter.value);
  if (kind != RACY && final != total) {
    fprintf(stderr, "%s: counter %lu != ops %lu: mutual exclusion broken\n",
            names[kind], final, total);
    return 1;
  }
  printf("%s,%d,%d,%lu,%.0f,%lu,%lu,%lu\n", names[kind], threads, millis, total,
         total / secs, lo, hi, final);
  return 0;
}
