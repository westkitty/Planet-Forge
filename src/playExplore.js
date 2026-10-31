// Play-tab panels for Milestone 6: First Footfall (PF-19), Abyssal Frontier (PF-32), God of Consequences (PF-16).
import { buildPatch, sites, newVehicle, moveVehicle, VEHICLES, pressureBar, heightAt } from './localTerrain.js';
import { INTERVENTIONS, runExperiment, delta } from './gameplay/lab.js';

export const EXPLORE_MODES = { rover: 'First Footfall', sub: 'Abyssal Frontier', lab: 'God of Consequences' };

export function explorePanels(app, h, status, rerender) {
  let mission = null, exp = null;
  const rules = list => h('details', {}, h('summary', {}, 'Rules (gameplay approximations)'), h('ul', {}, list.map(t => h('li', {}, t))));
  const pad = kind => {
    const step = (dx, dy, dz = 0) => () => app.localMove({ dx, dy, dz });
    return h('div', { class: 'pad', role: 'group', 'aria-label': 'Vehicle controls' },
      h('button', { class: 'mini', 'aria-label': 'Forward', id: 'drive-up', on: { click: step(0, -2) } }, '▲'), h('button', { class: 'mini', 'aria-label': 'Left', on: { click: step(-2, 0) } }, '◀'), h('button', { class: 'mini', 'aria-label': 'Right', on: { click: step(2, 0) } }, '▶'), h('button', { class: 'mini', 'aria-label': 'Back', on: { click: step(0, 2) } }, '▼'),
      kind === 'ocean' ? [h('button', { class: 'mini', 'aria-label': 'Dive', id: 'sub-dive', on: { click: step(0, 0, 400) } }, 'Dive'), h('button', { class: 'mini', 'aria-label': 'Ascend', id: 'sub-ascend', on: { click: step(0, 0, -400) } }, 'Ascend')] : null);
  };
  function start(kind) {
    const c = app.selected; if (c < 0) return status('Select a place on the globe first.');
    const ocean = kind === 'ocean'; if (ocean !== app.planet.elevation[c] < 0) return status(ocean ? 'Choose an ocean site.' : 'Choose a land site.');
    if (ocean && -app.planet.elevation[c] > VEHICLES.sub.crushDepth + 1500) status('Warning: much of this seafloor is deeper than the hull rating.');
    const patch = buildPatch(app.planet, c, { kind }), list = sites(app.planet, patch);
    mission = { kind, cell: c, patch, sites: list, state: newVehicle(patch, kind) };
    app.enterLocal(patch, list, kind, mission.state, s => { mission.state = s; if (s.over) app.store.apply('journal', { id: `${kind}-${app.planet.seed}-${c}-${app.store.state.journal.length}`, title: (ocean ? 'Dive' : 'Surface mission') + (s.won ? ' completed' : ' failed') + ` at ${app.planet.lat[c]}°, ${app.planet.lon[c]}°`, kind, won: s.won, samples: s.collected.map(k => list[k].type) }); rerender(); });
    rerender();
  }
  const panel = kind => () => {
    const ocean = kind === 'ocean', V = VEHICLES[ocean ? 'sub' : 'rover'];
    if (!mission || mission.kind !== kind) return h('div', {}, h('p', {}, ocean ? 'Select an ocean site on the globe, then dive. The seafloor comes from the world\'s bathymetry.' : 'Select a land site on the globe, then descend. The terrain comes from the world\'s elevations.'),
      h('button', { class: 'mini', id: ocean ? 'sub-start' : 'rover-start', on: { click: () => start(kind) } }, ocean ? 'Deploy submersible' : 'Descend to the surface'), rules(V.text));
    const s = mission.state, p = mission.patch, floor = Math.round(-heightAt(p, s.x, s.y));
    return h('div', {}, h('p', {}, `${ocean ? 'Depth ' + Math.round(s.depth).toLocaleString('en-US') + ' m of ' + floor.toLocaleString('en-US') + ' m · pressure ' + pressureBar(s.depth).toFixed(1) + ' bar' : 'Elevation ' + Math.round(heightAt(p, s.x, s.y)).toLocaleString('en-US') + ' m'} · energy ${s.energy.toFixed(1)} · samples ${s.collected.length}/${Math.min(ocean ? 2 : 3, mission.sites.length)}`),
      s.over ? h('p', { class: 'verdict' }, s.won ? 'Mission complete.' : 'Mission failed.') : pad(kind),
      h('p', { class: 'fine' }, 'Keys while the view is focused: arrows or WASD to move' + (ocean ? ', Q/E to dive and ascend.' : '.') + ' Relief is exaggerated ×4.'),
      h('ul', {}, mission.sites.map((t, k) => h('li', {}, (s.collected.includes(k) ? '✔ ' : '○ ') + `${t.type} — ${t.info}`))),
      h('ol', { class: 'events' }, s.log.slice(-6).map(l => h('li', {}, l))),
      h('p', { class: 'fine' }, p.note),
      h('button', { class: 'mini', id: 'return-orbit', on: { click: () => { app.exitLocal(); app.select(mission.cell); app.flyTo(mission.cell); mission = null; rerender(); } } }, 'Return to orbit'));
  };
  const panels = {
    rover: panel('surface'),
    sub: panel('ocean'),
    lab() {
      const which = h('select', { 'aria-label': 'Intervention', id: 'lab-intervention' }, Object.entries(INTERVENTIONS).map(([k, v]) => h('option', { value: k }, v)));
      const tilt = h('input', { type: 'number', min: 0, max: 90, value: 45, 'aria-label': 'Experimental tilt', id: 'lab-tilt', style: 'width:70px' });
      const run = () => { status('Running the experiment (the full climate model, about two seconds)…'); setTimeout(() => {
        const r = runExperiment(app.planet, app.planet.mesh, which.value, Number(tilt.value)); if (r.error) return status(r.error);
        if (which.value === 'glacial') app.showGlacial();
        exp = { ...r, d: delta(r.before, r.after) }; exp.world = null; app.setDiffMap(r.dT);
        app.store.apply('journal', { id: 'lab-' + app.store.state.journal.length, title: `Experiment: ${INTERVENTIONS[r.intervention]}${r.value !== null ? ' → ' + r.value + '°' : ''}`, kind: 'experiment', baselineTilt: app.planet.tilt, value: r.value, delta: exp.d });
        status(''); rerender(); }, 20); };
      const row = (label, k, unit, pct) => { const b = exp.before[k], a = exp.after[k], d = exp.d[k]; return h('tr', {}, h('td', {}, label), h('td', {}, b === null ? '—' : pct ? (b * 100).toFixed(1) + ' %' : b + unit), h('td', {}, a === null ? '—' : pct ? (a * 100).toFixed(1) + ' %' : a + unit), h('td', {}, d === null ? '—' : (d > 0 ? '+' : '') + (pct ? (d * 100).toFixed(1) + ' pts' : d + unit))); };
      return h('div', {}, h('p', {}, `Baseline: ${app.planet.seed}, tilt ${app.planet.tilt}°, model ${app.planet.version}. The baseline world is never modified.`),
        h('div', { class: 'row wrap' }, which, tilt, h('button', { class: 'mini', id: 'lab-run', on: { click: run } }, 'Run experiment'), h('button', { class: 'mini', id: 'lab-revert', on: { click: () => { exp = null; app.setDiffMap(null); status('Reverted: showing the baseline world.'); rerender(); } } }, 'Revert')),
        exp ? h('div', {}, h('table', { class: 'grid' }, h('tr', {}, ['Metric', 'baseline', 'experiment', 'change'].map(t => h('th', {}, t))), row('Mean temperature', 'meanTempC', ' °C'), row('Land mean temperature', 'landMeanTempC', ' °C'), row('Land fraction', 'landFraction', '', true), row('Ice-covered land', 'iceLandShare', '', true), row('Desert land', 'desertLandShare', '', true), row('Mild, wet land (habitability)', 'habitableLandShare', '', true), row('Mean land rainfall', 'meanLandRainMm', ' mm')),
          h('p', { class: 'fine' }, exp.note + ' The globe shows the temperature change (blue colder, red warmer) on the current layer colours\' place; Revert restores the baseline.')) : null,
        h('p', { class: 'fine' }, 'Only interventions the scientific model supports are offered. Terraforming, ocean engineering or atmospheric chemistry would need new, validated, versioned models.'));
    }
  };
  return { panels, reset() { if (mission) app.exitLocal(); mission = null; exp = null; app.setDiffMap(null); } };
}
