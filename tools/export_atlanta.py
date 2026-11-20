#!/usr/bin/env python3
"""Export real Atlanta open data to static JSON in data/, so the site runs on GitHub Pages with no server.
(Same idea as SUNDIAL's tools/export_static.py.)

Sources, all public:
  * MARTA GTFS feed          -> data/marta.json    rail stations (lines, wheelchair flag) + bus stops (wheelchair flag)
  * OpenStreetMap / Overpass -> data/places.json   hospitals, pharmacies, libraries, senior and community centres,
                                                   public toilets, supermarkets, with OSM's own wheelchair tag
  * Open-Meteo archive       -> data/climate.json  2021-2025 hourly temperature and feels-like by month x hour
  * US Census (us-atlas)     -> data/counties.geojson  the 10 core metro counties

Usage:  python3 tools/export_atlanta.py [--only marta|places|climate|counties]
Nothing here needs an API key. Overpass is busy at times, so it retries across mirrors.
"""
import csv, io, json, os, sys, time, zipfile, urllib.request, urllib.parse, collections

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
UA = "atl-access-hackathon/0.1 (student project; open data export)"
BBOX = (33.45, -84.75, 34.15, -83.95)  # south, west, north, east: the 10-county core
CENTER = (33.749, -84.388)


def fetch(url, data=None, timeout=120, tries=1):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - we just retry and report
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def write(name, obj):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    with open(p, "w") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
    print(f"  wrote {name}: {os.path.getsize(p)/1024:.0f} KB")


def inside(lat, lon):
    return BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]


# ------------------------------------------------------------------ MARTA
def export_marta():
    print("MARTA GTFS")
    raw = fetch("https://itsmarta.com/google_transit_feed/google_transit.zip", timeout=180, tries=3)
    z = zipfile.ZipFile(io.BytesIO(raw))
    rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig"))
    routes = {r["route_id"]: r for r in rd("routes.txt")}
    rail_routes = {i: r for i, r in routes.items() if r.get("route_type") == "1"}
    rail_trips = {t["trip_id"]: t["route_id"] for t in rd("trips.txt") if t["route_id"] in rail_routes}
    stops = {s["stop_id"]: s for s in rd("stops.txt")}
    child_to_parent = {i: s["parent_station"] for i, s in stops.items() if s.get("parent_station")}
    lines = collections.defaultdict(set)
    for st in rd("stop_times.txt"):
        rid = rail_trips.get(st["trip_id"])
        if rid:
            sid = st["stop_id"]
            lines[child_to_parent.get(sid, sid)].add(rail_routes[rid]["route_long_name"] or rail_routes[rid]["route_short_name"])
    stations = []
    for sid, s in stops.items():
        if s.get("location_type") != "1":
            continue
        name = s["stop_name"].title().replace("Mcpherson", "McPherson").replace("Ft ", "Ft. ")
        ln = sorted(lines.get(sid, []))
        stations.append({
            "id": sid, "name": name, "lat": round(float(s["stop_lat"]), 5), "lon": round(float(s["stop_lon"]), 5),
            "wc": {"1": 1, "2": 0}.get(s.get("wheelchair_boarding", ""), -1),  # 1 accessible, 0 not, -1 unknown
            "rail": bool(ln), "lines": ln,
        })
    bus = []
    for sid, s in stops.items():
        if s.get("location_type") not in ("", None, "0") or s.get("parent_station"):
            continue
        la, lo = float(s["stop_lat"]), float(s["stop_lon"])
        if inside(la, lo):
            bus.append([round(la, 4), round(lo, 4), {"1": 1, "2": 0}.get(s.get("wheelchair_boarding", ""), -1)])
    print(f"  {len(stations)} stations ({sum(1 for s in stations if s['rail'])} on rail lines), {len(bus)} bus stops")
    write("marta.json", {"source": "MARTA GTFS (itsmarta.com/google_transit_feed)", "stations": stations, "bus": bus})


