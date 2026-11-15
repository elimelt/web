---
title: Orthogonality, Projections, and Least Squares
category: Mathematics
tags:
  - linear algebra
  - orthogonality
  - projections
  - least squares
  - qr decomposition
date: 2026-08-01
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Orthogonality, orthogonal projection and least squares as formulations of one orthogonality condition, with the normal equations, the geometry of residuals, and the numerical reason that QR is preferred to the normal equations.
sources:
  - title: MIT 18.06 Linear Algebra, Spring 2010 (Strang), lectures 15-17
    url: https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/
    type: course
  - title: Interactive Linear Algebra (Margalit and Rabinoff), chapter 6
    url: https://textbooks.math.gatech.edu/ila/chap-orthogonality.html
    type: book
  - title: numpy.linalg.lstsq
    url: https://numpy.org/doc/stable/reference/generated/numpy.linalg.lstsq.html
    type: docs
  - title: Trefethen and Bau, Numerical Linear Algebra (SIAM, 1997), lectures 11 and 19
    type: book
---

The orthogonal projection of a vector $b \in \mathbb{R}^n$ onto a subspace $W$ is the unique point $\hat{b} \in W$ for which the error $b - \hat{b}$ is orthogonal to $W$, and it is the point of $W$ closest to $b$. A least-squares solution of an overdetermined system $Ax = b$ is a vector $\hat{x}$ for which $A\hat{x}$ is the projection of $b$ onto the column space of $A$.

Orthogonality, projection and least squares are thus three formulations of one condition, the orthogonality of the error to the subspace. That condition yields the normal equations. Numerical libraries nevertheless solve least-squares problems with QR or SVD factorizations, because forming the normal equations squares the condition number. Matrix background is in [[math/linear-algebra/cheatsheet|Matrix Theory]].

## Orthogonality and orthonormal bases

Vectors $u, v \in \mathbb{R}^n$ are orthogonal when $u^T v = 0$. A set of vectors is orthonormal when the vectors are pairwise orthogonal and unit length. Orthonormal bases simplify computation. If $Q = [u_1 \cdots u_k]$ has orthonormal columns then $Q^T Q = I$, and the coordinates of a vector in that basis are inner products, so no linear system has to be solved.

The orthogonal complement of a subspace $W \subseteq \mathbb{R}^n$ is $W^\perp = \{v : v^T w = 0 \text{ for all } w \in W\}$. The instance used in least squares is

$$
\mathrm{col}(A)^\perp = \ker(A^T),
$$

