"""Shared data structures."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Observation:
    """One received-signal measurement of one transmitter."""

    mac: str
    rssi: float  # dBm
    timestamp: float
    name: str = ""
    kind: str = "unknown"  # router | phone | laptop | tv | iot | unknown
    channel: Optional[int] = None
    is_ap: bool = False


@dataclass
class Sample:
    """An observation tagged with where the receiver (you) stood."""

    x: float
    y: float
    rssi: float
    t: float


@dataclass
class DeviceEstimate:
    mac: str
    name: str
    kind: str
    is_ap: bool
    x: Optional[float] = None
    y: Optional[float] = None
    sigma: float = float("inf")  # 1-sigma position uncertainty in metres
    tx_power: float = -40.0  # fitted RSSI at 1 m
    last_rssi: float = -100.0
    last_seen: float = 0.0
    n_samples: int = 0
    mobile: bool = False
    rssi_history: list = field(default_factory=list)

    @property
    def located(self) -> bool:
        return self.x is not None and self.sigma < 3.0

    @property
    def label(self) -> str:
        return self.name or self.mac


@dataclass
class Human:
    track_id: int
    x: float
    y: float
    confidence: float
    source: str  # "rf-motion" | "carried-device"
    last_seen: float
    hits: int = 1
    device_mac: Optional[str] = None

    @property
    def confirmed(self) -> bool:
        return self.source == "carried-device" or self.hits >= 4
