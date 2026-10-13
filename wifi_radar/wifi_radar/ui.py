"""Pygame front-end: a live map you can walk around in.

Two views (Tab switches):
  * Map      - top-down radar map with devices, people, obstacles and motion.
  * Explore  - first-person view of the same map, walk through the room.
"""

from __future__ import annotations

import json
import math
import os
import random
import time

import numpy as np
import pygame

from .models import DeviceEstimate, Human
from .tracker import WorldModel

W, H = 1280, 800
PANEL_W = 330
MAP_W = W - PANEL_W

BG = (12, 16, 24)
GRID = (28, 36, 50)
TEXT = (220, 228, 240)
DIM = (130, 140, 160)
ACCENT = (80, 200, 255)
PLAYER = (255, 214, 90)
HUMAN = (255, 92, 120)
KIND_COLORS = {
    "router": (80, 200, 255),
    "phone": (170, 120, 255),
    "laptop": (90, 230, 160),
    "tv": (255, 170, 70),
    "iot": (120, 220, 230),
    "unknown": (190, 190, 190),
}
KIND_LABEL = {"router": "Access point", "phone": "Phone / wearable", "laptop": "Computer",
              "tv": "TV / media", "iot": "Smart device", "unknown": "Unknown"}

WALK_SPEED = 1.4  # m/s
TURN_SPEED = 2.2  # rad/s
FOV = math.radians(70)

HELP = [
    "WASD / arrows  move",
    "Q / E          turn (strafe in Explore)",
    "Shift          walk faster",
    "Tab            Map <-> Explore view",
    "Mouse wheel    zoom   right-drag: pan",
    "Click          select a device",
    "1 obstacles  2 motion  3 labels",
    "T path   F follow   G ground truth (sim)",
    "Space pause scan   R reset map",
    "Ctrl+S save map to JSON   H help",
    "Esc            quit",
]


class Player:
    def __init__(self, x: float, y: float):
        self.x, self.y = x, y
        self.heading = -math.pi / 2  # facing "up" on the map


