---
title: Information Theory in Networks
aliases:
  - networks/0-foundation/information-theory
category: Networks
tags:
  - information-theory
  - nyquist-limit
  - shannon-capacity
  - bandwidth
  - noise
date: 2024-01-13
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The Nyquist limit and Shannon capacity, the quantity each bounds, and the diminishing returns from added bandwidth when noise power scales with it.
sources:
  - title: A Mathematical Theory of Communication (Shannon, 1948)
    url: https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf
    type: paper
  - title: UW CSE 461 Computer Networks
    url: https://courses.cs.washington.edu/courses/cse461/
    type: course
---

The Nyquist limit and the Shannon capacity are two classical upper bounds on the rate at which a channel can carry bits. The Nyquist limit bounds the symbol rate of a band-limited channel, and the Shannon capacity bounds the bit rate of a channel with noise. Every physical link is subject to both bounds.

> [!abstract] Two limits, two regimes
> Nyquist assumes a noiseless channel and bounds the *symbol rate*; bandwidth alone limits the number of signal changes per second the channel can carry. Shannon adds noise and bounds the *bit rate*; the signal-to-noise ratio limits the number of levels per symbol the receiver can distinguish.

## Key channel properties

- **Bandwidth** $B$ (Hz): the range of frequencies the channel can carry.
- **Signal power** $S$: the strength of the transmitted signal at the receiver.
- **Noise power** $N$: the strength of all other signal energy the receiver picks up.

## Nyquist limit

A channel of bandwidth $B$ can carry at most $2B$ symbols per second. Sending faster than that adds no information, because a band-limited signal is fully determined by samples taken at rate $2B$.

If each symbol can take one of $V$ distinguishable signal levels, each symbol carries $\log_2 V$ bits, so the maximum bit rate is

$$R = 2B \log_2 V \ \text{bits/sec}$$

The bound ignores noise. In practice noise determines how large $V$ can be, which is the subject of Shannon's result.

## Shannon capacity

The **capacity** $C$ of a channel is the maximum rate at which it can carry information with arbitrarily low error:

$$C = B \log_2\left(1 + \frac{S}{N}\right) \ \text{bits/sec}$$

Noise spreads the received signal, so only levels spaced further apart than the noise can be distinguished. The signal-to-noise ratio $S/N$ therefore determines the number of usable levels, and $\log_2(1 + S/N)$ takes the place of $\log_2 V$ in the Nyquist formula.

[Shannon's noisy-channel coding theorem](https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf) establishes both directions. For any rate below $C$ there exist codes with arbitrarily low error rate, and no code communicates reliably at a rate above $C$.

### Diminishing returns from bandwidth

Additional bandwidth does not in general yield proportionally more capacity. If the noise power $N$ stays fixed while $B$ grows, capacity grows linearly in $B$. For white noise, however, the noise power scales with the bandwidth used, $N = N_0 B$ for noise density $N_0$, so

$$C = B \log_2\left(1 + \frac{S}{N_0 B}\right) \xrightarrow{B \to \infty} \frac{S}{N_0} \log_2 e$$

Capacity therefore approaches a finite limit. Beyond some bandwidth, further bandwidth increases capacity only slightly, and only more signal power (or less noise) raises the limit.

## Related notes

- [[systems/networks/1-physical/media|media]]
- [[systems/networks/0-foundation/2-physical-layer|the physical layer]]
- [[systems/networks/0-foundation/3-performance|performance]]