that is, the vectors perpendicular to every column of $A$ are exactly the vectors in the kernel of $A^T$ ([ILA §6.2](https://textbooks.math.gatech.edu/ila/chap-orthogonality.html)). Every $b \in \mathbb{R}^n$ decomposes uniquely as $b = \hat{b} + e$ with $\hat{b} \in W$ and $e \in W^\perp$.

## Projections

The projection of $b$ onto $W$ is that component $\hat{b}$, the closest point in $W$ to $b$. With an orthonormal basis $u_1, \dots, u_k$ for $W$,

$$
\mathrm{proj}_W(b) = \sum_{i=1}^{k} (u_i^T b)\, u_i = Q Q^T b,
$$

per [ILA §6.3](https://textbooks.math.gatech.edu/ila/chap-orthogonality.html). For a general full-column-rank matrix $A$ whose columns span $W$, the projection is computed by solving for a coefficient vector. The projection is $A\hat{x}$, where $\hat{x}$ makes the residual perpendicular to every column, and the projection matrix is

$$
P = A (A^T A)^{-1} A^T.
$$

Projection matrices satisfy $P^2 = P$ (projecting twice changes nothing) and $P^T = P$. Strang's [18.06 lectures 15-16](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/) develop least squares from this matrix.

## Least squares and the normal equations

An overdetermined system $Ax = b$ with $A \in \mathbb{R}^{m \times n}$, $m > n$, in general has no solution, since $b$ need not lie in $\mathrm{col}(A)$. The least-squares problem seeks the $\hat{x}$ minimizing $\lVert Ax - b \rVert_2^2$. Geometrically, $A\hat{x}$ must be the projection of $b$ onto $\mathrm{col}(A)$, so the residual $r = b - A\hat{x}$ lies in $\mathrm{col}(A)^\perp = \ker(A^T)$:

$$
A^T (b - A\hat{x}) = 0
\quad\Longleftrightarrow\quad
A^T A\, \hat{x} = A^T b.
$$

These are the normal equations ([ILA §6.5](https://textbooks.math.gatech.edu/ila/chap-orthogonality.html)). The same equation follows from setting the gradient to zero, since $\nabla_x \lVert Ax - b\rVert^2 = 2 A^T(Ax - b)$. $A^T A$ is invertible exactly when $A$ has full column rank, and then $\hat{x} = (A^T A)^{-1} A^T b$ is unique.

> [!tip] The normal equations are an orthogonality statement
> $A^T A \hat{x} = A^T b$ is the condition $A^T r = 0$ rearranged, which states that the residual $r = b - A\hat{x}$ is perpendicular to every column of $A$. The condition also provides a check on any fitted model, since $A^T r$ should be numerically zero, as it is in the [[#Worked example|worked example]].

The residual is orthogonal to every vector in the column space, that is, to every prediction the model can express. In a regression with an intercept column of ones, orthogonality against that column forces the residuals to sum to zero. With the intercept present, orthogonality against a feature column means that the residual is uncorrelated with that feature, and any structure remaining in the residual lies outside the column space.

## Worked example

Strang's example in [18.06 lecture 16](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/) fits a line $y = c_0 + c_1 t$ through the points $(0, 6)$, $(1, 0)$, $(2, 0)$:

$$
A = \begin{pmatrix} 1 & 0 \\ 1 & 1 \\ 1 & 2 \end{pmatrix}, \quad
b = \begin{pmatrix} 6 \\ 0 \\ 0 \end{pmatrix}, \quad
A^T A = \begin{pmatrix} 3 & 3 \\ 3 & 5 \end{pmatrix}, \quad
A^T b = \begin{pmatrix} 6 \\ 0 \end{pmatrix}.
$$

Solving $A^T A \hat{x} = A^T b$ gives $\hat{x} = (5, -3)^T$, the line $y = 5 - 3t$. The fitted values are $(5, 2, -1)$ and the residual is $r = (1, -2, 1)$. Both orthogonality conditions hold: $r$ sums to zero (intercept column) and $0\cdot1 + 1\cdot(-2) + 2\cdot1 = 0$ (slope column), so $r \perp \mathrm{col}(A)$ as derived.

```python
import numpy as np

A = np.array([[1.0, 0.0], [1.0, 1.0], [1.0, 2.0]])
b = np.array([6.0, 0.0, 0.0])

xhat, res, rank, sv = np.linalg.lstsq(A, b, rcond=None)
print(xhat)                    # [ 5. -3.]
r = b - A @ xhat
print(A.T @ r)                 # ~[0. 0.], residual orthogonal to columns

P = A @ np.linalg.inv(A.T @ A) @ A.T   # projection onto col(A)
print(np.allclose(P @ b, A @ xhat))    # True
print(np.allclose(P @ P, P))           # True, projecting twice is a no-op
```

## Why QR instead of the normal equations

Forming $A^T A$ squares the conditioning of the problem: for full-column-rank $A$, $\kappa(A^T A) = \kappa(A)^2$ (Trefethen and Bau, lecture 19; Golub and Van Loan, ch. 5). A matrix with $\kappa(A) = 10^6$ is ill-conditioned; its normal equations have $\kappa = 10^{12}$ and can lose all useful digits in double precision. The QR method factors $A = QR$ with orthonormal $Q$ and triangular $R$, then solves $R\hat{x} = Q^T b$ by back substitution. Orthogonal transformations preserve norms and hence conditioning, and Householder QR is backward stable (Trefethen and Bau, lecture 16), so the accuracy tracks $\kappa(A)$ rather than $\kappa(A)^2$.

> [!warning] Derive with the normal equations, solve with QR or SVD
> The normal equations characterize the least-squares solution but are numerically unsuitable for computing it. Explicitly forming $A^T A$ squares the condition number, so an ill-conditioned problem can lose all accuracy. In double precision, $\kappa(A) \approx 10^8$ gives $\kappa(A^T A) \approx 10^{16}$, comparable to the reciprocal of machine epsilon. Library solvers (`lstsq`, R's `lm`, LAPACK drivers) use QR or SVD for this reason.

[numpy.linalg.lstsq](https://numpy.org/doc/stable/reference/generated/numpy.linalg.lstsq.html) uses an SVD-based LAPACK driver (`gelsd`). The SVD is more expensive than QR and handles rank deficiency. Singular values below `rcond` times the largest are treated as zero, and among all minimizers `lstsq` returns the one of minimum norm, which is the pseudoinverse solution treated in [[math/linear-algebra/svd-and-pseudoinverse|SVD and the Pseudoinverse]].

## Sources

- [MIT 18.06 Linear Algebra, Spring 2010 (Strang), lectures 15-17](https://ocw.mit.edu/courses/18-06-linear-algebra-spring-2010/)
- [Interactive Linear Algebra (Margalit and Rabinoff), chapter 6](https://textbooks.math.gatech.edu/ila/chap-orthogonality.html)
- [numpy.linalg.lstsq documentation](https://numpy.org/doc/stable/reference/generated/numpy.linalg.lstsq.html)
- Trefethen and Bau, Numerical Linear Algebra (SIAM, 1997), lectures 11, 16, 19

## Related notes

- [[math/linear-algebra/cheatsheet|Matrix Theory]]
- [[math/linear-algebra/svd-and-pseudoinverse|Singular Value Decomposition and the Pseudoinverse]]
- [[math/linear-algebra/eigenvalues-eigenvectors-diagonalization|Eigenvalues, Eigenvectors, and Diagonalization]]
