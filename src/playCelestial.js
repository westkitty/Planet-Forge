// Play-tab panels for Milestone 5: Stellar Foundry (PF-24), Eclipse Hunter (PF-25), Orbit Architect (PF-26) and
// Constellation Cartography (PF-04). State is kept in the gameplay store (flags), so it is saved and restored.
import { STAR_TYPES, validateStar, habitability, makeMoon, predictEclipses, SAT_CLASSES, orbitPeriodMin, footprintDeg, LIMITS } from './celestial.js';
import { coverage, MISSIONS, launch, maneuver } from './gameplay/orbits.js';
import { addEdge, validateConstellation, starsOf, PICK_MAG } from './constellations.js';
import { latLonToDir, nearestCell, ringDistance } from './geo.js';

export const CELESTIAL_MODES = { star: 'Stellar Foundry', eclipse: 'Eclipse Hunter', orbits: 'Orbit Architect', sky: 'Constellation Cartography' };

export function celestialPanels(app, h, status, rerender) {
  let eclipses = null, draft = null, cov = null;
  const flag = (k, d) => app.store.state.flags[k + ':' + app.planet.seed] ?? d, setFlag = (k, v) => app.store.apply('flag', { key: k + ':' + app.planet.seed, value: v });
  const star = () => flag('star', { type: 'G2V', distanceAU: 1 }), fleet = () => flag('fleet', []);
  const table = (head, rows) => h('table', { class: 'grid' }, h('tr', {}, head.map(t => h('th', {}, t))), rows.map(r => h('tr', {}, r.map(v => h('td', {}, v)))));
  const num = (label, value, attrs = {}) => h('label', { class: 'param' }, label + ' ', h('input', { type: 'number', value, 'aria-label': label, step: 'any', ...attrs }));
  const cellAt = (lat, lon) => nearestCell(app.planet.mesh, latLonToDir(lat, lon), 0);

  const panels = {
    star() {
      const c = star(), hb = habitability(c);
      const type = h('select', { 'aria-label': 'Star type', id: 'star-type' }, Object.keys(STAR_TYPES).map(k => h('option', { value: k, ...(k === c.type ? { selected: '' } : {}) }, `${k} (${STAR_TYPES[k].teff} K, ${STAR_TYPES[k].L} L☉)`)));
      const dist = num('Distance (AU)', c.distanceAU, { min: .01, max: 50, id: 'star-distance' });
      const apply = () => { const next = { type: type.value, distanceAU: Number(dist.querySelector('input').value) }, e = validateStar(next); if (e) return status(e); setFlag('star', next); const hb2 = habitability(next); app.setStarLight(STAR_TYPES[next.type].teff, hb2.relativeToModel); rerender(); };
      return h('div', {}, h('div', { class: 'row wrap' }, type, dist, h('button', { class: 'mini', id: 'star-apply', on: { click: apply } }, 'Apply')),
        table(['Quantity', 'value'], [['Incoming radiation', `${hb.fluxWm2.toLocaleString('en-US')} W/m² (${Math.round(hb.relativeToModel * 100)} % of the model's 1,361)`], ['Equilibrium temperature (albedo 0.3)', hb.equilibriumK + ' K'], ['Year', hb.yearDays.toLocaleString('en-US') + ' days'], ['Habitable zone (Kopparapu et al. 2013)', `${hb.hz.innerAU.toFixed(2)}–${hb.hz.outerAU.toFixed(2)} AU${hb.hz.extrapolated ? ' (extrapolated outside 2,600–7,200 K)' : ''}`], ['In the habitable zone', hb.inHZ ? 'yes' : 'no']]),
        h('p', { class: 'verdict' }, hb.coupling), h('p', { class: 'fine' }, 'The star\'s colour and brightness tint the natural-view sunlight only.'));
    },
    eclipse() {
      const moon = makeMoon(app.planet.seed), c = star();
      if (!eclipses || eclipses.key !== JSON.stringify(c) + app.planet.seed) eclipses = { key: JSON.stringify(c) + app.planet.seed, list: predictEclipses(c, moon, app.planet.tilt, 0, 1095) };
      const observed = flag('eclipses-seen', []);
      const go = e => () => {
        if (!e.centre) { status('Lunar eclipses are seen from the whole night side; no single shadow point.'); return; }
        const cell = cellAt(e.centre.lat, e.centre.lon); app.setSun(e.sunLat, e.sunLon); app.select(cell); app.flyTo(cell);
        const rings = Math.max(1, Math.round((e.umbraKm || 100) / app.planet.spacingKm)), d = ringDistance(app.planet.mesh, i => i === cell, rings), cells = []; for (let i = 0; i < app.planet.cellCount; i++) if (d[i] >= 0) cells.push(i);
        app.highlight(cells); draft = { ...e, cell, rings };
        if (app.pulse) app.pulse(cell, 'observation');
        rerender();
      };
      const observe = () => {
        if (!draft) return status('Jump to a solar eclipse first.');
        const d = ringDistance(app.planet.mesh, i => i === draft.cell, draft.rings)[app.selected];
        if (!(app.selected >= 0 && d >= 0)) return status('Select a place inside the shadow to observe from.');
        if (!/total|annular/.test(draft.type)) return status('Only total or annular eclipses count for the objective.');
        setFlag('eclipses-seen', [...observed, { day: draft.day, type: draft.type }]); app.store.apply('discover', { id: `eclipse-${app.planet.seed}-${draft.day}`, name: `${draft.type} eclipse, day ${draft.day}`, cell: app.selected }); status('Eclipse observed and recorded.'); rerender();
      };
      return h('div', {}, h('p', {}, `Moon: radius ${moon.radiusKm.toLocaleString('en-US')} km, distance ${moon.distanceKm.toLocaleString('en-US')} km, period ${moon.periodDays} days, inclination ${moon.inclinationDeg}°.`), h('p', { class: 'fine' }, moon.note),
        h('h4', {}, `Eclipses in the next three years (${eclipses.list.length})`),
        table(['Day', 'type', 'shadow centre', ''], eclipses.list.map(e => [e.day, e.type, e.centre ? `${e.centre.lat}°, ${e.centre.lon}°` : 'night side', e.centre ? h('button', { class: 'mini', 'data-eclipse': e.day, on: { click: go(e) } }, 'Go') : ''])),
        h('div', { class: 'row' }, h('button', { class: 'mini', id: 'eclipse-observe', on: { click: observe } }, 'Observe from selected place')),
        h('p', {}, `Objective: observe a total or annular solar eclipse from inside its shadow. Observed: ${observed.length}.`),
        h('p', { class: 'fine' }, 'Times are simulation days from the epoch (not wall-clock time). Geometry: circular orbits, star and moon as spheres, shadow cones from their radii.'));
    },
    orbits() {
      const f = fleet();
      const cls = h('select', { 'aria-label': 'Satellite class', id: 'sat-class' }, Object.entries(SAT_CLASSES).map(([k, v]) => h('option', { value: k }, v.label)));
      const alt = num('Altitude km', 700, { id: 'sat-alt' }), inc = num('Inclination °', 98, { id: 'sat-inc' }), raan = num('Node °', 0), phase = num('Phase °', 0);
      const add = () => { const v = el => Number(el.querySelector('input').value), r = launch(f, { cls: cls.value, altKm: v(alt), incDeg: v(inc), raanDeg: v(raan), phaseDeg: v(phase) }); if (r.error) return status(r.error); setFlag('fleet', r.fleet); app.setFleet(r.fleet); cov = null; rerender(); };
      const man = o => () => { const a = Number(document.getElementById('man-alt-' + o.id).value), i = Number(document.getElementById('man-inc-' + o.id).value), r = maneuver(f, o.id, { altKm: a, incDeg: i }); if (r.error) return status('Manoeuvre rejected: ' + r.error); setFlag('fleet', r.fleet); app.setFleet(r.fleet); cov = null; status(`Manoeuvre used ${r.dv.toFixed(3)} km/s.`); rerender(); };
      const run = () => { status('Simulating 24 hours of coverage…'); setTimeout(() => { cov = coverage(app.planet, f); app.highlight(cov.cells); for (const [k, m] of Object.entries(MISSIONS)) if (m.met(cov)) app.store.apply('flag', { key: 'mission:' + k + ':' + app.planet.seed, value: true }); status(''); rerender(); }, 20); };
      return h('div', {}, h('div', { class: 'row wrap' }, cls, alt, inc, raan, phase, h('button', { class: 'mini', id: 'sat-launch', on: { click: add } }, 'Launch')),
        h('p', { class: 'fine' }, `Circular Keplerian orbits around a planet of Earth's mass and radius. Limits: ${LIMITS.minAltKm}–${Math.round(LIMITS.maxAltKm).toLocaleString('en-US')} km; Δv budget ${LIMITS.deltaVBudgetKms} km/s per satellite (Hohmann + plane change).`),
        table(['#', 'class', 'alt km', 'inc °', 'period', 'footprint', 'Δv used', 'manoeuvre'], f.map(o => [o.id, o.cls, o.altKm, o.incDeg, orbitPeriodMin(o.altKm).toFixed(1) + ' min', footprintDeg(o.altKm, SAT_CLASSES[o.cls].minElevationDeg).toFixed(1) + '°', o.dvUsed.toFixed(2), h('span', {}, h('input', { id: 'man-alt-' + o.id, type: 'number', value: o.altKm, 'aria-label': 'New altitude', style: 'width:64px' }), h('input', { id: 'man-inc-' + o.id, type: 'number', value: o.incDeg, 'aria-label': 'New inclination', style: 'width:48px' }), h('button', { class: 'mini', on: { click: man(o) } }, 'Burn'))])),
        h('div', { class: 'row' }, h('button', { class: 'mini', id: 'sat-coverage', on: { click: run } }, 'Simulate 24 h coverage'), h('button', { class: 'mini', on: { click: () => { setFlag('fleet', []); app.setFleet([]); cov = null; rerender(); } } }, 'Clear fleet')),
        cov ? h('div', {}, h('p', {}, `Seen in 24 h: ${(cov.surface * 100).toFixed(1)} % of the surface, ${(cov.land * 100).toFixed(1)} % of land, ${(cov.polar * 100).toFixed(1)} % poleward of 60°. Settlement passes: ${cov.settlementPasses.join(', ')}.`), h('ul', {}, Object.entries(MISSIONS).map(([k, m]) => h('li', {}, (m.met(cov) ? '✔ ' : '○ ') + m.title + ' — ' + m.goal)))) : h('ul', {}, Object.values(MISSIONS).map(m => h('li', {}, '○ ' + m.title + ' — ' + m.goal))));
    },
    sky() {
      const list = flag('constellations', []);
      if (!draft || draft.kind !== 'sky') draft = { kind: 'sky', c: { id: 'c' + Date.now(), name: '', edges: [] }, last: -1 };
      app.setSkyPick(idx => {
        if (idx < 0) return status('No star brighter than magnitude ' + PICK_MAG + ' there. Click empty sky beside the globe, close to a bright star.');
        if (draft.last < 0) { draft.last = idx; status(`Star #${idx} selected; click another to draw a line.`); return; }
        const r = addEdge(draft.c, draft.last, idx, app.sky.catalogue.magnitude); if (r.error) { status(r.error); draft.last = idx; return; }
        draft.c = r.c; draft.last = idx; app.sky.setConstellations([...list, draft.c]); status(`Line ${draft.c.edges.length} drawn.`); rerender();
      });
      const name = h('input', { 'aria-label': 'Constellation name', maxlength: '40', value: draft.c.name, id: 'const-name' }); name.addEventListener('input', () => { draft.c.name = name.value; });
      const save = () => { const e = validateConstellation(draft.c); if (e) return status(e); app.store.apply('constellation', { ...draft.c, name: draft.c.name.trim(), stars: starsOf(draft.c).length }); setFlag('constellations', [...list.filter(x => x.id !== draft.c.id), { ...draft.c, name: draft.c.name.trim() }]); draft = null; app.sky.setConstellations(flag('constellations', [])); status('Constellation charted.'); rerender(); };
      return h('div', {}, h('p', {}, `Click empty sky beside the globe near bright stars (magnitude < ${PICK_MAG}) to connect them. Clicking the planet still selects places as usual.`),
        h('div', { class: 'row' }, name, h('button', { class: 'mini', id: 'const-save', on: { click: save } }, 'Save'), h('button', { class: 'mini', on: { click: () => { draft.c = { ...draft.c, edges: draft.c.edges.slice(0, -1) }; draft.last = -1; app.sky.setConstellations([...list, draft.c]); rerender(); } } }, 'Undo line')),
        h('p', { class: 'fine' }, `Draft: ${draft.c.edges.length} lines, ${starsOf(draft.c).length} stars.`),
        h('h4', {}, `Journal (${list.length})`), h('ul', {}, list.map(c => h('li', {}, `${c.name}: ${starsOf(c).length} stars, ${c.edges.length} lines `, h('button', { class: 'mini', on: { click: () => { setFlag('constellations', list.filter(x => x.id !== c.id)); app.sky.setConstellations(list.filter(x => x.id !== c.id)); rerender(); } } }, 'Delete')))),
        h('p', { class: 'fine' }, 'Constellations are your own figures over the fixed sky catalogue; they keep their stars on every graphics tier and after reload. Undo/redo in the Journal tab covers saved constellations.'));
    }
  };
  return { panels, leave() { app.setSkyPick(null); }, reset() { eclipses = null; draft = null; cov = null; } };
}
