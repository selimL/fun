"""Real Wi-Fi scanners.

Normal Wi-Fi cards in "managed" mode can only list access points (routers,
hotspots, printers in AP mode, ...). To see phones, laptops and other client
devices you need a card that supports monitor mode (Linux) - use the
``monitor`` backend for that.

Every backend implements ``scan(x, y, now) -> list[Observation]``. Scans by
the OS tools are slow (1-5 s), so they run in a background thread via
``ThreadedScanner``.
"""

from __future__ import annotations

import json
import platform
import re
import shutil
import subprocess
import threading
import time
from collections import defaultdict

from .models import Observation
from .pathloss import percent_to_dbm


def guess_kind(name: str, mac: str, is_ap: bool) -> str:
    n = name.lower()
    if any(k in n for k in ("tv", "bravia", "roku", "chromecast", "firetv", "fire tv")):
        return "tv"
    if any(k in n for k in ("iphone", "galaxy", "pixel", "phone", "android", "watch")):
        return "phone"
    if any(k in n for k in ("laptop", "macbook", "desktop", "-pc", "thinkpad")):
        return "laptop"
    if any(k in n for k in ("printer", "hp-", "epson", "canon", "brother", "esp_", "esp32",
                            "tasmota", "shelly", "tuya", "nest", "echo", "sonos", "hue", "cam")):
        return "iot"
    if is_ap:
        return "router"
    try:
        # Locally administered (randomised) MACs are used by modern phones.
        if int(mac.split(":")[0], 16) & 0x02:
            return "phone"
    except ValueError:
        pass
    return "unknown"


def _run(cmd: list[str], timeout: float = 20.0) -> str:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False).stdout


# --------------------------------------------------------------------- Linux
class NmcliScanner:
    """Linux with NetworkManager. No root needed."""

    name = "nmcli"
    rate_hz = 0.5
    sees_clients = False

    def scan(self, x: float, y: float, now: float) -> list[Observation]:
        out = _run(["nmcli", "-t", "-f", "BSSID,SSID,CHAN,SIGNAL", "device", "wifi", "list", "--rescan", "yes"])
        return parse_nmcli(out, now)


def parse_nmcli(out: str, now: float) -> list[Observation]:
    obs = []
    for line in out.splitlines():
        # nmcli -t escapes ':' inside fields as '\:'
        parts = [p.replace("\\:", ":") for p in re.split(r"(?<!\\):", line)]
        if len(parts) < 4:
            continue
        bssid, ssid, chan, signal = parts[0].lower(), parts[1], parts[2], parts[3]
        try:
            rssi = percent_to_dbm(float(signal))
        except ValueError:
            continue
        name = ssid or "(hidden network)"
        obs.append(Observation(bssid, rssi, now, name, guess_kind(ssid, bssid, True),
                               int(chan) if chan.isdigit() else None, True))
    return obs


class IwScanner:
    """Linux ``iw dev <iface> scan`` - real dBm values, needs root."""

    name = "iw"
    rate_hz = 0.5
    sees_clients = False

    def __init__(self, iface: str):
        self.iface = iface

    def scan(self, x: float, y: float, now: float) -> list[Observation]:
        return parse_iw(_run(["iw", "dev", self.iface, "scan"]), now)


def parse_iw(out: str, now: float) -> list[Observation]:
    obs, cur = [], None
    for line in out.splitlines():
        m = re.match(r"^BSS ([0-9a-f:]{17})", line)
        if m:
            cur = {"mac": m.group(1), "ssid": "", "signal": None, "chan": None}
            obs.append(cur)
            continue
        if cur is None:
            continue
        line = line.strip()
        if line.startswith("signal:"):
            cur["signal"] = float(line.split()[1])
        elif line.startswith("SSID:"):
            cur["ssid"] = line[5:].strip()
        elif line.startswith("DS Parameter set: channel"):
            cur["chan"] = int(line.split()[-1])
    return [Observation(c["mac"], c["signal"], now, c["ssid"] or "(hidden network)",
                        guess_kind(c["ssid"], c["mac"], True), c["chan"], True)
            for c in obs if c["signal"] is not None]


# ------------------------------------------------------------------- Windows
class NetshScanner:
    name = "netsh"
    rate_hz = 0.3
    sees_clients = False

    def scan(self, x: float, y: float, now: float) -> list[Observation]:
        return parse_netsh(_run(["netsh", "wlan", "show", "networks", "mode=bssid"]), now)


