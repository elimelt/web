---
title: Creating Collections and Data Types in Modern Java
aliases:
  - teaching/modern-java/collections-and-records
category: Software Engineering
tags:
  - java
  - collections
  - immutability
  - java records
date: 2024-12-08
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Creating fixed-size lists with Arrays.asList and immutable collections with the Java 9 factory methods, and defining data types with records.
sources:
  - title: "JEP 269: Convenience Factory Methods for Collections"
    url: https://openjdk.org/jeps/269
    type: docs
  - title: "JEP 395: Records"
    url: https://openjdk.org/jeps/395
    type: docs
---

Java provides concise constructs for creating a collection whose elements are fixed at construction (`Arrays.asList` and the factory methods `List.of`, `Set.of` and `Map.of`) and for defining a data type that holds structured data (the `record` keyword).

Collections of fixed elements are frequently needed in tests and in implementations of algorithms. A conventional class for structured data requires a constructor and hand-written `toString`, `equals` and `hashCode` methods, which a record generates automatically. To my knowledge, the UW introductory series does not cover these features.

## Arrays.asList

The `Arrays.asList` method creates a list from its arguments. It takes a variable number of arguments and returns a fixed-size list backed by the underlying array. Elements cannot be added or removed, but the elements themselves can be modified.

```java
List<Integer> list = Arrays.asList(1, 2, 3, 4, 5);
```

## Java 9+ Factory Methods

Java 9 introduced factory methods for creating immutable collections ([JEP 269](https://openjdk.org/jeps/269)). They are available on the `List`, `Set`, and `Map` interfaces:

```java
List<Integer> list = List.of(1, 2, 3, 4, 5);
Set<Integer> set = Set.of(1, 2, 3, 4, 5);
Map<Integer, String> map = Map.of(
  1, "one",
  2, "two",
  3, "three"
);
```

## Records

Records define simple data classes with minimal boilerplate. They shipped as a preview in Java 14 and became standard in Java 16 ([JEP 395](https://openjdk.org/jeps/395)). In addition to being more concise than traditional classes, records provide `toString`, `equals`, and `hashCode` methods by default.

```java
// With classes
class Point {
  int x;
  int y;

  Point(int x, int y) {
    this.x = x;
    this.y = y;
  }

  public String toString() {
    return String.format("(%d, %d)", x, y);
  }

  public boolean equals(Object o) {
    if (o == this) return true;
    if (!(o instanceof Point)) return false;
    Point p = (Point) o;
    return p.x == x && p.y == y;
  }

  public int hashCode() {
    return Objects.hash(x, y);
  }
}

// With records
record Point(int x, int y) {}
```

## Example: a playing card

Consider the representation of a card in a poker game. Written with the features of introductory Java, the class is as follows.

```java
enum Suit {
  HEARTS, DIAMONDS, CLUBS, SPADES
}

class Card {
  private final Suit suit;
  private final int rank;

  Card(Suit suit, int rank) {
    this.suit = suit;
    this.rank = rank;
  }

  public Suit getSuit() {
    return suit;
  }

  public int getRank() {
    return rank;
  }

  public String toString() {
    return String.format("%d of %s", rank, suit);
  }

  public boolean equals(Object o) {
    if (o == this) return true;
    if (!(o instanceof Card)) return false;
    Card c = (Card) o;
    return c.suit == suit && c.rank == rank;
  }

  public int hashCode() {
    return Objects.hash(suit, rank);
  }
}
```

A record defines the same type more concisely:

```java
enum Suit {
  HEARTS, DIAMONDS, CLUBS, SPADES
}

record Card(Suit suit, int rank) {}
```

Records can also declare methods and implement interfaces:

```java
record Card(Suit suit, int rank) implements Comparable<Card> {
  public int compareTo(Card other) {
    return Integer.compare(rank, other.rank);
  }
}
```

The following test sorts a list of cards and compares the result with the expected order.

```java
public static void main(String[] args) {
  var cards = List.of(
    new Card(Suit.CLUBS, 4),
    new Card(Suit.DIAMONDS, 3),
    new Card(Suit.HEARTS, 2),
    new Card(Suit.SPADES, 5)
  );

  var expected = List.of(
    new Card(Suit.HEARTS, 2),
    new Card(Suit.DIAMONDS, 3),
    new Card(Suit.CLUBS, 4),
    new Card(Suit.SPADES, 5)
  );

  var sorted = cards.stream()
    .sorted()
    .toList();

  assert sorted.equals(expected);
}
```

The sort produces a new list, since `List.of` returns an immutable one. The comparison works because `Card` implements `Comparable`, and the equality check works because records generate `equals`. Run the program with `java -ea` so that the assertion is checked.

## Related

- [[software/java/lambdas-and-streams|Java Streams and Lambdas]]
- [[reference/cheatsheets/java-spring-boot/reference|Spring Boot Annotations]]
