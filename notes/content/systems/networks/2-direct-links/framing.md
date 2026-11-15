---
title: Framing in Network Protocols
aliases:
  - networks/2-direct-links/framing
category: Networks
tags:
  - framing
  - byte-stuffing
  - bit-stuffing
  - ppp
  - hdlc
  - sonet
date: 2024-01-15
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The marking of frame boundaries in a bit stream by link protocols, covering byte-oriented framing (length fields, sentinels, PPP), bit-oriented framing (HDLC and bit stuffing), and clock-based framing (SONET).
sources:
  - title: "Computer Networks: A Systems Approach (Peterson and Davie)"
    url: https://book.systemsapproach.org/
    type: textbook
---

Framing is the link-layer function of delimiting frames within the stream of bits that the physical layer delivers, so that the receiver can determine where each frame begins and ends.

Following Peterson and Davie's treatment, framing schemes fall into three families: byte-oriented, bit-oriented, and clock-based.

## Byte-oriented framing

Byte-oriented framing, the oldest approach, treats a frame as a sequence of bytes. BISYNC (IBM), DDCMP (DECNET), and PPP all frame this way. Protocols in this family locate the end of a frame in one of two ways.

### Length field approach

DDCMP puts the frame's byte count in the header, and the receiver counts bytes until the frame is done. A transmission error in the count field desynchronizes the receiver from the true frame boundaries, which is called a framing error.

### Sentinel approach and byte stuffing

BISYNC instead marks frame boundaries with special characters (SYN, STX, ETX). The payload can contain the same characters, so the sender escapes them by inserting an escape character before any sentinel byte that appears in the data, as C strings escape quotes. This is byte stuffing.

> [!example] Byte stuffing trace
> With STX marking frame start, ETX marking frame end, and DLE as the escape byte, a payload that contains ETX is stuffed by the sender:
>
> ```txt
> payload:  A  ETX  B
> on wire:  STX  A  DLE  ETX  B  ETX
> ```
>
> The receiver strips the DLE and keeps the following ETX as data; the unescaped ETX ends the frame. A DLE in the payload is itself escaped as DLE DLE.

### PPP frame format

PPP carries IP packets over point-to-point links. Its flag field, 01111110, marks the start of a frame, several of its field sizes are negotiable, and a CRC protects the frame.

The negotiation happens through the Link Control Protocol (LCP). LCP control messages are themselves carried inside PPP frames, and LCP conducts link establishment between the two peers.

## Bit-oriented framing (HDLC)

Bit-oriented protocols treat the frame as a bit stream and ignore byte boundaries. IBM's SDLC was the first, later standardized by ISO as HDLC.

HDLC marks both the start and end of a frame with the bit sequence 01111110. As with sentinel characters, the payload can contain the marker, and bit stuffing prevents it from appearing in the transmitted body.

### Bit stuffing

The sender inserts a 0 after every five consecutive 1s in the body. After five 1s, the receiver examines the next bit. If it is 0, the bit was stuffed and is removed. If it is 1, the sequence is either the end-of-frame marker or an error, and the following bit distinguishes the two.

> [!example] Bit stuffing trace
> A payload containing the flag pattern 01111110 cannot be sent unmodified, because the receiver would end the frame early. After five 1s the sender stuffs a 0:
>
> ```txt
> payload:  0 1 1 1 1 1 1 0
> on wire:  0 1 1 1 1 1 0 1 0
> ```
>
> The receiver counts five 1s, sees a 0 next, and deletes it, recovering the original bits. Only the actual flag arrives with six consecutive 1s.

## Frame size

With stuffing, the bits on the wire depend on the payload, so frames of equal payload size can differ in length, and no fixed frame size can be enforced. Clock-based protocols use fixed-length frames instead.

## Clock-based framing (SONET)

The Synchronous Optical Network (SONET) standard handles framing, encoding, and multiplexing for data over optical fiber. SONET frames have a fixed length and rely on timing rather than stuffing.

The receiver finds frame boundaries by looking for a special bit pattern that recurs at a fixed interval, every 810 bytes in an STS-1 frame. Since the frame length never depends on the data, no stuffing is needed. Payload bytes are scrambled to guarantee enough signal transitions for clock recovery, and much of SONET's complexity comes from its overhead bytes and network-level features.

### Multiplexing and concatenation

SONET links run at a hierarchy of rates from STS-1 up to STS-768, and a single SONET frame can carry subframes for multiple lower-rate channels. An STS-N frame is N interleaved STS-1 frames. When the payload is to be treated as a single high-rate channel rather than N lower-rate ones, the payloads are concatenated, written STS-Nc. Keeping the hierarchy synchronous simplifies clock coordination across carriers' networks.

## Related notes

- [[systems/networks/2-direct-links/errors|error detection]]
- [[systems/networks/2-direct-links/multiple-access|multiple access]]
