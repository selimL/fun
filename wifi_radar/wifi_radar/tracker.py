"""The world model: turns a stream of (your position, observations) into a map."""

from __future__ import annotations

import math
from collections import deque

import numpy as np

from .localization import Grid, bin_samples, fit_coarse_to_fine, spatial_spread
from .models import DeviceEstimate, Human, Observation, Sample
from .pathloss import DEFAULT_EXPONENT, rssi_at
from .tomography import Tomography, blur, find_peaks

MAX_SAMPLES = 400
SAMPLE_HALF_LIFE = 60.0  # seconds; older samples count less (devices can move)
REFIT_INTERVAL = 1.0
MOTION_WINDOW = 2.0
MOTION_THRESHOLD = 1.0
MOTION_NOISE_FACTOR = 1.4  # fluctuation must exceed the quiet level by this much
HUMAN_TIMEOUT = 6.0
MOBILE_DB = 7.0


class _DeviceState:
    def __init__(self, est: DeviceEstimate):
        self.est = est
        self.samples: deque[Sample] = deque(maxlen=MAX_SAMPLES)
        self.window: deque[tuple[float, float, float, float]] = deque()  # t, rssi, px, py
        self.quiet_stds: deque[float] = deque(maxlen=300)
        self.last_fit = -1e9
        self.mobility = 0.0  # median dB change at the same spot over time


