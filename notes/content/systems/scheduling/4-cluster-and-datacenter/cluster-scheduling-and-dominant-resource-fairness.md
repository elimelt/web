---
title: Cluster Scheduling and Dominant Resource Fairness
category: Scheduling
tags:
  - scheduling
  - cluster scheduling
  - dominant resource fairness
  - mesos
  - placement
  - multi-resource fairness
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Scheduling when jobs compete for several resource types at once, covering the failure of single-resource fairness, DRF with its properties and the worked allocation from the DRF paper, placement and preemption tradeoffs, and the division of the problem in Mesos, YARN, Borg and Kubernetes.
sources:
  - title: "Mesos: A Platform for Fine-Grained Resource Sharing in the Data Center"
    url: https://www.usenix.org/event/nsdi11/tech/full_papers/Hindman.pdf
    type: paper
  - title: "Dominant Resource Fairness: Fair Allocation of Multiple Resource Types"
    url: https://www.usenix.org/system/files/conference/nsdi11/nsdi11-ghodsi.pdf
    type: paper
  - title: "Large-scale cluster management at Google with Borg"
    url: https://research.google/pubs/pub43438/
    type: paper
---

Cluster scheduling allocates the resources of a set of machines among users or frameworks whose tasks each demand a vector of resources (CPU, memory, GPUs, network bandwidth), and places those tasks on machines. Dominant Resource Fairness (DRF) defines a fair allocation of such vectors by equalizing each user's largest share of any single resource.

CPU scheduling divides one scalar quantity, processor time, so a fair share is a single fraction. When demands are vectors, a job may be dominated by CPU, memory, GPUs or network bandwidth, and a fair share must be defined in several dimensions.

## Dominant Share

Suppose cluster capacity is

$$
C = (C_{\text{cpu}}, C_{\text{mem}}, C_{\text{gpu}})
$$

and user $i$ currently holds allocation vector

$$
x_i = (x_{i,\text{cpu}}, x_{i,\text{mem}}, x_{i,\text{gpu}})
$$

The share of resource $r$ is

$$
s_{i,r} = \frac{x_{i,r}}{C_r}
$$

The **dominant share** is the largest coordinate:

$$
d_i = \max_r s_{i,r}
$$

DRF equalizes dominant shares rather than raw CPU or memory fractions.

## Limits of Single-Resource Fairness

If one job demands much CPU and little memory while another demands little CPU and much memory, equalizing only CPU shares does not produce a fair allocation, since one user can hold most of the memory while its CPU share remains small.

DRF measures each user on the resource of which it holds the largest fraction of cluster capacity, and uses that fraction as the coordinate along which shares are equalized.

## Small Example

Cluster capacity:

$$
(12 \text{ CPU}, 12 \text{ GB})
$$

Framework A task:

$$
(3 \text{ CPU}, 1 \text{ GB})
$$

Framework B task:

$$
(1 \text{ CPU}, 3 \text{ GB})
$$

After giving one task to each:

- A dominant share is $\max(3/12, 1/12) = 1/4$
- B dominant share is $\max(1/12, 3/12) = 1/4$

One task each is therefore balanced under DRF.

After two A tasks and one B task:

- A dominant share becomes $\max(6/12, 2/12) = 1/2$
- B dominant share stays $1/4$

The next allocation under DRF therefore goes to B.

> [!example] A further grant equalizes the shares
> With its second task, B holds (2 CPU, 6 GB), with dominant share $\max(2/12, 6/12) = 1/2$, equal to A's $1/2$. Progressive filling repeats this step: it grants the next task to the user with the lowest dominant share, so the shares rise together until some resource is exhausted.

## The DRF Paper's Example Allocation

