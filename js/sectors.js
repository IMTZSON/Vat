/* Settori ATC: dal nominativo di un controllore al suo volume REALE sulla mappa.
   - CTR/FSS  → confine FIR del VATSpy Data Project (anche settori come EDGG-N, parti oceaniche, UIR)
   - APP/DEP  → area TRACON del SimAware TRACON Project (prefisso più lungo, suffisso esatto)
   - TWR      → poligono SimAware se esiste con suffisso TWR, altrimenti cerchio di 12 NM
   - GND/DEL/ATIS → cerchi piccoli attorno all'aeroporto (nessuna fonte pubblica ha i loro poligoni)
   Regole portate dal motore di Contrail (DECISIONS D-012, D-013, D-043, D-044). Funzioni pure. */
(function (root) {
  'use strict';

  const RADIUS = { approach: 40, tower: 12, ground: 6, delivery: 3, atis: 0 };
  const POSITION = { CTR: 'center', FSS: 'flightService', APP: 'approach', DEP: 'departure', TWR: 'tower', GND: 'ground', DEL: 'delivery', ATIS: 'atis', RMP: 'ground', OBS: 'observer', SUP: 'supervisor' };
  const WORD = { atis: 'ATIS', delivery: 'Delivery', ground: 'Ground', tower: 'Tower', approach: 'Approach', departure: 'Departure', center: 'Control', flightService: 'Radio' };

  // ---------------------------------------------------------------- VATSpy.dat

  function parseVatspy(text) {
    const out = { countries: [], airports: [], firs: [], uirs: [] };
    let section = '';
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith(';')) continue;
      const m = line.match(/^\[(\w+)\]$/);
      if (m) { section = m[1]; continue; }
      const f = line.split('|');
      if (section === 'Countries') out.countries.push({ name: f[0], prefix: (f[1] || '').toUpperCase(), center: (f[2] || '').trim() });
      else if (section === 'Airports') out.airports.push({ icao: (f[0] || '').toUpperCase(), name: f[1], lat: Number(f[2]), lon: Number(f[3]), lid: (f[4] || '').toUpperCase(), fir: (f[5] || '').toUpperCase(), pseudo: f[6] === '1' });
      else if (section === 'FIRs') {
        const icao = (f[0] || '').toUpperCase();
        out.firs.push({ icao, name: f[1] || icao, prefix: (f[2] || '').toUpperCase() || icao, boundary: (f[3] || '').toUpperCase() || icao });
      } else if (section === 'UIRs') {
        // ID|Nome|FIR,FIR,… (alcune versioni hanno anche lat|lon prima dell'elenco)
        const list = f.length >= 5 ? f[4] : f[2];
        out.uirs.push({ id: (f[0] || '').toUpperCase(), name: f[1], lat: f.length >= 5 ? Number(f[2]) : NaN, lon: f.length >= 5 ? Number(f[3]) : NaN, firs: (list || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- geometria

  // Poligoni come in GeoJSON: [ [ring esterno, buchi…], … ] con punti [lon, lat]
  function polygonsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
  }

  function boundsOf(polygons) {
    let minLat = 90; let maxLat = -90; let minLon = 180; let maxLon = -180;
    for (const p of polygons) for (const [lon, lat] of p[0] || []) {
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    }
    return { minLat, maxLat, minLon, maxLon };
  }

  // Punto per l'etichetta: baricentro dell'anello più grande (ripiego: centro dei limiti)
  function labelPoint(polygons) {
    let best = null;
    let bestArea = -1;
    for (const p of polygons) {
      const r = p[0] || [];
      let a = 0; let cx = 0; let cy = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const k = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        a += k; cx += (r[j][0] + r[i][0]) * k; cy += (r[j][1] + r[i][1]) * k;
      }
      if (Math.abs(a) > bestArea && a !== 0) { bestArea = Math.abs(a); best = { lon: cx / (3 * a), lat: cy / (3 * a) }; }
    }
    if (best) return best;
    const b = boundsOf(polygons);
    return { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2 };
  }

  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function contains(volume, lat, lon) {
    if (volume.radiusNM !== undefined) {
      const d = Math.hypot((lat - volume.center.lat) * 60, (lon - volume.center.lon) * 60 * Math.cos((lat * Math.PI) / 180));
      return d <= volume.radiusNM;
    }
    const b = volume.bounds;
    if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) return false;
    return volume.polygons.some((p) => pointInRing(lon, lat, p[0]) && !p.slice(1).some((h) => pointInRing(lon, lat, h)));
  }

  // ---------------------------------------------------------------- database

  function build(vatspyText, firGeo, traconGeo, opts) {
    const vatspy = typeof vatspyText === 'string' ? parseVatspy(vatspyText) : vatspyText;
    const airportLookup = (opts && opts.airport) || (() => null);
    const suffixes = {};
    for (const c of vatspy.countries) if (c.prefix && c.center && !suffixes[c.prefix]) suffixes[c.prefix] = c.center;

    const volumes = [];
    const byId = {};
    const add = (v) => {
      let id = v.id;
      for (let n = 2; byId[id] !== undefined; n++) id = `${v.id}#${n}`;
      v.id = id;
      byId[id] = volumes.length;
      volumes.push(v);
      return volumes.length - 1;
    };

    // --- FIR: un volume per (id del confine, oceanico sì/no)
    const featuresById = new Map();
    for (const ft of (firGeo && firGeo.features) || []) {
      const id = String((ft.properties && ft.properties.id) || '').toUpperCase();
      if (!id) continue;
      if (!featuresById.has(id)) featuresById.set(id, []);
      featuresById.get(id).push(ft);
    }
    const entriesByBoundary = {};
    for (const e of vatspy.firs) (entriesByBoundary[e.boundary] = entriesByBoundary[e.boundary] || []).push(e);
    const displayName = (name, icao) => {
      const suffix = suffixes[icao.slice(0, 2)] || suffixes[icao[0]] || '';
      if (!suffix || name.toLowerCase().includes(suffix.toLowerCase()) || name.includes(' - ')) return name;
      if (/\b(acc|radar|control|centre|center|centro|oceanic|information|approach|radio)\b/i.test(name)) return name;
      return `${name} ${suffix}`;
    };
    const volumesByBoundary = {};
    for (const [id, features] of featuresById) {
      const entries = entriesByBoundary[id] || [];
      const prefixes = [...new Set(entries.map((e) => e.prefix))];
      // "London ACC (South) - London" → "London ACC (South)"
      const baseName = entries.length ? displayName(entries[0].name.split(' - ')[0].trim(), entries[0].icao) : id;
      const groups = [false, true].map((oc) => features.filter((ft) => (String(ft.properties.oceanic) === '1') === oc)).filter((g) => g.length);
      for (const group of groups) {
        const oceanic = String(group[0].properties.oceanic) === '1';
        const polygons = group.flatMap((ft) => polygonsOf(ft.geometry));
        const p = group[0].properties;
        const two = oceanic && groups.length > 1;
        const center = Number.isFinite(Number(p.label_lat)) && p.label_lat !== undefined ? { lat: Number(p.label_lat), lon: Number(p.label_lon) } : labelPoint(polygons);
        const i = add({ id: `FIR:${id}${two ? ':OCEANIC' : ''}`, kind: 'fir', name: two ? `${baseName} (Oceanic)` : baseName, prefixes: prefixes.length ? prefixes : [id], polygons, bounds: boundsOf(polygons), center, oceanic });
        (volumesByBoundary[id] = volumesByBoundary[id] || []).push(i);
      }
    }
    const firByPrefix = {};
    const firByIcao = {};
    const push = (map, k, i) => { if (!map[k]) map[k] = []; if (!map[k].includes(i)) map[k].push(i); };
    for (const e of vatspy.firs) for (const i of volumesByBoundary[e.boundary] || []) { push(firByPrefix, e.prefix, i); push(firByIcao, e.icao, i); }
    for (const [id, list] of Object.entries(volumesByBoundary)) if (!firByIcao[id]) firByIcao[id] = list;

    // --- UIR: unione delle FIR che la compongono
    const uirById = {};
    for (const u of vatspy.uirs) {
      const seen = new Set();
      const polygons = [];
      for (const f of u.firs) for (const i of firByIcao[f] || volumesByBoundary[f] || []) if (!seen.has(i)) { seen.add(i); polygons.push(...volumes[i].polygons); }
      if (!polygons.length) continue;
      uirById[u.id] = add({ id: `UIR:${u.id}`, kind: 'uir', name: u.name, prefixes: [u.id], polygons, bounds: boundsOf(polygons), center: Number.isFinite(u.lat) ? { lat: u.lat, lon: u.lon } : labelPoint(polygons) });
    }

    // --- TRACON (SimAware)
    const tracons = [];
    const traconByPrefix = {};
    const idCount = {};
    for (const ft of (traconGeo && traconGeo.features) || []) idCount[ft.properties.id] = (idCount[ft.properties.id] || 0) + 1;
    for (const ft of (traconGeo && traconGeo.features) || []) {
      const p = ft.properties || {};
      const prefixes = [].concat(p.prefix || []).map((x) => String(x).toUpperCase());
      const suffix = p.suffix ? String(p.suffix).toUpperCase() : null;
      const polygons = polygonsOf(ft.geometry);
      if (!polygons.length || !prefixes.length) continue;
      let id = `TRACON:${p.id}`;
      if (idCount[p.id] > 1) id += `/${prefixes.join('+')}${suffix ? `_${suffix}` : ''}`;
      const center = p.label_lat !== undefined ? { lat: Number(p.label_lat), lon: Number(p.label_lon) } : labelPoint(polygons);
      const vi = add({ id, kind: 'tracon', name: p.name || p.id, prefixes, suffix, polygons, bounds: boundsOf(polygons), center });
      const ti = tracons.length;
      tracons.push(vi);
      for (const pre of prefixes) (traconByPrefix[pre] = traconByPrefix[pre] || []).push(ti);
    }

    // Aeroporti VATSpy (anche pseudo-aeroporti) e alias IATA/LID, per i cerchi
    const vatspyAirports = {};
    const byLid = {};
    for (const a of vatspy.airports) {
      if (!vatspyAirports[a.icao]) vatspyAirports[a.icao] = a;
      if (a.lid && !byLid[a.lid]) byLid[a.lid] = a;
    }
    const airportFor = (prefix) => {
      const w = airportLookup(prefix);
      if (w && Number.isFinite(w.lat)) return { icao: w.icao, name: w.city || w.name, lat: w.lat, lon: w.lon };
      const v = vatspyAirports[prefix] || byLid[prefix] || (prefix.length === 3 ? vatspyAirports[`K${prefix}`] : null);
      if (v) {
        const ww = airportLookup(v.icao);
        return { icao: v.icao, name: (ww && (ww.city || ww.name)) || v.name, lat: v.lat, lon: v.lon };
      }
      return null;
    };

    // ---------------------------------------------------------------- regole

    function traconMatches(callsign, prefixParts, explicitOnly) {
      const parts = callsign.split('_');
      const last = parts[parts.length - 1];
      let best = { score: -1, list: [] };
      for (let k = prefixParts.length; k >= 1; k--) {
        const key = prefixParts.slice(0, k).join('_');
        for (const ti of traconByPrefix[key] || []) {
          const v = volumes[tracons[ti]];
          let score;
          if (v.suffix) {
            if (!callsign.endsWith(`_${v.suffix}`) || callsign.length < key.length + v.suffix.length + 1) continue;
            score = k * 1000 + 500 + v.suffix.length;
          } else {
            if (explicitOnly || !(last === 'APP' || last === 'DEP')) continue;
            score = k * 1000;
          }
          if (score > best.score) best = { score, list: [tracons[ti]] };
          else if (score === best.score) best.list.push(tracons[ti]);
        }
      }
      return best.list.map((i) => volumes[i]);
    }

    function areaVolumes(callsign, prefixParts, preferOceanic) {
      const pick = (list) => {
        const c = list.map((i) => volumes[i]);
        if (c.length < 2) return c;
        const pref = c.filter((v) => !!v.oceanic === preferOceanic);
        return pref.length ? pref : c;
      };
      const keys = [];
      for (let n = prefixParts.length; n >= 1; n--) keys.push(prefixParts.slice(0, n).join('_'));
      for (const k of keys) if (firByPrefix[k] && firByPrefix[k].length) return pick(firByPrefix[k]);
      for (const k of keys) {
        const l = firByIcao[k] || firByIcao[k.replace(/_/g, '-')];
        if (l && l.length) return pick(l);
      }
      for (const k of keys) {
        const u = uirById[k] !== undefined ? uirById[k] : uirById[k.replace(/_/g, '-')];
        if (u !== undefined) return [volumes[u]];
      }
      return traconMatches(callsign, prefixParts, true);
    }

    function circle(prefixParts, position, radius, kind) {
      const ap = airportFor(prefixParts[0]);
      if (!ap) return [];
      return [{ id: `APT:${ap.icao}:${position}`, kind, name: `${ap.name} ${WORD[position] || ''}`.trim(), prefixes: [ap.icao], center: { lat: ap.lat, lon: ap.lon }, radiusNM: radius, airport: ap.icao, position }];
    }

    function volumesFor(rawCallsign) {
      const callsign = String(rawCallsign || '').toUpperCase().trim();
      const parts = callsign.split('_').filter(Boolean);
      if (!parts.length) return [];
      const position = POSITION[parts[parts.length - 1]] || 'observer';
      const prefixParts = parts.length > 1 ? parts.slice(0, -1) : parts;
      switch (position) {
        case 'center':
        case 'flightService':
          return areaVolumes(callsign, prefixParts, position === 'flightService');
        case 'approach':
        case 'departure': {
          const t = traconMatches(callsign, prefixParts, false);
          return t.length ? t : circle(prefixParts, position, RADIUS.approach, 'tracon');
        }
        case 'tower': {
          const t = traconMatches(callsign, prefixParts, true);
          return t.length ? t : circle(prefixParts, position, RADIUS.tower, 'airport');
        }
        case 'ground': return circle(prefixParts, position, RADIUS.ground, 'airport');
        case 'delivery': return circle(prefixParts, position, RADIUS.delivery, 'airport');
        case 'atis': return circle(prefixParts, position, RADIUS.atis, 'airport');
        default: return [];
      }
    }

    return {
      volumes,
      volume: (id) => (byId[id] !== undefined ? volumes[byId[id]] : null),
      volumesFor,
      position: (callsign) => { const p = String(callsign || '').toUpperCase().split('_'); return POSITION[p[p.length - 1]] || 'observer'; },
      airportFor,
      // FIR che contiene un punto (le FIR "vere" vincono sui sottosettori, la più piccola vince)
      firContaining(lat, lon) {
        let best = null;
        for (const v of volumes) {
          if (v.kind !== 'fir' || !contains(v, lat, lon)) continue;
          const sub = v.id.includes('-');
          const area = (v.bounds.maxLat - v.bounds.minLat) * (v.bounds.maxLon - v.bounds.minLon);
          if (!best || (best.sub && !sub) || (best.sub === sub && area < best.area)) best = { v, sub, area };
        }
        return best ? best.v : null;
      },
      stats: { firs: Object.keys(volumesByBoundary).length, uirs: Object.keys(uirById).length, tracons: tracons.length },
    };
  }

  const api = { parseVatspy, build, contains, labelPoint, polygonsOf, RADIUS, POSITION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sectors = api;
})(this);
