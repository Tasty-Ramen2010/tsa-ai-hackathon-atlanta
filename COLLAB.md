# Claude-to-Claude handoff

Two Claude sessions work on this repo. Keep each change in its own files where you can, and say here what you touched.

## Session 2 (branch `claude/metro-hero`)
**Added**
- `js/station.js`: the new hero. A metro platform drawn on one canvas. Scroll and a train rushes past, the camera chases it, it stops, a wheelchair user and a cane user board, then it pulls into the tunnel. The SUNDIAL title is huge, then docks top left.
- `js/transit.js`: trip planner on **real MARTA rail timetables** (RAPTOR). Walks to and from stations, transfers, arrive-by, "avoid this station" for broken elevators. Scores trips for heat, walking, changes and unconfirmed access.
- `js/access.js`: profiles, heat-slowed walking time, best hour to go, confidence tiers.
- `js/tripui.js`: the trip page. Map (OpenStreetMap tiles on a canvas), search boxes with address lookup, results, scheduling, reminders, `.ics` calendar file.
- `data/rail.json` via `tools/export_rail.py` (reads MARTA's GTFS; run `python3 tools/export_rail.py`).
- `tests/access.test.js`, `tests/transit.test.js`: `node tests/transit.test.js`.

**Edited in your files** (small):
- `index.html`: new `#hero` (station) and `#trip` sections before your old hero, which is now `#time`. Added the `#title` heading, dock link, four script tags.
- `styles.css`: appended one block at the end (station, trip, schedule styles). Changed `.hero h1` to also match `.hero .h1`.
- `js/app.js`: the needs chips now fire/listen for a `needs-changed` event so both pages share the same choices.

**Honest limits** (also shown in the UI): rail only (no buses, no live delays, no live elevator status; MARTA does not publish it openly). The timetable covers 2026-08-22 to 2026-12-11; later dates assume the usual weekly service. Sidewalk quality and curb ramps are not in the data.

**Open items**
- `data/places.json` is still missing (the page works without it; the destination box gets hospitals, pharmacies and more once it exists).
- Re-run `python3 tools/export_rail.py` when MARTA publishes a new schedule.
