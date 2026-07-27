---
title: "Seed 01: Geodetic Precision"
tags:
  - geodesy
  - coordinates
  - ecs
  - 1.1
---

## The Problem

The naive approach to planetary coordinates treats the Earth as a sphere. This is wrong in three ways:

1. **WGS-84 is an oblate spheroid**, not a sphere. The equatorial radius is $6,378,137$ m; the polar radius is $6,356,752$ m. The flattening is $1/298.257223563$.
2. **Altitude $h$ is measured normal to the ellipsoid**, not radially from the center. At 45° latitude, the difference is ~$20$ km.
3. **A single `float32` origin drifts at ~1 cm precision beyond 100 km** from the origin. Planetary-scale games cannot use one global Cartesian frame.

The correct pipeline requires **LLA → ECEF → ENU** with chunked local origins.

## The ECS Analogy

In a game engine, a `Transform` component holds position. Systems read and write it each frame. Geodetic coordinates work the same way:

| Geodetic Frame | ECS Role | Data |
|:--|:--|:--|
| LLA | **Authoritative source component** | `lat`, `lon`, `alt`, `datum` |
| ECEF | **Physics system write target** | `x`, `y`, `z` in meters |
| ENU | **Camera/character system read source** | `e`, `n`, `u` relative to local origin |

No system writes LLA directly except the initialization and save/load systems.

## Forward Transform: LLA → ECEF

For a given datum with semi-major axis $a$ and first eccentricity $e$:

$$N = \frac{a}{\sqrt{1 - e^2 \sin^2 \phi}}$$

$$X = (N + h) \cos\phi \cos\lambda$$
$$Y = (N + h) \cos\phi \sin\lambda$$
$$Z = (N(1 - e^2) + h) \sin\phi$$

Where:
- $\phi$ = geodetic latitude
- $\lambda$ = longitude
- $h$ = ellipsoidal height
- $N$ = prime vertical radius of curvature

## Inverse Transform: ECEF → LLA

Bowring's 1976 closed-form solution (iterative refinement for $h$):

$$\phi_0 = \arctan\left(\frac{Z}{\sqrt{X^2 + Y^2}}\right)$$

$$C = \frac{a^2}{b^2} = \frac{1}{1 - e^2}$$

$$\phi = \arctan\left(\frac{Z + C b e'^2 \sin^3 \phi_0}{\sqrt{X^2 + Y^2} - a e^2 \cos^3 \phi_0}\right)$$

Iterate $\phi_0 \leftarrow \phi$ until convergence (typically 2–3 iterations).

## ECEF → ENU: The Local Camera Frame

Given a local origin $(\phi_0, \lambda_0, h_0)$ in ECEF:

$$\mathbf{R}_{ECEF}^{ENU} = \begin{bmatrix} -\sin\lambda_0 & \cos\lambda_0 & 0 \\ -\sin\phi_0\cos\lambda_0 & -\sin\phi_0\sin\lambda_0 & \cos\phi_0 \\ \cos\phi_0\cos\lambda_0 & \cos\phi_0\sin\lambda_0 & \sin\phi_0 \end{bmatrix}$$

$$\mathbf{p}_{ENU} = \mathbf{R}_{ECEF}^{ENU} (\mathbf{p}_{ECEF} - \mathbf{p}_{origin})$$

## Implementation Sketch

```cpp
struct GeodeticPosition {
    double lat, lon, alt;  // radians, meters
    Datum datum;           // WGS-84, etc.
    
    Vec3d ToECEF() const;
    Vec3d ToENU(const GeodeticPosition& origin) const;
    static GeodeticPosition FromECEF(const Vec3d& ecef);
};
