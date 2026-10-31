// Observatory analysis over the authoritative world arrays (PF-27 transect, PF-31 correlations). Pure and read-only.
import { nearestCell, cellDir, greatCircle, angleBetween, ringDistance, EARTH_RADIUS_KM } from './geo.js';
import { RIVER_MIN_M3S } from './hydrology.js';

/**
 * PF-27: geodesic transect from cell a to cell b. The great circle is sampled at half the mean cell spacing and each
 * sample is snapped to its nearest cell; consecutive duplicates are dropped, so every row is a real cell. Distances
 * are along the great circle on a sphere of Earth radius (the model's scale).
 */
export function transect(planet, a, b) {
  const mesh = planet.mesh, A = cellDir(mesh, a), B = cellDir(mesh, b), arc = angleBetween(A, B), lengthKm = arc * EARTH_RADIUS_KM;
  const n = Math.max(2, Math.min(4000, Math.ceil(lengthKm / (planet.spacingKm / 2)) + 1));
  const g = planet.glaciationComputed ? planet.glaciation : null, rows = [];
  let prev = a;
  for (const [k, d] of greatCircle(A, B, n).entries()) {
    const c = nearestCell(mesh, d, prev); prev = c;
    if (rows.length && rows[rows.length - 1].cell === c) continue;
    const el = planet.elevation[c], q = planet.hydro.discharge[c];
    rows.push({
      cell: c, distanceKm: Math.round(lengthKm * k / (n - 1)), lat: planet.lat[c], lon: planet.lon[c],
      elevationM: Math.round(el), oceanDepthM: el < 0 ? Math.round(-el) : 0, temperatureC: Math.round(planet.temperature[c] * 10) / 10,
      rainfallMm: Math.round(planet.rainfall[c]), river: el >= 0 && q >= RIVER_MIN_M3S && !planet.hydro.lake[c] ? Math.round(q) : 0,
      iceM: g ? Math.round(g.thickness[c]) : null
    });
  }
  const crossings = [];
  for (let i = 0; i < rows.length; i++) if (rows[i].river && !(i && rows[i - 1].river)) crossings.push({ distanceKm: rows[i].distanceKm, dischargeM3s: rows[i].river });
  const max = k => rows.reduce((m, r) => Math.max(m, r[k]), -Infinity), min = k => rows.reduce((m, r) => Math.min(m, r[k]), Infinity);
  return {
    from: a, to: b, lengthKm: Math.round(lengthKm), samples: rows.length, sampleSpacingKm: Math.round(planet.spacingKm / 2), rows, crossings,
    summary: { maxElevationM: max('elevationM'), minElevationM: min('elevationM'), maxDepthM: max('oceanDepthM'), tempRangeC: [min('temperatureC'), max('temperatureC')], rainRangeMm: [min('rainfallMm'), max('rainfallMm')], riverCrossings: crossings.length, iceModelled: !!g },
    limitations: `Each row is the nearest of the 100,002 cells (spacing ≈ ${Math.round(planet.spacingKm)} km); finer relief is not resolved. Ice thickness ${g ? 'is the computed glacial-maximum state' : 'needs the glacial state (choose the ice-age era or layer) and is blank'}.`
  };
}
export function transectCsv(t) {
  const head = 'distance_km,cell,lat,lon,elevation_m,ocean_depth_m,temperature_c,rainfall_mm,river_discharge_m3s,ice_m';
  return [head, ...t.rows.map(r => [r.distanceKm, r.cell, r.lat, r.lon, r.elevationM, r.oceanDepthM, r.temperatureC, r.rainfallMm, r.river, r.iceM ?? ''].join(','))].join('\n');
}

// ---- PF-31 correlation observatory ----
const land = (p, i) => p.elevation[i] >= 0;
const riverCell = (p, i) => land(p, i) && p.hydro.discharge[i] >= RIVER_MIN_M3S && !p.hydro.lake[i];
const seasonalRange = (p, i) => { const t = p.climate.temperatureMonthly; let lo = Infinity, hi = -Infinity; for (let m = 0; m < 12; m++) { const v = t[12 * i + m]; if (v < lo) lo = v; if (v > hi) hi = v; } return hi - lo; };

/**
 * Curated cross-layer queries. Each is (A within population P) vs (A among cells with condition B): it reports
 * counts, the share of A in B and in P, and the lift = share_B / share_P. Lift > 1 means A is over-represented where
 * B holds. That is a correlation in this world's arrays, not evidence of a causal mechanism.
 */
