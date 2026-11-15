---
title: Latency, Throughput, and Utilization
category: Performance Engineering
tags:
  - performance engineering
  - latency
  - throughput
  - utilization
  - queueing
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: A compact model of service time, arrival rate, queueing and the bottlenecks they produce, with Little's Law, the bottleneck law, saturation behavior, and the limits of analysis based on means.
sources:
  - title: Millsap (2010), Thinking Clearly about Performance
    url: https://queue.acm.org/detail.cfm?id=1854041
    type: paper
  - title: Brewer, CS262 queueing theory notes
    url: https://people.eecs.berkeley.edu/~brewer/cs262/queueing.pdf
    type: lecture
---

Latency (response time) is the time from a request's arrival to its completion, throughput is the rate at which requests complete, and utilization is the fraction of time a resource is busy. For a service stage with a given arrival rate and service time, these quantities are related by a few laws that require few assumptions: the utilization law, Little's Law and the bottleneck law. Together they identify the resource that limits a system and estimate how close that resource is to saturation.

More detailed queueing analysis is in [[systems/operating-systems/v2-concurrency/7-queueing-theory|Queueing Theory]], and the distribution of response time is treated in [[systems/performance/tail-latency-percentiles|Tail Latency and Percentiles]].

## The four numbers

Consider a single service stage, described by four quantities.

- arrival rate: $\lambda$ requests per second
- service time: $S$ seconds of work per request
- throughput: $X$ completed requests per second
- response time: $R$ seconds from arrival to completion

If the stage is stable, then $X \approx \lambda$. If requests arrive faster than the stage can serve them, a queue grows until an upstream component throttles, times out or drops work.

## Utilization

Utilization is the fraction of time the stage is busy. For a single server,

$\rho = \lambda S$

and the stage can stay stable only when $\rho < 1$.

High average utilization therefore increases latency sharply. As $\rho$ approaches 1, the idle time between requests becomes too short to absorb even small bursts, and queueing delay comes to dominate service time.

## Response time

Response time splits into

$R = W_q + S$

where $W_q$ is time spent waiting in the queue and $S$ is time spent being served.

The decomposition often suffices to localize a latency problem. A large $S$ calls for reducing the work per request. A large $W_q$ calls for reducing load, smoothing bursts, adding capacity or shortening the critical section that serializes requests.

## Little's Law

Little's Law requires almost no assumptions. For any stable system observed over a long window,

$$
N = X \cdot R
$$

The average number of requests in the system equals the throughput times the average time each request spends inside. The law follows from an accounting identity. Over a long interval $T$, each of the $XT$ completed requests contributes its residence time to the total request-seconds observed, and dividing total request-seconds by $T$ is exactly the time-average occupancy $N$. No distributional or scheduling assumptions enter, so the law applies to any boundary drawn around part of a system, such as a whole service, one queue, a thread pool or a connection pool.

In practice the law gives the third quantity from two measured ones. A service handling $X = 2{,}000$ req/s with $N = 300$ requests in flight has $R = N/X = 150$ ms, even if latency is not instrumented. Applied in the other direction, the law sizes concurrency. Sustaining 2,000 req/s at 150 ms requires capacity for 300 concurrent requests (threads, connections or whatever the unit of in-flight work is), and a pool capped at 100 limits throughput to $100/0.15 \approx 667$ req/s regardless of the backend's speed.

## Bottlenecks

A bottleneck is the stage with the highest demand relative to its capacity. If stage $i$ needs $S_i$ seconds of a resource per request, then its maximum throughput is roughly

$X_i^{max} \approx 1 / S_i$

for one server, or $m_i / S_i$ for $m_i$ identical servers. The **bottleneck law** for a pipeline follows directly. System throughput is bounded by the stage with the lowest capacity,

$$
X \le \min_i \frac{m_i}{S_i},
$$

