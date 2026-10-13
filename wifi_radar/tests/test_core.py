import math
import random

import numpy as np

from wifi_radar.localization import Grid, bin_samples, fit_position
from wifi_radar.pathloss import distance_for, percent_to_dbm, rssi_at
from wifi_radar.scanners import guess_kind, parse_iw, parse_netsh, parse_nmcli
from wifi_radar.simulation import SimulatedScanner, SimWorld
from wifi_radar.tracker import WorldModel


def test_pathloss_roundtrip():
    for d in (0.5, 1, 3, 10):
        assert math.isclose(float(distance_for(rssi_at(d, -40, 2.5), -40, 2.5)), d, rel_tol=1e-9)
    assert percent_to_dbm(100) == -50
    assert percent_to_dbm(0) == -100


def test_fit_position_recovers_transmitter():
    rng = np.random.default_rng(0)
    tx, ty, p0, n = 4.0, 3.0, -38.0, 2.4
    xs = rng.uniform(0, 10, 120)
    ys = rng.uniform(0, 8, 120)
    r = rssi_at(np.hypot(xs - tx, ys - ty), p0, n) + rng.normal(0, 2.0, xs.size)
    grid = Grid(-5, 15, -5, 13, 0.2)
    bx, by, br, bw = bin_samples(xs, ys, r, np.ones_like(r))
    fit = fit_position(bx, by, br, bw, grid, n)
    assert math.hypot(fit.x - tx, fit.y - ty) < 0.7
    assert abs(fit.p0 - p0) < 3
    assert fit.sigma < 1.0


def test_fit_from_one_spot_is_uncertain():
    rng = np.random.default_rng(1)
    xs = 5 + rng.normal(0, 0.05, 50)
    ys = 5 + rng.normal(0, 0.05, 50)
    r = rssi_at(np.hypot(xs - 8, ys - 5), -40, 2.4) + rng.normal(0, 2, 50)
    fit = fit_position(xs, ys, r, np.ones(50), Grid(-5, 15, -5, 15, 0.25))
    assert fit.sigma > 2.0


def test_parse_nmcli():
    out = "AA\\:BB\\:CC\\:DD\\:EE\\:FF:HomeNet:6:80\n11\\:22\\:33\\:44\\:55\\:66::36:40\n"
    obs = parse_nmcli(out, 1.0)
    assert [o.mac for o in obs] == ["aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"]
    assert obs[0].name == "HomeNet" and obs[0].rssi == -60 and obs[0].channel == 6
    assert obs[1].name == "(hidden network)"


def test_parse_netsh():
    out = """
SSID 1 : CoffeeShop
    Network type            : Infrastructure
    BSSID 1                 : a0:b1:c2:d3:e4:f5
         Signal             : 70%
         Channel            : 11
SSID 2 : Living Room TV
    BSSID 1                 : 00:11:22:33:44:55
         Signal             : 30%
         Channel            : 1
"""
    obs = parse_netsh(out, 0)
    assert len(obs) == 2
    assert obs[0].name == "CoffeeShop" and obs[0].rssi == -65 and obs[0].channel == 11
    assert obs[1].kind == "tv"


def test_parse_iw():
    out = """BSS 12:34:56:78:9a:bc(on wlan0)
\tsignal: -48.00 dBm
\tSSID: Lab
\tDS Parameter set: channel 6
BSS de:ad:be:ef:00:01(on wlan0)
\tsignal: -71.00 dBm
\tSSID:
"""
    obs = parse_iw(out, 0)
    assert obs[0].rssi == -48 and obs[0].name == "Lab" and obs[0].channel == 6
    assert obs[1].name == "(hidden network)"


def test_guess_kind():
    assert guess_kind("Bob's iPhone", "", True) == "phone"
    assert guess_kind("HP-Print-42", "", True) == "iot"
    assert guess_kind("", "da:00:00:00:00:01", False) == "phone"  # randomised MAC
    assert guess_kind("Home", "a4:00:00:00:00:01", True) == "router"