# ------------------------------------------------------------------ places (OSM)
KINDS = {
    "hospital": '["amenity"="hospital"]',
    "pharmacy": '["amenity"="pharmacy"]',
    "library": '["amenity"="library"]',
    "senior": '["amenity"="social_facility"]["social_facility:for"~"senior"]',
    "clinic": '["amenity"="clinic"]',
    "community": '["amenity"="community_centre"]',
    "toilets": '["amenity"="toilets"]',
    "grocery": '["shop"="supermarket"]',
}
MIRRORS = ["https://overpass.openstreetmap.fr/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]


def overpass(q):
    body = urllib.parse.urlencode({"data": q}).encode()
    for rnd in range(4):
        for m in MIRRORS:
            try:
                return json.loads(fetch(m, body, timeout=90))
            except Exception as e:  # noqa: BLE001
                print(f"    {m.split('/')[2]} failed ({str(e)[:60]}), next")
        time.sleep(10 * (rnd + 1))
    raise RuntimeError("Overpass unavailable")


def export_places():
    print("OpenStreetMap places")
    bb = ",".join(map(str, BBOX))
    places = []
    for kind, flt in KINDS.items():
        q = f'[out:json][timeout:80];(nwr{flt}({bb}););out center tags;'
        try:
            els = overpass(q)["elements"]
        except RuntimeError as e:  # keep the other categories if one is unavailable
            print(f"  {kind}: SKIPPED ({e}); rerun later to add it")
            continue
        n0 = len(places)
        for e in els:
            t = e.get("tags", {})
            la = e.get("lat") or e.get("center", {}).get("lat")
            lo = e.get("lon") or e.get("center", {}).get("lon")
            if la is None:
                continue
            name = t.get("name")
            if not name and kind != "toilets":
                continue
            wc = {"yes": 1, "designated": 1, "limited": 2, "no": 0}.get(t.get("wheelchair", ""), -1)
            addr = " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x)
            p = {"k": kind, "n": name or "Public restroom", "la": round(la, 5), "lo": round(lo, 5), "wc": wc}
            if addr: p["a"] = addr
            if t.get("opening_hours"): p["h"] = t["opening_hours"][:120]
            ph = t.get("phone") or t.get("contact:phone")
            if ph: p["p"] = ph[:30]
            if t.get("toilets:wheelchair") == "yes" or (kind == "toilets" and wc == 1): p["tw"] = 1
            if t.get("tactile_paving") == "yes": p["tp"] = 1
            if t.get("hearing_impaired") in ("yes", "designated") or t.get("hearing_loop") == "yes": p["hl"] = 1
            places.append(p)
        print(f"  {kind}: {len(places)-n0}")
        write("places.json", {"source": "OpenStreetMap contributors (ODbL), via Overpass", "fetched": time.strftime("%Y-%m-%d"), "places": places})  # save as we go
        time.sleep(1)
    write("places.json", {"source": "OpenStreetMap contributors (ODbL), via Overpass", "fetched": time.strftime("%Y-%m-%d"), "places": places})


# ------------------------------------------------------------------ climate
def export_climate():
    print("Open-Meteo climate")
    url = ("https://archive-api.open-meteo.com/v1/archive?latitude=%s&longitude=%s&start_date=2021-01-01&end_date=2025-12-31"
           "&hourly=temperature_2m,apparent_temperature&temperature_unit=fahrenheit&timezone=America%%2FNew_York") % CENTER
    h = json.loads(fetch(url, timeout=120, tries=3))["hourly"]
    acc = {k: [[[] for _ in range(24)] for _ in range(12)] for k in ("t", "f")}
    for ts, t, f in zip(h["time"], h["temperature_2m"], h["apparent_temperature"]):
        if t is None or f is None:
            continue
        m, hr = int(ts[5:7]) - 1, int(ts[11:13])
        acc["t"][m][hr].append(t); acc["f"][m][hr].append(f)
    avg = lambda a: [[round(sum(c) / len(c), 1) for c in row] for row in a]
    share = lambda a, fn: [[round(sum(1 for v in c if fn(v)) / len(c), 3) for c in row] for row in a]
    write("climate.json", {
        "source": "Open-Meteo historical archive (ERA5), downtown Atlanta, 2021-2025, deg F, local time",
        "temp": avg(acc["t"]), "feels": avg(acc["f"]),
        "hot90": share(acc["f"], lambda v: v >= 90),   # share of hours that feel like 90F+
        "hot103": share(acc["f"], lambda v: v >= 103),
        "cold32": share(acc["f"], lambda v: v <= 32),  # share of hours that feel like freezing
    })


# ------------------------------------------------------------------ counties
METRO = {"13121": "Fulton", "13089": "DeKalb", "13067": "Cobb", "13135": "Gwinnett", "13063": "Clayton",
         "13057": "Cherokee", "13097": "Douglas", "13113": "Fayette", "13151": "Henry", "13247": "Rockdale"}


def export_counties():
    print("Census counties")
    t = json.loads(fetch("https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json", timeout=120, tries=3))
    sc, tr = t["transform"]["scale"], t["transform"]["translate"]
    arcs = []
    for a in t["arcs"]:
        x = y = 0; pts = []
        for dx, dy in a:
            x += dx; y += dy
            pts.append([round(x * sc[0] + tr[0], 3), round(y * sc[1] + tr[1], 3)])
        arcs.append(pts)

    def ring(idx):
        out = []
        for i in idx:
            seg = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(seg if not out else seg[1:])
        return out
    feats = []
    for g in t["objects"]["counties"]["geometries"]:
        if g["id"] not in METRO:
            continue
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        coords = [[ring(r) for r in poly] for poly in polys]
        feats.append({"type": "Feature", "properties": {"id": g["id"], "name": METRO[g["id"]]},
                      "geometry": {"type": "MultiPolygon", "coordinates": coords}})
    write("counties.geojson", {"type": "FeatureCollection", "features": feats})


if __name__ == "__main__":
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    steps = {"counties": export_counties, "climate": export_climate, "marta": export_marta, "places": export_places}
    for name, fn in steps.items():
        if only in (None, name):
            fn()
