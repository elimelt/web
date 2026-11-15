---
title: Glossary of Linear Algebra Concepts
aliases:
  - linear-algebra/elementry-linear-algebra
category: Mathematics
tags:
  - gaussian-elimination
  - linear-transformations
  - matrix-multiplication
  - span
  - linear-independence
date: 2024-12-08
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Systems of linear equations, Gaussian elimination, span, linear transformations and matrix multiplication, with emphasis on the consequences of row reduction that recur in later linear algebra.
sources:
  - https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/
  - https://textbooks.math.gatech.edu/ila/
---

Elementary linear algebra begins with systems of linear equations $Ax = b$, the row operations that solve them, and the vector-space concepts that the solution procedure exposes: span, linear independence, linear transformations and matrix multiplication.

The algorithms are treated briefly, and the emphasis is on the consequences of row reduction that recur in later material. The broader [[math/linear-algebra/cheatsheet|Matrix Theory reference]] and its practical [[math/linear-algebra/python-cheatsheet|NumPy companion]] complement these definitions.

## Systems of Equations

Systems of linear equations are fundamental to linear algebra. The two primary introductory courses at the University of Washington, Math 208 and, to a lesser extent, Applied Math 352, spend a significant amount of time on methods for *solving* systems of equations. The notation and algorithms are summarized briefly here, with the emphasis on the consequences that are used in later material.

### Notation

$$
\begin{aligned}
a_{11}x_1 + a_{12}x_2 + \cdots + a_{1n}x_n &= b_1 \\
a_{21}x_1 + a_{22}x_2 + \cdots + a_{2n}x_n &= b_2 \\
&\vdots \\
a_{m1}x_1 + a_{m2}x_2 + \cdots + a_{mn}x_n &= b_m
\end{aligned}
$$

The same system is written in matrix form as $Ax = b$.

$$
\begin{aligned}
\begin{bmatrix}
a_{11} & a_{12} & \cdots & a_{1n} \\
a_{21} & a_{22} & \cdots & a_{2n} \\
\vdots & \vdots & \ddots & \vdots \\
a_{m1} & a_{m2} & \cdots & a_{mn}
\end{bmatrix}
\begin{bmatrix}
x_1 \\
x_2 \\
\vdots \\
x_n
\end{bmatrix}
&=
\begin{bmatrix}
b_1 \\
b_2 \\
\vdots \\
b_m
\end{bmatrix}
\end{aligned}
$$

### Gaussian Elimination

Gaussian elimination applies the following **elementary row operations** to the augmented matrix $\lbrack  A|b  \rbrack$:

- Swap two rows
- Multiply a row by a nonzero scalar
- Add a multiple of one row to another

The algorithm reduces the matrix to either **row echelon form** or **reduced row echelon form**. In row echelon form, the first nonzero entry of each row sits strictly to the right of the first nonzero entry of the row above it (many texts also scale each leading entry to 1). In reduced row echelon form, each leading entry is 1 and is the only nonzero entry in its column. For example, below $A$ is in row echelon form, and $B$ is in reduced row echelon form.

$$
\begin{aligned}
A &=
\begin{bmatrix}
a_{11} & a_{12} & a_{13} & a_{14} \\
0 & a_{22} & a_{23} & a_{24} \\
0 & 0 & a_{33} & a_{34} \\
0 & 0 & 0 & a_{44}
\end{bmatrix}
\\
B &=
\begin{bmatrix}
1 & 0 & 0 & 0 \\
0 & 1 & 0 & 0 \\
0 & 0 & 1 & 0 \\
0 & 0 & 0 & 1
\end{bmatrix}
\end{aligned}
$$

Each row operation is applied to $b$ as well, which keeps the system equivalent. Once the matrix is in row echelon form, the system is solved by back substitution, or by further reduction to reduced row echelon form, from which the solution can be read directly.

### Takeaways

#### Row Operations

The structure that row reduction exposes illustrates several ideas used in later material.

- **Row operations** are reversible and preserve the solution set. Each operation corresponds to left multiplication by an invertible elementary matrix, and the elementary matrices generate a **group** under multiplication.
- Row reduction exposes the structure of the solution set. Pivot columns correspond to determined variables and non-pivot columns to free ones, which gives a parameterization of the solution set, and the number of pivots is the **rank** of the matrix.
- Rows of zeros left after row reduction indicate **redundancy** among the original equations, in other words **linear dependence**.

#### Span

The span of a set of vectors is the set of all possible linear combinations of those vectors, and it is always a **subspace** of the ambient vector space. For a matrix whose columns are those vectors, the span is exactly the **column space** of the matrix.

