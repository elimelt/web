---
title: Media in Networks
aliases:
  - networks/1-physical/media
category: Networks
tags:
  - media
  - twisted-pair
  - coaxial-cable
  - fiber
  - wireless
  - nyquist-limit
  - shannon-capacity
date: 2024-02-03
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The physical media that carry signals, comparing twisted pair, coaxial cable, fiber, and wireless, and the channel properties and the Nyquist and Shannon limits that apply to all of them.
sources:
  - title: A Mathematical Theory of Communication (Shannon, 1948)
    url: https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf
    type: paper
  - title: "Computer Networks: A Systems Approach (Peterson and Davie)"
    url: https://book.systemsapproach.org/
    type: textbook
---

A transmission medium is the physical path along which a signal propagates from sender to receiver. Wired media guide the signal along a conductor or a glass fiber, and wireless media radiate it through space.

Media differ in data rate, reach, susceptibility to interference and cost. The Nyquist limit and the Shannon capacity bound the data rate of every medium.

## Wires

### Twisted pair

Twisted pair consists of two insulated copper wires twisted around each other. The twisting reduces radiation and crosstalk, so the pair picks up less interference than parallel wires would. Twisted pair is widely used in LANs and telephone lines, and Ethernet and DSL run over it.

### Coaxial cable

Coaxial cable consists of a copper core surrounded by insulation, a braided metal shield and an outer plastic jacket. The shielding supports higher data rates and longer distances than twisted pair. The cable is more expensive, more difficult to install and much less flexible. Cable TV and cable Internet run over it.

### Fiber

Optical fiber consists of long, thin strands of very pure glass that carry modulated light. Fiber supports very high data rates over long distances and is immune to electromagnetic interference, but its hardware and installation are expensive. The Internet backbone runs on fiber. In multi-mode fiber light travels through the strand along multiple paths, and in single-mode fiber along one.

## Wireless

A wireless sender radiates its signal through a region of space in all directions. Nearby signals **interfere** with each other, especially on the same frequency, so senders must coordinate their use of time and frequency.

WiFi largely uses unlicensed (ISM) spectrum, which is free to use and therefore crowded. A running microwave oven can interfere with WiFi on the 2.4 GHz band.

Signals also take multiple paths to the receiver (**multipath**) and get absorbed by physical barriers. Higher frequencies get absorbed more easily by walls and obstacles, which is why millimeter-wave 5G has poor indoor coverage.

## Channel properties

- **Bandwidth** $B$ (Hz): the range of frequencies the channel can carry. This is a different quantity from the data rate of a link, though it bounds it.
- **Signal power** $S$ (Watts): the strength of the signal.
- **Noise power** $N$ (Watts): the strength of the noise.

## Nyquist limit

The maximum symbol rate is twice the bandwidth, $2B$ symbols per second. Reaching it requires signaling at the channel's maximum frequency and reading a symbol from each peak and trough of the wave.

With $V$ signal levels, and ignoring noise, the maximum data rate is $2B \log_2 V$ bits/sec.

## Shannon capacity

Noise limits how many signal levels the receiver can tell apart. The signal-to-noise ratio (SNR) determines that number. It is expressed in decibels as

$$
SNR_{dB} = 10 \log_{10} \left( \frac{S}{N} \right)
$$

Capacity $C$ is the maximum lossless data rate over the channel:

$$
C = B \log_2 \left( 1 + \frac{S}{N} \right)
$$

The derivation is in [Shannon's 1948 paper](https://people.math.harvard.edu/~ctm/home/text/others/shannon/entropy/entropy.pdf), and [[systems/networks/0-foundation/information-theory|information theory]] explains the intuition. With fixed noise power, capacity grows linearly in bandwidth and only logarithmically in SNR.

## Related notes

- [[systems/networks/1-physical/coding-and-modulation|coding and modulation]]
- [[systems/networks/0-foundation/information-theory|information theory]]
