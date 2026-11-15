---
title: Power Provisioning for a Warehouse-sized Computer
aliases:
  - systems-research/data-center-power-provisioning
category: Systems Research
tags:
  - datacenter
  - power
  - provisioning
  - utilization
  - paper-notes
date: 2025-03-12
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Review notes on Google's study of datacenter power usage, which measures the gap between provisioned and actual power draw and estimates how many extra servers that gap can host.
sources:
  - title: Power Provisioning for a Warehouse-sized Computer (ISCA 2007)
    url: https://static.googleusercontent.com/media/research.google.com/en//archive/power_provisioning.pdf
    type: paper
---

[Power Provisioning for a Warehouse-sized Computer](https://static.googleusercontent.com/media/research.google.com/en//archive/power_provisioning.pdf) (Fan, Weber and Barroso, ISCA 2007) measures, for large-scale Google workloads, the gap between the power a datacenter is provisioned for and the power its machines draw, and estimates how many additional servers that gap could host under the same power budget. The gap has economic significance because power delivery capacity is a large part of the cost of a facility.

## Citation

- [Power Provisioning for a Warehouse-sized Computer](https://static.googleusercontent.com/media/research.google.com/en//archive/power_provisioning.pdf), Fan, Weber, and Barroso, ISCA 2007.

## Problem

Datacenter power infrastructure is provisioned against nameplate ratings, but deployed machines rarely draw their rated maximum. As a result, the power delivery capacity, an expensive part of the facility, is underused. Since building that capacity is a dominant component of cost, closing the gap amortizes the infrastructure over more machines and reduces cost substantially.

## Main idea

The approach is to measure actual power usage at scale, quantify the gap between provisioned and consumed power at rack, PDU and cluster level, and use that headroom to place more servers under the same power budget. Power capping is the safety mechanism that makes the oversubscription safe.

## Evidence

The authors ran a 6-month study of power usage across large-scale workloads at Google, covering three major workloads (Websearch, Webmail, MapReduce) plus a real mixed-use datacenter. They found consistent underutilization of provisioned power, and the gap widens with the level of aggregation, since a whole cluster rarely reaches the peak that a single rack can. The principal figures are the following.

- Individual well-tuned applications could host 7% to 16% more machines within the same power budget, and an operational datacenter running a mix of applications could host as much as 39% more.
- CPU dynamic voltage/frequency scaling was estimated to yield moderate energy savings, up to 23%.

## Key insights

Workload diversity across a datacenter, plus the variability between peak and average power per workload, means aggregate peak power is far below the sum of individual peaks. That headroom can be exploited safely as long as a power capping mechanism exists to throttle machines in the rare case the aggregate approaches the budget. Capping converts a hard provisioning constraint into a soft enforcement mechanism, which allows operators to deploy more machines with little risk.

> [!warning] Oversubscription requires power capping
> Placing extra machines in the provisioning gap is safe only with power capping in place. Without a throttle for the rare case that aggregate draw approaches the budget, the same headroom creates a risk of outage.

The evaluation covers both well-tuned applications and a production mix of workloads, which makes the deployment estimates more credible than a study of a single benchmark.

## Assumptions and limits

The paper is descriptive rather than prescriptive. It establishes that the gap exists and recommends driving idle power toward zero, but gives little guidance on how to design systems that do so. Cooling infrastructure and other related costs are also excluded from the analysis, so the economic picture is partial.

## Open questions

- Does the flat-tax assumption for non-critical power overhead hold up across other datasets?
- Is there a general framework system designers can use to drive idle power consumption to near zero?

## Sources

- [Power Provisioning for a Warehouse-sized Computer](https://static.googleusercontent.com/media/research.google.com/en//archive/power_provisioning.pdf)

## Related notes

- [[hardware/signal-conditioning/lecture-notes/lecture-1|C-SWAP: Cost, Size, Weight and Power]]
