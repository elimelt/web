---
title: Sliding Window Pattern
category: Algorithms
tags:
  - sliding-window
  - two-pointers
  - arrays
  - streaming-algorithms
date: 2024-03-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: The recognition of sliding window problems and the design of fixed and variable size window algorithms over linear data structures.
---

A **sliding window** algorithm maintains a contiguous subarray of a linear data structure, the window, together with a summary of its contents, and advances the window's endpoints through the input.

Each step changes the window only at its ends, so the summary is updated from the elements entering and leaving the window instead of being recomputed from all of its elements.

## Core idea

Sliding window problems fall into two categories.

1. **Fixed size window**: the window size is constant throughout the iteration. These problems are simpler, since every step performs the same update.
2. **Variable size window**: the window grows and shrinks during the iteration, depending on the algorithm's state. These are harder, since each step must decide whether to expand or contract the window.

> [!tip] Recognition cues
> The input is a linear structure, the answer concerns a contiguous run of elements, and the brute force re-scans overlapping subarrays. When all three hold, a window with incremental state can remove a factor of $n$ from the running time.

## Fixed size window

A fixed size window applies when the input is a linear data structure and the task asks for a minimal or maximal contiguous subset of elements of known size.

The algorithm has the following form.

- Initialize the window state with the first $k$ elements.
- Iterate through the array from index $k$ to $n - 1$.
  - At each step, update the window state by removing the element leaving the window and adding the next element.
  - Update the result based on the window state, sometimes conditionally.
- Return the result.

The design of such an algorithm answers three questions.

- What state describes a window of elements? A sum fits in an integer, element frequencies fit in a `dict`, a running maximum needs a monotonic deque.
- How does the state change when an element enters or leaves the window? This can be as simple as adding and subtracting, or as involved as solving an entire subproblem on the window state.
- How and when does the window state update the result? For minimum and maximum problems the state is often directly comparable against the result.

Some problems apply a function to every window of a fixed size and output the list of per-window results. The same algorithm applies, appending each iteration's result to a list. If the final answer depends only on an aggregate of window states, a single result can be updated in streaming fashion instead, which suffices whenever the output is a single value.

## Variable size window

Variable size windows involve more logic per iteration, since each step decides whether to expand or contract the window, in addition to updating the window state in each case.

The algorithm has the following form.

- Start with two pointers $l = r = 0$ and an empty window state.
- Advance $r$ one element at a time, adding $A[r]$ to the window state.
- After each expansion, shrink from the left while the window violates the problem's constraint, removing $A[l]$ from the state and incrementing $l$.
- Update the result whenever the window is valid. For longest-window problems that is after the shrink loop restores validity. For shortest-window problems, shrink while the window stays valid and record the size before it breaks.

The nested loop appears quadratic, but both pointers move only forward, so each element enters and leaves the window at most once, and the whole pass performs $O(n)$ state updates.

> [!example] Minimum size subarray with sum at least 7
>
> ```text
> A = [2, 3, 1, 2, 4, 3]
>
> [2  3  1  2] 4  3     sum 8,  valid   -> best = 4, shrink
>  2 [3  1  2] 4  3     sum 6,  invalid -> expand
>  2 [3  1  2  4] 3     sum 10, valid   -> best = 4, shrink
>  2  3 [1  2  4] 3     sum 7,  valid   -> best = 3, shrink
>  2  3  1 [2  4] 3     sum 6,  invalid -> expand
>  2  3  1 [2  4  3]    sum 9,  valid   -> best = 3, shrink
>  2  3  1  2 [4  3]    sum 7,  valid   -> best = 2, shrink
>  2  3  1  2  4 [3]    sum 3,  invalid, array exhausted -> answer 2
> ```

> [!warning] Negative numbers break the shrink step
> The shrink loop relies on removals moving the window state monotonically, so a too-large sum only shrinks toward the target. A negative element lets the sum grow as the window shrinks, and the two-pointer argument no longer holds. Shortest subarray with sum at least $k$ on signed input needs prefix sums with a monotonic deque instead.

## Practice problems

- [minimum-size-subarray-sum](https://leetcode.com/problems/minimum-size-subarray-sum/)
- [longest-substring-without-repeating-characters](https://leetcode.com/problems/longest-substring-without-repeating-characters)
- [substring-with-concatenation-of-all-words](https://leetcode.com/problems/substring-with-concatenation-of-all-words)
- [minimum-window-substring](https://leetcode.com/problems/minimum-window-substring)

## Related notes

- [[algorithms/patterns/BFS|Breadth First Search Pattern]]
- [[systems/networks/4-transport/flow-control|Flow Control]]
- [[systems/networks/4-transport/ACK-clocking|Sliding Window ACK Clock]]
