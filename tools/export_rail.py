#!/usr/bin/env python3
"""Export MARTA rail timetables from the public GTFS feed to data/rail.json, for the trip planner.

What it writes (small, because trips on a rail line repeat the same station pattern all day):
  patterns: one per line + direction + stop list: ordered station ids and minutes after the first stop
  trips:    for weekday / saturday / sunday: [pattern index, first departure in minutes after midnight], sorted
  valid:    first and last date the feed covers

Usage:  python3 tools/export_rail.py [path/to/google_transit.zip]
Without an argument it downloads MARTA's feed. Needs data/marta.json to exist (run export_atlanta.py --only marta first).
Nothing here needs an API key.
"""
import csv, io, json, os, statistics, sys, urllib.request, zipfile, collections

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data")
FEED = "https://itsmarta.com/google_transit_feed/google_transit.zip"
UA = "atl-access-hackathon/0.1 (student project; open data export)"


def mins(t):
    h, m, s = (int(x) for x in t.strip().split(":"))
    return h * 60 + m + s / 60


def main():
    if len(sys.argv) > 1:
        raw = open(sys.argv[1], "rb").read()
    else:
        req = urllib.request.Request(FEED, headers={"User-Agent": UA})
        raw = urllib.request.urlopen(req, timeout=180).read()
    z = zipfile.ZipFile(io.BytesIO(raw))
    rd = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig"))

    stations = {s["id"] for s in json.load(open(os.path.join(OUT, "marta.json")))["stations"] if s["rail"]}
    routes = {r["route_id"]: r for r in rd("routes.txt") if r["route_type"] == "1"}
    stops = {s["stop_id"]: s for s in rd("stops.txt")}
    parent = {i: s["parent_station"] for i, s in stops.items() if s.get("parent_station")}

    day_of = {}
    valid = ["9999-12-31", "0000-01-01"]
    for c in rd("calendar.txt"):
        wk = any(c[d] == "1" for d in ("monday", "tuesday", "wednesday", "thursday", "friday"))
        kind = "wk" if wk else "sa" if c["saturday"] == "1" else "su" if c["sunday"] == "1" else None
        if kind:
            day_of[c["service_id"]] = kind
            f = lambda d: f"{d[:4]}-{d[4:6]}-{d[6:]}"
            valid = [min(valid[0], f(c["start_date"])), max(valid[1], f(c["end_date"]))]

    trips = {t["trip_id"]: t for t in rd("trips.txt") if t["route_id"] in routes and t["service_id"] in day_of}
    times = collections.defaultdict(list)
    for st in rd("stop_times.txt"):
        if st["trip_id"] in trips:
            sid = parent.get(st["stop_id"], st["stop_id"])
            if sid in stations:
                times[st["trip_id"]].append((int(st["stop_sequence"]), sid, mins(st["departure_time"])))

    pats = {}      # (line, dir, stops) -> list of offset lists
    runs = collections.defaultdict(list)  # day kind -> [(pattern key, start)]
    for tid, rows in times.items():
        rows.sort()
        stops_ = tuple(r[1] for r in rows)
        if len(stops_) < 2:
            continue
        t0 = rows[0][2]
        tr = trips[tid]
        key = (routes[tr["route_id"]]["route_short_name"], int(tr["direction_id"]), stops_)
        pats.setdefault(key, []).append([r[2] - t0 for r in rows])
        runs[day_of[tr["service_id"]]].append((key, t0))

    keys = sorted(pats, key=lambda k: (k[0], k[1], -len(k[2])))
    index = {k: i for i, k in enumerate(keys)}
    head = {}
    for t in trips.values():
        head.setdefault((routes[t["route_id"]]["route_short_name"], int(t["direction_id"])), t["trip_headsign"])
    patterns = []
    for k in keys:
        off = [round(statistics.median(col), 1) for col in zip(*pats[k])]
        patterns.append({"line": k[0], "dir": k[1], "head": head.get((k[0], k[1]), ""), "stops": list(k[2]), "off": off, "n": len(pats[k])})
    out_trips = {d: sorted([[index[k], round(t0, 1)] for k, t0 in v], key=lambda x: x[1]) for d, v in runs.items()}
    colors = {r["route_short_name"]: "#" + r["route_color"] for r in routes.values()}
    obj = {"source": "MARTA GTFS (itsmarta.com/google_transit_feed)", "valid": valid, "colors": colors, "patterns": patterns, "trips": out_trips}
    p = os.path.join(OUT, "rail.json")
    with open(p, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    print(f"wrote rail.json: {os.path.getsize(p)/1024:.0f} KB, {len(patterns)} patterns, trips " + ", ".join(f"{k}={len(v)}" for k, v in out_trips.items()), "valid", valid)


if __name__ == "__main__":
    main()
