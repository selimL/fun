"""Log-distance path-loss model.

    RSSI(d) = P0 - 10 * n * log10(d / 1 m)

P0 is the received power at 1 m (depends on the transmitter), n is the
path-loss exponent (about 2 in free space, 2.5-3.5 indoors).
"""

from __future__ import annotations

import numpy as np

DEFAULT_EXPONENT = 2.4
DEFAULT_P0 = -40.0
MIN_DISTANCE = 0.3


def rssi_at(distance, p0: float = DEFAULT_P0, n: float = DEFAULT_EXPONENT):
    d = np.maximum(np.asarray(distance, dtype=float), MIN_DISTANCE)
    return p0 - 10.0 * n * np.log10(d)


def distance_for(rssi, p0: float = DEFAULT_P0, n: float = DEFAULT_EXPONENT):
    return np.power(10.0, (p0 - np.asarray(rssi, dtype=float)) / (10.0 * n))


def percent_to_dbm(percent: float) -> float:
    """Convert the 0-100 'signal quality' that OS tools print into dBm."""
    return float(percent) / 2.0 - 100.0
