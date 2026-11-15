---
title: C and GDB Review
aliases:
  - operating-systems/section-notes/section-1
category: Operating Systems
tags:
  - c
  - gdb
  - pointers
  - static
  - extern
  - debugging
date: 2024-01-04
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Review of C linkage (static and extern), pointer basics and a few core GDB commands.
sources:
  - https://sourceware.org/gdb/current/onlinedocs/gdb.html
  - https://en.cppreference.com/w/c/language/storage_duration
---

The first section meeting of the operating systems course reviewed C linkage through the `static` and `extern` keywords, pointers passed by address, and basic debugging with GDB. The summary is brief and omits most of the language.


## C Review
**static**: has different meanings

- static functions cannot be used outside the file where they are defined
- static local variables keep one storage location across function calls

**extern**: declares variable without allocating any memory for it

- variables must be defined somewhere else
- allows a file to use variables defined in other files



```c

void change(char** s) { *s = "class"; }

int main() {
   char* s = "hello";
   char* w = s;

   change(&w);
}
```

An uninitialized pointer holds an indeterminate value, and dereferencing it interprets that value as an address, which is likely to cause an error.


## GDB Review

`printf` debugging is of limited use when program state changes rapidly or when multiple threads are involved.

The GNU debugger, `gdb`, inspects a running program directly. Its basic commands are the following.

`run <...args>`: start execution

`n`: next instruction

`bt`: backtrace

`watch <variable>`:  breakpoint when it changes

`p <opt> <arg>`: print arg

`x <opt> <arg>`: examine memory at an address



