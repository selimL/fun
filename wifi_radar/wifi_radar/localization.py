"""Locate a transmitter from RSSI samples taken at different receiver positions.

Every time you take a step, each device is measured from a new spot. With
samples from several spots we can solve for the device position (x, y) and
its 1 m power P0 by fitting the path-loss model. The fit is done as a dense
grid search (robust, no local minima) and turned into a posterior so we also
get an uncertainty radius.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .pathloss import DEFAULT_EXPONENT, MIN_DISTANCE

P0_RANGE = (-60.0, -25.0)  # plausible 1 m power for Wi-Fi devices
MEASUREMENT_SIGMA_DB = 4.0


@dataclass
class Fit:
    x: float
    y: float
    sigma: float
    p0: float
    rms_error: float


class Grid:
    def __init__(self, xmin: float, xmax: float, ymin: float, ymax: float, res: float):
        self.xmin, self.xmax, self.ymin, self.ymax, self.res = xmin, xmax, ymin, ymax, res
        self.xs = np.arange(xmin + res / 2, xmax, res)
        self.ys = np.arange(ymin + res / 2, ymax, res)
        gx, gy = np.meshgrid(self.xs, self.ys)  # shape (ny, nx)
        self.gx, self.gy = gx, gy
        self.flat_x = gx.ravel()
        self.flat_y = gy.ravel()

    @property
    def shape(self):
        return self.gx.shape

    def index(self, x: float, y: float):
        i = int((y - self.ymin) / self.res)
        j = int((x - self.xmin) / self.res)
        if 0 <= i < self.shape[0] and 0 <= j < self.shape[1]:
            return i, j
        return None


def fit_position(xs, ys, rssi, weights, grid: Grid, n: float = DEFAULT_EXPONENT) -> Fit | None:
    xs = np.asarray(xs, float)
    ys = np.asarray(ys, float)
    r = np.asarray(rssi, float)
    w = np.asarray(weights, float)
    if len(r) < 4:
        return None

    dx = grid.flat_x[:, None] - xs[None, :]
    dy = grid.flat_y[:, None] - ys[None, :]
    d = np.maximum(np.hypot(dx, dy), MIN_DISTANCE)
    loss = 10.0 * n * np.log10(d)  # (G, S)

    wsum = w.sum()
    p0 = ((r[None, :] + loss) * w).sum(axis=1) / wsum  # closed-form best P0 per cell
    p0_clipped = np.clip(p0, *P0_RANGE)
    resid = r[None, :] - (p0_clipped[:, None] - loss)
    cost = (w * resid**2).sum(axis=1) / wsum  # weighted mean squared error, dB^2

    # Effective number of independent samples, capped: neighbouring samples
    # are strongly correlated (multipath), so do not get over-confident.
    n_eff = min(wsum**2 / (w**2).sum(), 25.0)
    loglik = -0.5 * n_eff * cost / MEASUREMENT_SIGMA_DB**2
    loglik -= loglik.max()
    post = np.exp(loglik)
    post /= post.sum()

    mx = float((post * grid.flat_x).sum())
    my = float((post * grid.flat_y).sum())
    var = float((post * ((grid.flat_x - mx) ** 2 + (grid.flat_y - my) ** 2)).sum())
    best = int(np.argmax(post))
    return Fit(
        x=mx,
        y=my,
        sigma=float(np.sqrt(var / 2.0)),
        p0=float(p0_clipped[best]),
        rms_error=float(np.sqrt(cost[best])),
    )


def fit_coarse_to_fine(xs, ys, rssi, weights, bounds, n: float = DEFAULT_EXPONENT,
                       coarse_res: float = 0.8, fine_res: float = 0.2) -> Fit | None:
    """Search the whole area on a coarse grid, then refine around the answer."""
    coarse = fit_position(xs, ys, rssi, weights, Grid(*bounds, coarse_res), n)
    if coarse is None or coarse.sigma > 3.0:
        return coarse
    half = max(3.0 * coarse.sigma, 2.0)
    local = Grid(coarse.x - half, coarse.x + half, coarse.y - half, coarse.y + half, fine_res)
    return fit_position(xs, ys, rssi, weights, local, n)


def bin_samples(xs, ys, rssi, weights, cell: float = 0.3):
    """Average samples that were taken within the same small cell.

    Cuts computation a lot and stops a spot you lingered on from dominating.
    """
    xs = np.asarray(xs, float)
    ys = np.asarray(ys, float)
    r = np.asarray(rssi, float)
    w = np.asarray(weights, float)
    keys = np.floor(xs / cell).astype(np.int64) * 100003 + np.floor(ys / cell).astype(np.int64)
    uniq, inv = np.unique(keys, return_inverse=True)
    wsum = np.bincount(inv, w, len(uniq))
    bx = np.bincount(inv, w * xs, len(uniq)) / wsum
    by = np.bincount(inv, w * ys, len(uniq)) / wsum
    br = np.bincount(inv, w * r, len(uniq)) / wsum
    # A bin is worth more than one sample, but much less than all of them.
    bw = np.sqrt(wsum)
    return bx, by, br, bw


def spatial_spread(xs, ys) -> float:
    """How far apart the measurement spots are (metres, RMS)."""
    xs = np.asarray(xs, float)
    ys = np.asarray(ys, float)
    if len(xs) < 2:
        return 0.0
    return float(np.sqrt(xs.var() + ys.var()))
