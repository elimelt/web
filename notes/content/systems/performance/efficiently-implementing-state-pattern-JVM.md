---
title: JVM Performance with State Pattern Optimizations
aliases:
  - performance-engineering/efficiently-implementing-state-pattern-JVM
category: Performance Engineering
tags:
  - jvm
  - state-pattern
  - performance-optimization
  - multithreading
  - atomic-reference
  - benchmarks
date: 2024-12-08
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
description: A comparison of an enum-based inline state pattern and a polymorphic state pattern using AtomicReference on the JVM, with single-threaded and multi-threaded timing runs. Hardware, JVM version and the full benchmark harness were not recorded.
sources:
  - title: "State pattern (Refactoring Guru)"
    url: https://refactoring.guru/design-patterns/state
    type: docs
---

The state pattern lets an object change its behavior when its internal state changes, by delegating state-dependent behavior to an object that represents the current state ([Refactoring Guru's state pattern page](https://refactoring.guru/design-patterns/state) describes it in detail). On the JVM it can be implemented with enum constants whose transitions are written inline, or with polymorphic state classes whose current instance is held in an `AtomicReference`. The two implementations differ in dispatch and synchronization cost, and the difference is most relevant when several threads drive transitions concurrently.

I made the comparison after reading an implementation of the state pattern written by a senior engineer on my team at AWS; nothing specific to that code is described. The state pattern addresses logical complexity and structure, and the question here is the performance of the underlying implementations, particularly with multiple threads.

The hardware, OS and JVM version were not recorded, and the `benchmark` helper and the two pattern classes are not reproduced, so the numbers are a single anecdote and not a reproducible result. Comparisons within a single run remain informative because both implementations ran in the same environment.

## The implementations

1. **Inline state pattern using enums.** In `InlineStatePattern`, states are enums with direct in-line transitions. A state change is a check and an assignment.
2. **Polymorphic state pattern with lazy transitions.** In `PolymorphicStatePattern`, a generic context holds the current state in an `AtomicReference` for thread-safe transitions. Lazy evaluation changes the state only when necessary, which can reduce overhead in some cases.

## When each implementation applies

The inline pattern suits transitions that are simple and predictable in components where synchronization overhead matters, for example a high-throughput cache or a message queue with little locking.

The polymorphic pattern suits transitions that are complex or require additional logic, and concurrent access that requires the safety of `AtomicReference`. Contention level is a rough guide and does not decide the choice by itself. Even with low contention, complex transitions can justify the polymorphic version purely for readability and maintainability.

## JVM costs of each approach

The enum version keeps each transition to an assignment with no extra method dispatch or object creation. Each `DocumentState` enum implements its own `handle` and `nextState` methods, and the transition is simple enough that the JIT can inline it at runtime.

The `AtomicReference` version obtains thread safety through compare-and-swap (CAS) operations. Under high contention, failed CAS attempts are retried, which consumes cycles. With lazy state transitions, this implementation can skip unnecessary state updates, which may help when contention is low.

## Predictions

1. **Single-threaded.** `InlineStatePattern` should be faster because it avoids `AtomicReference` overhead.
2. **Multi-threaded.** At low contention, `InlineStatePattern` should still be faster because it has fewer synchronization requirements. Under high contention, CAS retries in `PolymorphicStatePattern` may limit its performance.

## Results

### Single-threaded

```java
Document doc1 = new InlineStatePattern.Document("Single-threaded Test");
benchmark("Optimized State Pattern - Single Thread", 10_000_000, doc1::handleState);

Document doc2 = new PolymorphicStatePattern.Document("Single-threaded Test");
benchmark("Generic State Pattern - Single Thread", 10_000_000, doc2::handleState);
```

```txt
Inline State Pattern - Single Thread: 201363 µs for 10000000 iterations (0.02 µs/op) - Last result: Published: Single-threaded Test
Polymorphic State Pattern - Single Thread: 133314 µs for 10000000 iterations (0.01 µs/op) - Last result: Published: Single-threaded Test
```

The prediction was wrong. The polymorphic version completed 10M iterations in 133 ms against 201 ms for the inline version, so an uncontended `AtomicReference` cost less here than the per-transition overhead of the inline version. A single-shot loop of this kind is also sensitive to JIT warmup and run ordering, as the low-contention runs show.

### Multi-threaded, low contention

```java
Document sharedDoc1 = new InlineStatePattern.Document("Multi-thread Test");
Thread[] threads1 = new Thread[4];
for (int i = 0; i < threads1.length; i++) {
    threads1[i] = new Thread(() -> {
        benchmark("Optimized Pattern - Multi-thread Low Contention", 2_500_000, sharedDoc1::handleState);
    });
    threads1[i].start();
}

Document sharedDoc2 = new PolymorphicStatePattern.Document("Multi-thread Test");
Thread[] threads2 = new Thread[4];
for (int i = 0; i < threads2.length; i++) {
    threads2[i] = new Thread(() -> {
        benchmark("Generic Pattern - Multi-thread Low Contention", 2_500_000, sharedDoc2::handleState);
    });
    threads2[i].start();
}
```

First run, both tests in one JVM:

```txt
Polymorphic Pattern - Multi-thread Low Contention: 339159 µs for 2500000 iterations (0.14 µs/op) - Last result: Published: Multi-thread Test
Polymorphic Pattern - Multi-thread Low Contention: 360859 µs for 2500000 iterations (0.14 µs/op) - Last result: Published: Multi-thread Test
Polymorphic Pattern - Multi-thread Low Contention: 348844 µs for 2500000 iterations (0.14 µs/op) - Last result: Published: Multi-thread Test
Polymorphic Pattern - Multi-thread Low Contention: 375313 µs for 2500000 iterations (0.15 µs/op) - Last result: Published: Multi-thread Test
Inline Pattern - Multi-thread Low Contention: 342431 µs for 2500000 iterations (0.14 µs/op) - Last result: Published: Multi-thread Test
Inline Pattern - Multi-thread Low Contention: 368308 µs for 2500000 iterations (0.15 µs/op) - Last result: Published: Multi-thread Test
Inline Pattern - Multi-thread Low Contention: 368001 µs for 2500000 iterations (0.15 µs/op) - Last result: Published: Multi-thread Test
Inline Pattern - Multi-thread Low Contention: 385776 µs for 2500000 iterations (0.15 µs/op) - Last result: Published: Multi-thread Test
```

The two were close, with per-thread averages of 356043.75 µs (0.1424 µs/op) for polymorphic and 366129.0 µs (0.1465 µs/op) for inline. The inline pattern was slightly slower. To test whether run order explained the result, I swapped the order of the tests:

```txt
Polymorphic Pattern - Multi-thread Low Contention: 494816 µs for 2500000 iterations (0.20 µs/op) - Last result: Published: Multi-thread Test
Polymorphic Pattern - Multi-thread Low Contention: 481862 µs for 2500000 iterations (0.19 µs/op) - Last result: Published: Multi-thread Test
Polymorphic Pattern - Multi-thread Low Contention: 491883 µs for 2500000 iterations (0.20 µs/op) - Last result: Published: Multi-thread Test
Polymorphic Pattern - Multi-thread Low Contention: 492075 µs for 2500000 iterations (0.20 µs/op) - Last result: Published: Multi-thread Test
Inline Pattern - Multi-thread Low Contention: 455870 µs for 2500000 iterations (0.18 µs/op) - Last result: Published: Multi-thread Test
Inline Pattern - Multi-thread Low Contention: 491346 µs for 2500000 iterations (0.20 µs/op) - Last result: Published: Multi-thread Test
Inline Pattern - Multi-thread Low Contention: 483745 µs for 2500000 iterations (0.19 µs/op) - Last result: Published: Multi-thread Test
Inline Pattern - Multi-thread Low Contention: 475941 µs for 2500000 iterations (0.19 µs/op) - Last result: Published: Multi-thread Test
```

This time the averages were 490159.0 µs (0.1961 µs/op) polymorphic and 476725.5 µs (0.1907 µs/op) inline, so the faster implementation changed with the ordering.

To remove the effect of ordering, I ran each test in its own JVM instance:

```txt
Polymorphic Pattern - Multi-thread Low Contention: 372321 µs for 2500000 iterations (0.15 µs/op) - Last result: Published: Multi-thread Test
Polymorphic Pattern - Multi-thread Low Contention: 387558 µs for 2500000 iterations (0.16 µs/op) - Last result: Published: Multi-thread Test
Polymorphic Pattern - Multi-thread Low Contention: 402434 µs for 2500000 iterations (0.16 µs/op) - Last result: Published: Multi-thread Test
Polymorphic Pattern - Multi-thread Low Contention: 407174 µs for 2500000 iterations (0.16 µs/op) - Last result: Published: Multi-thread Test
```

```txt
Inline Pattern - Multi-thread Low Contention: 397600 µs for 2500000 iterations (0.16 µs/op) - Last result: Published: Multi-thread Test
Inline Pattern - Multi-thread Low Contention: 398064 µs for 2500000 iterations (0.16 µs/op) - Last result: Published: Multi-thread Test
Inline Pattern - Multi-thread Low Contention: 392855 µs for 2500000 iterations (0.16 µs/op) - Last result: Published: Multi-thread Test
Inline Pattern - Multi-thread Low Contention: 419996 µs for 2500000 iterations (0.17 µs/op) - Last result: Published: Multi-thread Test
```

In separate JVMs the averages were 392371.75 µs (0.1569 µs/op) polymorphic and 402128.75 µs (0.1609 µs/op) inline. The inline pattern was again slower, by about 2%.

### High contention

```java
Document highContDoc1 = new InlineStatePattern.Document("High Contention Test");
Document highContDoc2 = new PolymorphicStatePattern.Document("High Contention Test");

for (int i = 0; i < 8; i++) {
    new Thread(() -> {
        benchmark("Optimized Pattern - High Contention", 1_250_000, highContDoc1::handleState);
    }).start();
}

for (int i = 0; i < 8; i++) {
    new Thread(() -> {
        benchmark("Generic Pattern - High Contention", 1_250_000, highContDoc2::handleState);
    }).start();
}
```

The prediction was that CAS retries would degrade `PolymorphicStatePattern` as the thread count rises. The output of this run was not recorded, so the high-contention case remains open.

## What the numbers say

The measurements contradict the initial prediction. The polymorphic pattern with `AtomicReference` matched or outperformed the enum-based inline pattern in every run whose output was kept, by 34% single-threaded and by 2% to 3% at 4 threads in the isolated-JVM runs. The differences in the low-contention runs are close to the run-to-run variation, as the order-swap experiment shows, so at this contention level the two implementations cost about the same and the safety of `AtomicReference` added no measurable overhead. Absent profiler evidence to the contrary, maintainability is a reasonable basis for choosing between them. A more rigorous comparison would use JMH, record the JVM and hardware, and include the high-contention run.
