"""Command line entry point:  python -m wifi_radar [--sim | --backend ...]"""

from __future__ import annotations

import argparse
import os
import sys


def main(argv=None):
    ap = argparse.ArgumentParser(prog="wifi_radar", description=__doc__)
    ap.add_argument("--sim", action="store_true",
                    help="use the built-in virtual apartment instead of your Wi-Fi card")
    ap.add_argument("--backend", default="auto",
                    choices=["auto", "nmcli", "iw", "netsh", "macos", "monitor"],
                    help="real scanner to use (default: pick one for this OS)")
    ap.add_argument("--iface", help="Wi-Fi interface for the iw / monitor backends, e.g. wlan0")
    ap.add_argument("--exponent", type=float, default=2.4,
                    help="path-loss exponent: ~2 open space, 2.5-3.5 walls/furniture (default 2.4)")
    ap.add_argument("--seed", type=int, default=None, help="random seed for the simulation")
    ap.add_argument("--autopilot", action="store_true", help="(sim) walk around automatically; P toggles")
    ap.add_argument("--frames", type=int, help="quit after N frames (testing)")
    ap.add_argument("--screenshot", help="save a PNG of the last frame (testing)")
    ap.add_argument("--headless", action="store_true", help="no window (testing; implies fixed time step)")
    ap.add_argument("--view", choices=["map", "explore"], default="map")
    args = ap.parse_args(argv)

    if args.headless:
        os.environ["SDL_VIDEODRIVER"] = "dummy"
        os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

    from .tracker import WorldModel
    from .ui import App

    model = WorldModel(path_loss_exponent=args.exponent)
    if args.sim:
        from .simulation import SimulatedScanner, SimWorld

        world = SimWorld(seed=args.seed)
        app = App(SimulatedScanner(world), model, sim_world=world, autopilot=args.autopilot,
                  title="WiFi Radar - simulation")
    else:
        from .scanners import ThreadedScanner, make_scanner

        try:
            scanner = make_scanner(args.backend, args.iface)
        except RuntimeError as e:
            print(f"error: {e}\n\nTip: try the simulation with  python -m wifi_radar --sim", file=sys.stderr)
            return 1
        app = None
        threaded = ThreadedScanner(scanner, lambda: (app.player.x, app.player.y))
        app = App(threaded, model, title=f"WiFi Radar - {scanner.name}")
    app.view = args.view
    app.run(max_frames=args.frames, screenshot=args.screenshot,
            sim_dt=1 / 30 if args.headless else None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