def parse_netsh(out: str, now: float) -> list[Observation]:
    obs, ssid, cur = [], "", None
    for raw in out.splitlines():
        line = raw.strip()
        m = re.match(r"^SSID \d+\s*:\s*(.*)$", line)
        if m:
            ssid = m.group(1)
            continue
        m = re.match(r"^BSSID \d+\s*:\s*([0-9a-fA-F:]{17})", line)
        if m:
            cur = {"mac": m.group(1).lower(), "ssid": ssid, "signal": None, "chan": None}
            obs.append(cur)
            continue
        if cur is None:
            continue
        # Match by value shape, not label: labels are translated (e.g. "Sinyal", "Kanal").
        m = re.match(r"^[^:]+:\s*(\d+)\s*%$", line)
        if m and cur["signal"] is None:
            cur["signal"] = percent_to_dbm(float(m.group(1)))
            continue
        m = re.match(r"^(Channel|Kanal|Canal)\s*:\s*(\d+)", line, re.I)
        if m:
            cur["chan"] = int(m.group(2))
    return [Observation(c["mac"], c["signal"], now, c["ssid"] or "(hidden network)",
                        guess_kind(c["ssid"], c["mac"], True), c["chan"], True)
            for c in obs if c["signal"] is not None]



# ------------------------------------------------------- Windows (native API)
WINDOWS_LOCATION_HELP = (
    "Windows blocked the Wi-Fi scan. Turn on: Settings > Privacy & security > Location > "
    "'Location services' AND 'Let desktop apps access your location', then restart WiFi Radar."
)


def freq_to_channel(mhz: float) -> int | None:
    mhz = round(mhz)
    if mhz == 2484:
        return 14
    if 2412 <= mhz <= 2472:
        return (mhz - 2407) // 5
    if 5150 <= mhz <= 5895:
        return (mhz - 5000) // 5
    if 5955 <= mhz <= 7115:
        return (mhz - 5950) // 5
    return None


def bss_to_observation(ssid: bytes, bssid: bytes, rssi: int, freq_khz: int, now: float) -> Observation:
    name = ssid.decode("utf-8", errors="replace")
    mac = ":".join(f"{b:02x}" for b in bssid)
    return Observation(mac, float(rssi), now, name or "(hidden network)",
                       guess_kind(name, mac, True), freq_to_channel(freq_khz / 1000.0), True)


def _wlan_structs():
    import ctypes as C

    class GUID(C.Structure):
        _fields_ = [("Data1", C.c_uint32), ("Data2", C.c_uint16), ("Data3", C.c_uint16),
                    ("Data4", C.c_ubyte * 8)]

    class WLAN_INTERFACE_INFO(C.Structure):
        _fields_ = [("InterfaceGuid", GUID), ("strInterfaceDescription", C.c_uint16 * 256),
                    ("isState", C.c_uint32)]

    class WLAN_INTERFACE_INFO_LIST(C.Structure):
        _fields_ = [("dwNumberOfItems", C.c_uint32), ("dwIndex", C.c_uint32),
                    ("InterfaceInfo", WLAN_INTERFACE_INFO * 1)]

    class DOT11_SSID(C.Structure):
        _fields_ = [("uSSIDLength", C.c_uint32), ("ucSSID", C.c_ubyte * 32)]

    class WLAN_RATE_SET(C.Structure):
        _fields_ = [("uRateSetLength", C.c_uint32), ("usRateSet", C.c_uint16 * 126)]

    class WLAN_BSS_ENTRY(C.Structure):
        _fields_ = [("dot11Ssid", DOT11_SSID), ("uPhyId", C.c_uint32),
                    ("dot11Bssid", C.c_ubyte * 6), ("dot11BssType", C.c_uint32),
                    ("dot11BssPhyType", C.c_uint32), ("lRssi", C.c_int32),
                    ("uLinkQuality", C.c_uint32), ("bInRegDomain", C.c_ubyte),
                    ("usBeaconPeriod", C.c_uint16), ("ullTimestamp", C.c_uint64),
                    ("ullHostTimestamp", C.c_uint64), ("usCapabilityInformation", C.c_uint16),
                    ("ulChCenterFrequency", C.c_uint32), ("wlanRateSet", WLAN_RATE_SET),
                    ("ulIeOffset", C.c_uint32), ("ulIeSize", C.c_uint32)]

    class WLAN_BSS_LIST_HEADER(C.Structure):
        _fields_ = [("dwTotalSize", C.c_uint32), ("dwNumberOfItems", C.c_uint32)]

    return GUID, WLAN_INTERFACE_INFO, WLAN_INTERFACE_INFO_LIST, DOT11_SSID, WLAN_BSS_ENTRY, WLAN_BSS_LIST_HEADER