class WorldModel:
    def __init__(self, bounds=(-3.0, 17.0, -3.0, 13.0), resolution: float = 0.25,
                 path_loss_exponent: float = DEFAULT_EXPONENT):
        self.bounds = bounds
        self.n = path_loss_exponent
        self.grid = Grid(*bounds, resolution)
        # Position fitting searches a larger area: transmitters can be outside the map.
        xmin, xmax, ymin, ymax = bounds
        self.fit_bounds = (xmin - 8, xmax + 8, ymin - 8, ymax + 8)
        self.tomo = Tomography(self.grid)
        self._devices: dict[str, _DeviceState] = {}
        self.humans: list[Human] = []
        self._next_track = 1
        self.trail: deque[tuple[float, float]] = deque(maxlen=4000)
        self._player_hist: deque[tuple[float, float, float]] = deque(maxlen=200)
        self._last_update = None

    # ------------------------------------------------------------------ API
    @property
    def devices(self) -> list[DeviceEstimate]:
        return [s.est for s in self._devices.values()]

    def reset(self):
        self.__init__(self.bounds, self.grid.res, self.n)

    def ingest(self, observations: list[Observation], px: float, py: float, now: float):
        if not self.trail or math.hypot(self.trail[-1][0] - px, self.trail[-1][1] - py) > 0.1:
            self.trail.append((px, py))
        for ob in observations:
            st = self._devices.get(ob.mac)
            if st is None:
                st = self._devices[ob.mac] = _DeviceState(
                    DeviceEstimate(mac=ob.mac, name=ob.name, kind=ob.kind, is_ap=ob.is_ap))
            est = st.est
            est.name = ob.name or est.name
            est.last_rssi = ob.rssi
            est.last_seen = now
            est.n_samples += 1
            est.rssi_history.append(ob.rssi)
            if len(est.rssi_history) > 120:
                del est.rssi_history[:-120]
            st.samples.append(Sample(px, py, ob.rssi, now))
            self._radio_imaging(st, ob.rssi, px, py, now)

    def update(self, px: float, py: float, now: float):
        dt = 0.0 if self._last_update is None else now - self._last_update
        self._last_update = now
        self._player_hist.append((now, px, py))
        self.tomo.decay(dt)
        # Refit at most a few devices per frame so the UI never stutters.
        due = [st for st in self._devices.values()
               if now - st.last_fit >= REFIT_INTERVAL and len(st.samples) >= 4]
        for st in sorted(due, key=lambda st: st.last_fit)[:3]:
            self._refit(st, now)
        self._update_humans(px, py, now)

    def player_speed(self, now: float, window: float = 1.0) -> float:
        pts = [(t, x, y) for t, x, y in self._player_hist if now - t <= window]
        if len(pts) < 2:
            return 0.0
        (t0, x0, y0), (t1, x1, y1) = pts[0], pts[-1]
        return math.hypot(x1 - x0, y1 - y0) / max(t1 - t0, 1e-3)

    def distance_estimate(self, est: DeviceEstimate) -> float:
        return float(10 ** ((est.tx_power - est.last_rssi) / (10 * self.n)))

    # ------------------------------------------------------------- internals
    def _refit(self, st: _DeviceState, now: float):
        st.last_fit = now
        s = list(st.samples)
        xs = np.array([a.x for a in s])
        ys = np.array([a.y for a in s])
        rs = np.array([a.rssi for a in s])
        ts = np.array([a.t for a in s])
        ages = now - ts
        est = st.est
        self._update_mobility(st, xs, ys, rs, ages)
        if est.mobile:
            # A moving transmitter: only the last few seconds say where it is now.
            keep = ages < 8.0
            xs, ys, rs, ages = xs[keep], ys[keep], rs[keep], ages[keep]
            ws = 0.5 ** (ages / 3.0)
        else:
            ws = np.maximum(0.5 ** (ages / SAMPLE_HALF_LIFE), 0.05)
        if len(rs) < 4:
            return
        bx, by, br, bw = bin_samples(xs, ys, rs, ws)
        fit = fit_coarse_to_fine(bx, by, br, bw, self.fit_bounds, self.n)
        if fit is None:
            return
        est.tx_power = fit.p0
        spread = spatial_spread(bx, by)
        # Samples taken from (almost) one spot only give a distance, not a direction.
        sigma = fit.sigma if spread > 0.7 else max(fit.sigma, 5.0)
        est.x, est.y, est.sigma = fit.x, fit.y, sigma

    def _update_mobility(self, st: _DeviceState, xs, ys, rs, ages):
        """Compare fresh readings with old readings taken at the same spot.

        For a device that stays put, standing where you stood before gives the
        same RSSI (give or take noise). If it differs a lot, the device moved.
        """
        recent = ages < 3.0
        old = ages > 8.0
        if recent.sum() < 2 or old.sum() < 5:
            return
        dx = xs[recent][:, None] - xs[old][None, :]
        dy = ys[recent][:, None] - ys[old][None, :]
        close = np.hypot(dx, dy) < 0.6
        if close.sum() < 20:
            return
        diff = np.abs(rs[recent][:, None] - rs[old][None, :])[close]
        st.mobility += 0.15 * (float(np.median(diff)) - st.mobility)
        if st.mobility > MOBILE_DB:
            st.est.mobile = True
        elif st.mobility < MOBILE_DB * 0.5:
            st.est.mobile = False

    def _radio_imaging(self, st: _DeviceState, rssi: float, px: float, py: float, now: float):
        est = st.est
        if est.x is None or est.sigma > 2.0 or est.mobile:
            return
        dist = math.hypot(est.x - px, est.y - py)
        predicted = float(rssi_at(dist, est.tx_power, self.n))
        resid = rssi - predicted

        # Long-term: links weaker than predicted pass through obstacles.
        if est.sigma < 1.5 and dist > 1.0:
            self.tomo.add_static(px, py, est.x, est.y, -resid)

        # Short-term: a person moving near a link makes its RSSI fluctuate.
        # Only meaningful while you stand still (your own steps change RSSI too).
        st.window.append((now, rssi, px, py))
        while st.window and now - st.window[0][0] > MOTION_WINDOW:
            st.window.popleft()
        if len(st.window) < 6:
            return
        if max(math.hypot(wx - px, wy - py) for _, _, wx, wy in st.window) > 0.25:
            return
        std = float(np.std([r for _, r, _, _ in st.window]))
        st.quiet_stds.append(std)
        baseline = float(np.percentile(st.quiet_stds, 30)) if len(st.quiet_stds) >= 20 else 2.0
        excess = std - (MOTION_NOISE_FACTOR * baseline + 0.4)
        self.tomo.add_motion(est.mac, px, py, est.x, est.y, excess)

    def motion_sensing_active(self, now: float) -> bool:
        return self.player_speed(now, window=MOTION_WINDOW) < 0.1

    def _update_humans(self, px: float, py: float, now: float):
        tracks: list[Human] = []

        # 1) Phones/watches that move around are almost always carried by someone.
        by_mac = {h.device_mac: h for h in self.humans if h.device_mac}
        for est in self.devices:
            if not (est.mobile and est.x is not None and est.sigma < 3.0 and now - est.last_seen < 5):
                continue
            h = by_mac.get(est.mac)
            if h is None:
                h = Human(self._next_track, est.x, est.y, 0.7, "carried-device", now, device_mac=est.mac)
                self._next_track += 1
            else:
                h.x += 0.3 * (est.x - h.x)
                h.y += 0.3 * (est.y - h.y)
                h.last_seen = now
                h.hits += 1
            tracks.append(h)

        # 2) Hot spots in the RF motion image.
        # A person is placed only where at least two links agree; one link alone
        # says "someone is somewhere on this line".
        img = blur(self.tomo.motion, 2) * (self.tomo.motion_support() >= 2)
        min_sep = int(round(1.2 / self.grid.res))
        motion_tracks = [h for h in self.humans if h.device_mac is None]
        for i, j, v in find_peaks(img, MOTION_THRESHOLD, min_sep):
            x, y = float(self.grid.xs[j]), float(self.grid.ys[i])
            if math.hypot(x - px, y - py) < 0.9:
                continue  # that's you
            if any(math.hypot(t.x - x, t.y - y) < 1.2 for t in tracks):
                continue  # already explained by a carried device
            conf = min(1.0, v / (3 * MOTION_THRESHOLD))
            best = min(motion_tracks, key=lambda h: math.hypot(h.x - x, h.y - y), default=None)
            if best is not None and math.hypot(best.x - x, best.y - y) < 1.6:
                best.x += 0.25 * (x - best.x)
                best.y += 0.25 * (y - best.y)
                best.confidence = max(conf, best.confidence * 0.95)
                best.last_seen = now
                best.hits += 1
            else:
                motion_tracks.append(Human(self._next_track, x, y, conf, "rf-motion", now))
                self._next_track += 1

        alive = [h for h in motion_tracks if now - h.last_seen < HUMAN_TIMEOUT]
        for h in sorted(alive, key=lambda h: -h.hits):
            if all(math.hypot(h.x - t.x, h.y - t.y) > 1.0 for t in tracks):
                tracks.append(h)
        self.humans = tracks

    @property
    def confirmed_humans(self) -> list[Human]:
        return [h for h in self.humans if h.confirmed]

    # ------------------------------------------------------------ export
    def to_dict(self) -> dict:
        return {
            "devices": [
                {"mac": d.mac, "name": d.name, "kind": d.kind, "access_point": d.is_ap,
                 "x": d.x, "y": d.y, "uncertainty_m": None if math.isinf(d.sigma) else d.sigma,
                 "tx_power_1m_dbm": d.tx_power, "last_rssi_dbm": d.last_rssi, "mobile": d.mobile}
                for d in self.devices
            ],
            "humans": [{"id": h.track_id, "x": h.x, "y": h.y, "confidence": h.confidence,
                        "source": h.source} for h in self.confirmed_humans],
            "path": list(self.trail),
        }
