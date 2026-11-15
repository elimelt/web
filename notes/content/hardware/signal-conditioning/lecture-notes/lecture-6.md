---
title: Capacitors
aliases:
  - signal-conditioning/lecture-notes/lecture-6
category: Signal Conditioning
tags:
  - capacitance
  - inductance
  - impedance
  - complex numbers
  - phasors
  - energy storage
date: 2024-01-17
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Lecture 6 of the signal conditioning course, on capacitors and inductors as energy storage elements, the complex representation of AC signals, impedance and phasors.
sources:
  - title: Signal conditioning course, lecture 6
    type: lecture
---

Lecture 6 of the signal conditioning course treats capacitors and inductors, which store energy and whose behavior depends on frequency, and the complex representation of AC signals. With impedances and phasors, AC circuits containing these elements are analyzed with the same rules that apply to resistive circuits.

## Capacitors

A capacitor stores energy in the electric field between two plates. It passes AC and blocks DC, which is why a series capacitor acts as a high pass filter.

Capacitance is the ratio of charge to voltage, measured in Farads:

$$
C = \frac{Q}{V}
$$

The energy stored in a capacitor is

$$
E = \frac{1}{2}CV^2
$$

Differentiating $Q = CV$ with respect to time gives the current through the capacitor:

$$
I_C = C\frac{dV}{dt}
$$

## Inductors

An inductor stores energy in the magnetic field around a coil of wire, built up by the current flowing through it. Inductance is measured in Henrys (H). It passes DC and blocks AC, acting as a low pass filter in series.

The energy stored in an inductor is

$$
E = \frac{1}{2}LI^2
$$

and the voltage across it is

$$
V_L = L\frac{dI}{dt}
$$

## Complex numbers review

With $j$ defined by $j \cdot j = -1$, Euler's formula connects exponentials to sinusoids:

$$
e^{j\theta} = \cos(\theta) + j\sin(\theta)
$$

## Complex numbers for AC signals

During analysis, signals are represented as complex quantities, and the physical signal is the real part of the result. Multiplying by a real number scales the amplitude. Multiplying by a unit complex number $e^{j\phi}$ shifts the phase. Multiplying by a general complex number does both.

For example, a shifted cosine is the real part of a complex exponential:

$$
\cos(2\pi ft + \phi) = \operatorname{Re}\left\{e^{j\phi}e^{j2\pi ft}\right\}
$$

## Impedance

Impedance is the AC generalization of resistance:

$$
Z_{cap} = \frac{1}{j\omega C}, \qquad Z_{ind} = j\omega L, \qquad Z_{res} = R
$$

The capacitor's impedance decreases as frequency increases, consistent with a capacitor passing AC and blocking DC. The inductor's impedance increases with frequency, consistent with an inductor passing DC and blocking AC.

> [!tip] Sanity check at the frequency extremes
> As $\omega \to 0$, $Z_{cap} \to \infty$ (open circuit) and $Z_{ind} \to 0$ (short circuit). As $\omega \to \infty$ the roles are reversed. Evaluating a derived transfer function at these two limits detects many algebraic errors before any plot is made.

## Phasors

A phasor is a complex number that represents the amplitude and phase of a sinusoidal signal. Since impedances obey Ohm's law with phasors, the differential equations from $I_C = C\,dV/dt$ and $V_L = L\,dI/dt$ become algebraic equations, and series and parallel combination rules carry over from resistors.

## Related

- [[hardware/signal-conditioning/lecture-notes/lecture-2|Electricity]]
- [[hardware/signal-conditioning/lecture-notes/lecture-3|Resistance]]
- [[reference/cheatsheets/circuits/components|Electronic Components]]
- [[reference/cheatsheets/circuits/electricity|Electric Circuit Analysis]]