def parse_bss_list(addr: int, now: float) -> list[Observation]:
    """Read a WLAN_BSS_LIST that lives at memory address ``addr``."""
    import ctypes as C

    *_, WLAN_BSS_ENTRY, HEADER = _wlan_structs()
    head = HEADER.from_address(addr)
    entries = (WLAN_BSS_ENTRY * head.dwNumberOfItems).from_address(addr + C.sizeof(HEADER))
    obs = []
    for e in entries:
        n = min(e.dot11Ssid.uSSIDLength, 32)
        obs.append(bss_to_observation(bytes(e.dot11Ssid.ucSSID[:n]), bytes(e.dot11Bssid),
                                      e.lRssi, e.ulChCenterFrequency, now))
    return obs


class WlanApiScanner:
    """Windows native Wi-Fi API (wlanapi.dll) via ctypes.

    Unlike ``netsh`` it works in every Windows language, reports real dBm
    and triggers a fresh scan every time instead of returning cached results.
    """

    name = "windows"
    rate_hz = 0.25
    sees_clients = False
    ERROR_ACCESS_DENIED = 5

    def __init__(self):
        import ctypes as C
        from ctypes import wintypes as W

        if platform.system() != "Windows":
            raise RuntimeError("The windows backend only works on Windows.")
        self.C = C
        self.GUID, _, self.IFLIST, *_ = _wlan_structs()
        self.api = C.WinDLL("wlanapi.dll")
        self.api.WlanOpenHandle.argtypes = [W.DWORD, C.c_void_p, C.POINTER(W.DWORD), C.POINTER(W.HANDLE)]
        self.api.WlanEnumInterfaces.argtypes = [W.HANDLE, C.c_void_p, C.POINTER(C.c_void_p)]
        self.api.WlanScan.argtypes = [W.HANDLE, C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p]
        self.api.WlanGetNetworkBssList.argtypes = [W.HANDLE, C.c_void_p, C.c_void_p, C.c_uint32,
                                                   W.BOOL, C.c_void_p, C.POINTER(C.c_void_p)]
        self.api.WlanFreeMemory.argtypes = [C.c_void_p]
        self.api.WlanCloseHandle.argtypes = [W.HANDLE, C.c_void_p]
        for fn in ("WlanOpenHandle", "WlanEnumInterfaces", "WlanScan", "WlanGetNetworkBssList", "WlanCloseHandle"):
            getattr(self.api, fn).restype = W.DWORD

        version = W.DWORD()
        self.handle = W.HANDLE()
        err = self.api.WlanOpenHandle(2, None, C.byref(version), C.byref(self.handle))
        if err:
            raise RuntimeError(f"Could not open the Wi-Fi service (WlanOpenHandle error {err}). "
                               "Is Wi-Fi turned on?")
        self.guids = self._interfaces()
        if not self.guids:
            raise RuntimeError("No Wi-Fi adapter found. Is Wi-Fi turned on?")

    def _interfaces(self):
        C = self.C
        ptr = C.c_void_p()
        err = self.api.WlanEnumInterfaces(self.handle, None, C.byref(ptr))
        if err:
            raise RuntimeError(f"WlanEnumInterfaces error {err}")
        try:
            head = self.IFLIST.from_address(ptr.value)
            n = head.dwNumberOfItems
            info_t = type(head.InterfaceInfo[0])
            infos = (info_t * n).from_address(ptr.value + self.IFLIST.InterfaceInfo.offset)
            guids = []
            for info in infos:
                g = self.GUID()
                C.memmove(C.byref(g), C.byref(info.InterfaceGuid), C.sizeof(g))
                guids.append(g)
            return guids
        finally:
            self.api.WlanFreeMemory(ptr)

    def scan(self, x: float, y: float, now: float) -> list[Observation]:
        C = self.C
        for g in self.guids:
            self.api.WlanScan(self.handle, C.byref(g), None, None, None)
        time.sleep(3.0)  # Windows needs a few seconds to finish the scan
        now = time.monotonic()
        obs: dict[str, Observation] = {}
        for g in self.guids:
            ptr = C.c_void_p()
            err = self.api.WlanGetNetworkBssList(self.handle, C.byref(g), None, 3, False, None, C.byref(ptr))
            if err == self.ERROR_ACCESS_DENIED:
                raise PermissionError(WINDOWS_LOCATION_HELP)
            if err:
                raise RuntimeError(f"WlanGetNetworkBssList error {err}")
            try:
                for o in parse_bss_list(ptr.value, now):
                    obs[o.mac] = o
            finally:
                self.api.WlanFreeMemory(ptr)
        return list(obs.values())

    def close(self):
        try:
            self.api.WlanCloseHandle(self.handle, None)
        except Exception:
            pass


