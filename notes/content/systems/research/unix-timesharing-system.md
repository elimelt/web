---
title: The Unix Timesharing System
aliases:
  - systems-research/unix-timesharing-system
category: Systems Research
tags:
  - unix
  - systems
  - operating systems
  - paper-notes
  - file-systems
date: 2025-01-16
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Paper and lecture notes on Ritchie and Thompson's original Unix paper, covering the file system implementation, the device model and the process model.
sources:
  - title: The UNIX Time-Sharing System (Ritchie and Thompson)
    url: https://people.eecs.berkeley.edu/~brewer/cs262/unix.pdf
    type: paper
---

[The UNIX Time-Sharing System](https://people.eecs.berkeley.edu/~brewer/cs262/unix.pdf) (Ritchie and Thompson) describes the design of Unix: a hierarchical file system in which devices also appear as files, a kernel that buffers block I/O, and a process model in which a process is an executing instance of an image. These notes, taken while reading the paper alongside lecture, record the mechanics of the file system and process model and do not evaluate the design.

## Citation

- [The UNIX Time-Sharing System](https://people.eecs.berkeley.edu/~brewer/cs262/unix.pdf), Ritchie and Thompson.

## Problem

The paper does not state a specific problem. The authors had worked on Multics and set out to build a simpler and more general system. The principal design goal is simplicity: the file system is hierarchical, and devices and directories are accessed as files.

## File system implementation

The [[systems/operating-systems/lecture-notes/file-systems|file system]] is a tree, and additional file systems are mounted onto a file. A system table of i-numbers (the i-list) holds an i-node of metadata for each file. Path names do not distinguish between files and directories, and a mount table records the mounted file systems.

Buffering is built into the kernel and transparent to the user, with write-behind flushing to disk when the buffer fills.

## Storage devices

Block devices store data in fixed-size blocks and manage allocation through a free list, a linked list of blocks. Hard disks, tape drives, and later devices like USB drives and SSDs fit this model, and early versions of Ethernet were exposed the same way. Character devices cover everything else.

## Execution

An **image** is an execution environment, loosely comparable to a container. A **process** is an instance of an image in execution. Program text is write-protected and shared between all processes running the same image, while each process gets its own virtual address space. The kernel mediates access to services, hardware and shared resources.

## Sources

- [The UNIX Time-Sharing System](https://people.eecs.berkeley.edu/~brewer/cs262/unix.pdf)

## Related notes

- [[systems/research/exokernel|Exokernel]]
- [[systems/research/xen|Xen and the Art of Virtualization]]
- [[systems/operating-systems/lecture-notes/file-systems|File Systems]]
- [[systems/operating-systems/v4-persistent-storage/13-files-and-directories|Files and Directories]]
- [[systems/operating-systems/lecture-notes/io-systems-secondary-storage|I/O Systems and Secondary Storage]]
- [[systems/operating-systems/lecture-notes/file-systems|File Systems]]
- [[systems/operating-systems/v4-persistent-storage/13-files-and-directories|Files and Directories]]
- [[systems/operating-systems/lecture-notes/io-systems-secondary-storage|I/O Systems and Secondary Storage]]