class App:
    def __init__(self, scanner, world_model: WorldModel, sim_world=None, autopilot: bool = False,
                 start=(7.0, 5.0), title: str = "WiFi Radar"):
        pygame.init()
        pygame.display.set_caption(title)
        self.screen = pygame.display.set_mode((W, H))
        self.clock = pygame.time.Clock()
        self.font = pygame.font.Font(None, 20)
        self.font_small = pygame.font.Font(None, 17)
        self.font_big = pygame.font.Font(None, 30)

        self.scanner = scanner
        self.model = world_model
        self.sim = sim_world
        self.player = Player(*(sim_world.player_start if sim_world else start))
        self.threaded = hasattr(scanner, "poll")
        self.autopilot = autopilot
        self._ap_target = None
        self._ap_pause = 0.0

        self.view = "map"
        self.scale = 48.0  # pixels per metre
        self.center = [self.player.x, self.player.y]
        self.follow = True
        self.show = {"obstacles": True, "motion": True, "labels": True, "trail": True,
                     "truth": False, "help": False}
        self.paused = False
        self.selected: str | None = None
        self.message = ("Walk around! Every step measures the devices from a new spot.", time.monotonic() + 8)
        self._next_scan = 0.0
        self._obstacle_surf = None
        self._obstacle_time = -1.0
        self._motion_surf = None
        self._motion_time = -1.0
        self._scaled = {}
        self._drag = None
        self.t0 = time.monotonic()

    # ================================================================ loop
    def run(self, max_frames: int | None = None, screenshot: str | None = None, sim_dt: float | None = None):
        frames = 0
        now = 0.0
        running = True
        while running:
            dt = sim_dt if sim_dt else min(self.clock.tick(60) / 1000.0, 0.1)
            now += dt
            running = self._handle_events()
            self._move(dt)
            if self.sim:
                self.sim.step(dt)
            self._scan(now)
            self.model.update(self.player.x, self.player.y, now)
            self._draw(now)
            pygame.display.flip()
            frames += 1
            if max_frames and frames >= max_frames:
                break
        if screenshot:
            pygame.image.save(self.screen, screenshot)
        if hasattr(self.scanner, "close"):
            self.scanner.close()
        pygame.quit()

    # ============================================================== input
    def _handle_events(self) -> bool:
        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                return False
            if ev.type == pygame.KEYDOWN:
                mods = pygame.key.get_mods()
                if ev.key == pygame.K_ESCAPE:
                    return False
                if ev.key == pygame.K_TAB:
                    self.view = "explore" if self.view == "map" else "map"
                elif ev.key == pygame.K_s and mods & pygame.KMOD_CTRL:
                    self._save()
                elif ev.key == pygame.K_1:
                    self._toggle("obstacles")
                elif ev.key == pygame.K_2:
                    self._toggle("motion")
                elif ev.key == pygame.K_3:
                    self._toggle("labels")
                elif ev.key == pygame.K_t:
                    self._toggle("trail")
                elif ev.key == pygame.K_g:
                    if self.sim:
                        self._toggle("truth")
                    else:
                        self._say("Ground truth is only known in simulation mode.")
                elif ev.key == pygame.K_h:
                    self._toggle("help")
                elif ev.key == pygame.K_f:
                    self.follow = not self.follow
                elif ev.key == pygame.K_r:
                    self.model.reset()
                    self.selected = None
                    self._say("Map reset.")
                elif ev.key == pygame.K_SPACE:
                    self.paused = not self.paused
                    if self.threaded:
                        self.scanner.paused = self.paused
                    self._say("Scanning paused." if self.paused else "Scanning resumed.")
                elif ev.key in (pygame.K_PLUS, pygame.K_EQUALS, pygame.K_KP_PLUS):
                    self.scale = min(200, self.scale * 1.2)
                elif ev.key in (pygame.K_MINUS, pygame.K_KP_MINUS):
                    self.scale = max(10, self.scale / 1.2)
                elif ev.key == pygame.K_p:
                    self.autopilot = not self.autopilot
                    self._say("Autopilot " + ("on" if self.autopilot else "off"))
            elif ev.type == pygame.MOUSEWHEEL and self.view == "map":
                self.scale = float(np.clip(self.scale * (1.15 ** ev.y), 10, 200))
            elif ev.type == pygame.MOUSEBUTTONDOWN:
                if ev.button == 1:
                    self._click(ev.pos)
                elif ev.button == 3:
                    self._drag = (ev.pos, list(self.center))
                    self.follow = False
            elif ev.type == pygame.MOUSEBUTTONUP and ev.button == 3:
                self._drag = None
            elif ev.type == pygame.MOUSEMOTION and self._drag:
                (sx, sy), c = self._drag
                self.center = [c[0] - (ev.pos[0] - sx) / self.scale, c[1] - (ev.pos[1] - sy) / self.scale]
        return True

    def _toggle(self, key):
        self.show[key] = not self.show[key]

    def _say(self, text, secs=4.0):
        self.message = (text, time.monotonic() + secs)

    def _move(self, dt: float):
        keys = pygame.key.get_pressed()
        p = self.player
        speed = WALK_SPEED * (2.0 if keys[pygame.K_LSHIFT] or keys[pygame.K_RSHIFT] else 1.0)
        dx = dy = 0.0
        if self.view == "map":
            if keys[pygame.K_w] or keys[pygame.K_UP]:
                dy -= 1
            if keys[pygame.K_s] or keys[pygame.K_DOWN]:
                dy += 1
            if keys[pygame.K_a] or keys[pygame.K_LEFT]:
                dx -= 1
            if keys[pygame.K_d] or keys[pygame.K_RIGHT]:
                dx += 1
            if keys[pygame.K_q]:
                p.heading -= TURN_SPEED * dt
            if keys[pygame.K_e]:
                p.heading += TURN_SPEED * dt
            if dx or dy:
                p.heading = math.atan2(dy, dx)
        else:
            fwd = (keys[pygame.K_w] or keys[pygame.K_UP]) - (keys[pygame.K_s] or keys[pygame.K_DOWN])
            turn = (keys[pygame.K_d] or keys[pygame.K_RIGHT]) - (keys[pygame.K_a] or keys[pygame.K_LEFT])
            strafe = keys[pygame.K_e] - keys[pygame.K_q]
            p.heading += turn * TURN_SPEED * dt
            ch, sh = math.cos(p.heading), math.sin(p.heading)
            dx = fwd * ch - strafe * sh
            dy = fwd * sh + strafe * ch
        manual = bool(dx or dy)
        if not manual and self.autopilot and self.sim:
            dx, dy, speed = self._autopilot(dt)
        n = math.hypot(dx, dy)
        if n == 0:
            return
        step = speed * dt / n
        nx, ny = p.x + dx * step, p.y + dy * step
        if self.sim:
            # You can't walk through walls in the real world either.
            if self.sim.blocked(p.x, p.y, nx, ny):
                if not self.sim.blocked(p.x, p.y, nx, p.y):
                    ny = p.y
                elif not self.sim.blocked(p.x, p.y, p.x, ny):
                    nx = p.x
                else:
                    self._ap_target = None
                    return
        xmin, xmax, ymin, ymax = self.model.bounds
        p.x = float(np.clip(nx, xmin, xmax))
        p.y = float(np.clip(ny, ymin, ymax))
        if self.autopilot and not manual:
            p.heading = math.atan2(dy, dx)

    def _autopilot(self, dt):
        p = self.player
        if self._ap_pause > 0:
            self._ap_pause -= dt
            return 0.0, 0.0, 0.0
        if self._ap_target is None:
            for _ in range(40):
                tx = random.uniform(0.7, self.sim.width - 0.7)
                ty = random.uniform(0.7, self.sim.height - 0.7)
                if not self.sim.blocked(p.x, p.y, tx, ty, margin=0.3):
                    self._ap_target = (tx, ty)
                    break
            else:
                return 0.0, 0.0, 0.0
        tx, ty = self._ap_target
        if math.hypot(tx - p.x, ty - p.y) < 0.1:
            self._ap_target = None
            self._ap_pause = random.uniform(2.5, 5.0)  # stand still: motion sensing works then
            return 0.0, 0.0, 0.0
        return tx - p.x, ty - p.y, WALK_SPEED

    def _click(self, pos):
        if pos[0] >= MAP_W:
            for rect, mac in getattr(self, "_list_rects", []):
                if rect.collidepoint(pos):
                    self.selected = None if self.selected == mac else mac
            return
        if self.view != "map":
            return
        best, best_d = None, 18
        for d in self.model.devices:
            if d.x is None:
                continue
            sx, sy = self.w2s(d.x, d.y)
            dist = math.hypot(sx - pos[0], sy - pos[1])
            if dist < best_d:
                best, best_d = d.mac, dist
        self.selected = best

    def _save(self):
        path = os.path.abspath(time.strftime("wifi_map_%Y%m%d_%H%M%S.json"))
        with open(path, "w") as f:
            json.dump(self.model.to_dict(), f, indent=2)
        self._say(f"Saved {path}", 6)

    # ============================================================ scanning
    def _scan(self, now: float):
        if self.threaded:
            for x, y, obs in self.scanner.poll():
                self.model.ingest(obs, x, y, now)
            return
        if self.paused or now < self._next_scan:
            return
        self._next_scan = now + 1.0 / self.scanner.rate_hz
        obs = self.scanner.scan(self.player.x, self.player.y, now)
        self.model.ingest(obs, self.player.x, self.player.y, now)

    # ============================================================ drawing
    def w2s(self, x, y):
        if self.follow:
            self.center = [self.player.x, self.player.y]
        cx, cy = self.center
        return (MAP_W / 2 + (x - cx) * self.scale, H / 2 + (y - cy) * self.scale)

    def _draw(self, now: float):
        self.screen.fill(BG)
        if self.view == "map":
            self._draw_map(now)
        else:
            self._draw_explore(now)
        self._draw_panel(now)
        text, until = self.message
        if text and time.monotonic() < until:
            surf = self.font.render(text, True, TEXT)
            r = surf.get_rect(midbottom=(MAP_W // 2, H - 14))
            pygame.draw.rect(self.screen, (0, 0, 0), r.inflate(16, 10), border_radius=6)
            self.screen.blit(surf, r)

    # ---------------------------------------------------------------- map
    def _draw_map(self, now: float):
        scr = self.screen
        clip = pygame.Rect(0, 0, MAP_W, H)
        scr.set_clip(clip)
        xmin, xmax, ymin, ymax = self.model.bounds
        # metre grid
        for gx in range(math.ceil(xmin), math.floor(xmax) + 1):
            a, b = self.w2s(gx, ymin), self.w2s(gx, ymax)
            pygame.draw.line(scr, GRID, a, b, 1)
        for gy in range(math.ceil(ymin), math.floor(ymax) + 1):
            a, b = self.w2s(xmin, gy), self.w2s(xmax, gy)
            pygame.draw.line(scr, GRID, a, b, 1)

        if self.show["obstacles"]:
            self._blit_grid("obstacles", self._obstacle_surface(now))
        if self.show["motion"]:
            self._blit_grid("motion", self._motion_surface(now))
        if self.show["truth"] and self.sim:
            self._draw_truth()
        if self.show["trail"] and len(self.model.trail) > 1:
            pts = [self.w2s(x, y) for x, y in self.model.trail]
            pygame.draw.lines(scr, (70, 90, 120), False, pts, 2)

        sel = self.selected
        for d in sorted(self.model.devices, key=lambda d: d.mac == sel):
            self._draw_device(d, now, d.mac == sel)
        for h in self.model.confirmed_humans:
            self._draw_human(h, now)
        self._draw_player()
        self._draw_scale_bar()
        scr.set_clip(None)

    def _blit_grid(self, key, surf):
        if surf is None:
            return
        g = self.model.grid
        x0, y0 = self.w2s(g.xmin, g.ymin)
        x1, y1 = self.w2s(g.xmin + g.res * g.shape[1], g.ymin + g.res * g.shape[0])
        w, h = int(x1 - x0), int(y1 - y0)
        if w <= 0 or h <= 0 or w > 8000 or h > 8000:
            return
        cached = self._scaled.get(key)
        if cached is None or cached[0] is not surf or cached[1] != (w, h):
            cached = (surf, (w, h), pygame.transform.smoothscale(surf, (w, h)))
            self._scaled[key] = cached
        self.screen.blit(cached[2], (x0, y0))

    @staticmethod
    def _rgba_surface(rgba: np.ndarray):
        # rgba: (ny, nx, 4) -> pygame surface of size (nx, ny)
        arr = np.ascontiguousarray(rgba.astype(np.uint8))
        return pygame.image.frombuffer(arr.tobytes(), (arr.shape[1], arr.shape[0]), "RGBA").convert_alpha()

    def _obstacle_surface(self, now):
        if self._obstacle_surf is not None and now - self._obstacle_time < 0.5:
            return self._obstacle_surf
        self._obstacle_time = now
        cov = self.model.tomo.coverage()
        explored = np.clip(cov / 4.0, 0, 1)
        v = self._obst_v = self._obstacle_strength()
        rgba = np.zeros(v.shape + (4,))
        # explored area: faint blue floor; obstacles: warm amber
        rgba[..., 0] = 30 + 200 * v
        rgba[..., 1] = 50 + 120 * v
        rgba[..., 2] = 80 - 40 * v
        rgba[..., 3] = 255 * np.clip(0.18 * explored + 0.75 * v * explored, 0, 0.9)
        self._obstacle_surf = self._rgba_surface(rgba)
        return self._obstacle_surf

    def _obstacle_strength(self) -> np.ndarray:
        """0..1 'how much does this cell block signals', relative to the rest of the map."""
        img = self.model.tomo.obstacle_image()
        covered = img[self.model.tomo.coverage() > 4.0]
        if covered.size < 50:
            return np.zeros_like(img)
        lo, hi = np.percentile(covered, [50, 98])
        return np.clip((img - lo) / max(hi - lo, 1.0), 0, 1)

    def _motion_surface(self, now):
        if now - self._motion_time < 0.1:
            return self._motion_surf
        self._motion_time = now
        m = self.model.tomo.motion
        if not m.any():
            self._motion_surf = None
            return None
        v = np.clip(m / 4.0, 0, 1)
        rgba = np.zeros(m.shape + (4,))
        rgba[..., 0] = 255
        rgba[..., 1] = 60 + 80 * v
        rgba[..., 2] = 90
        rgba[..., 3] = 200 * v
        self._motion_surf = self._rgba_surface(rgba)
        return self._motion_surf

    def _draw_truth(self):
        for wall in self.sim.walls:
            pygame.draw.line(self.screen, (230, 230, 230), self.w2s(wall.x1, wall.y1),
                             self.w2s(wall.x2, wall.y2), 3)
        for d in self.sim.devices:
            sx, sy = self.w2s(d.x, d.y)
            pygame.draw.line(self.screen, (255, 255, 255), (sx - 5, sy - 5), (sx + 5, sy + 5), 1)
            pygame.draw.line(self.screen, (255, 255, 255), (sx - 5, sy + 5), (sx + 5, sy - 5), 1)
        for h in self.sim.humans:
            pygame.draw.circle(self.screen, (255, 255, 255), self.w2s(h.x, h.y), 7, 1)

    def _draw_device(self, d: DeviceEstimate, now: float, selected: bool):
        col = KIND_COLORS.get(d.kind, KIND_COLORS["unknown"])
        stale = now - d.last_seen > 15
        if not d.located:
            # Not triangulated yet: we only know roughly how far away it is.
            if selected:
                dist = self.model.distance_estimate(d)
                if dist < 40:
                    pygame.draw.circle(self.screen, col, self.w2s(self.player.x, self.player.y),
                                       max(3, int(dist * self.scale)), 1)
            return
        sx, sy = self.w2s(d.x, d.y)
        r = max(6, int(d.sigma * self.scale))
        ring = pygame.Surface((2 * r + 2, 2 * r + 2), pygame.SRCALPHA)
        pygame.draw.circle(ring, col + (35 if not selected else 70,), (r + 1, r + 1), r)
        pygame.draw.circle(ring, col + (110,), (r + 1, r + 1), r, 1)
        self.screen.blit(ring, (sx - r - 1, sy - r - 1))
        draw_icon(self.screen, d.kind, (sx, sy), col if not stale else DIM, 1.0 + 0.3 * selected)
        if selected:
            pygame.draw.circle(self.screen, (255, 255, 255), (sx, sy), 17, 2)
        if self.show["labels"] or selected:
            label = d.label + ("  (moving)" if d.mobile else "")
            t = self.font_small.render(label, True, TEXT if not stale else DIM)
            self.screen.blit(t, (sx + 14, sy - 16))
            t2 = self.font_small.render(f"{d.last_rssi:.0f} dBm", True, DIM)
            self.screen.blit(t2, (sx + 14, sy - 2))

    def _draw_human(self, h: Human, now: float):
        sx, sy = self.w2s(h.x, h.y)
        pulse = 0.5 + 0.5 * math.sin(now * 4 + h.track_id)
        r = int(14 + 6 * pulse)
        s = pygame.Surface((2 * r + 2, 2 * r + 2), pygame.SRCALPHA)
        pygame.draw.circle(s, HUMAN + (int(60 + 60 * h.confidence),), (r + 1, r + 1), r, 2)
        self.screen.blit(s, (sx - r - 1, sy - r - 1))
        draw_person(self.screen, (sx, sy), HUMAN, 1.0)
        if self.show["labels"]:
            how = "carrying a device" if h.source == "carried-device" else "RF motion"
            t = self.font_small.render(f"Person #{h.track_id} ({how})", True, HUMAN)
            self.screen.blit(t, (sx + 14, sy + 6))

    def _draw_player(self):
        p = self.player
        sx, sy = self.w2s(p.x, p.y)
        ch, sh = math.cos(p.heading), math.sin(p.heading)
        # field-of-view wedge
        wedge = [(61, 61)]
        for a in np.linspace(-FOV / 2, FOV / 2, 9):
            wedge.append((61 + math.cos(p.heading + a) * 60, 61 + math.sin(p.heading + a) * 60))
        s = pygame.Surface((122, 122), pygame.SRCALPHA)
        pygame.draw.polygon(s, PLAYER + (30,), wedge)
        self.screen.blit(s, (sx - 61, sy - 61))
        tip = (sx + ch * 14, sy + sh * 14)
        left = (sx - ch * 8 - sh * 8, sy - sh * 8 + ch * 8)
        right = (sx - ch * 8 + sh * 8, sy - sh * 8 - ch * 8)
        pygame.draw.polygon(self.screen, PLAYER, [tip, left, (sx - ch * 3, sy - sh * 3), right])
        t = self.font_small.render("YOU", True, PLAYER)
        self.screen.blit(t, (sx - t.get_width() / 2, sy + 12))

    def _draw_scale_bar(self):
        x, y = 20, H - 50
        pygame.draw.line(self.screen, TEXT, (x, y), (x + self.scale, y), 2)
        pygame.draw.line(self.screen, TEXT, (x, y - 4), (x, y + 4), 2)
        pygame.draw.line(self.screen, TEXT, (x + self.scale, y - 4), (x + self.scale, y + 4), 2)
        self.screen.blit(self.font_small.render("1 m", True, TEXT), (x, y + 6))

    # ------------------------------------------------------------ explore
    def _draw_explore(self, now: float):
        scr = self.screen
        p = self.player
        horizon = H // 2
        # sky / floor gradient
        for i in range(0, horizon, 4):
            c = int(14 + 18 * i / horizon)
            pygame.draw.rect(scr, (c // 2, c // 2 + 2, c + 6), (0, i, MAP_W, 4))
        self._draw_floor(now, horizon)

        n_cols = MAP_W // 4
        angles = p.heading + np.linspace(-FOV / 2, FOV / 2, n_cols)
        depth = np.full(n_cols, 1e9)

        # RF obstacle "walls" from the tomographic image
        if self.show["obstacles"]:
            self._obstacle_surface(now)  # refreshes self._obst_v
            d_obs, strength = self._raycast_grid(angles)
            for c in range(n_cols):
                if d_obs[c] < 20:
                    corr = d_obs[c] * math.cos(angles[c] - p.heading)
                    hgt = min(H, int(H * 0.9 / max(corr, 0.1)))
                    a = float(np.clip(strength[c], 0.25, 1.0))
                    shade = max(0.25, 1.0 - corr / 12)
                    col = (int(210 * a * shade), int(150 * a * shade), int(70 * a * shade))
                    pygame.draw.rect(scr, col, (c * 4, horizon - hgt // 2, 4, hgt))
                    depth[c] = corr
        if self.show["truth"] and self.sim:
            d_true = self._raycast_walls(angles)
            for c in range(n_cols):
                corr = d_true[c] * math.cos(angles[c] - p.heading)
                if corr < depth[c] and d_true[c] < 40:
                    hgt = min(H, int(H * 0.9 / max(corr, 0.1)))
                    shade = max(0.2, 1.0 - corr / 14)
                    pygame.draw.rect(scr, (int(200 * shade),) * 3, (c * 4, horizon - hgt // 2, 4, hgt))
                    depth[c] = corr

        # billboards: devices and people
        items = []
        for d in self.model.devices:
            if d.located:
                items.append((d.x, d.y, "device", d))
        for h in self.model.confirmed_humans:
            items.append((h.x, h.y, "human", h))
        items.sort(key=lambda it: -math.hypot(it[0] - p.x, it[1] - p.y))
        for x, y, typ, obj in items:
            dx, dy = x - p.x, y - p.y
            dist = math.hypot(dx, dy)
            rel = (math.atan2(dy, dx) - p.heading + math.pi) % (2 * math.pi) - math.pi
            if abs(rel) > FOV / 2 + 0.2 or dist < 0.2:
                continue
            corr = dist * math.cos(rel)
            col_idx = int((rel + FOV / 2) / FOV * (n_cols - 1))
            if 0 <= col_idx < n_cols and depth[col_idx] < corr:
                continue  # hidden behind an obstacle
            sx = MAP_W / 2 + math.tan(rel) / math.tan(FOV / 2) * MAP_W / 2
            size = float(np.clip(2.6 / max(corr, 0.3), 0.35, 4.0))
            if typ == "device":
                cy = horizon + int(H * 0.15 / max(corr, 0.3))
                col = KIND_COLORS.get(obj.kind, KIND_COLORS["unknown"])
                draw_icon(scr, obj.kind, (sx, cy), col, size)
                lbl = f"{obj.label}  {obj.last_rssi:.0f} dBm  ~{dist:.1f} m"
                t = self.font.render(lbl, True, TEXT)
                scr.blit(t, (sx - t.get_width() / 2, cy - 22 * size - 18))
            else:
                cy = horizon + int(H * 0.05 / max(corr, 0.3))
                draw_person(scr, (sx, cy), HUMAN, size * 1.6)
                t = self.font.render(f"Person #{obj.track_id}  ~{dist:.1f} m", True, HUMAN)
                scr.blit(t, (sx - t.get_width() / 2, cy - 40 * size - 10))

        # crosshair + compass + minimap
        pygame.draw.line(scr, (200, 200, 200), (MAP_W / 2 - 8, horizon), (MAP_W / 2 + 8, horizon), 1)
        pygame.draw.line(scr, (200, 200, 200), (MAP_W / 2, horizon - 8), (MAP_W / 2, horizon + 8), 1)
        deg = (math.degrees(p.heading) + 90) % 360
        t = self.font.render(f"Heading {deg:03.0f}°   ({p.x:.1f}, {p.y:.1f}) m", True, TEXT)
        scr.blit(t, (16, 14))
        self._draw_minimap(now)

    def _draw_floor(self, now: float, horizon: int):
        """Project the radio map onto the floor, so you walk on top of it."""
        p = self.player
        fw, fh = MAP_W // 4, (H - horizon) // 4
        ys = horizon + (np.arange(fh) + 0.5) * 4
        corr = 0.45 * H / np.maximum(ys - horizon, 1)  # forward distance of each floor row
        rel = np.linspace(-FOV / 2, FOV / 2, fw)
        dist = corr[None, :] / np.cos(rel)[:, None]  # (fw, fh)
        ang = p.heading + rel[:, None]
        wx = p.x + np.cos(ang) * dist
        wy = p.y + np.sin(ang) * dist

        g = self.model.grid
        j = ((wx - g.xmin) / g.res).astype(int)
        i = ((wy - g.ymin) / g.res).astype(int)
        valid = (i >= 0) & (i < g.shape[0]) & (j >= 0) & (j < g.shape[1])
        ic, jc = np.clip(i, 0, g.shape[0] - 1), np.clip(j, 0, g.shape[1] - 1)

        self._obstacle_surface(now)
        explored = np.clip(self.model.tomo.coverage() / 4.0, 0, 1)[ic, jc] * valid
        obst = self._obst_v[ic, jc] * valid
        motion = np.clip(self.model.tomo.motion / 4.0, 0, 1)[ic, jc] * valid if self.show["motion"] else 0

        rgb = np.zeros((fw, fh, 3))
        rgb[..., 0] = 16 + 14 * explored
        rgb[..., 1] = 20 + 40 * explored
        rgb[..., 2] = 32 + 50 * explored
        if self.show["obstacles"]:
            rgb += obst[..., None] * (np.array([200, 130, 40]) - rgb) * 0.8
        rgb += np.asarray(motion)[..., None] * (np.array([255, 70, 90]) - rgb)
        # 1 m grid lines
        lw = 0.012 + 0.006 * dist
        line = (np.abs(wx - np.round(wx)) < lw) | (np.abs(wy - np.round(wy)) < lw)
        rgb[line] = rgb[line] * 0.6 + np.array([70, 90, 130]) * 0.4
        # fade into the distance
        fade = np.clip(1.2 - dist / 14.0, 0.15, 1.0)[..., None]
        rgb = rgb * fade + np.array([14, 18, 30]) * (1 - fade)
        surf = pygame.surfarray.make_surface(rgb.astype(np.uint8))
        self.screen.blit(pygame.transform.smoothscale(surf, (MAP_W, H - horizon)), (0, horizon))

    def _raycast_grid(self, angles):
        g = self.model.grid
        img = self._obst_v
        steps = np.arange(0.3, 20, 0.06)
        xs = self.player.x + np.cos(angles)[:, None] * steps[None, :]
        ys = self.player.y + np.sin(angles)[:, None] * steps[None, :]
        j = ((xs - g.xmin) / g.res).astype(int)
        i = ((ys - g.ymin) / g.res).astype(int)
        valid = (i >= 0) & (i < g.shape[0]) & (j >= 0) & (j < g.shape[1])
        vals = np.zeros(xs.shape)
        vals[valid] = img[i[valid], j[valid]]
        hit = vals > 0.55
        any_hit = hit.any(axis=1)
        first = np.argmax(hit, axis=1)
        dist = np.where(any_hit, steps[first], 1e9)
        strength = np.where(any_hit, vals[np.arange(len(angles)), first], 0)
        return dist, strength

    def _raycast_walls(self, angles):
        p = self.player
        walls = np.array([[w.x1, w.y1, w.x2, w.y2] for w in self.sim.walls])
        dx, dy = np.cos(angles)[:, None], np.sin(angles)[:, None]
        ex, ey = (walls[:, 2] - walls[:, 0])[None, :], (walls[:, 3] - walls[:, 1])[None, :]
        wx, wy = (walls[:, 0] - p.x)[None, :], (walls[:, 1] - p.y)[None, :]
        denom = dx * ey - dy * ex
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (wx * ey - wy * ex) / denom
            u = (wx * dy - wy * dx) / denom
        ok = (np.abs(denom) > 1e-9) & (t > 0) & (u >= 0) & (u <= 1)
        t = np.where(ok, t, 1e9)
        return t.min(axis=1)

    def _draw_minimap(self, now):
        size, m = 200, 10
        rect = pygame.Rect(MAP_W - size - m, m, size, size)
        s = pygame.Surface((size, size), pygame.SRCALPHA)
        s.fill((0, 0, 0, 150))
        self.screen.blit(s, rect)
        sc = size / 16.0
        p = self.player

        def mm(x, y):
            return (rect.centerx + (x - p.x) * sc, rect.centery + (y - p.y) * sc)

        self.screen.set_clip(rect)
        if self.show["truth"] and self.sim:
            for w in self.sim.walls:
                pygame.draw.line(self.screen, (200, 200, 200), mm(w.x1, w.y1), mm(w.x2, w.y2), 1)
        for d in self.model.devices:
            if d.located:
                pygame.draw.circle(self.screen, KIND_COLORS.get(d.kind, DIM), mm(d.x, d.y), 3)
        for h in self.model.confirmed_humans:
            pygame.draw.circle(self.screen, HUMAN, mm(h.x, h.y), 4)
        ch, sh = math.cos(p.heading), math.sin(p.heading)
        c = (rect.centerx, rect.centery)
        pygame.draw.line(self.screen, PLAYER, c, (c[0] + ch * 12, c[1] + sh * 12), 2)
        pygame.draw.circle(self.screen, PLAYER, c, 4)
        self.screen.set_clip(None)
        pygame.draw.rect(self.screen, (80, 90, 110), rect, 1)

    # -------------------------------------------------------------- panel
    def _draw_panel(self, now: float):
        scr = self.screen
        x0 = MAP_W
        pygame.draw.rect(scr, (18, 22, 32), (x0, 0, PANEL_W, H))
        pygame.draw.line(scr, (50, 60, 80), (x0, 0), (x0, H), 1)
        y = 14
        scr.blit(self.font_big.render("WiFi Radar", True, ACCENT), (x0 + 16, y))
        y += 30
        src = f"Source: {self.scanner.name}"
        if not self.scanner.sees_clients:
            src += " (access points only)"
        scr.blit(self.font_small.render(src, True, DIM), (x0 + 16, y))
        y += 18
        if self.threaded and self.scanner.error:
            scr.blit(self.font_small.render(self.scanner.error[:48], True, HUMAN), (x0 + 16, y))
            y += 18
        sensing = self.model.motion_sensing_active(now)
        status = ("PAUSED" if self.paused else
                  "Motion sensing: ON (standing still)" if sensing else
                  "Motion sensing: paused while you walk")
        scr.blit(self.font_small.render(status, True, (120, 230, 140) if sensing and not self.paused else DIM),
                 (x0 + 16, y))
        y += 18
        devs = self.model.devices
        located = sum(d.located for d in devs)
        people = len(self.model.confirmed_humans)
        scr.blit(self.font.render(f"{len(devs)} devices  |  {located} located  |  {people} people",
                                  True, TEXT), (x0 + 16, y))
        y += 26

        if self.show["help"]:
            for line in HELP:
                scr.blit(self.font_small.render(line, True, TEXT), (x0 + 16, y))
                y += 17
            y += 8

        pygame.draw.line(scr, (50, 60, 80), (x0 + 12, y), (W - 12, y), 1)
        y += 8
        self._list_rects = []
        sel_dev = None
        for d in sorted(devs, key=lambda d: -d.last_rssi if now - d.last_seen < 15 else 200):
            if y > H - 190:
                break
            rect = pygame.Rect(x0 + 8, y - 2, PANEL_W - 16, 34)
            selected = d.mac == self.selected
            if selected:
                sel_dev = d
                pygame.draw.rect(scr, (40, 52, 74), rect, border_radius=5)
            self._list_rects.append((rect, d.mac))
            col = KIND_COLORS.get(d.kind, DIM)
            draw_icon(scr, d.kind, (x0 + 24, y + 14), col, 0.7)
            stale = now - d.last_seen > 15
            name = d.label if len(d.label) <= 26 else d.label[:25] + "…"
            scr.blit(self.font.render(name, True, TEXT if not stale else DIM), (x0 + 42, y))
            if d.located:
                info = f"{KIND_LABEL.get(d.kind, d.kind)}  ±{d.sigma:.1f} m"
            else:
                info = f"{KIND_LABEL.get(d.kind, d.kind)}  ~{self.model.distance_estimate(d):.1f} m away"
            scr.blit(self.font_small.render(info, True, DIM), (x0 + 42, y + 16))
            bar = int(np.clip((d.last_rssi + 95) / 65, 0, 1) * 50)
            pygame.draw.rect(scr, (40, 50, 66), (W - 70, y + 6, 50, 6), border_radius=3)
            pygame.draw.rect(scr, col, (W - 70, y + 6, bar, 6), border_radius=3)
            scr.blit(self.font_small.render(f"{d.last_rssi:.0f}", True, DIM), (W - 58, y + 16))
            y += 36

        if sel_dev is None and self.selected:
            sel_dev = next((d for d in devs if d.mac == self.selected), None)
        self._draw_details(sel_dev, now)

    def _draw_details(self, d: DeviceEstimate | None, now: float):
        scr = self.screen
        x0, y0 = MAP_W + 12, H - 180
        pygame.draw.rect(scr, (24, 30, 44), (x0, y0, PANEL_W - 24, 168), border_radius=6)
        if d is None:
            lines = ["Click a device for details.", "",
                     "Tip: walk in a loop around the room;", "devices get located as you move.",
                     "Stand still to sense people moving.", "Press H for all controls."]
            for i, line in enumerate(lines):
                scr.blit(self.font_small.render(line, True, DIM), (x0 + 10, y0 + 10 + 17 * i))
            return
        scr.blit(self.font.render(d.label[:34], True, TEXT), (x0 + 10, y0 + 8))
        rows = [
            f"MAC {d.mac}",
            f"{KIND_LABEL.get(d.kind, d.kind)}{'  (moving)' if d.mobile else ''}",
            (f"Position ({d.x:.1f}, {d.y:.1f}) m  ±{d.sigma:.1f} m" if d.located
             else "Position: walk around to triangulate"),
            f"Power @1m {d.tx_power:.0f} dBm   samples {d.n_samples}",
        ]
        for i, r in enumerate(rows):
            scr.blit(self.font_small.render(r, True, DIM), (x0 + 10, y0 + 30 + 16 * i))
        hist = d.rssi_history[-90:]
        if len(hist) > 1:
            gx, gy, gw, gh = x0 + 10, y0 + 100, PANEL_W - 44, 56
            pygame.draw.rect(scr, (16, 20, 30), (gx, gy, gw, gh))
            lo, hi = min(hist) - 2, max(hist) + 2
            pts = [(gx + gw * i / (len(hist) - 1), gy + gh - (v - lo) / (hi - lo) * gh) for i, v in enumerate(hist)]
            pygame.draw.lines(scr, KIND_COLORS.get(d.kind, ACCENT), False, pts, 2)
            scr.blit(self.font_small.render(f"RSSI {hi:.0f}..{lo:.0f} dBm", True, DIM), (gx + 4, gy + 2))


# ================================================================ icons
def draw_icon(surf, kind: str, pos, color, scale: float = 1.0):
    x, y = pos
    s = scale
    if kind == "router":
        pygame.draw.rect(surf, color, (x - 9 * s, y - 3 * s, 18 * s, 8 * s), border_radius=int(2 * s))
        pygame.draw.line(surf, color, (x - 6 * s, y - 3 * s), (x - 9 * s, y - 11 * s), max(1, int(2 * s)))
        pygame.draw.line(surf, color, (x + 6 * s, y - 3 * s), (x + 9 * s, y - 11 * s), max(1, int(2 * s)))
        for r in (5, 9):
            pygame.draw.arc(surf, color, (x - r * s, y - (r + 12) * s, 2 * r * s, 2 * r * s), 0.6, 2.5, 1)
    elif kind == "phone":
        pygame.draw.rect(surf, color, (x - 5 * s, y - 9 * s, 10 * s, 18 * s), max(1, int(2 * s)),
                         border_radius=int(3 * s))
        pygame.draw.circle(surf, color, (x, y + 5 * s), max(1, int(1.5 * s)))
    elif kind == "laptop":
        pygame.draw.rect(surf, color, (x - 8 * s, y - 8 * s, 16 * s, 11 * s), max(1, int(2 * s)))
        pygame.draw.polygon(surf, color, [(x - 11 * s, y + 5 * s), (x + 11 * s, y + 5 * s),
                                          (x + 9 * s, y + 2 * s), (x - 9 * s, y + 2 * s)])
    elif kind == "tv":
        pygame.draw.rect(surf, color, (x - 11 * s, y - 8 * s, 22 * s, 14 * s), max(1, int(2 * s)))
        pygame.draw.line(surf, color, (x - 5 * s, y + 9 * s), (x + 5 * s, y + 9 * s), max(1, int(2 * s)))
    elif kind == "iot":
        pygame.draw.circle(surf, color, (x, y), 7 * s, max(1, int(2 * s)))
        pygame.draw.circle(surf, color, (x, y), 2.5 * s)
    else:
        pygame.draw.polygon(surf, color, [(x, y - 8 * s), (x + 8 * s, y), (x, y + 8 * s), (x - 8 * s, y)],
                            max(1, int(2 * s)))


def draw_person(surf, pos, color, scale: float = 1.0):
    x, y = pos
    s = scale
    pygame.draw.circle(surf, color, (x, y - 9 * s), 4 * s)
    pygame.draw.line(surf, color, (x, y - 5 * s), (x, y + 5 * s), max(1, int(2.5 * s)))
    pygame.draw.line(surf, color, (x - 6 * s, y - 1 * s), (x + 6 * s, y - 1 * s), max(1, int(2 * s)))
    pygame.draw.line(surf, color, (x, y + 5 * s), (x - 4 * s, y + 12 * s), max(1, int(2 * s)))
    pygame.draw.line(surf, color, (x, y + 5 * s), (x + 4 * s, y + 12 * s), max(1, int(2 * s)))