# --------------------------------------------------------------------- macOS
class MacScanner:
    """macOS. Recent versions hide BSSIDs, so networks are keyed by name."""

    name = "macos"
    rate_hz = 0.2
    sees_clients = False

    def scan(self, x: float, y: float, now: float) -> list[Observation]:
        out = _run(["system_profiler", "SPAirPortDataType", "-json"], timeout=30)
        return parse_system_profiler(out, now)


def parse_system_profiler(out: str, now: float) -> list[Observation]:
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return []
    obs = []
    for entry in data.get("SPAirPortDataType", []):
        for iface in entry.get("spairport_airport_interfaces", []):
            nets = list(iface.get("spairport_airport_other_local_wireless_networks", []))
            cur = iface.get("spairport_current_network_information")
            if cur:
                nets.append(cur)
            for net in nets:
                name = net.get("_name", "")
                m = re.match(r"\s*(-?\d+)\s*dBm", net.get("spairport_signal_noise", ""))
                if not m:
                    continue
                chan = re.match(r"\s*(\d+)", str(net.get("spairport_network_channel", "")))
                key = "ssid:" + name
                obs.append(Observation(key, float(m.group(1)), now, name, guess_kind(name, "", True),
                                       int(chan.group(1)) if chan else None, True))
    return obs


