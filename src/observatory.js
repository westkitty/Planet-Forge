// PF-30 investigations and PF-09 tour routes. Both read only the authoritative world arrays.
import { RIVER_MIN_M3S } from './hydrology.js';
import { BOUNDARY } from './planet.js';
import { cellDir, angleBetween } from './geo.js';

const seasonalRange = (p, i) => { let lo = Infinity, hi = -Infinity; for (let m = 0; m < 12; m++) { const v = p.climate.temperatureMonthly[12 * i + m]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
const isLand = (p, i) => p.elevation[i] >= 0, isRiver = (p, i) => isLand(p, i) && p.hydro.discharge[i] >= RIVER_MIN_M3S && !p.hydro.lake[i];

/**
 * PF-30 investigation protocols. Each compares a measured quantity between two groups of sites the player chooses.
 * Sites must satisfy the group's stated eligibility rule (checked against the world arrays), every measurement is
 * read from the world (players cannot enter values), and the verdict follows a stated decision rule, so a hypothesis
 * can come out rejected. `expect` is the direction H1 predicts; `margin` the minimum difference that counts.
 */
export const INVESTIGATIONS = {
  rainShadow: {
    title: 'Do mountains cast rain shadows?', question: 'Is land where the model\'s winds rise over higher ground wetter than land where air descends?',
    h1: 'Windward land receives more rain than leeward land.', h0: 'Windward and leeward land receive similar rain.',
    measure: { label: 'rainfall', unit: 'mm/yr', of: (p, i) => Math.round(p.rainfall[i]) },
    groups: { A: { label: 'windward site', rule: 'land where air rises downwind (uplift > 30 m)', ok: (p, i) => isLand(p, i) && p.climate.uplift[i] > 30 }, B: { label: 'leeward site', rule: 'land where air descends (uplift < −30 m)', ok: (p, i) => isLand(p, i) && p.climate.uplift[i] < -30 } },
    expect: 1, margin: 50
  },
  lapseRate: {
    title: 'Is it colder up high?', question: 'Are highland sites colder than lowland sites at similar (tropical to mid) latitudes?',
    h1: 'Highlands are more than 3 °C colder than lowlands.', h0: 'Highlands are not clearly colder.',
    measure: { label: 'annual mean temperature', unit: '°C', of: (p, i) => Math.round(p.temperature[i] * 10) / 10 },
    groups: { A: { label: 'highland site', rule: 'land above 2,000 m within 40° of the equator', ok: (p, i) => p.elevation[i] > 2000 && Math.abs(p.lat[i]) < 40 }, B: { label: 'lowland site', rule: 'land below 500 m within 40° of the equator', ok: (p, i) => isLand(p, i) && p.elevation[i] < 500 && Math.abs(p.lat[i]) < 40 } },
    expect: -1, margin: 3
  },
  continentality: {
    title: 'Does the sea calm the seasons?', question: 'Do deep-interior sites have larger seasonal temperature swings than coastal sites?',
    h1: 'Interior land has a seasonal range more than 3 °C larger than coastal land.', h0: 'Seasonal range does not depend on distance from the sea.',
    measure: { label: 'seasonal range (warmest − coldest month)', unit: '°C', of: (p, i) => Math.round(seasonalRange(p, i) * 10) / 10 },
    groups: { A: { label: 'interior site', rule: 'land at least 12 cells from the sea', ok: (p, i) => isLand(p, i) && p.climate.coastDist[i] >= 12 }, B: { label: 'coastal site', rule: 'land next to the sea', ok: (p, i) => isLand(p, i) && p.climate.coastDist[i] === 1 } },
    expect: 1, margin: 3
  },
  riverRain: {
    title: 'Do rivers mark the rainiest land?', question: 'Is local rainfall higher on river cells than on other land?',
    h1: 'River cells receive more local rain than other land (by > 100 mm/yr).', h0: 'River cells are not wetter locally: rivers carry water from elsewhere.',
    measure: { label: 'local rainfall', unit: 'mm/yr', of: (p, i) => Math.round(p.rainfall[i]) },
    groups: { A: { label: 'river site', rule: `land carrying ≥ ${RIVER_MIN_M3S} m³/s`, ok: isRiver }, B: { label: 'non-river site', rule: 'land without a river or lake', ok: (p, i) => isLand(p, i) && !isRiver(p, i) && !p.hydro.lake[i] } },
    expect: 1, margin: 100
  },
  seafloorAge: {
    title: 'Does old seafloor sink?', question: 'Is old oceanic crust deeper than young crust?',
    h1: 'Seafloor older than 100 Myr lies more than 500 m deeper than seafloor younger than 30 Myr.', h0: 'Depth does not depend on seafloor age.',
    measure: { label: 'water depth', unit: 'm', of: (p, i) => Math.round(-p.elevation[i]) },
    groups: { A: { label: 'old seafloor site', rule: 'oceanic crust older than 100 Myr', ok: (p, i) => !p.continental[i] && p.elevation[i] < 0 && p.seafloorAge[i] > 100 }, B: { label: 'young seafloor site', rule: 'oceanic crust younger than 30 Myr', ok: (p, i) => !p.continental[i] && p.elevation[i] < 0 && p.seafloorAge[i] < 30 } },
    expect: 1, margin: 500
  }
};
export const SITES_PER_GROUP = 3;

export function investigationAvailability(planet) {
  const out = {};
  for (const [id, inv] of Object.entries(INVESTIGATIONS)) {
    let a = 0, b = 0; for (let i = 0; i < planet.cellCount; i += 3) { if (inv.groups.A.ok(planet, i)) a++; if (inv.groups.B.ok(planet, i)) b++; }
    out[id] = a >= 10 && b >= 10;
  }
  return out;
}
/** Try to record cell i in group g. Returns { ok, observation } or { ok: false, reason }. */
export function recordObservation(planet, id, record, g, i) {
  const inv = INVESTIGATIONS[id], grp = inv.groups[g];
  if (!grp) return { ok: false, reason: 'unknown group' };
  if (record.some(o => o.cell === i)) return { ok: false, reason: 'this site is already recorded' };
  if (record.filter(o => o.group === g).length >= SITES_PER_GROUP) return { ok: false, reason: `group ${g} already has ${SITES_PER_GROUP} sites` };
  if (!grp.ok(planet, i)) return { ok: false, reason: `not a valid ${grp.label}: needs ${grp.rule}` };
  return { ok: true, observation: { group: g, cell: i, lat: planet.lat[i], lon: planet.lon[i], value: inv.measure.of(planet, i) } };
}
/** Decision rule on the recorded evidence; `claim` is the player's conclusion ('supported' | 'rejected'). */
export function evaluate(id, record, claim) {
  const inv = INVESTIGATIONS[id], A = record.filter(o => o.group === 'A'), B = record.filter(o => o.group === 'B');
  if (A.length < SITES_PER_GROUP || B.length < SITES_PER_GROUP) return { complete: false, reason: `record ${SITES_PER_GROUP} sites in each group first` };
  const mean = xs => xs.reduce((s, o) => s + o.value, 0) / xs.length, mA = mean(A), mB = mean(B), diff = mA - mB;
  const supported = Math.sign(diff) === inv.expect && Math.abs(diff) > inv.margin;
  return {
    complete: true, meanA: Math.round(mA * 10) / 10, meanB: Math.round(mB * 10) / 10, difference: Math.round(diff * 10) / 10, unit: inv.measure.unit,
    verdict: supported ? 'supported' : 'rejected', correct: claim === (supported ? 'supported' : 'rejected'),
    rule: `H1 is supported when ${inv.groups.A.label}s minus ${inv.groups.B.label}s is ${inv.expect > 0 ? 'above +' : 'below −'}${inv.margin} ${inv.measure.unit}.`,
    note: 'Observation: the measured values. Inference: the verdict from three sites per group is a small-sample comparison within this world, not a general law.'
  };
}

// ---- PF-09 tour routes ----
function separated(planet, cells, minDeg, limit) {
  const out = [];
  for (const c of cells) { if (out.every(o => angleBetween(cellDir(planet.mesh, o), cellDir(planet.mesh, c)) > minDeg * Math.PI / 180)) out.push(c); if (out.length >= limit) break; }
  return out;
}
function topBy(planet, score, n, minDeg) { const idx = []; for (let i = 0; i < planet.cellCount; i++) { const s = score(i); if (s > -Infinity) idx.push([s, i]); } idx.sort((a, b) => b[0] - a[0] || a[1] - b[1]); return separated(planet, idx.slice(0, 4000).map(x => x[1]), minDeg, n); }

export const ROUTES = { highlights: 'Planet highlights', mountains: 'Mountain systems', rivers: 'Great rivers', boundaries: 'Plate boundaries', polar: 'Polar regions', settlements: 'Settlement network' };
/** Deterministic, narration-ready stops for a route: [{ title, text, cell }]. */
export function tourStops(planet, route) {
  const el = planet.elevation, at = i => `${planet.lat[i]}°, ${planet.lon[i]}°`, peak = i => ({ title: 'Summit at ' + at(i), text: `${Math.round(el[i])} m above sea level, ${planet.boundary[i] ? 'on a ' + BOUNDARY[planet.boundary[i]] + ' plate boundary' : Math.round(planet.boundaryDistance[i] * planet.spacingKm) + ' km from the nearest boundary on its plate'}.`, cell: i });
  if (route === 'mountains') return topBy(planet, i => el[i], 5, 12).map(peak);
  if (route === 'rivers') return planet.hydro.rivers.slice(0, 3).flatMap(r => [
    { title: r.name + ' — source', text: `${r.lengthKm.toLocaleString('en-US')} km long; drains ${Math.round(r.basinKm2 / 1000).toLocaleString('en-US')}k km².`, cell: r.source },
    { title: r.name + ' — ' + (r.endorheic ? 'terminal basin' : 'mouth'), text: `${r.dischargeM3s.toLocaleString('en-US')} m³/s ${r.endorheic ? 'ending inland' : 'reaching the sea'}.`, cell: r.mouth }]);
  if (route === 'boundaries') return topBy(planet, i => planet.boundary[i] === 1 ? planet.boundaryConvergence[i] : -Infinity, 3, 20).map(i => ({ title: 'Convergent boundary at ' + at(i), text: `Plates ${planet.plate[i]} and a neighbour converge here; elevation ${Math.round(el[i])} m.`, cell: i }))
    .concat(topBy(planet, i => planet.boundary[i] === 2 ? 1 : -Infinity, 2, 30).map(i => ({ title: 'Divergent boundary at ' + at(i), text: `Plates pull apart here; elevation ${Math.round(el[i])} m.`, cell: i })));
  if (route === 'polar') return [topBy(planet, i => planet.lat[i], 1, 0)[0], topBy(planet, i => -planet.lat[i], 1, 0)[0]].map(i => ({ title: (planet.lat[i] > 0 ? 'North' : 'South') + ' polar region', text: `${Math.round(planet.temperature[i] * 10) / 10} °C annual mean, ${Math.round(planet.rainfall[i])} mm/yr, ${el[i] < 0 ? 'ocean ' + Math.round(-el[i]) + ' m deep' : 'land at ' + Math.round(el[i]) + ' m'}.`, cell: i }));
  if (route === 'settlements') return planet.settlements.slice().sort((a, b) => a.founded - b.founded).map(s => ({ title: s.name, text: `Founded year ${s.founded}, ${s.water}, ${s.biome.toLowerCase()} (${s.climate}).`, cell: s.cell }));
  const deep = topBy(planet, i => -el[i], 1, 0)[0], r = planet.hydro.rivers[0];
  return [peak(topBy(planet, i => el[i], 1, 0)[0]), ...(r ? [{ title: r.name, text: `Largest river: ${r.dischargeM3s.toLocaleString('en-US')} m³/s over ${r.lengthKm.toLocaleString('en-US')} km.`, cell: r.mouth }] : []),
    { title: 'Deepest point', text: `${Math.round(-el[deep])} m below sea level${planet.boundary[deep] ? ', on a ' + BOUNDARY[planet.boundary[deep]] + ' boundary' : ''}.`, cell: deep },
    ...(planet.settlements[0] ? [{ title: planet.settlements[0].name, text: `A settlement founded year ${planet.settlements[0].founded}.`, cell: planet.settlements[0].cell }] : [])];
}
/** Globe Euler angles (XYZ order, as the app rotates the mesh) that bring cell direction d to face the camera (+z). */
export function facingRotation(d) {
  const ry = Math.atan2(-d[0], d[2]), lat = Math.asin(Math.max(-1, Math.min(1, d[1])));
  return { x: Math.max(-1.35, Math.min(1.35, lat)), y: ry };
}
