/* Rullaggio: legge l'istruzione dell'ATC ("Taxi to holding point Alpha 2, runway 16L, via Bravo"),
   costruisce il grafo dei taxiway dai dati OpenStreetMap dell'aeroporto e calcola il percorso che segue
   i taxiway nell'ordine dato dall'ATC. Modulo puro (usato anche dal server per compattare i dati). */
(function (root) {
  'use strict';

  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const R = isNode ? require('./readback.js') : root.Readback;
  const G = isNode ? require('./geo.js') : root.Geo;

  // "Alpha 2" -> "A2", "Bravo" -> "B", "B1" -> "B1"
  function refOf(words) {
    const out = [];
    for (const w of String(words || '').trim().split(/\s+/)) {
      const lw = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!lw) continue;
      if (R.PHONETIC[lw]) out.push(R.PHONETIC[lw]);
      else if (/^[a-z]{1,2}\d{0,2}$/.test(lw) || /^\d{1,2}$/.test(lw)) out.push(lw.toUpperCase());
      else return null;
    }
    const s = out.join('');
    return /^[A-Z]{1,2}\d{0,2}$/.test(s) ? s : null;
  }

  /* parts: le parti del readback (Readback.generateReadback(...).parts)
     -> { target: { kind: 'holding'|'runway'|'stand', ref, runway }, via: ['B', 'A'], holdShort: ['07'], cross: ['23'] } o null */
  function parseClearance(parts) {
    const taxi = (parts || []).find((p) => p.type === 'taxi');
    if (!taxi) return null;
    const d = String(taxi.display || '');
    const plan = { target: null, via: [], holdShort: [], cross: [] };
    let m;
    const rw = (x) => x.toUpperCase().replace(/^(\d)(?=[LRC]?$)/, '0$1');
    const runway = (m = d.match(/runway (\d{1,2}[LRC]?)/i)) ? rw(m[1]) : null;
    if ((m = d.match(/holding point ([A-Za-z]+(?: \d{1,2})?)/i))) plan.target = { kind: 'holding', ref: refOf(m[1]), runway };
    else if ((m = d.match(/(?:stand|gate|parking(?: position)?) ([A-Z0-9]{1,4})/i))) plan.target = { kind: 'stand', ref: m[1].toUpperCase() };
    else if (runway) plan.target = { kind: 'runway', ref: null, runway };
    // "via Bravo 3 and Charlie", "via November, Alpha"
    if ((m = d.match(/via (.+?)(?= to | cross| hold|$)/i))) {
      for (const chunk of m[1].split(/,|\band\b|\bthen\b/i)) {
        const r = refOf(chunk);
        if (r) plan.via.push(r);
      }
    }
    for (const x of d.matchAll(/cross(?:ing)? runway (\d{1,2}[LRC]?)/gi)) plan.cross.push(rw(x[1]));
    for (const p of parts) {
      if (p.type === 'runway' && (m = String(p.display).match(/hold(?:ing)? short (?:of )?runway (\d{1,2}[LRC]?)/i))) plan.holdShort.push(rw(m[1]));
    }
    return plan.target || plan.via.length ? plan : null;
  }

  /* Risposta di Overpass -> formato compatto
     { nodes: { id: [lat, lon] }, ways: [{ kind: 'taxiway'|'taxilane'|'runway', ref, nodes: [id] }], points: [{ kind, ref, lat, lon }] } */
  function compactOverpass(json) {
    const nodes = {};
    const ways = [];
    const points = [];
    for (const el of (json && json.elements) || []) {
      if (el.type === 'node' && typeof el.lat === 'number') {
        nodes[el.id] = [Math.round(el.lat * 1e7) / 1e7, Math.round(el.lon * 1e7) / 1e7];
        const k = el.tags && el.tags.aeroway;
        if (k === 'holding_position' || k === 'parking_position' || k === 'gate') points.push({ kind: k === 'holding_position' ? 'holding' : 'stand', ref: String(el.tags.ref || '').toUpperCase(), lat: el.lat, lon: el.lon, node: el.id });
      }
      if (el.type === 'way' && el.tags && el.nodes) {
        const k = el.tags.aeroway;
        if (k === 'taxiway' || k === 'taxilane' || k === 'runway') ways.push({ kind: k, ref: String(el.tags.ref || '').toUpperCase(), nodes: el.nodes });
      }
    }
    for (const w of ways) w.nodes = w.nodes.filter((id) => nodes[id]);
    return { nodes, ways: ways.filter((w) => w.nodes.length > 1), points };
  }

  // Le designazioni di una pista: "16L/34R" -> ["16L", "34R"]
  const runwayIds = (ref) => String(ref || '').toUpperCase().split(/[/\s-]+/).filter(Boolean);
  const pos = (g, id) => ({ lat: g.nodes[id][0], lon: g.nodes[id][1] });

  function buildGraph(ground) {
    const adj = new Map();
    const add = (a, b, w) => {
      const d = G.distance(pos(ground, a), pos(ground, b)) * 1852;
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push({ to: b, d, ref: w.ref, kind: w.kind });
    };
    for (const w of ground.ways) {
      for (let i = 1; i < w.nodes.length; i++) { add(w.nodes[i - 1], w.nodes[i], w); add(w.nodes[i], w.nodes[i - 1], w); }
    }
    return { ground, adj };
  }

  function nearestNode(graph, p, filter) {
    let best = null;
    let bd = Infinity;
    for (const id of graph.adj.keys()) {
      if (filter && !filter(id)) continue;
      const d = G.distance(p, pos(graph.ground, id)) * 1852;
      if (d < bd) { bd = d; best = id; }
    }
    return best === null ? null : { id: best, d: bd };
  }

  // Coda con priorità minimale
  function heap() {
    const a = [];
    return {
      get size() { return a.length; },
      push(x) { a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].c <= a[i].c) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } },
      pop() {
        const top = a[0]; const last = a.pop();
        if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i; if (l < a.length && a[l].c < a[m].c) m = l; if (r < a.length && a[r].c < a[m].c) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
        return top;
      },
    };
  }

  // Nodi di arrivo per l'istruzione
  function targetNodes(graph, plan) {
    const g = graph.ground;
    const t = plan.target;
    const inGraph = (id) => graph.adj.has(id);
    if (!t) return [];
    if (t.kind === 'holding' && t.ref) {
      const hp = g.points.filter((p) => p.kind === 'holding' && p.ref === t.ref);
      const out = [];
      for (const p of hp) {
        if (inGraph(p.node)) out.push(p.node);
        else { const n = nearestNode(graph, p); if (n && n.d < 60) out.push(n.id); }
      }
      if (out.length) return out;
    }
    if (t.kind === 'stand' && t.ref) {
      const st = g.points.filter((p) => p.kind === 'stand' && p.ref === t.ref);
      const out = st.map((p) => (inGraph(p.node) ? p.node : (nearestNode(graph, p) || {}).id)).filter((x) => x !== undefined && x !== null);
      if (out.length) return out;
    }
    // Pista (anche come ripiego per un punto attesa senza dati): nodi dei taxiway che toccano quella pista
    const rwy = t.runway;
    if (rwy) {
      const onRunway = new Set();
      for (const w of g.ways) if (w.kind === 'runway' && runwayIds(w.ref).includes(rwy)) w.nodes.forEach((id) => onRunway.add(id));
      const out = [];
      for (const id of onRunway) if ((graph.adj.get(id) || []).some((e) => e.kind !== 'runway')) out.push(id);
      return out;
    }
    return [];
  }

  /* Percorso: Dijkstra sugli stati (nodo, tappa). Tappa k = sto percorrendo plan.via[k];
     prima della prima tappa e dopo l'ultima si può usare qualsiasi taxiway (con un costo maggiore). */
  function route(graph, start, plan) {
    const via = plan.via || [];
    const s0 = nearestNode(graph, start, (id) => (graph.adj.get(id) || []).some((e) => e.kind !== 'runway'));
    if (!s0 || s0.d > 800) return { ok: false, reason: 'far', points: [] };
    const missing = via.filter((r) => !graph.ground.ways.some((w) => w.ref === r && w.kind !== 'runway'));
    const stages = via.filter((r) => !missing.includes(r));
    const last = stages.length; // tappa finale: verso la destinazione
    let targets = new Set(targetNodes(graph, plan));
    let endStage = last;
    if (!targets.size && stages.length) {
      // destinazione sconosciuta: si arriva sull'ultimo taxiway indicato
      graph.ground.ways.filter((w) => w.ref === stages[last - 1]).forEach((w) => w.nodes.forEach((id) => targets.add(id)));
      endStage = last - 1;
    }
    if (!targets.size) return { ok: false, reason: 'notarget', points: [], missing };
    const free = (e) => e.kind !== 'runway';
    const cost = new Map();
    const prev = new Map();
    const key = (n, k) => `${n}|${k}`;
    const q = heap();
    const k0 = stages.length ? -1 : last;
    q.push({ n: s0.id, k: k0, c: 0 });
    cost.set(key(s0.id, k0), 0);
    // taxiway che passano per ogni nodo: all'incrocio si passa alla tappa successiva senza costo
    const refsAt = new Map();
    for (const w of graph.ground.ways) if (w.kind !== 'runway') for (const id of w.nodes) { if (!refsAt.has(id)) refsAt.set(id, new Set()); refsAt.get(id).add(w.ref); }
    const relax = (n, k, c, from) => {
      const nk = key(n, k);
      if (c < (cost.has(nk) ? cost.get(nk) : Infinity)) { cost.set(nk, c); prev.set(nk, from); q.push({ n, k, c }); }
    };
    let end = null;
    while (q.size) {
      const cur = q.pop();
      const ck = key(cur.n, cur.k);
      if (cur.c > cost.get(ck)) continue;
      if ((cur.k === endStage || cur.k === last) && targets.has(cur.n)) { end = cur; break; }
      const here = refsAt.get(cur.n);
      if (here && cur.k < last && (cur.k + 1 === last ? cur.k >= 0 && here.has(stages[cur.k]) : here.has(stages[cur.k + 1]))) {
        relax(cur.n, cur.k + 1, cur.c, ck);
      }
      for (const e of graph.adj.get(cur.n) || []) {
        const moves = [];
        if (e.kind === 'runway') {
          // attraversare una pista si può (e si segnala), percorrerla no
          if (e.d < 120 && (graph.adj.get(e.to) || []).some((x) => x.kind !== 'runway')) moves.push([cur.k, 4]);
        } else if (cur.k === -1) {
          moves.push(e.ref === stages[0] ? [0, 1] : [-1, 3]);
        } else if (cur.k < last) {
          if (e.ref === stages[cur.k]) moves.push([cur.k, 1]);
          if (cur.k + 1 < last && e.ref === stages[cur.k + 1]) moves.push([cur.k + 1, 1]);
          if (cur.k + 1 === last && free(e)) moves.push([last, 2.5]);
        } else {
          moves.push([last, 2.5]);
        }
        for (const [k, mult] of moves) relax(e.to, k, cur.c + e.d * mult, ck);
      }
    }
    if (!end) return { ok: false, reason: 'noroute', points: [], missing };
    const ids = [];
    for (let k = key(end.n, end.k); k; k = prev.get(k)) {
      const id = Number(k.split('|')[0]);
      if (ids[0] !== id) ids.unshift(id); // i cambi di tappa restano sullo stesso nodo
    }
    const points = ids.map((id) => graph.ground.nodes[id]);
    // Piste attraversate lungo il percorso (non quella di destinazione)
    const crossings = [];
    const dest = plan.target && plan.target.runway;
    for (const w of graph.ground.ways) {
      if (w.kind !== 'runway' || (dest && runwayIds(w.ref).includes(dest))) continue;
      const hit = ids.find((id) => w.nodes.includes(id));
      if (hit !== undefined) crossings.push({ runway: w.ref, at: graph.ground.nodes[hit] });
    }
    let length = 0;
    for (let i = 1; i < points.length; i++) length += G.distance({ lat: points[i - 1][0], lon: points[i - 1][1] }, { lat: points[i][0], lon: points[i][1] }) * 1852;
    return { ok: true, points, length: Math.round(length), crossings, missing, end: graph.ground.nodes[end.n] };
  }

  // Taxiway citati (per evidenziarli quando il percorso non si può calcolare)
  function namedWays(ground, plan) {
    const refs = new Set(plan.via || []);
    return ground.ways.filter((w) => w.kind !== 'runway' && refs.has(w.ref)).map((w) => w.nodes.map((id) => ground.nodes[id]));
  }

  // Richiesta Overpass per lo schema di un aeroporto (piste, taxiway, punti attesa, stand nel raggio di 4,5 km)
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  function overpassQuery(lat, lon) {
    return `[out:json][timeout:25];(way["aeroway"~"^(taxiway|taxilane|runway)$"](around:4500,${lat},${lon});`
      + `node["aeroway"~"^(holding_position|parking_position|gate)$"](around:4500,${lat},${lon}););out body;>;out skel qt;`;
  }

  const api = { refOf, parseClearance, compactOverpass, buildGraph, route, namedWays, runwayIds, overpassQuery, OVERPASS };
  if (isNode && module.exports) module.exports = api;
  else root.Taxi = api;
})(this);