def _walk(world, model, route, still_every=3, speed=1.2, dt=1 / 30):
    sc = SimulatedScanner(world)
    px, py = route[0]
    t, k, next_scan, still = 0.0, 1, 0.0, 0.0
    while k < len(route) or still > 0:
        if still > 0:
            still -= dt
        else:
            tx, ty = route[k]
            d = math.hypot(tx - px, ty - py)
            if d < 0.05:
                k += 1
                still = 3.0 if k % still_every == 0 else 0.0
                continue
            s = min(d, speed * dt)
            px, py = px + (tx - px) / d * s, py + (ty - py) / d * s
        world.step(dt)
        t += dt
        if t >= next_scan:
            model.ingest(sc.scan(px, py, t), px, py, t)
            next_scan += 1 / sc.rate_hz
        model.update(px, py, t)
    return t


ROUTE = [(8, 7.5), (12, 8), (9, 7.5), (9, 4.5), (9, 3), (12, 3), (12, 1), (11, 3), (8, 3), (8, 1), (7, 5),
         (3, 5), (3, 2), (1, 4), (4, 5.5), (3.6, 8), (2, 8), (5, 8), (3.6, 6), (7, 5), (9, 5), (9, 7.5)]


def test_simulated_walk_locates_static_devices():
    random.seed(0)
    world = SimWorld(seed=1)
    model = WorldModel()
    _walk(world, model, ROUTE)
    truth = {d.mac: d for d in world.devices}
    indoor_static = [d for d in model.devices
                     if truth[d.mac].carrier is None and 0 <= truth[d.mac].x <= world.width]
    errors = [math.hypot(d.x - truth[d.mac].x, d.y - truth[d.mac].y) for d in indoor_static]
    assert len(errors) == 6
    assert np.median(errors) < 2.5, errors
    assert not any(d.mobile for d in indoor_static)


def test_empty_home_has_no_phantom_people():
    random.seed(0)
    world = SimWorld(seed=1)
    world.humans = []
    world.devices = [d for d in world.devices if d.carrier is None]
    model = WorldModel()
    _walk(world, model, ROUTE)
    assert model.confirmed_humans == []


def test_windows_wlan_struct_layout_matches_sdk():
    import ctypes

    from wifi_radar.scanners import _wlan_structs

    GUID, INFO, IFLIST, SSID, ENTRY, HEADER = _wlan_structs()
    assert ctypes.sizeof(GUID) == 16
    assert ctypes.sizeof(INFO) == 532
    assert IFLIST.InterfaceInfo.offset == 8
    assert ctypes.sizeof(ENTRY) == 360  # sizeof(WLAN_BSS_ENTRY) in the Windows SDK
    assert ENTRY.lRssi.offset == 56
    assert ENTRY.ulChCenterFrequency.offset == 92


def test_windows_parse_bss_list_from_memory():
    import ctypes

    from wifi_radar.scanners import _wlan_structs, parse_bss_list

    *_, ENTRY, HEADER = _wlan_structs()

    class List(ctypes.Structure):
        _fields_ = [("head", HEADER), ("entries", ENTRY * 2)]

    lst = List()
    lst.head.dwNumberOfItems = 2
    e = lst.entries[0]
    e.dot11Ssid.uSSIDLength = 7
    e.dot11Ssid.ucSSID[:7] = list(b"EvWiFi5")
    e.dot11Bssid[:] = [0xA4, 0x2B, 0xB0, 0x11, 0x22, 0x01]
    e.lRssi = -57
    e.ulChCenterFrequency = 5180000
    lst.entries[1].lRssi = -80
    lst.entries[1].ulChCenterFrequency = 2437000
    obs = parse_bss_list(ctypes.addressof(lst), 1.0)
    assert obs[0].name == "EvWiFi5" and obs[0].mac == "a4:2b:b0:11:22:01"
    assert obs[0].rssi == -57 and obs[0].channel == 36
    assert obs[1].name == "(hidden network)" and obs[1].channel == 6


def test_parse_netsh_turkish():
    out = """
SSID 1 : SuperOnline_5G
    Ağ türü                 : Altyapı
    BSSID 1                 : a0:b1:c2:d3:e4:f5
         Sinyal             : 82%
         Radyo türü         : 802.11ac
         Kanal              : 44
"""
    obs = parse_netsh(out, 0)
    assert len(obs) == 1 and obs[0].rssi == -59 and obs[0].channel == 44