The [DRF paper's](https://www.usenix.org/system/files/conference/nsdi11/nsdi11-ghodsi.pdf) running example is traced below as progressive filling, which repeatedly grants a task to the user with the *lowest* dominant share (script run in the repo venv; the trace is its verbatim output). The cluster has (9 CPU, 18 GB); user A's tasks need (1 CPU, 4 GB) and are memory-dominant, and user B's need (3 CPU, 1 GB) and are CPU-dominant:

| step | granted to | A tasks | A dom. share | B tasks | B dom. share | CPU used | mem used |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A | 1 | 4/18 = 0.222 | 0 | 0 | 1/9 | 4/18 |
| 2 | B | 1 | 0.222 | 1 | 3/9 = 0.333 | 4/9 | 5/18 |
| 3 | A | 2 | 0.444 | 1 | 0.333 | 5/9 | 9/18 |
| 4 | B | 2 | 0.444 | 2 | 0.667 | 8/9 | 10/18 |
| 5 | A | 3 | 0.667 | 2 | 0.667 | 9/9 | 14/18 |

Final allocation: A gets 3 tasks (3 CPU, 12 GB), B gets 2 tasks (6 CPU, 2 GB), dominant shares are equal at $2/3$, and the cluster's CPU is exhausted, so no further task fits. The users' shares are unequal on each single resource (A holds 2/3 of memory, B holds 2/3 of CPU); they are equal on the resource each user demands most, which is the fairness criterion DRF defines.

## Alternatives to DRF

The DRF paper evaluates several alternatives and identifies how each fails. **Asset fairness** (equalize the sum of resource shares) can leave a user better off *outside* the shared cluster than in it, violating **sharing incentive**. Equalizing per-resource shares independently can be manipulated by misreported demands. DRF satisfies the four properties the paper argues a datacenter allocator needs:

- **Sharing incentive**: every user does at least as well as under a static $1/n$ partition of the cluster.
- **Strategy-proofness**: a user cannot increase its allocation by inflating its stated demand. The property matters because users inflate their requests when doing so helps (the paper cites production examples).
- **Envy-freeness**: no user prefers another's allocation.
- **Pareto efficiency**: no allocation change helps someone without hurting someone else.

DRF is the max-min fairness of [[systems/scheduling/3-network-and-packet/fair-queueing-wfq-and-drr|fair queueing]] applied to dominant shares, with the same progressive-filling procedure and each user measured along its own dominant resource. Weighted DRF divides dominant shares by per-user weights, which defines priority classes in the same way as WFQ's weights.

## Placement and Fairness

Once DRF has determined which user receives resources next, the scheduler must still decide where to place the work, subject to:

- data locality
- anti-affinity
- fragmentation
- bin packing
- preemption cost

Many cluster schedulers therefore divide the problem into two parts:

- fair resource allocation policy
- placement policy

Mesos makes this division explicit through resource offers.

## Placement, Packing, and Preemption

Fairness determines *which user* receives resources, and placement determines *where* the work runs; the objectives of placement conflict with one another:

- **Locality**: a task should run near its data. Delay scheduling (waiting briefly for a slot on a machine that holds the data rather than accepting the first offer) recovers most locality at a small cost in latency.
- **Packing vs. fragmentation**: packing tasks tightly raises utilization but leaves irregular gaps that no pending task fits; [Borg](https://research.google/pubs/pub43438/) scores placements to balance packing against remaining capacity, and colocates latency-sensitive and batch work on the same machines to use capacity that would otherwise be stranded.
- **Anti-affinity and spreading**: replicas of one service must not share failure domains, which works directly against packing.
- **Preemption**: when a high-priority job arrives and no placement fits, the scheduler evicts lower-priority tasks. Preemption costs little for stateless batch work with checkpoints and much for tasks with warm state. Frequent preemption itself reduces utilization, so schedulers rate-limit it and preferentially preempt the newest or least-progressed tasks.

## Real Systems

The division between allocation and placement appears in each of the following production schedulers, at different points:

- **Mesos**: two-level scheduling through resource *offers*. The allocator applies (weighted) DRF to decide which framework is offered resources next, and the framework's own scheduler decides placement by accepting or declining offers. DRF is implemented as the allocator module.
- **YARN**: the Capacity and Fair schedulers both ship DRF as the multi-resource policy option (`DominantResourceCalculator`); queues get dominant-share fairness, applications get containers within queues.
- **Borg**: quota and priority bands rather than continuous DRF, with a scoring-based placement engine and substantial overcommitment reclaimed by eviction. The paper's utilization argument, that shared multi-workload cells use sufficiently fewer machines than segregated ones to justify the cost of the scheduler, is the economic justification for these mechanisms.
- **Kubernetes**: requests/limits per resource with a filter-then-score placement cycle derived from Borg's. Fairness across tenants is added as a separate layer (namespace quotas), so fairness in multi-tenant Kubernetes is coarser than Mesos-style DRF.

GPU clusters depart from the model: GPUs are indivisible, workloads are gang-scheduled (all-or-nothing groups), and placement is sensitive to topology (NVLink domains), so schedulers add reservation and packing heuristics above the fairness layer. Scheduling on the serving side is treated in [[systems/scheduling/5-ml-and-serving/request-scheduling-for-llm-serving|request scheduling for LLM serving]].

## Competing Objectives

A production scheduler typically balances several incompatible goals:

- fairness between users
- locality to data
- high utilization
- low preemption churn
- isolation between workloads

No single scalar objective captures all of them. DRF addresses fairness between users, and the other goals require separate mechanisms.

## Related Notes

- [[systems/distributed-systems/load-balancing|Load Balancing]]
- [[ml/recommender-systems/intro-mapreduce-spark|MapReduce and Spark]]
- [[systems/scheduling/3-network-and-packet/fair-queueing-wfq-and-drr|Fair Queueing, WFQ, and DRR]]
- [[systems/scheduling/4-cluster-and-datacenter/stragglers-speculation-and-overload|Stragglers, Speculation, and Overload]]

