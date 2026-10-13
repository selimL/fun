"""A virtual apartment that produces realistic-ish RSSI readings.

Use it to try the software without special hardware, and to check how well
the mapping works (press G in the app to overlay the ground truth).

The radio model: log-distance path loss + per-wall attenuation + attenuation
and multipath jitter caused by human bodies near the link + Gaussian noise.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from .models import Observation
from .pathloss import rssi_at

NOISE_DB = 2.0
SENSITIVITY_DBM = -92.0


@dataclass
class Wall:
    x1: float
    y1: float
    x2: float
    y2: float
    loss_db: float = 5.0


@dataclass
class SimDevice:
    mac: str
    name: str
    kind: str
    x: float
    y: float
    p0: float = -38.0
    is_ap: bool = False
    carrier: int | None = None  # index of the human carrying it


@dataclass
class SimHuman:
    x: float
    y: float
    tx: float = 0.0
    ty: float = 0.0
    speed: float = 0.0
    pause: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    path: list = field(default_factory=list)


def _segments_intersect(ax, ay, bx, by, cx, cy, dx, dy) -> bool:
    def orient(px, py, qx, qy, rx, ry):
        return (qx - px) * (ry - py) - (qy - py) * (rx - px)

    o1 = orient(ax, ay, bx, by, cx, cy)
    o2 = orient(ax, ay, bx, by, dx, dy)
    o3 = orient(cx, cy, dx, dy, ax, ay)
    o4 = orient(cx, cy, dx, dy, bx, by)
    return (o1 * o2 < 0) and (o3 * o4 < 0)


def _point_segment_distance(px, py, ax, ay, bx, by) -> float:
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    if L2 < 1e-9:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / L2))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


class SimWorld:
    """A 14 m x 10 m flat: living room, kitchen, bedroom, office, hallway."""

    width = 14.0
    height = 10.0

    def __init__(self, seed: int | None = None):
        self.rng = random.Random(seed)
        ext, inner, brick = 12.0, 4.5, 8.0
        W, H = self.width, self.height
        self.walls: list[Wall] = [
            Wall(0, 0, W, 0, ext), Wall(W, 0, W, H, ext), Wall(W, H, 0, H, ext), Wall(0, H, 0, 0, ext),
            # vertical wall x=6 with a door between y=4.5..5.5
            Wall(6, 0, 6, 4.5, brick), Wall(6, 5.5, 6, H, brick),
            # horizontal wall y=6 on the right side with doors
            Wall(6, 6, 8.5, 6, inner), Wall(9.5, 6, 14, 6, inner),
            # bedroom/office divider x=10 with a door
            Wall(10, 0, 10, 2.5, inner), Wall(10, 3.5, 10, 6, inner),
            # kitchen nook on the left, y=6.5
            Wall(0, 6.5, 3.0, 6.5, inner), Wall(4.2, 6.5, 6, 6.5, inner),
            # metal fridge (a small box that blocks a lot)
            Wall(0.3, 8.6, 1.1, 8.6, 10), Wall(1.1, 8.6, 1.1, 9.7, 10),
        ]
        self.devices: list[SimDevice] = [
            SimDevice("a4:2b:b0:11:22:01", "HomeNet-5G", "router", 5.4, 3.0, -32.0, is_ap=True),
            SimDevice("3c:9a:77:21:00:02", "Living-Room TV", "tv", 0.5, 2.5, -40.0),
            SimDevice("f0:18:98:aa:00:03", "Work Laptop", "laptop", 12.0, 1.5, -42.0),
            SimDevice("44:65:0d:00:10:04", "Printer", "iot", 7.0, 0.6, -45.0),
            SimDevice("b8:27:eb:00:00:05", "Smart Speaker", "iot", 2.5, 9.2, -44.0),
            SimDevice("c8:3a:35:00:00:06", "Thermostat", "iot", 13.6, 8.0, -48.0),
            SimDevice("10:fe:ed:00:00:07", "Neighbor-WiFi", "router", 19.0, 6.0, -30.0, is_ap=True),
            SimDevice("da:a1:19:42:00:08", "Phone (random MAC)", "phone", 0, 0, -41.0, carrier=0),
            SimDevice("7a:11:22:33:00:09", "Smartwatch", "phone", 0, 0, -50.0, carrier=1),
        ]
        self.humans: list[SimHuman] = [SimHuman(3.0, 4.0), SimHuman(11.5, 8.0), SimHuman(8.0, 3.0)]
        for h in self.humans:
            h.tx, h.ty = h.x, h.y
        self.player_start = (8.0, 7.5)
        self._sync_carried()

    # ---------------------------------------------------------------- geometry
    def wall_loss(self, ax, ay, bx, by) -> float:
        return sum(w.loss_db for w in self.walls if _segments_intersect(ax, ay, bx, by, w.x1, w.y1, w.x2, w.y2))

    def blocked(self, ax, ay, bx, by, margin: float = 0.2) -> bool:
        d = math.hypot(bx - ax, by - ay)
        if d < 1e-9:
            return False
        ex = bx + (bx - ax) / d * margin
        ey = by + (by - ay) / d * margin
        if any(_segments_intersect(ax, ay, ex, ey, w.x1, w.y1, w.x2, w.y2) for w in self.walls):
            return True
        return any(_point_segment_distance(bx, by, w.x1, w.y1, w.x2, w.y2) < margin for w in self.walls)

    # ---------------------------------------------------------------- dynamics
    def step(self, dt: float):
        for h in self.humans:
            if h.pause > 0:
                h.pause -= dt
                h.vx = h.vy = 0.0
                continue
            dx, dy = h.tx - h.x, h.ty - h.y
            dist = math.hypot(dx, dy)
            if dist < 0.15:
                self._new_target(h)
                continue
            step = min(dist, h.speed * dt)
            nx, ny = h.x + dx / dist * step, h.y + dy / dist * step
            if self.blocked(h.x, h.y, nx, ny, margin=0.15):
                self._new_target(h)
                continue
            h.vx, h.vy = (nx - h.x) / dt, (ny - h.y) / dt
            h.x, h.y = nx, ny
        self._sync_carried()

    def _new_target(self, h: SimHuman):
        h.vx = h.vy = 0.0
        if self.rng.random() < 0.35:
            h.pause = self.rng.uniform(1.0, 5.0)
        for _ in range(30):
            tx = self.rng.uniform(0.6, self.width - 0.6)
            ty = self.rng.uniform(0.6, self.height - 0.6)
            if not self.blocked(h.x, h.y, tx, ty, margin=0.25):
                h.tx, h.ty = tx, ty
                h.speed = self.rng.uniform(0.6, 1.3)
                return
        h.pause = 1.0

    def _sync_carried(self):
        for d in self.devices:
            if d.carrier is not None:
                h = self.humans[d.carrier]
                d.x, d.y = h.x + 0.2, h.y

    # ---------------------------------------------------------------- radio
    def measure(self, rx: float, ry: float, now: float) -> list[Observation]:
        out = []
        for d in self.devices:
            dist = math.hypot(d.x - rx, d.y - ry)
            rssi = float(rssi_at(dist, d.p0, 2.2)) - self.wall_loss(rx, ry, d.x, d.y)
            jitter = NOISE_DB
            for i, h in enumerate(self.humans):
                if d.carrier == i:
                    continue
                hd = _point_segment_distance(h.x, h.y, rx, ry, d.x, d.y)
                if hd < 0.6:
                    closeness = 1.0 - hd / 0.6
                    rssi -= 7.0 * closeness
                    if math.hypot(h.vx, h.vy) > 0.1:
                        jitter += 3.5 * closeness
            rssi += self.rng.gauss(0.0, jitter)
            if rssi < SENSITIVITY_DBM:
                continue
            out.append(Observation(mac=d.mac, rssi=round(rssi, 1), timestamp=now, name=d.name,
                                   kind=d.kind, channel=36 if d.is_ap else None, is_ap=d.is_ap))
        return out


class SimulatedScanner:
    name = "simulation"
    rate_hz = 6.0
    sees_clients = True

    def __init__(self, world: SimWorld):
        self.world = world

    def scan(self, x: float, y: float, now: float) -> list[Observation]:
        return self.world.measure(x, y, now)