$$
\begin{aligned}
\text{span}\left\{ \begin{bmatrix} 1 \\ 0 \end{bmatrix}, \begin{bmatrix} 0 \\ 1 \end{bmatrix} \right\} &= \mathbb{R}^2 \\
\text{span}\left\{ \begin{bmatrix} 1 \\ 0 \end{bmatrix}, \begin{bmatrix} 0 \\ 1 \end{bmatrix}, \begin{bmatrix} 1 \\ 1 \end{bmatrix} \right\} &= \mathbb{R}^2 \\
\text{span}\left\{ \begin{bmatrix} 1 \\ 0 \end{bmatrix}, \begin{bmatrix} 0 \\ 1 \end{bmatrix}, \begin{bmatrix} 1 \\ 1 \end{bmatrix} \right\} &= \text{span}\left\{ \begin{bmatrix} 1 \\ 0 \end{bmatrix}, \begin{bmatrix} 0 \\ 1 \end{bmatrix} \right\}
\end{aligned}
$$

For a set of $n$ vectors in $\mathbb{R}^n$ to span $\mathbb{R}^n$, the vectors must be linearly independent. This is a necessary and sufficient condition for a set of vectors to be a **basis** for $\mathbb{R}^n$. Similar reasoning gives further rules relating spanning sets and linear independence. For instance, a set of fewer than $n$ vectors in $\mathbb{R}^n$ cannot span $\mathbb{R}^n$, and a set of more than $n$ vectors in $\mathbb{R}^n$ must be linearly dependent.

#### Linear Transformations

For a function to be linear, it must satisfy two properties:

- **Additivity**: $f(x + y) = f(x) + f(y)$
- **Homogeneity**: $f(cx) = cf(x)$

A linear transformation is a function $T: \mathbb{R}^n \to \mathbb{R}^m$ that satisfies these properties. The **kernel** of a linear transformation is the set of vectors that are mapped to the zero vector, the solutions of $T(x) = 0$, or $Ax = 0$ for a matrix $A$ that represents the transformation. The kernel is a subspace of the domain. The **range** of a linear transformation is the set of all possible outputs, and is a subspace of the codomain.

$$
\begin{aligned}
T: \mathbb{R}^2 &\to \mathbb{R}^2 \\
T\left( \begin{bmatrix} x \\ y \end{bmatrix} \right) &= \begin{bmatrix} x \\ 0 \end{bmatrix}
\end{aligned}
$$

$$
\begin{aligned}
\text{ker}(T) &= \text{span}\left\{ \begin{bmatrix} 0 \\ 1 \end{bmatrix} \right\} \\
\text{range}(T) &= \text{span}\left\{ \begin{bmatrix} 1 \\ 0 \end{bmatrix} \right\}
\end{aligned}
$$

#### Matrix-Vector Multiplication

$$
\begin{aligned}
A\begin{bmatrix} x \\ y \end{bmatrix} &= x\begin{bmatrix} a_{11} \\ a_{21} \end{bmatrix} + y\begin{bmatrix} a_{12} \\ a_{22} \end{bmatrix} \\
&= \begin{bmatrix} a_{11}x + a_{12}y \\ a_{21}x + a_{22}y \end{bmatrix}
\end{aligned}
$$

Matrix-vector multiplication is a linear transformation. The columns of the matrix are the images of the basis vectors, and the result is the image of the input vector. The kernel of the transformation is the null space of the matrix, and the range is the column space of the matrix.

Geometrically, the matrix transforms the basis vectors of the domain, and with them the unit square. Its columns are the images of the basis vectors, and the product is the image of the input vector.

#### Matrix-Matrix Multiplication

$$
\begin{aligned}
AB &= A\begin{bmatrix} b_1 & b_2 & \cdots & b_n \end{bmatrix} \\
&= \begin{bmatrix} Ab_1 & Ab_2 & \cdots & Ab_n \end{bmatrix}
\end{aligned}
$$

The product is computed by multiplying $A$ by each column of $B$. The result is a matrix whose columns are the images of the columns of $B$ under $A$, which is the composition of the two transformations. The column space of $AB$ sits inside the column space of $A$, and the null space of $AB$ contains the null space of $B$.

```python
import numpy as np

## inefficient
def multiply_bad(A, B):
    C = np.zeros((A.shape[0], B.shape[1]))
    for i in range(A.shape[0]):
        for j in range(B.shape[1]):
            for k in range(A.shape[1]):
                C[i, j] += A[i, k] * B[k, j]
    return C

## efficient
def multiply_good(A, B):
    return np.dot(A, B)

M, N = 1000, 1000
A = np.random.rand(M, N)
B = np.random.rand(N, M)

## in IPython/Jupyter:
## %timeit multiply_bad(A, B)
## %timeit multiply_good(A, B)
```

Matrix multiplication is a costly operation. The schoolbook algorithm takes $O(n^3)$ time for square matrices, and the naive triple loop is impractically slow for matrices of realistic size. Libraries like NumPy dispatch to heavily optimized BLAS routines that use vectorized instructions and cache-aware blocking, and run orders of magnitude faster than the naive loop even at the same asymptotic complexity. Practical code therefore calls such a library instead of implementing matrix multiplication directly.

## Related notes

- [[math/linear-algebra/cheatsheet|Matrix Theory reference]]
- [[math/linear-algebra/python-cheatsheet|Python Linear Algebra Cheatsheet]]
