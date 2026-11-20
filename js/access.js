/* SUNDIAL ATL access engine: pure functions, no DOM. Works in the browser (window.ACCESS) and in Node (require).
   Inputs are the static files in data/: marta.json, places.json, climate.json.
   Every result carries a confidence tier so the UI can say what is confirmed, reported or unknown. */
(function (root) {
  'use strict';

  /* ---------- confidence tiers ---------- */
  // wc codes come from the exporters: 1 yes, 0 no, 2 limited, -1 unknown.
  // MARTA GTFS is the agency's own data, so wc=1 is "confirmed" (but says nothing about today's elevator outages).
  // OSM wheelchair tags are volunteer-mapped, so wc=1 is only "reported".
  function tier(wc, source) {
    if (wc === 0) return 'no';
    if (wc === 2) return 'limited';
    if (wc === 1) return source === 'gtfs' ? 'confirmed' : 'reported';
    return 'unknown';
  }
  const TIER_RANK = { no: 0, unknown: 1, limited: 2, reported: 3, confirmed: 4 };
  const weakest = (list) => list.reduce((a, b) => (TIER_RANK[b] < TIER_RANK[a] ? b : a), 'confirmed');

  /* ---------- who is travelling ---------- */
  // speed in m/s on level ground. heat is how fast comfort falls once it feels hot (0..1).
  // maxWalk is the longest single walk in metres the person has said is comfortable.
  const PROFILES = {
    general:    { label: 'No limits',            speed: 1.35, heat: 0.25, maxWalk: 1600, stepFree: false, needsRest: false },
    walker:     { label: 'Cane or walker',       speed: 0.80, heat: 0.65, maxWalk: 500,  stepFree: false, needsRest: true },
    wheelchair: { label: 'Wheelchair or scooter', speed: 1.10, heat: 0.55, maxWalk: 900,  stepFree: true,  needsRest: false },
    lowvision:  { label: 'Blind or low vision',  speed: 1.00, heat: 0.30, maxWalk: 800,  stepFree: false, needsRest: false },
    heart:      { label: 'Heat or heart risk',   speed: 1.00, heat: 1.00, maxWalk: 600,  stepFree: false, needsRest: true },
  };

  /* ---------- geometry ---------- */
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  function dist(a, b) { // metres, points are {lat, lon}
    const dLa = rad(b.lat - a.lat), dLo = rad(b.lon - a.lon);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // street walking is longer than the crow flies; 1.3 is a common urban detour factor
  const walkM = (a, b) => dist(a, b) * 1.3;

  /* ---------- heat ---------- */
  // Returns feels-like F, share of hours that feel 90F+, for a month (0..11) and hour (0..23).
  function climateAt(climate, month, hour) {
    return { feels: climate.feels[month][hour], temp: climate.temp[month][hour], hot90: climate.hot90[month][hour] };
  }
  // Walking slows as it feels hotter than 85F, more for heat-sensitive profiles. Floor at 45% speed.
  function heatSlowdown(feels, profile) {
    const over = Math.max(0, feels - 85);
    return Math.max(0.45, 1 - profile.heat * (over / 40));
  }
  function heatLevel(feels, profile) {
    const f = feels + (profile.heat > 0.8 ? 6 : profile.heat > 0.5 ? 3 : 0); // vulnerable people feel it sooner
    if (f >= 103) return 'danger';
    if (f >= 94) return 'high';
    if (f >= 85) return 'moderate';
    if (f <= 32) return 'cold';
    return 'ok';
  }
  function walkMinutes(metres, profile, feels) {
    const v = profile.speed * heatSlowdown(feels == null ? 70 : feels, profile);
    return metres / v / 60;
  }

  /* "Right hour": rank the hours of the day for a month so people pick when to go, not just where.
     Daylight hours only by default. Lower score is better. */
  function bestHours(climate, month, profile, opts) {
    const from = (opts && opts.from) ?? 7, to = (opts && opts.to) ?? 19;
    const rows = [];
    for (let h = from; h <= to; h++) {
      const c = climateAt(climate, month, h);
      const hot = Math.max(0, c.feels - 80);
      const cold = Math.max(0, 40 - c.feels);
      const score = hot * (0.5 + profile.heat) + cold * 0.8 + c.hot90 * 20 * profile.heat;
      rows.push({ hour: h, feels: c.feels, hot90: c.hot90, level: heatLevel(c.feels, profile), score: +score.toFixed(2) });
    }
    const ranked = rows.slice().sort((a, b) => a.score - b.score);
    // best contiguous 3-hour window
    let best = null;
    for (let i = 0; i + 2 < rows.length; i++) {
      const s = rows[i].score + rows[i + 1].score + rows[i + 2].score;
      if (!best || s < best.score) best = { start: rows[i].hour, end: rows[i + 2].hour + 1, score: s };
    }
    return { hours: rows, ranked, window: best };
  }

  /* ---------- nearest things ---------- */
  function nearestStations(pt, stations, opts) {
    const o = Object.assign({ n: 3, railOnly: true, stepFree: false }, opts);
    return stations
      .filter((s) => (!o.railOnly || s.rail) && (!o.stepFree || s.wc !== 0))
      .map((s) => ({ station: s, m: walkM(pt, s) }))
      .sort((a, b) => a.m - b.m)
      .slice(0, o.n);
  }

  /* Rank places of one kind (hospital, pharmacy, toilets...) for a person right now. */
  function rankPlaces(places, origin, ctx) {
    const { profile, climate, month, hour, kind } = ctx;
    const feels = climate ? climateAt(climate, month, hour).feels : 70;
    return places
      .filter((p) => !kind || p.k === kind)
      .map((p) => {
        const m = walkM(origin, { lat: p.la, lon: p.lo });
        const t = tier(p.wc, 'osm');
        const mins = walkMinutes(m, profile, feels);
        // Minutes-equivalent cost of an access doubt. Step-free travellers can't gamble on "unknown", so it costs more.
        const barrier = t === 'no' ? 1000 : t === 'unknown' ? (profile.stepFree ? 15 : 5) : t === 'limited' ? (profile.stepFree ? 25 : 8) : 0;
        const tooFar = m > profile.maxWalk ? 6 : 0;
        return { place: p, metres: Math.round(m), minutes: Math.round(mins), tier: t, score: mins + barrier + tooFar };
      })
      .sort((a, b) => a.score - b.score);
  }

  /* ---------- trip planner ---------- */
  const RAIL_MS = 11;          // average rail speed incl. stops, m/s (about 25 mph)
  const WAIT_MIN = 6;          // typical headway wait
  const TRANSFER_MIN = 8;
  const NS = ['RED', 'GOLD'], EW = ['BLUE', 'GREEN'];
  const shared = (a, b) => a.some((l) => b.includes(l));

  function railLegs(a, b) {
    const km = dist(a, b);
    const same = shared(a.lines, b.lines);
    const transfer = same ? 0 : TRANSFER_MIN;
    return {
      minutes: km / RAIL_MS / 60 + WAIT_MIN + transfer,
      transfer: !same,
      note: same ? null : 'Change trains at Five Points (north-south to east-west). Use the elevator, not the stairs.',
    };
  }

  /* plan({from, to}, {stations}, {profile, climate, month, hour}) -> up to 2 options, best first.
     Options: walk the whole way (if reasonable), or walk + MARTA rail + walk. */
  function plan(trip, data, ctx) {
    const { profile, climate, month, hour } = ctx;
    const feels = climate ? climateAt(climate, month, hour).feels : 70;
    const level = heatLevel(feels, profile);
    const out = [];

    const direct = walkM(trip.from, trip.to);
    if (direct <= profile.maxWalk * 1.5) {
      out.push({
        kind: 'walk', totalMin: Math.round(walkMinutes(direct, profile, feels)), walkMetres: Math.round(direct),
        exposedMin: Math.round(walkMinutes(direct, profile, feels)), legs: [{ type: 'walk', metres: Math.round(direct), to: 'destination' }],
        tier: 'unknown', caveats: ['Sidewalk quality and curb ramps are not in the data. Check the route before you go.'],
      });
    }

    const fromS = nearestStations(trip.from, data.stations, { n: 2, stepFree: profile.stepFree });
    const toS = nearestStations(trip.to, data.stations, { n: 2, stepFree: profile.stepFree });
    let bestRail = null;
    for (const a of fromS) for (const b of toS) {
      if (a.station.id === b.station.id) continue;
      const r = railLegs(a.station, b.station);
      const w1 = walkMinutes(a.m, profile, feels), w2 = walkMinutes(b.m, profile, feels);
      const total = w1 + r.minutes + w2;
      if (!bestRail || total < bestRail.total) bestRail = { a, b, r, w1, w2, total };
    }
    if (bestRail) {
      const { a, b, r, w1, w2, total } = bestRail;
      const caveats = ['Elevator and escalator outages are not live here. Check MARTA service alerts before you leave.'];
      if (r.note) caveats.push(r.note);
      const longWalk = Math.max(a.m, b.m) > profile.maxWalk;
      if (longWalk) caveats.push(`One walk is over ${profile.maxWalk} m, longer than you said is comfortable.`);
      const tiers = [tier(a.station.wc, 'gtfs'), tier(b.station.wc, 'gtfs'), 'unknown'];
      out.push({
        kind: 'rail', totalMin: Math.round(total), walkMetres: Math.round(a.m + b.m), exposedMin: Math.round(w1 + w2),
        legs: [
          { type: 'walk', metres: Math.round(a.m), to: a.station.name },
          { type: 'rail', from: a.station.name, to: b.station.name, lines: a.station.lines, transfer: r.transfer },
          { type: 'walk', metres: Math.round(b.m), to: 'destination' },
        ],
        tier: weakest(tiers.slice(0, 2)), caveats, longWalk,
      });
    }

    out.forEach((o) => {
      o.heat = level;
      if (level === 'danger' || level === 'high') o.caveats.push(`It will feel like ${Math.round(feels)}F. Go earlier or later, and plan shade and water.`);
      if (level === 'cold') o.caveats.push('It will feel near freezing. Check for ice on ramps and crossings.');
      // comfort first: penalise minutes outside, and long walks, over raw time
      o.score = o.totalMin + o.exposedMin * (0.5 + profile.heat) + (o.longWalk ? 25 : 0) + (o.kind === 'walk' && o.walkMetres > profile.maxWalk ? 20 : 0);
    });
    return out.sort((a, b) => a.score - b.score);
  }

  const api = { tier, TIER_RANK, weakest, PROFILES, dist, walkM, climateAt, heatSlowdown, heatLevel, walkMinutes,
    bestHours, nearestStations, rankPlaces, plan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACCESS = api;
})(typeof window !== 'undefined' ? window : globalThis);