and at that bound the bottleneck runs at $\rho = 1$ while the other stages run below full utilization. Two corollaries are useful for diagnosis. Optimizing a stage other than the bottleneck does not change system throughput; [Millsap](https://queue.acm.org/detail.cfm?id=1854041) describes work on anything but the constraint as an illusion of progress. The bottleneck also moves once it is relieved, to the stage with the next-highest demand, so capacity planning is an iterative process of repeated calculation.

## The saturation curve

A queueing model gives a definite form to the growth of response time with utilization. For exponential arrivals and service (M/M/1; derivation in [[systems/operating-systems/v2-concurrency/7-queueing-theory|Queueing Theory]]):

$$
R = \frac{S}{1 - \rho}
$$

| $\rho$ | 0.5 | 0.8 | 0.9 | 0.95 | 0.99 |
| --- | --- | --- | --- | --- | --- |
| $R/S$ | 2 | 5 | 10 | 20 | 100 |

The pole at $\rho = 1$ separates two regimes. In the **stable** regime ($\lambda < \mu$), queues form and drain, response time is finite, and the table gives the response time at each level of headroom. In the **unstable** regime ($\lambda \ge \mu$), the queue grows without bound and $R$ depends on elapsed *time* rather than on load, because every second of overload adds to a backlog that must be drained; throughput stays at $\mu$ while arrivals accumulate. Past saturation, the backlog and the response time grow linearly with time. A simulation that confirms the table, and the effects of variance and burstiness that the M/M/1 model omits, are in [[systems/operating-systems/v2-concurrency/7-queueing-theory|Queueing Theory]].

> [!warning] Past saturation, latency is a function of time, not load
> The $R = S/(1-\rho)$ curve describes only the stable regime. At $\rho \ge 1$ there is no steady state; every second of overload adds $\lambda - \mu$ requests to a backlog that must be drained before latency recovers. On a dashboard this appears as throughput flat at capacity while latency increases linearly with wall-clock time and remains high after load drops, until the backlog drains.

The curve also accounts for the knee heuristic. Below $\rho \approx 0.7$-0.8, added load increases latency little; above it, each additional point of utilization increases latency more than the previous one. Operators leave headroom because response time is a convex function of utilization.

## Finite buffers and dropped work

Queues in deployed systems are bounded. A finite buffer converts unbounded delay into loss; when the queue is full, arrivals are dropped (or rejected, or timed out upstream). The bound is a deliberate tradeoff. A bounded queue limits the worst-case $W_q$ of a request to (buffer length) x $S$, at the cost of serving less than the offered load. Under sustained overload a bounded queue is strictly preferable to an unbounded one, because an unbounded queue eventually holds only requests whose clients have already timed out. The server then performs the full work of each request to produce responses that no client receives, which is the mechanism of congestion collapse. Choosing the bound amounts to choosing the worst latency the system will serve; admission control and load shedding apply the same idea deliberately.

## Limitations of averages

Little's Law, the bottleneck law and the M/M/1 formula are stated in terms of means, which conceal two properties of a workload. The first is the *distribution* of $R$. At $\rho$ near 1 the tail grows faster than the mean (for M/M/1 the p99 is 4.6x the mean, and both scale as $1/(1-\rho)$), so an SLO on p99 is violated at a considerably lower load than a capacity plan based on the mean predicts. The second is *mixtures*. A mean over two request classes, or over bursty and quiet periods, describes no actual request, and burstiness increases queueing delay at the same average $\rho$ (worked example in [[systems/operating-systems/v2-concurrency/7-queueing-theory|Queueing Theory]]). Capacity can be planned with these formulas, while objectives and dashboards are better stated in percentiles; the argument is developed in [[systems/performance/tail-latency-percentiles|Tail Latency, Percentiles, and Queueing Distributions]].

## Worked example

A request touches an API server ($S = 2$ ms CPU) and a database ($S = 8$ ms). The offered load is 100 req/s. The resulting utilizations are $\rho = 0.2$ for the API and $\rho = 0.8$ for the DB, so the DB is the bottleneck and bounds throughput at 125 req/s. With $R \approx 2 + 8/(1-0.8) = 42$ ms, Little's Law gives an expected in-flight count of $N = 100 \times 0.042 = 4.2$ requests. If the measured $N$ is 40, the measured $R$ must be about 400 ms, and in the model DB queueing is the only term that can be that large, which identifies it before any profiling. Doubling DB capacity ($m = 2$) lowers its $\rho$ to 0.4 and its response time to $\approx 8/(1-0.4) = 13$ ms; optimizing the API, at $\rho = 0.2$, would have had little effect.

## Related notes

- [[systems/operating-systems/v2-concurrency/7-queueing-theory|queueing theory]]
- [[systems/performance/tail-latency-percentiles|tail latency, percentiles, and queueing distributions]]
- [[systems/performance/streaming|Streaming Data]]
- [[ml/serving-systems/performance-modeling|performance modeling for model serving]]
- [[systems/scheduling/0-foundations/littles-law-and-bottleneck-analysis|Little's Law and bottleneck analysis]]
- [[ml/serving-systems/distributed-training|distributed training of LLMs]] (throughput, MFU, and goodput for training clusters)

## Sources

- [Millsap (2010), Thinking Clearly about Performance, ACM Queue](https://queue.acm.org/detail.cfm?id=1854041)
- [Brewer, CS262 queueing theory notes](https://people.eecs.berkeley.edu/~brewer/cs262/queueing.pdf)
