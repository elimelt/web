---
title: Development of the Domain Name System
aliases:
  - systems-research/development-of-the-dns
category: Systems Research
tags:
  - dns
  - domain-name-system
  - networking
  - systems
  - paper-notes
date: 2025-01-19
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Review notes on the DNS retrospective paper, covering the design requirements for the replacement of HOSTS.TXT, the division between name servers and resolvers, zones, caching, and the parts of the design that proved durable.
sources:
  - title: Development of the Domain Name System (SIGCOMM 1988)
    url: https://courses.cs.washington.edu/courses/cse551/09sp/papers/dns.pdf
    type: paper
---

[Development of the Domain Name System](https://courses.cs.washington.edu/courses/cse551/09sp/papers/dns.pdf) (Mockapetris and Dunlap, SIGCOMM 1988) is a retrospective on the design of DNS, a distributed, hierarchical database that maps domain names to typed resource records and that replaced the centrally maintained `HOSTS.TXT` file. The paper treats the design requirements, the architecture, and the mechanisms for distributing and caching data.

## Citation

- [Development of the Domain Name System](https://courses.cs.washington.edu/courses/cse551/09sp/papers/dns.pdf), Mockapetris and Dunlap, SIGCOMM 1988.

## Problem

The original solution for naming was a single shared file, `HOSTS.TXT`, containing every hostname and its IP address. This was adequate while the number of hosts was proportional to the number of timesharing systems. Once the internet consisted of many networks, each with many hosts, a centrally maintained file could not accommodate the size or the rate of change of the host list. Naming required a distributed database, and the paper describes the system built to provide one.

## Design requirements

- Provide all the functionality of `HOSTS.TXT`
- Allow distributed maintenance
- No obvious size limits on names, name components, or data associated with names
- Interoperate with the existing DARPA Internet
- Tolerable performance
- Independence from network topology, with the ability to encapsulate other name spaces
- Avoid forcing a single OS, architecture, or organizational structure; support both large timesharing systems and individual PCs

## Mechanism

### Architecture

DNS has two main components. The name server is the repository of name-to-data mappings and answers queries. The resolver is the interface client programs use to query name servers. The boundary between them is deliberately loose. An organization can run a centralized name server plus resolver shared by all its hosts, so individual PCs never need to run their own resolver.

### Name space

Domains are organized hierarchically, with all names sharing a common null root. DNS makes no assumptions about the structure or presentation of names, but suggests domains model the organization they represent.

### Data attached to names

DNS attaches arbitrary data to names, organized into typed resource records (RRs). Each RR carries a type, a class, and unstructured application data. Type represents the abstract resource and class represents the protocol family or instance. The designers expected types and classes to be extended often; in practice extension is rare, and more bits than necessary were allocated to those fields.

A name server answering a query is free to return extra data beyond what was asked for, anticipating future queries in order to reduce round trips. Root servers use this, returning both the name and the address of a host when a query requested only one of them.

### Zones

A zone is a complete description of a contiguous portion of the name space plus pointers to other zones. A zone can be a single node or the whole tree, but is typically a subtree. An organization obtains control of a zone by persuading its parent to insert RRs marking the zone division; the CS department got `cs.washington.edu` by having `washington.edu` insert RRs marking a boundary between the two.

A zone administrator should provide redundancy by running multiple name servers. The zone is maintained as a master file on a master server, and secondary servers either refresh manually or run a zone refresh algorithm that polls a serial number and pulls updates when it increases. Zone transfers happen over TCP. A name server can host any number of zones, contiguous or not, and marks responses served from its own zone data (rather than cache) as authoritative.

### Caching

Every RR has a TTL in seconds, the maximum time a resolver may reuse the cached record. Zero means no caching. The zone administrator sets TTLs as part of the zone definition. Cached answers are intended to be as reliable as authoritative ones, although the authoritative answer takes precedence when both are available. Negative responses are also cached, such as a nonexistent domain or a domain with no data of the requested type, which avoids repeated queries for names that will continue to fail.

### Root servers

Resolvers search downward from domains they already know, and carry hints pointing at the root servers and the top of their local domain. A resolver that can reach a root server can find any domain. A partitioned resolver can still resolve names inside its local domain. Root servers therefore must be highly available and geographically distributed.

## Strengths of the design

The hierarchy serves two functions. It models namespaces after organizations, and the same structure provides natural units for distributing and delegating data. Because caching is central to the design, DNS attains good performance and availability while keeping policy and implementation simple, and negative caching in particular is a general optimization with low overhead.

A distributed namespace was the necessary form of the solution, since `HOSTS.TXT` could not scale with the internet's growth in either complexity or size. The design requirements were deliberately general, and the balance between flexibility and simplicity accounts in large part for the success of its adoption.

> [!tip] Two central design decisions
> The hierarchy models organizations, so the structure that names resources also delegates control over them. Caching, including negative caching, made the common case fast enough to remain usable on a network far slower than the designers anticipated.

## Evidence

The paper is a retrospective, so its evidence is deployment experience. DNS replaced `HOSTS.TXT` and accommodated the internet's growth. The underlying network performed far worse than the designers expected, and DNS remained usable because the common case, a cached answer, is fast, and multiple levels of caching reduce the round trips needed after the initial queries.

## Assumptions and limits

Decentralized management brings inconsistency in cached answers, difficulty pushing updates through the system in real time, and unclear accountability. The system also exposes no versioning metadata and no way to tune runtime performance, which some applications and organizations could use.

## Open questions

- What level of security was considered in the original design, and how has that evolved since?
- Are the type and class fields still over-allocated? Could versioning be introduced within those spare bits?

## Sources

- [Development of the Domain Name System](https://courses.cs.washington.edu/courses/cse551/09sp/papers/dns.pdf)

## Related notes

- [[systems/research/internet-design-philosophy|Design Philosophy of DARPA Internet Protocols]]
- [[systems/research/end-to-end-arguments-in-sys-design|End-to-End Arguments in System Design]]
- [[reference/slides/system-design-interviews|System Design Interviews]]
- [[systems/databases/distributed-data/preface|Scalable Distributed Data Systems]]
