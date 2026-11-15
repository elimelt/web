---
title: Java Streams and Lambdas
aliases:
  - teaching/modern-java/lambdas-and-streams
category: Software Engineering
tags:
  - java
  - streams
  - lambdas
  - functional-programming
  - collections
date: 2024-12-08
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Java streams and lambdas and the reason for their introduction, with imperative and declarative versions of filtering, mapping, matching, summing and grouping.
sources:
  - title: java.util.stream package documentation
    url: https://docs.oracle.com/javase/8/docs/api/java/util/stream/package-summary.html
    type: docs
---

A Java stream (`java.util.stream.Stream`) is a sequence of elements that supports aggregate operations, such as filtering, mapping and reduction, composed into a pipeline. A lambda expression is an anonymous function whose type is a functional interface, and lambdas supply the per-element behavior of stream operations.

Streams and lambdas express collection operations in a *declarative* style. The *imperative* style, with loops and conditionals, is the one taught in the 12x/14x series at UW, and it becomes verbose for simple operations. The following method is an example:

```java
List<User> getAdmins(List<User> users) {
    List<User> admins = new ArrayList<>();
    for (User user : users) {
        if (user.isAdmin()) {
            admins.add(user);
        }
    }
    return admins;
}
```

It iterates over the provided list of users and keeps those that are admins. A check that *all* users are admins has the same structure:

```java
boolean allAdmins(List<User> users) {
    for (User user : users) {
        if (!user.isAdmin()) {
            return false;
        }
    }
    return true;
}
```

Each of these simple operations takes several lines of loop code. Streams and lambdas express the same operations in a *declarative* style.

## Java Streams

Streams resemble iterators in that they traverse the elements of a collection, and they add operations on those elements that compose into a pipeline. The admin filter becomes:

```java
List<User> admins = users.stream()
    .filter(user -> user.isAdmin())
    .collect(Collectors.toList());

// note while using collect(Collectors.to*()) is going to work in most cases,
// when terminating a stream to a list you can also use the toList() method
List<User> admins = users.stream().filter(User::isAdmin).toList();
```

The parts of the pipeline are:

- `users.stream()`: This converts the list of users into a Stream (`java.util.stream.Stream`).
- `user -> user.isAdmin()`: This is a Lambda expression. It passes a function as an argument, in this case a function that takes a `User` object and returns a boolean. The method reference `User::isAdmin` is equivalent and calls the `isAdmin` method on the `User` object passed as the argument.
- `filter(...)`: This is an intermediate operation. It takes a predicate (a function that returns a boolean) and filters out elements that don't satisfy the predicate.
- `collect(...)`: This is a terminal operation. It collects the elements of the Stream into a list.

## Lambdas

A lambda defines a function without an explicitly declared class or method, which is convenient for passing a function as an argument to another function. Each lambda below has a different functional interface type:

```java
// A lambda that takes no arguments and returns void
Runnable r = () -> System.out.println("Hello, world!");

// A lambda that takes two integers and returns an integer
BiFunction<Integer, Integer, Integer> add = (a, b) -> a + b;

// A lambda that takes a string and returns a string
Function<String, String> toUpperCase = s -> s.toUpperCase();

// A lambda that takes a string and returns a boolean
Predicate<String> isEmpty = s -> s.isEmpty();
```

In stream code, lambdas are usually passed directly as arguments and never assigned to a variable, so these interface names are rarely written. A lambda assigned to a variable requires an explicit functional interface type such as those above. `var` cannot be used, since the compiler needs an explicit target type to determine the lambda's type.

## Common Operations

Each of the following operations is shown in imperative and in stream-based form.

### Filtering

```java
// Imperative
List<User> admins = new ArrayList<>();
for (User user : users) {
    if (user.isAdmin()) {
        admins.add(user);
    }
}

// Declarative
List<User> admins = users.stream()
    .filter(User::isAdmin)
    .toList();
```

### Mapping

```java
// Imperative
List<String> names = new ArrayList<>();
for (User user : users) {
    names.add(user.getName());
}

// Declarative
List<String> names = users.stream().map(User::getName).toList();
```

### All match

```java
// Imperative
boolean allAdmins = true;
for (User user : users) {
    if (!user.isAdmin()) {
        allAdmins = false;
        break;
    }
}

// Declarative
boolean allAdmins = users.stream().allMatch(User::isAdmin);
```

### Any match

```java
// Imperative
boolean anyAdmins = false;
for (User user : users) {
    if (user.isAdmin()) {
        anyAdmins = true;
        break;
    }
}

// Declarative
boolean anyAdmins = users.stream().anyMatch(User::isAdmin);
```

### Sum

```java
// Imperative
int sum = 0;
for (int i : numbers) {
    sum += i;
}

// Declarative
int sum = numbers.stream().reduce(0, Integer::sum);

// alternatively, you can use the sum() method
int sum = numbers.stream().mapToInt(Integer::intValue).sum();

// or Collectors.summingInt()
int sum = numbers.stream().collect(Collectors.summingInt(Integer::intValue));
```

### Grouping

```java
// Imperative
Map<String, List<User>> usersByRole = new HashMap<>();
for (User user : users) {
    usersByRole.computeIfAbsent(
      user.getRole(), k -> new ArrayList<>()
    ).add(user);
}

// Declarative
Map<String, List<User>> usersByRole = users.stream()
    .collect(Collectors.groupingBy(User::getRole));
```

## Related

- [[software/java/collections-and-records|Creating Collections and Data Types in Modern Java]]
- [[systems/databases/derived-data/ch10-batch-processing|Batch Processing Systems and MapReduce Fundamentals]]
