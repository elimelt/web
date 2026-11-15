---
title: The Physical Layer
aliases:
  - networks/0-foundation/2-physical-layer
category: Networks
tags:
  - physical-layer
  - modulation
  - coding
  - clock-recovery
  - latency
date: 2024-01-05
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The representation of bits as signals on a link, covering simple codings (NRZ, RZ), clock recovery, the distinction between coding and modulation, a simple link model, and message latency with a worked example.
sources:
  - title: UW CSE 461 Computer Networks
    url: https://courses.cs.washington.edu/courses/cse461/
    type: course
  - title: "Computer Networks: A Systems Approach (Peterson and Davie)"
    url: https://book.systemsapproach.org/
    type: textbook
---

The physical layer specifies how a sender represents bits as a signal on a transmission medium and how a receiver recovers them. It covers the conversion of digital data to an analog signal and back, and the delays a message incurs in crossing a link.

The conversion has two parts. A coding or modulation scheme maps bits to signal levels, and the receiver must recover the timing of the symbols in order to sample them. The encoding schemes are treated in more detail in [[systems/networks/1-physical/coding-and-modulation|Coding and modulation]].

## Coding and modulation

A modem (modulator-demodulator) converts digital signals to analog signals and back.

### A simple coding

**NRZ** (non-return-to-zero) coding represents 1 by a high positive voltage and 0 by a low negative voltage. Each time interval carries one **symbol**, and the receiver samples once per symbol.

NRZ carries 1 bit per symbol. Additional voltage levels carry more bits per symbol: $N$ bits per symbol require $2^N$ voltage levels, and a signal with more levels is more sensitive to noise. Practical coding schemes balance these two effects according to the engineering constraints of the link.

### Clock recovery

The receiver relies on frequent signal transitions to decode bits. A long run of identical bits contains no transitions to synchronize on, so the receiver can lose track of where symbols begin and end. Manchester coding and scrambling both address this.

Return-to-zero (RZ) coding is a simple remedy. It alternates between the signal voltage and zero after each bit:

```txt
    0       1        1      1       0
+V |        ___     ___     ___
   |   |   |   |   |   |   |   |   |   |
   |   |   |   |   |   |   |   |   |   |
0  |   |___|   |___|   |___|   |___|   |
   |   |   |   |   |   |   |   |   |   |
   |   |   |   |   |   |   |   |   |   |
-V |___|   |   |   |   |   |   |   |___|
```

Two approaches are more efficient than RZ. The first maps input bit patterns to longer output patterns chosen so that long runs of zeros cannot occur, as 4b/5b does. The second XORs the data with a pseudorandom bit pattern before transmission, so that the encoded data appears random and most long runs are removed. Both are described in [[systems/networks/1-physical/coding-and-modulation|coding and modulation]].

### Modulation vs. coding

With **coding**, the signal is placed directly on the wire. This works poorly for wireless links, which use **modulation** instead. Modulation carries a signal by varying the frequency, amplitude, or phase of a carrier wave. The original signal is the **baseband** signal, and the modulated signal is the **passband** signal.

Examples:

- NRZ signal of bits sent directly on a wire
- Amplitude shift keying (Zigbee)
- Frequency shift keying (Bluetooth)
- Phase shift keying

Modern WiFi uses a band of frequencies and many signal levels rather than two.

### Key points

- All signals are physically analog. A digital signal is conceptually discrete but is carried by a continuous physical medium.
- Modulation and demodulation convert between the digital data and the analog carrier.
- A coding is a convention, shared by sender and receiver, for representing data as a signal.

## Simple link model

Two main parameters describe a link:

- **Rate** (bandwidth, capacity, speed): bits per second
- **Delay**: the time a message takes to cross the link

The type of cast (unicast, multicast, broadcast) and the error rate are also relevant.

### Message latency

**Latency** is the time a message takes to travel from one end of a link to the other. It is the sum of the **transmission delay** (the time to put the bits on the wire) and the **propagation delay** (the time for the bits to cross the link). Signals in copper and fiber travel at roughly $\frac{2}{3}c$, which gives the $3D/2c$ form below.

```txt
Transmission delay:
T = L (message length) / R (rate) = L/R seconds

Propagation delay:
P = D (distance) / S (speed) = D / (2/3 * C) = 3D/2C seconds

Total latency:
L_t = T + P = L/R + 3D/2C
```

#### Example

A broadband cross-country link with $P = 50\text{ ms}$, $R = 10$ Mbps, and a message of $L = 1$ MB:

```txt
L = 1 MB = 8 Mb
T = 8 Mb / 10 Mbps = 0.8 s
L_t = 0.8 s + 0.05 s = 0.85 s
```

Transmission delay dominates in this example. On a faster link the propagation delay would dominate, since it does not decrease as the rate increases.

### Cut-through routing

Store-and-forward switching incurs the full transmission delay at every hop, because each node buffers the whole message before forwarding it. Cut-through routing begins forwarding as soon as the destination header arrives, before the rest of the message has been received. This reduces per-hop latency, but frames are forwarded before their checksum can be verified.

## Related notes

- [[systems/networks/1-physical/coding-and-modulation|coding and modulation]]
- [[systems/networks/0-foundation/information-theory|information theory]]
- [[systems/networks/0-foundation/3-performance|performance]]
