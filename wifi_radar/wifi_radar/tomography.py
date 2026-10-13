"""Radio tomographic imaging (RTI).

When something stands on the straight line between a transmitter and the
receiver, the signal gets weaker than the path-loss model predicts. We
"back-project" that excess loss onto every map cell inside a thin ellipse
around the link. Over many links (you keep moving, so the links sweep the
room) the cells that block signals light up.

Two images are kept:
  * obstacle image - long-term average excess loss  -> walls, furniture
  * motion image   - short-term RSSI fluctuation    -> moving people
"""

from __future__ import annotations

import numpy as np

from .localization import Grid

ELLIPSE_EXCESS = 0.35  # metres of extra path length that still counts as "on the link"


def link_weights(grid: Grid, ax: float, ay: float, bx: float, by: float,
                 receiver_clearance: float = 0.0) -> np.ndarray:
    """Weights of the cells inside the ellipse around link a (receiver) -> b."""
    d = max(np.hypot(bx - ax, by - ay), 0.5)
    d1 = np.hypot(grid.gx - ax, grid.gy - ay)
    d2 = np.hypot(grid.gx - bx, grid.gy - by)
    inside = (d1 + d2 < d + ELLIPSE_EXCESS) & (d1 >= receiver_clearance)
    return inside.astype(float) / np.sqrt(d)


class Tomography:
    def __init__(self, grid: Grid):
        self.grid = grid
        self.obs_num = np.zeros(grid.shape)
        self.obs_den = np.zeros(grid.shape)
        self._motion: dict[str, np.ndarray] = {}  # one image per link (device)

    def reset(self):
        self.obs_num[:] = 0
        self.obs_den[:] = 0
        self._motion.clear()

    def add_static(self, ax, ay, bx, by, excess_db: float):
        w = link_weights(self.grid, ax, ay, bx, by)
        self.obs_num += w * max(excess_db, 0.0)
        self.obs_den += w

    def add_motion(self, key: str, ax, ay, bx, by, strength: float):
        if strength <= 0:
            return
        # Your own body sits at the receiver end of every link; ignore that part.
        w = link_weights(self.grid, ax, ay, bx, by, receiver_clearance=0.9) * strength
        img = self._motion.get(key)
        if img is None:
            self._motion[key] = w
        else:
            np.maximum(img, w, out=img)

    def decay(self, dt: float, half_life: float = 3.0):
        f = 0.5 ** (dt / half_life)
        for img in self._motion.values():
            img *= f

    @property
    def motion(self) -> np.ndarray:
        if not self._motion:
            return np.zeros(self.grid.shape)
        return np.sum(list(self._motion.values()), axis=0)

    def motion_support(self, eps: float = 0.05) -> np.ndarray:
        """How many different links currently see motion through each cell."""
        if not self._motion:
            return np.zeros(self.grid.shape)
        return np.sum([img > eps for img in self._motion.values()], axis=0)

    def obstacle_image(self) -> np.ndarray:
        img = np.where(self.obs_den > 1.0, self.obs_num / np.maximum(self.obs_den, 1e-9), 0.0)
        return img

    def coverage(self) -> np.ndarray:
        return self.obs_den


def find_peaks(img: np.ndarray, threshold: float, min_sep_cells: int):
    """Return (i, j, value) of local maxima above threshold, strongest first."""
    peaks = []
    work = img.copy()
    while True:
        idx = int(np.argmax(work))
        i, j = divmod(idx, work.shape[1])
        v = work[i, j]
        if v < threshold:
            break
        peaks.append((i, j, float(v)))
        work[max(0, i - min_sep_cells): i + min_sep_cells + 1,
             max(0, j - min_sep_cells): j + min_sep_cells + 1] = 0
        if len(peaks) >= 8:
            break
    return peaks


def blur(img: np.ndarray, passes: int = 2) -> np.ndarray:
    out = img
    for _ in range(passes):
        p = np.pad(out, 1, mode="edge")
        out = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] + 2 * p[1:-1, 1:-1]) / 6.0
    return out
