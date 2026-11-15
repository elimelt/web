---
title: What Is an Operating System?
aliases:
  - operating-systems/v1-kernels-and-processes/1-introductions
category: Operating Systems
tags:
  - operating systems
  - virtualization
  - virtual-memory
  - resource management
  - reliability
  - availability
  - fault isolation
date: 2023-12-22
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
description: Chapter 1 of Operating Systems, Principles and Practice on the roles of an operating system, virtualization and design goals, with answers to the chapter's design exercises.
sources:
  - https://www.kea.nu/files/textbooks/ospp/osppv1.pdf
---

Chapter 1 of [*Operating Systems: Principles and Practice*](https://www.kea.nu/files/textbooks/ospp/osppv1.pdf), volume 1, introduces the operating system through its roles as referee, illusionist and glue, describes virtualization and the services an operating system provides, and sets out the goals of operating system design and the history of their tradeoffs. The answers given to the chapter's exercises are informal design sketches.

## What is an Operating System?

**Referee.** The OS manages the resources of a computer that are shared between applications.

**Illusionist.** The OS uses abstraction to make the computer's resources appear dedicated to each application.

**Glue.** The OS binds hardware, software and users together through services that facilitate communication and sharing.

### Virtualization
- Virtualization uses abstraction to create the illusion of additional resources.
- Examples of virtualization include:
    - **Virtual Memory.** Creates the illusion of more memory than is physically available.
    - **Virtual Machines.** Creates the illusion of multiple computers on one computer.
    - **Virtual Processors.** Creates the illusion of multiple processors on one processor.

### Services

The operating system provides services so that applications are written against a single interface (such as POSIX) rather than against the hardware. Examples include:

- **File System.** Create, delete, read, and write files through read, write, open, close, seek, etc.
- **Network.** Access the network through sockets with read, write, bind, and connect, etc.
- **Process Management.** Create and manage processes through fork, exec, wait, etc.
- **GUI.** Windows, cut and paste, and related interaction primitives.


## Evolution of Operating Systems

**Reliability and Availability.** A reliable system does what it is expected to do without crashing. At scale, an OS must tolerate failure even in edge cases. Availability, the percentage of time a system is available, is influenced by **Mean Time To Failure** (MTTF) and **Mean Time To Repair** (MTTR). Increasing MTTF and decreasing MTTR increases availability.

**Security.** A secure system cannot be compromised by malicious users. Privacy is the aspect of security under which data is accessible only to authorized users. Strong fault isolation is necessary for security.

**Portability.** Portable code runs independently of the underlying hardware. This is achieved through abstraction. The **abstract virtual machine** (AVM) is the interface between the OS and applications. The **hardware abstraction layer** (HAL) is the interface between the OS and hardware.

**Performance.** The system should be fast and efficient for its users. Performance has several measures:
- **overhead.** the cost of abstraction.
- **efficiency.** the ability to minimize overhead.
- **fairness.** the ability to allocate resources fairly.
- **response time.** the time between a request and a response.
- **throughput.** the number of requests per unit time.
- **predictability.** the ability to provide consistent performance.

**Adoption.** Adoption by users and developers is also a design goal.

### Design Tradeoffs

Design often trades one goal against another, for example by accepting some loss of performance in order to conform to an interface. Performance is frequently traded against complexity.

In early single-user operating systems the CPU sat idle while it waited for I/O. Later, when multi-user systems were introduced, the CPU could switch to another process while one process waited for I/O. This is called **multiprogramming**. In a **batch operating system**, the CPU reads from a queue of jobs, loading, running, and unloading each job.

While one job is running, the OS may set up I/O devices for another in the background through direct memory access (DMA). Through interrupts, the OS can then switch to the new job when it is ready. From the point of view of the original job, there was only a short delay. This is called **time sharing**.

When the OS directly controls multiple concurrent processes (**multiprocessing**), debugging becomes difficult, and developers often need to stop the system to inspect state. **Virtualization** addresses this by creating the illusion of multiple processors on one processor. This allows developers to debug one virtual processor while the others continue to run. Instead of debugging directly on the hardware, developers can debug on a virtual machine running as an application.



## Ch. 1 Exercises

## Introduction

### 1. What is an example of an operating system as:
- **Referee?**

The OS manages the running processes and their access to resources.

- **Illusionist?**

The OS creates the illusion of dedicated resources through abstraction, as with malloc.

- **Glue?**

The OS provides services like the file system and network.

### 2. What is the difference, if any, between the following terms:

- **Reliability** vs. **availability?**

Reliability is the ability to do what is expected without crashing. Availability is the percentage of time a system is available. Other things being equal, a more reliable system (one with a higher MTTF) has higher availability.

- **Security** vs. **privacy?**

Security is the ability to prevent compromise from malicious users. Privacy is the ability to prevent unauthorized users from accessing data.

- **Security enforcement** vs. **security policy?**

Security enforcement is the mechanism that prevents compromise. Security policy is the rules that define what is allowed and what is not.

- **Throughput** vs. **response time?**

Throughput is the number of requests per unit time. Response time is the time between a request and a response.

- **Efficiency** vs. **overhead?**

Efficiency is the ability to minimize overhead. Overhead is the cost of abstraction.

- **Application programming interface (API)** vs. **abstract virtual machine (AVM)**?

API is the interface between client applications and the software they're consuming. AVM is the interface between the OS and the applications running on it.

- **Abstract virtual machine (AVM)** vs. **hardware abstraction layer (HAL)**?

AVM is the interface between the OS and the applications running on it. HAL is the interface between the OS and the hardware.

- **Proprietary** vs. **open operating system**?

Proprietary operating systems are owned by a company and are not open source. Open operating systems are open source and free to use.

- **Batch** vs. **interactive operating system**?

Batch operating systems read from a queue of jobs, loading, running, and unloading each job. Interactive operating systems allow users to interact with the system while it is running.

- **Host** vs. **guest operating system**?

Host operating systems run on the hardware and typically manage guest operating systems. Guest operating systems run on top of the host operating system.

- **Multiprogramming** vs. **multiprocessing**?

Multiprogramming allows the CPU to switch to another process while waiting for I/O. Multiprocessing allows multiple processes to run concurrently.

### 3. Define the term, direct memory access (DMA).

DMA allows the OS to set up IO devices for another process in the background while the CPU is running another process. Through interrupts, the OS can then switch to the new process when it is ready.

### 4. Before there were operating systems, someone needed to develop solutions without being able to look them up! How would you have designed the first operating system?

The following design draws on the chapter, which I had just read.

Users must be able to execute arbitrary code on the hardware. Security is important but is set aside in this design.

The first requirement is a way to load and run code. Assuming that a preexisting compiler such as GCC is available, the first component is a set of "kernel" modules that interact directly with the hardware. These modules would be written in C and assembly and would cover the basic operations on I/O devices and any other hardware the system controls, in particular:

- CPU
- Disk Storage
- Memory Management
- Network
- Monitoring


The next component is a set of services that serve as the users' interface to the hardware drivers. Users should not interact with the drivers directly. These services would be written in C and assembly, and would cover the following:

- File System and Disk IO (read, write, open, close, seek, etc.)
- Memory Allocator (malloc, free, etc. to access heap memory)
- Network Communication (read, write, bind, connect, etc.)
- Process Management (fork, exec, wait, etc.)
- Terminal/Shell (stdin, stdout, stderr, etc.)
- GUI (windows, cut and paste, etc.)

The file system would be a simple tree of directories and files. As in the UNIX file system, file descriptors would refer to all I/O devices, including files, directories and network sockets. Open file descriptors would be stored in a table and passed to the kernel modules to perform I/O operations. Writes to disk would be buffered in memory to make logging efficient, and reads would go directly to disk through the storage device drivers.

The memory allocator would be a basic linked-list implementation of malloc, with periodic compaction and a sweep of the heap on process termination. The design has no virtual memory.

Network communication would be done entirely through reads and writes over sockets. TCP/IP would be used for communication, assuming a modern network stack is available. If not, then machines would need to be connected directly to each other and would read and write directly to each other's open sockets using whatever protocol is available, or a newly designed one.

Process management would be done through `fork`, `exec`, and `wait`. The OS would need to handle interrupts so that processes can be suspended and resumed when I/O is ready. Callbacks could handle this, where processes register a callback with the OS when blocked on I/O. When the I/O is ready, the OS would call the callback and the process would resume, or be added to the ready queue if it is not the highest-priority process. An event-driven model would be used for all I/O so that processes can be interrupted when I/O is ready. Each event should contain the information needed to stop and resume work, and a producer-consumer model would process events from an event queue. A simple round-robin scheduler would switch between processes, and the OS would keep a log of events and streaming statistics in order to schedule work fairly. The design provides limited concurrency, since processes can be suspended while they wait for I/O.


## System Design

### 5. Suppose a computer system and all of its applications were completely bug-free and everyone in the world were completely honest and trustworthy. In other words, we need not consider fault isolation.

- **How should the operating system allocate the CPU to applications?**

The OS should allocate the CPU by round robin.

- **How should the operating system allocate physical memory to applications?**

Ideally, each application would have its own memory space. This requires a virtual memory abstraction.

- **How should the operating system allocate its disk space?**

Applications should access disk through the file system, which has an interface for creating, deleting, reading, and writing files. The OS keeps a table of open files, and uses this table to perform I/O operations on files consistently and safely. Blocking access to a file while it is being written would be sufficient, and more complex buffering and locking could improve performance.

### 6. Now suppose the computer system needs to support fault isolation. What hardware and/or operating support do you think would be needed to do the following?
- **Protect an application's data structures in memory from being corrupted by other applications.**
- **Protecting one user's disk files from being accessed or corrupted by another user.**
- **Protecting the network from a virus trying to use your computer to send spam.**

Permissions and virtualization address all three. Each process has its own memory space, and each user has its own file system. The OS can then use permissions to control access to resources for individual users. Network access should be mutually consensual, and the OS should prevent unauthorized access to the network.

### 7. How should an operating system support communication between applications?
- **Through the file system?**

Each application can independently request access to a file, getting an entry in the currently open file table. Two processes may read the same file concurrently, but writes to the same file should not interleave. There should be multiple levels of locking, so that a process can hold a file exclusively, prevent writes but allow reads, prevent reads but allow writes, or only allow atomic reads and writes while still permitting concurrent ownership when safe.

- **Through messages passed between applications?**

Similar to network communication and file I/O, applications should be able to read from and write to sockets. Pipes could be used to pass messages between processes, and I/O streams could be used to compose programs together.

- **Through regions of memory shared between the applications?**

A reentrant locking service could provide a thin wrapper around a region of shared memory owned by the kernel.

The OS should support all three mechanisms, and programmers need to understand the tradeoffs and correctness conditions of each.

### 8. How would you design combined hardware and software support to provide the illusion of a nearly infinite virtual memory on a limited amount of physical memory?

By analogy with a cache in front of memory, main memory would serve as temporary storage for the data of running processes. When another process needs time on the CPU, main memory is switched to that process, and the memory of the previous process is written to disk.

The process management service would handle this "paging" of memory by keeping a table of processes and the location and metadata for their memory. As tasks are pulled from the job queue, they are loaded into memory and added to the ready queue. When a process is blocked on IO, the OS can switch to another process and write the blocked process's memory to disk. When the process is ready again, the OS can load the process's memory from disk and resume execution.

### 9. How would you design a system to run an entire operating system as an application on top of another operating system?

The hardware modules on which the host OS runs each follow an interface, so emulating those interfaces simulates the hardware. Running the guest OS on the simulated hardware then runs it as an application on top of the host OS. This should all be done in an isolated environment, so that the guest OS cannot access the host resources directly.

### 10. How would you design a system to update complex data structures on disk in a consistent fashion despite machine crashes?

A write-ahead log would record all disk writes. It would be buffered in memory for high-throughput events and flushed to disk in the background as often as possible to aid recovery. Each record in the log would correspond to an event applied to the data structure, and each event would have an ID. An atomic counter tracks the last event executed on the structure. After a crash, replaying the log from the last completed event to its end restores a consistent state. Replaying the log from the beginning also recovers from a crash during a write.

### 11. Society itself must grapple with managing resources. What ways do governments use to allocate resources, isolate misuse, and foster sharing in real life?

Governments use taxes, laws and regulations. Taxes are used to allocate resources, and laws are used to prevent misuse and foster sharing. For example, public services such as firefighters are funded by taxes, and laws are supposed to help ensure people can fairly access these services.

### 12. Suppose you were tasked with designing and implementing an ultra-reliable and ultra-available operating system. What techniques would you use? What tests, if any, might be sufficient to convince you of the system's reliability, short of handing your operating system to millions of users to serve as beta testers?

The techniques would be extensive testing, as for other software (unit, integration, fuzzing, fault injection), together with monitoring and telemetry of deployed devices. Formal verification would be desirable but is probably not feasible. A microkernel would be a reasonable starting point, since it isolates the "trusted" code.

### 13. For the computer you are currently using, how should the operating system designers prioritize among reliability, security, portability, performance, and adoption? Explain why.

As a user of a MacBook Pro, I consider security, performance and adoption the most important. As a developer, I would also value portability and, secondarily, reliability. Apple has deprioritized portability in hardware support, although that decision is also tied to the adoption of Apple Silicon.

## Related notes

- [[systems/research/hints-for-computer-system-design|Hints for Computer System Design]]
- [[systems/operating-systems/reference|Operating Systems Reference]]
- [[systems/research/xen|Xen and the Art of Virtualization]]
- [[systems/operating-systems/lecture-notes/io-systems-secondary-storage|I/O Systems and Secondary Storage]]
- [[systems/research/barrelfish|The Multikernel, A new OS architecture for scalable multicore systems]]