# ----------------------------------------------------------- monitor (Linux)
class MonitorScanner:
    """Passive sniffing with scapy on a monitor-mode interface (Linux, root).

    Hears every Wi-Fi frame in range, so it finds client devices too (phones,
    laptops, IoT), and gives many RSSI readings per second - which is what
    the motion/human sensing needs.

        sudo ip link set wlan1 down
        sudo iw dev wlan1 set type monitor
        sudo ip link set wlan1 up
    """

    name = "monitor"
    rate_hz = 4.0
    sees_clients = True
    CHANNELS = (1, 6, 11, 36, 40, 44, 48, 149, 153, 157, 161)

    def __init__(self, iface: str, channels=None, hop: bool = True):
        try:
            from scapy.all import AsyncSniffer  # noqa: F401
        except ImportError as e:
            raise RuntimeError("The monitor backend needs scapy: pip install scapy") from e
        self.iface = iface
        self.channels = tuple(channels or self.CHANNELS)
        self._lock = threading.Lock()
        self._buf: dict[str, list[float]] = defaultdict(list)
        self._meta: dict[str, tuple[str, bool, int | None]] = {}
        self._stop = threading.Event()
        from scapy.all import AsyncSniffer
        self._sniffer = AsyncSniffer(iface=iface, prn=self._on_packet, store=False)
        self._sniffer.start()
        if hop and shutil.which("iw"):
            threading.Thread(target=self._hop, daemon=True).start()

    def _hop(self):
        i = 0
        while not self._stop.is_set():
            ch = self.channels[i % len(self.channels)]
            subprocess.run(["iw", "dev", self.iface, "set", "channel", str(ch)], capture_output=True)
            i += 1
            time.sleep(0.25)

    def _on_packet(self, pkt):
        from scapy.layers.dot11 import Dot11, Dot11Beacon, Dot11Elt, Dot11ProbeResp, RadioTap
        if not pkt.haslayer(Dot11) or not pkt.haslayer(RadioTap):
            return
        rssi = getattr(pkt[RadioTap], "dBm_AntSignal", None)
        mac = pkt[Dot11].addr2
        if rssi is None or not mac:
            return
        mac = mac.lower()
        if int(mac.split(":")[0], 16) & 0x01:  # multicast/broadcast transmitter: ignore
            return
        is_ap = pkt.haslayer(Dot11Beacon) or pkt.haslayer(Dot11ProbeResp)
        name, chan = "", None
        if is_ap and pkt.haslayer(Dot11Elt):
            elt = pkt[Dot11Elt]
            while isinstance(elt, Dot11Elt):
                if elt.ID == 0:
                    name = elt.info.decode(errors="replace")
                elif elt.ID == 3 and elt.info:
                    chan = elt.info[0]
                elt = elt.payload
        with self._lock:
            self._buf[mac].append(float(rssi))
            old = self._meta.get(mac)
            if old is None or is_ap or (name and not old[0]):
                self._meta[mac] = (name or (old[0] if old else ""), is_ap or (old[1] if old else False), chan)

    def scan(self, x: float, y: float, now: float) -> list[Observation]:
        with self._lock:
            buf, self._buf = self._buf, defaultdict(list)
            meta = dict(self._meta)
        obs = []
        for mac, values in buf.items():
            name, is_ap, chan = meta.get(mac, ("", False, None))
            values.sort()
            rssi = values[len(values) // 2]  # median of this burst
            label = name or ("Access point" if is_ap else "Device " + mac[-8:])
            obs.append(Observation(mac, rssi, now, label, guess_kind(name, mac, is_ap), chan, is_ap))
        return obs

    def close(self):
        self._stop.set()
        self._sniffer.stop()


# -------------------------------------------------------------------- helpers
class ThreadedScanner:
    """Runs a slow scanner in the background; the UI polls for results.

    ``position`` is a callable returning your current (x, y); the reading is
    tagged with where you were when the scan finished.
    """

    def __init__(self, scanner, position):
        self.scanner = scanner
        self.name = scanner.name
        self.sees_clients = scanner.sees_clients
        self.rate_hz = scanner.rate_hz
        self._position = position
        self._results: list[tuple[float, float, list[Observation]]] = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self.error: str | None = None
        self.paused = False
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        period = 1.0 / self.scanner.rate_hz
        while not self._stop.is_set():
            t0 = time.monotonic()
            if not self.paused:
                try:
                    x, y = self._position()
                    obs = self.scanner.scan(x, y, time.monotonic())
                    x2, y2 = self._position()
                    with self._lock:
                        self._results.append(((x + x2) / 2, (y + y2) / 2, obs))
                    self.error = None
                except Exception as e:  # keep scanning; show the error in the UI
                    msg = str(e) if isinstance(e, (PermissionError, RuntimeError)) else f"{type(e).__name__}: {e}"
                    if msg != self.error:
                        print("WiFi Radar:", msg, flush=True)
                    self.error = msg
            self._stop.wait(max(0.05, period - (time.monotonic() - t0)))

    def poll(self) -> list[tuple[float, float, list[Observation]]]:
        with self._lock:
            out, self._results = self._results, []
        return out

    def close(self):
        self._stop.set()
        if hasattr(self.scanner, "close"):
            self.scanner.close()


def auto_scanner(iface: str | None = None):
    system = platform.system()
    if system == "Linux":
        if shutil.which("nmcli"):
            return NmcliScanner()
        if shutil.which("iw") and iface:
            return IwScanner(iface)
        raise RuntimeError("No supported scanner found: install NetworkManager (nmcli) or use --backend iw --iface wlan0")
    if system == "Windows":
        try:
            return WlanApiScanner()
        except OSError:
            return NetshScanner()
    if system == "Darwin":
        return MacScanner()
    raise RuntimeError(f"Unsupported platform: {system}")


def make_scanner(backend: str, iface: str | None = None):
    if backend == "auto":
        return auto_scanner(iface)
    if backend == "nmcli":
        return NmcliScanner()
    if backend == "iw":
        if not iface:
            raise RuntimeError("--backend iw needs --iface")
        return IwScanner(iface)
    if backend == "windows":
        return WlanApiScanner()
    if backend == "netsh":
        return NetshScanner()
    if backend == "macos":
        return MacScanner()
    if backend == "monitor":
        if not iface:
            raise RuntimeError("--backend monitor needs --iface (an interface in monitor mode)")
        return MonitorScanner(iface)
    raise RuntimeError(f"Unknown backend {backend}")
