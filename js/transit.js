/* SUNDIAL ATL transit planner: real MARTA rail timetables (data/rail.json) + walking to and from stations.
   Pure functions, no DOM. Browser: window.TRANSIT. Node: require('./transit.js').
   Method: RAPTOR (earliest arrival by rounds of one ride each) from the nearest few stations to the destination,
   then every candidate trip is scored for the traveller: heat, walking, transfers and unconfirmed access count against it.
   Not included: MARTA buses, streetcar, live delays, live elevator status. The UI says so. */
(function (root) {
  'use strict';
  const A = typeof module !== 'undefined' && module.exports ? require('./access.js') : root.ACCESS;
  const INF = 1e9;
  const CUSHION = 3;          // minutes to spare when you step onto the platform
  const lower = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; };

  function create(rail, marta) {
    const stations = marta.stations.filter((s) => s.rail);
    const byId = new Map(stations.map((s) => [s.id, s]));
    const pats = rail.patterns.map((p, i) => Object.assign({ i }, p));
    const starts = {};
    for (const d of Object.keys(rail.trips)) {
      starts[d] = pats.map(() => []);
      for (const [pi, t] of rail.trips[d]) starts[d][pi].push(t);
      starts[d].forEach((l) => l.sort((a, b) => a - b));
    }
    const dayKind = (date) => { const g = date.getDay(); return g === 0 ? 'su' : g === 6 ? 'sa' : 'wk'; };
    const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const inFeed = (date) => iso(date) >= rail.valid[0] && iso(date) <= rail.valid[1];
    const name = (id) => byId.get(id).name.replace(/ Station$/, '');

    /* One RAPTOR run from a source station. Returns a function that rebuilds the rides to any station reached. */
    function raptor(day, src, t0, ok, transferBuf, maxRides) {
      const best = new Map([[src, t0]]);
      let prev = new Map([[src, t0]]);
      const rounds = [prev], parents = [new Map()];
      for (let k = 1; k <= maxRides; k++) {
        const cur = new Map(), par = new Map();
        for (const p of pats) {
          const list = starts[day][p.i];
          let trip = null;
          for (let i = 0; i < p.stops.length; i++) {
            const s = p.stops[i];
            if (trip) {
              const arr = trip.start + p.off[i];
              if (ok(s) && arr < (best.has(s) ? best.get(s) : INF)) {
                best.set(s, arr); cur.set(s, arr);
                par.set(s, { pat: p.i, start: trip.start, bi: trip.bi, ai: i });
              }
            }
            const pa = prev.get(s);
            if (pa !== undefined && ok(s)) {
              const bt = pa + (k === 1 ? 0 : transferBuf);
              const j = lower(list, bt - p.off[i]);
              if (j < list.length && (!trip || list[j] < trip.start)) trip = { start: list[j], bi: i };
            }
          }
        }
        if (!cur.size) break;
        parents.push(par); rounds.push(cur); prev = cur;
      }
      return {
        arrival: (s) => (best.has(s) ? best.get(s) : INF),
        rides(dest) {
          const out = [];
          let s = dest, r = parents.length - 1;
          for (;;) {
            while (r >= 1 && !parents[r].has(s)) r--;   // latest round that improved this station
            if (r < 1) break;
            const q = parents[r].get(s);
            out.unshift(q);
            s = pats[q.pat].stops[q.bi];                // we boarded here, reached in an earlier round
            r--;
          }
          return out;
        },
      };
    }

    /* plan({from, to, date, minutes, mode}, ctx) -> {options:[...], notes:[...]} or {error}
       from/to: {lat, lon, label}. date: JS Date for the day. minutes: minutes after midnight, the time you want to leave
       (mode 'depart') or be there (mode 'arrive'). ctx: {profile, climate, avoid:Set of station ids}. */
    function plan(q, ctx) {
      const profile = ctx.profile, avoid = ctx.avoid || new Set(), day = dayKind(q.date);
      const mode = q.mode || 'depart';
      const month = q.date.getMonth();
      const feelsAt = (m) => ctx.climate ? A.climateAt(ctx.climate, month, Math.min(23, Math.max(0, Math.floor(m / 60) % 24))).feels : 70;
      const ok = (s) => !avoid.has(s);
      const buf = profile.stepFree || profile.needsRest ? 6 : 4;
      const from = { lat: q.from.lat, lon: q.from.lon }, to = { lat: q.to.lat, lon: q.to.lon };
      const access = A.nearestStations(from, stations.filter((s) => ok(s.id)), { n: 4, stepFree: profile.stepFree });
      const egress = A.nearestStations(to, stations.filter((s) => ok(s.id)), { n: 4, stepFree: profile.stepFree });
      const wmin = (m, atMin) => A.walkMinutes(m, profile, feelsAt(atMin));

      const cands = [];
      const direct = A.walkM(from, to);
      if (direct <= Math.max(profile.maxWalk * 1.2, 450)) {
        const t = wmin(direct, q.minutes);
        const leave = mode === 'depart' ? q.minutes : q.minutes - t;
        cands.push(finish({ kind: 'walk', leave, arrive: leave + t, legs: [{ type: 'walk', metres: Math.round(direct), min: t, to: q.to.label, fromPt: from, toPt: to }], walkM: direct, walkMin: t, wait: 0, transfers: 0, ids: [] }));
      }

      const earliest = mode === 'depart' ? [q.minutes] : (() => { const o = []; for (let t = q.minutes - 150; t <= q.minutes; t += 5) o.push(t); return o; })();
      for (const a of access) {
        const wA = wmin(a.m, q.minutes);
        for (const t of earliest) {
          const R = raptor(day, a.station.id, t + wA, ok, buf, 4);
          for (const e of egress) {
            if (e.station.id === a.station.id) continue;
            const arr = R.arrival(e.station.id);
            if (arr >= INF) continue;
            const rides = R.rides(e.station.id);
            if (!rides.length) continue;
            const wE = wmin(e.m, arr);
            const first = rides[0], dep0 = first.start + pats[first.pat].off[first.bi];
            const leave = Math.max(mode === 'depart' ? q.minutes : -INF, dep0 - wA - CUSHION);
            const arrive = arr + wE;
            if (mode === 'arrive' && arrive > q.minutes) continue;
            const legs = [{ type: 'walk', metres: Math.round(a.m), min: wA, to: name(a.station.id), fromPt: from, toPt: a.station }];
            let wait = Math.max(0, dep0 - (leave + wA)), transfers = 0, prevArr = null;
            const ids = [a.station.id];
            legs.push({ type: 'wait', min: wait, at: name(a.station.id) });
            rides.forEach((r, n) => {
              const p = pats[r.pat], dep = r.start + p.off[r.bi], ar = r.start + p.off[r.ai];
              if (n > 0) { const w = dep - prevArr; transfers++; wait += w; legs.push({ type: 'transfer', min: w, at: name(p.stops[r.bi]) }); }
              const stopIds = p.stops.slice(r.bi, r.ai + 1); stopIds.forEach((s) => ids.push(s));
              legs.push({ type: 'rail', line: p.line, color: rail.colors[p.line], toward: name(p.stops[p.stops.length - 1]), from: name(p.stops[r.bi]), to: name(p.stops[r.ai]), dep, arr: ar, stops: stopIds, count: r.ai - r.bi });
              prevArr = ar;
            });
            legs.push({ type: 'walk', metres: Math.round(e.m), min: wE, to: q.to.label, fromPt: e.station, toPt: to });
            const boardIds = [a.station.id, e.station.id, ...rides.slice(1).map((r) => pats[r.pat].stops[r.bi])];
            cands.push(finish({ kind: 'rail', leave, arrive, legs, walkM: a.m + e.m, walkMin: wA + wE, wait, transfers, ids, boardIds, maxWalkLeg: Math.max(a.m, e.m) }));
          }
        }
      }
      if (!cands.length) return { error: 'No MARTA rail trip was found for that time. Rail runs roughly 5 AM to 1 AM. Try another time, or use MARTA Mobility or a ride.' };

      function finish(j) {
        const f = feelsAt(j.leave);
        j.feels = f; j.heat = A.heatLevel(f, profile);
        const tiers = (j.boardIds || []).map((id) => A.tier(byId.get(id).wc, 'gtfs'));
        j.tier = tiers.length ? A.weakest(tiers) : 'unknown';
        j.total = j.arrive - j.leave;
        const longWalk = j.kind === 'walk' ? Math.max(0, j.walkM - profile.maxWalk) : Math.max(0, (j.maxWalkLeg || 0) - profile.maxWalk);
        j.longWalk = longWalk > 0;
        const tierPen = (profile.stepFree && (j.tier === 'unknown' || j.tier === 'limited')) ? 20 : (j.tier === 'no' ? 500 : 0);
        j.cost = j.total + j.walkMin * (0.5 + profile.heat) * (f >= 94 ? 1.6 : 1) + j.transfers * (profile.needsRest || profile.stepFree ? 7 : 3) + (longWalk ? 15 + longWalk / 50 : 0) + tierPen
          + (mode === 'arrive' ? Math.max(0, q.minutes - j.arrive) * 0.35 : 0); // arriving long before you need to is a small cost
        return j;
      }
      const uniq = (list) => { const seen = new Set(); return list.filter((j) => { const k = j.kind + '|' + Math.round(j.leave / 2) + '|' + (j.ids || []).join(','); if (seen.has(k)) return false; seen.add(k); return true; }); };
      const pool = uniq(cands);
      const by = (fn) => pool.slice().sort((x, y) => fn(x) - fn(y) || x.cost - y.cost)[0];
      const bestOne = by((j) => j.cost);
      // among arrive-by options we want the LATEST leave that still gets you there, so ties favour later leaving
      const tie = (fn) => (j) => fn(j) - (mode === 'arrive' ? j.leave / 10000 : 0);
      const fastest = by(tie((j) => j.total)), gentlest = by(tie((j) => j.walkM));
      const options = [];
      const add = (j, label, why) => { if (j && !options.some((o) => o.sig === sig(j))) options.push(Object.assign(j, { label, why, sig: sig(j) })); };
      const sig = (j) => j.kind + '|' + (j.ids || []).join(',') + '|' + Math.round(j.leave);
      add(bestOne, 'Recommended', 'Best balance of time, walking, heat and transfers for you.');
      add(fastest, 'Fastest', 'Gets you there soonest.');
      add(gentlest, 'Least walking', 'Shortest walks to and from the stations.');
      const notes = [];
      if (!inFeed(q.date)) notes.push(`MARTA's published schedule covers ${rail.valid[0]} to ${rail.valid[1]}. For ${iso(q.date)} we assume the usual ${day === 'wk' ? 'weekday' : day === 'sa' ? 'Saturday' : 'Sunday'} service. Check for holiday or construction changes.`);
      return { options, notes, day, valid: rail.valid };
    }

    return { plan, stations, byId, dayKind, inFeed, iso };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TRANSIT = api;
})(typeof window !== 'undefined' ? window : globalThis);
