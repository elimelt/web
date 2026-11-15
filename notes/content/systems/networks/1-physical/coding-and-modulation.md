---
title: Coding and Modulation
aliases:
  - networks/1-physical/coding-and-modulation
category: Networks
tags:
  - nrz
  - rz
  - clock-recovery
  - manchester-encoding
  - scrambling
  - keying
  - bandwidth-delay-product
date: 2024-02-03
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The transmission of bits on a link, covering NRZ and RZ coding, clock recovery, code design (4b/5b), the keying schemes (ASK, FSK, PSK), and the link model with latency and the bandwidth-delay product.
sources:
  - title: "Computer Networks: A Systems Approach (Peterson and Davie)"
    url: https://book.systemsapproach.org/
    type: textbook
  - title: UW CSE 461 Computer Networks
    url: https://courses.cs.washington.edu/courses/cse461/
    type: course
---

Coding and modulation are the means by which a link represents bits as a physical signal. **Coding** places bits directly on a wire as signal levels, and **modulation** conveys them by varying the amplitude, frequency or phase of a carrier wave.

The time a message takes to cross the link then follows from a simple model of the link with two parameters, its rate and its propagation delay.

## Coding

### Non-return-to-zero (NRZ)

NRZ represents a 1 by a high voltage and a 0 by a low voltage. Long runs of the same bit cause two problems.

- **Clock drift**: without signal transitions the receiver's clock drifts relative to the sender's, and the receiver samples at the wrong instants.
- **Baseline wander**: the receiver keeps a running average of the signal to set the threshold between 1s and 0s. A long run shifts the average toward one level, and the receiver begins to misread bits.

### Clock recovery

Recovering the clock from an NRZ signal with few transitions is difficult, because the receiver has no reference against which to synchronize its sampling. Manchester encoding and scrambling both introduce transitions into the signal.

### Return-to-zero (RZ)

The signal returns to zero after each bit. Every bit therefore contains a transition, and the receiver can resynchronize on each one. Each bit requires twice as many signal changes, which halves the data rate for a given symbol rate.

### Designing codes

More generally, a code maps one set of bit sequences to another, and the mapped bits are sent over the link. The mapping is chosen so that the output has good clock-recovery and noise properties.

In 4b/5b, let $S$ be the set of all 4-bit sequences and $C$ the set of 5-bit sequences actually used on the wire. The code is a function $f: S \to C$:

$$
f(0000) = 11110 \\
f(0001) = 01001 \\
f(0010) = 10100 \\
\vdots
$$

The 5-bit codewords are chosen so that long runs of 0s and 1s cannot occur. Since $C$ contains more codewords than $S$ requires, the unused codewords can carry control information such as the start of a frame.

## Modulation

**Modulation** transmits a digital signal over an analog channel by varying a carrier wave. The original signal is the **baseband** and the modulated signal is the **passband**. **Keying** is the digital form of modulation and has the role on a carrier that coding has on a wire.

### Amplitude shift keying (ASK)

The amplitude of the carrier encodes the bit, high amplitude for 1 and low for 0. ASK shares this weakness with NRZ, since a long run of one bit produces a steady signal from which the clock cannot be recovered.

### Frequency shift keying (FSK)

The frequency of the carrier encodes the bit, high frequency for 1 and low for 0. FSK resists noise better than ASK because noise mostly perturbs amplitude.

### Phase shift keying (PSK)

The phase of the carrier encodes the bit, for example 0 degrees for 1 and 180 degrees for 0. PSK supports more bits per symbol than ASK or FSK, which gives higher data rates.

## Link model

- **Transmitter**: converts the digital signal to an analog signal.
- **Channel**: the medium the signal crosses. See [[systems/networks/1-physical/media|media]].
- **Receiver**: converts the analog signal back to digital.

### Properties of the channel

- **Rate** (bandwidth): bits per second the channel can carry.
- **Delay**: time for a signal to cross from transmitter to receiver, roughly proportional to distance.

### Latency

Latency is the sum of the **transmission delay** and the **propagation delay**.

Transmission delay is the time to put an $M$-bit frame on the link:

$$
D_{\text{transmission}} = \frac{\text{message size}}{\text{transmission rate}} = \frac{M}{R}
$$

where $R$ is the link rate in bits/sec. Propagation delay is the time the signal takes to traverse the medium:

$$
D_{\text{propagation}} = \frac{\text{distance}}{\text{speed in the medium}} = \frac{d}{.66c}
$$

where $d$ is the distance and $c$ is the speed of light. Signals in copper and fiber travel at roughly two thirds of $c$. The latency is therefore

$$
L = \frac{M}{R} + D_{\text{propagation}}
$$

### Bandwidth-delay product

A link of finite length holds a finite number of bits in transit. The **bandwidth-delay product** is the number of bits in transit at any moment when the link is kept full:

$$
BD = R \cdot D_{\text{propagation}}
$$

Either the bandwidth or the delay may limit throughput, and BD gives the capacity of the link as a number of bits. It matters for [[systems/networks/2-direct-links/retransmission|retransmission]] protocols, which must keep BD bits outstanding to use the link fully.

> [!example] A long fat network
> A 100 Mbps cross-country link with 25 ms propagation delay holds $BD = 10^8 \cdot 0.025 = 2.5$ Mbit, about 312 KB in flight. A protocol that sends one 1500-byte frame and then waits a full 50 ms round trip for the reply transfers 12,000 bits per 50 ms, about 240 kbps, using under 0.3% of the link.

## Related notes

- [[systems/networks/1-physical/media|media]]
- [[systems/networks/0-foundation/2-physical-layer|the physical layer]]
- [[systems/networks/2-direct-links/errors|error detection]]