export const QUERIES = {
  riversNearBoundaries: {
    title: 'Rivers near plate boundaries', params: { km: 300 },
    describe: p => `Land cells within ${p.km} km of a plate boundary (B) vs all land (P); A = cell carries a river (≥ ${RIVER_MIN_M3S} m³/s).`,
    run(planet, prm) { const r = Math.round(prm.km / planet.spacingKm), d = planet.boundaryDistance; return compare(planet, i => land(planet, i), i => d[i] >= 0 && d[i] <= r, i => riverCell(planet, i), i => planet.hydro.discharge[i]); }
  },
  dryNearHighlands: {
    title: 'Dry land near high terrain', params: { mm: 400, heightM: 2500, rings: 6 },
    describe: p => `Land within ${p.rings} cells of terrain above ${p.heightM} m (B) vs all land (P); A = rainfall below ${p.mm} mm/yr.`,
    run(planet, prm) { const d = ringDistance(planet.mesh, i => planet.elevation[i] > prm.heightM, prm.rings); return compare(planet, i => land(planet, i), i => d[i] >= 0, i => planet.rainfall[i] < prm.mm, i => -planet.rainfall[i]); }
  },
  settlementHazards: {
    title: 'Settlements near convergent boundaries', params: { km: 500 },
    describe: p => `Each settlement's distance to the nearest convergent plate boundary; flagged when within ${p.km} km (a proxy for earthquake and volcanic exposure in this model).`,
    run(planet, prm) {
      const d = ringDistance(planet.mesh, i => planet.boundary[i] === 1), rows = planet.settlements.map(s => ({ cell: s.cell, name: s.name, metric: d[s.cell] < 0 ? Infinity : Math.round(d[s.cell] * planet.spacingKm) }));
      const hits = rows.filter(r => r.metric <= prm.km).sort((a, b) => a.metric - b.metric);
      return { kind: 'list', matches: hits.map(r => r.cell), count: hits.length, population: rows.length, ranked: rows.sort((a, b) => a.metric - b.metric).map(r => ({ cell: r.cell, label: r.name, value: r.metric, unit: 'km' })) };
    }
  },
  biomeEdgesVsRainGradient: {
    title: 'Biome boundaries vs rainfall gradients', params: { mmPerCell: 150 },
    describe: p => `Land cells with a neighbouring cell differing in rainfall by ≥ ${p.mmPerCell} mm/yr (B) vs all land (P); A = a neighbour has a different biome.`,
    run(planet, prm) {
      const { offsets: O, neighbors: N } = planet.mesh;
      const grad = i => { let g = 0; for (let e = O[i]; e < O[i + 1]; e++) g = Math.max(g, Math.abs(planet.rainfall[i] - planet.rainfall[N[e]])); return g; };
      const edge = i => { for (let e = O[i]; e < O[i + 1]; e++) if (planet.biome[N[e]] !== planet.biome[i]) return true; return false; };
      return compare(planet, i => land(planet, i), i => grad(i) >= prm.mmPerCell, edge, grad);
    }
  },
  seasonalExtremes: {
    title: 'Extreme seasonal temperature range', params: { rangeC: 40 },
    describe: p => `Land cells whose warmest and coldest months differ by ≥ ${p.rangeC} °C (A), compared between interior land more than 10 cells from the sea (B) and all land (P).`,
    run(planet, prm) { const c = planet.climate.coastDist; return compare(planet, i => land(planet, i), i => c[i] > 10, i => seasonalRange(planet, i) >= prm.rangeC, i => seasonalRange(planet, i)); }
  }
};
function compare(planet, inP, inB, isA, metric) {
  let nP = 0, aP = 0, nB = 0, aB = 0; const matches = [];
  for (let i = 0; i < planet.cellCount; i++) {
    if (!inP(i)) continue; nP++; const a = isA(i); if (a) aP++;
    if (inB(i)) { nB++; if (a) { aB++; matches.push(i); } }
  }
  const shareB = nB ? aB / nB : 0, shareP = nP ? aP / nP : 0;
  const ranked = matches.map(i => ({ cell: i, value: metric(i) })).sort((x, y) => y.value - x.value || x.cell - y.cell).slice(0, 10)
    .map(r => ({ ...r, label: planet.lat[r.cell] + '°, ' + planet.lon[r.cell] + '°' }));
  return { kind: 'compare', matches, count: aB, population: nP, inB: nB, withA: aP, shareB, shareP, lift: shareP ? shareB / shareP : null, ranked };
}
export function runQuery(planet, id, params) { const q = QUERIES[id], prm = { ...q.params, ...params }; return { id, title: q.title, logic: q.describe(prm), params: prm, ...q.run(planet, prm), caution: 'Correlation within this generated world; it does not show that one causes the other.' }; }
