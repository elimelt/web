---
title: Objects Handles and Reference Counts
aliases:
  - operating-systems/lecture-notes/windows-objects-handles-refcounts
category: Operating Systems
tags:
  - object-manager
  - handles
  - reference-counts
  - windows
date: 2024-01-19
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: incomplete
description: The Windows object manager, and how handle counts and reference counts track the lifetime of kernel objects.
sources:
  - title: Windows Internals, Part 1 (Russinovich, Solomon, Ionescu)
    type: book
  - title: Operating systems course lecture notes
    type: lecture
---

The Windows **object manager** is the kernel component that defines object types, names objects and issues handles to them. In early Windows it tracked the lifetime of each kernel object with two counts, a handle count and a reference count.

Windows was written in C, which has no language support for objects, so the kernel implements its own object model. The object manager defined object types, named objects and issued handles to users. Threads, processes, files, and semaphores were all object types.

Each object carried two counts. The **handle count** is the number of handles users hold on the object. The **ref count** is the number of references to the object within the kernel, and it includes the handles. The kernel-side count prevents premature deallocation. An object can be freed only once its ref count reaches zero, so kernel code that is still using an object keeps it alive even after the user closes every handle.

Handles resolve to objects through per-process handle tables, which are described briefly in [[systems/operating-systems/lecture-notes/handle-tables|handle tables]].

## Related notes

- [[systems/operating-systems/lecture-notes/handle-tables|handle tables]]
