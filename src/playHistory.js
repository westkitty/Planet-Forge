// Play-tab panels for Milestone 4: River Kingdoms (PF-15), Deep Time (PF-23), Ruins (PF-33), The Silent Planet (PF-21)
// and Life Finds a Way (PF-20). One recorded history (simulateHistory with the player's decisions) feeds the first four.
import { simulateHistory, snapshotAt, epochs, compareBranches, ruinState, excavate, mysteries, judgeCase, RULES as CR } from './gameplay/civilization.js';
import { newEcology, stepEcology, fieldGuide, tree, RULES as ER } from './gameplay/ecology.js';
import { ringDistance } from './geo.js';

export const HISTORY_MODES = { kingdoms: 'River Kingdoms', deeptime: 'Deep Time', ruins: 'The World Remembers', mystery: 'The Silent Planet', life: 'Life Finds a Way' };

export function historyPanels(app, h, status, rerender) {
  let hist = null, year = CR.years, playing = null, caseIdx = 0, notebook = [], verdict = null, eco = null, ecoPressure = 'none', focus = -1;
  const decisions = () => app.store.state.flags['history:' + app.planet.seed] || [];
  const branches = () => app.store.state.flags['branches:' + app.planet.seed] || [];
  const history = () => { const d = decisions(), key = JSON.stringify(d); if (!hist || hist.key !== key || hist.seed !== app.planet.seed) hist = { key, seed: app.planet.seed, h: simulateHistory(app.planet, d, 0) }; return hist.h; };
  const showYear = () => { const H = history(), s = snapshotAt(H, year), peak = Math.max(1, ...H.snapshots.flatMap(x => x.pop)); app.setSettlementState(s.pop.map(n => n / peak), s.founded.map((f, k) => !f ? 2 : s.alive[k] ? 0 : 1)); };
  const rules = list => h('details', {}, h('summary', {}, 'Rules (gameplay approximations)'), h('ul', {}, list.map(t => h('li', {}, t))));
  const table = (head, rows) => h('table', { class: 'grid' }, h('tr', {}, head.map(t => h('th', {}, t))), rows.map(r => h('tr', {}, r.map(v => h('td', {}, v)))));
  const go = cell => h('button', { class: 'mini', on: { click: () => { app.select(cell); app.flyTo(cell); } } }, 'Go');

  const panels = {
    kingdoms() {
      const H = history(), last = H.snapshots[H.snapshots.length - 1];
      const who = h('select', { 'aria-label': 'Settlement' }, H.sites.map(s => h('option', { value: s.k }, s.name)));
      const kind = h('select', { 'aria-label': 'Investment' }, ['irrigation', 'granary', 'road'].map(k => h('option', { value: k }, k)));
      const when = h('input', { type: 'number', min: 0, max: CR.years, step: 10, value: 500, 'aria-label': 'Year (decade)' });
      const add = () => {
        const y = Math.round(Number(when.value) / 10) * 10; if (!(y >= 0 && y <= CR.years)) return status('Year must be 0–2000.');
        const d = decisions(); if (d.some(x => x.year === y)) return status('One investment per decade.');
        app.store.apply('flag', { key: 'history:' + app.planet.seed, value: [...d, { year: y, k: Number(who.value), kind: kind.value }].sort((a, b) => a.year - b.year) }); rerender();
      };
      const shown = showYear();
      return h('div', {}, h('p', {}, `${H.sites.length} settlements over ${CR.years} years; ${H.routes.length} trade routes; ${H.ruins.length} abandoned.`),
        table(['Settlement', 'capacity', 'year 2000', 'status'], H.sites.map(s => [s.name, s.capacity.toLocaleString('en-US'), last.pop[s.k].toLocaleString('en-US'), H.ruins.find(r => r.k === s.k) ? 'abandoned ' + H.ruins.find(r => r.k === s.k).abandoned : 'thriving'])),
        h('h4', {}, 'Decisions'), h('div', { class: 'row wrap' }, who, kind, when, h('button', { class: 'mini', id: 'kingdom-invest', on: { click: add } }, 'Invest')),
        h('ul', {}, decisions().map((d, i) => h('li', {}, `Year ${d.year}: ${d.kind} at ${H.sites[d.k].name} `, h('button', { class: 'mini', on: { click: () => { app.store.apply('flag', { key: 'history:' + app.planet.seed, value: decisions().filter((_, j) => j !== i) }); rerender(); } } }, 'Remove')))),
        h('h4', {}, 'Recent history'), h('ol', { class: 'events' }, H.events.filter(e => e.type !== 'drought' || e.year > 1800).slice(-14).map(e => h('li', {}, `${e.year}: ${e.text}`))),
        rules(CR.text));
    },
    deeptime() {
      const H = history(), s = snapshotAt(H, year);
      const slider = h('input', { type: 'range', min: 0, max: CR.years, step: CR.stepYears, value: year, 'aria-label': 'Year', id: 'deeptime-year' });
      slider.addEventListener('input', () => { year = Number(slider.value); showYear(); rerender(); });
      const play = () => { if (playing) { clearInterval(playing); playing = null; rerender(); return; } playing = setInterval(() => { year = Math.min(CR.years, year + 50); showYear(); rerender(); if (year >= CR.years) { clearInterval(playing); playing = null; } }, app.reducedMotion() ? 900 : 400); rerender(); };
      const evs = H.events.filter(e => e.year <= year && e.year > year - 100 && e.type !== 'drought');
      const save = () => { const name = 'Branch ' + (branches().length + 1); app.store.apply('flag', { key: 'branches:' + app.planet.seed, value: [...branches(), { name, decisions: decisions() }] }); status(name + ' saved.'); rerender(); };
      const cmpSel = h('select', { 'aria-label': 'Compare with branch' }, h('option', { value: '' }, 'Compare with…'), branches().map((b, i) => h('option', { value: i }, b.name)));
      const out = h('div', {});
      cmpSel.addEventListener('change', () => { if (cmpSel.value === '') return out.replaceChildren(); const b = branches()[Number(cmpSel.value)], c = compareBranches(H, simulateHistory(app.planet, b.decisions, 0)); out.replaceChildren(table(['', 'current', b.name], [['population at 2000', c.populationA.toLocaleString('en-US'), c.populationB.toLocaleString('en-US')], ['famines', c.famineA, c.famineB], ['ruins', c.ruinsA.join(', ') || 'none', c.ruinsB.join(', ') || 'none']])); });
      return h('div', {}, h('div', { class: 'row' }, h('button', { class: 'mini', id: 'deeptime-play', on: { click: play } }, playing ? 'Pause' : 'Play'), h('button', { class: 'mini', on: { click: () => { year = 0; showYear(); rerender(); } } }, 'Rewind'), h('b', { id: 'deeptime-label' }, `Year ${s.year}`)), slider,
        h('p', { class: 'fine' }, 'Settlement lights follow the recorded population at this year; ruins show grey; unfounded sites are hidden.'),
        table(['Settlement', 'people', ''], H.sites.map(x => [x.name, s.founded[x.k] ? (s.alive[x.k] ? s.pop[x.k].toLocaleString('en-US') : 'ruin') : '—', go(x.cell)])),
        h('h4', {}, 'This century'), h('ol', { class: 'events' }, evs.map(e => h('li', {}, `${e.year}: ${e.text}`))),
        h('h4', {}, 'Epochs'), h('ul', {}, epochs(app.planet, H).map(e => h('li', {}, h('b', {}, e.name), ` (${e.kind}${e.from !== undefined ? ', years ' + e.from + '–' + e.to : ''}): ${e.text}`))),
        h('h4', {}, 'Branches'), h('div', { class: 'row' }, h('button', { class: 'mini', id: 'branch-save', on: { click: save } }, 'Save this history as a branch'), cmpSel), out,
        h('p', { class: 'fine' }, 'Computed states come from the world model; recorded history comes from the River Kingdoms simulation and your decisions. Geological change between epochs is not simulated.'));
    },
    ruins() {
      const H = history(); if (!H.ruins.length) return h('p', {}, 'No settlement has been abandoned in this history.');
      const out = h('div', { 'aria-live': 'polite' });
      const dig = r => () => { const x = excavate(H, r); app.select(r.cell); app.flyTo(r.cell); app.store.apply('discover', { id: 'ruin-' + app.planet.seed + '-' + r.k + '-' + r.abandoned, name: 'Ruin of ' + r.name, cell: r.cell }); out.replaceChildren(h('h4', {}, 'Excavation: ' + x.ruin), h('ul', {}, x.facts.map(f => h('li', {}, f))), h('ol', { reversed: '' }, x.layers.slice().reverse().map(l => h('li', {}, `Layer ${l.year}: ${l.record}`))), h('p', {}, h('i', {}, x.interpretation)), h('p', { class: 'fine' }, x.note)); };
      return h('div', {}, table(['Ruin', 'founded', 'abandoned', 'state in year ' + year, ''], H.ruins.map(r => [r.name, r.founded, r.abandoned, ruinState(r, year) || 'still inhabited', h('button', { class: 'mini', 'data-ruin': r.k, on: { click: dig(r) } }, 'Excavate')])), out);
    },
    mystery() {
      const H = history(), cases = mysteries(app.planet, H); if (!cases.length) return h('p', {}, 'No solvable vanished settlement in this history. Change the River Kingdoms decisions or forge another world.');
      caseIdx = Math.min(caseIdx, cases.length - 1); const c = cases[caseIdx];
      const sel = h('select', { 'aria-label': 'Case' }, cases.map((x, i) => h('option', { value: i, ...(i === caseIdx ? { selected: '' } : {}) }, 'The silence of ' + x.ruin)));
      sel.addEventListener('change', () => { caseIdx = Number(sel.value); notebook = []; verdict = null; rerender(); });
      const examine = clue => () => {
        if (app.selected < 0) return status('Go to the site first.');
        const near = ringDistance(app.planet.mesh, i => i === clue.cell, 2)[app.selected] >= 0; if (!near) return status('Too far from the site: select within two cells of it.');
        let added = 0; for (const e of clue.evidence) if (!notebook.some(n => n.text === e.text)) { notebook.push(e); added++; }
        status(added ? `${added} note${added > 1 ? 's' : ''} added to the field notebook.` : 'Nothing new here.'); app.pulse(clue.cell, 'discovery'); rerender();
      };
      const hyp = h('select', { 'aria-label': 'Hypothesis', id: 'mystery-hypothesis' }, Object.entries(c.hypotheses).map(([k, v]) => h('option', { value: k }, v)));
      const conclude = () => { verdict = judgeCase(c, notebook, hyp.value); if (verdict.solved) app.store.apply('journal', { id: 'mystery-' + app.planet.seed + '-' + c.ruin, title: 'Solved: the silence of ' + c.ruin, kind: 'mystery', cause: c.answer, evidence: notebook.length }); rerender(); };
      return h('div', {}, sel, h('p', {}, `${c.ruin} fell silent. Visit the clue sites, examine them, then name the cause.`),
        h('ul', {}, c.clues.map(cl => h('li', {}, cl.title + ' ', h('button', { class: 'mini', on: { click: () => { app.select(cl.cell); app.flyTo(cl.cell); } } }, 'Go to site'), h('button', { class: 'mini', 'data-clue': cl.id, on: { click: examine(cl) } }, 'Examine')))),
        h('h4', {}, `Field notebook (${notebook.length})`), h('ul', {}, notebook.map(n => h('li', {}, n.text))),
        h('div', { class: 'row' }, hyp, h('button', { class: 'mini', id: 'mystery-conclude', on: { click: conclude } }, 'Conclude')),
        verdict ? h('p', { class: 'verdict' }, (verdict.solved ? 'Solved. ' : 'Not solved. ') + verdict.reason) : null,
        h('p', { class: 'fine' }, c.note));
    },
    life() {
      if (!eco || eco.seed !== app.planet.seed) { eco = newEcology(app.planet, 0); eco.seed = app.planet.seed; focus = -1; }
      const pressure = () => ecoPressure === 'glacial' ? { glacial: true } : ecoPressure === 'none' ? {} : { dT: Number(ecoPressure) };
      const step = n => () => { if (ecoPressure === 'glacial') app.showGlacial(); const seed = eco.seed; for (let i = 0; i < n; i++) eco = stepEcology(app.planet, eco, pressure()); eco.seed = seed; if (focus >= 0) highlight(); rerender(); };
      const ps = h('select', { 'aria-label': 'Environmental pressure', id: 'life-pressure' }, [['none', 'No pressure'], ['3', 'Warming +3 °C'], ['6', 'Warming +6 °C'], ['-6', 'Cooling −6 °C'], ['glacial', 'Glacial maximum']].map(([v, t]) => h('option', { value: v, ...(v === ecoPressure ? { selected: '' } : {}) }, t)));
      ps.addEventListener('change', () => { ecoPressure = ps.value; });
      const highlight = () => { const sp = eco.species[focus]; if (!sp) return; const cells = []; eco.regions.forEach((r, k) => { if (sp.pop[k] > 0) for (let i = 0; i < r.cells.length; i += 4) cells.push(r.cells[i]); }); app.highlight(cells); };
      const guide = fieldGuide(eco), living = guide.filter(g => g.status === 'living').length;
      return h('div', {}, h('p', {}, `Generation ${eco.generation}; ${living} living species of ${guide.length}; ${eco.regions.length} regions.`),
        h('div', { class: 'row wrap' }, ps, h('button', { class: 'mini', id: 'life-step', on: { click: step(1) } }, '+1 generation'), h('button', { class: 'mini', id: 'life-step10', on: { click: step(10) } }, '+10')),
        h('h4', {}, 'Field guide'), table(['Species', 'status', 'T opt', 'rain', 'regions', ''], guide.map(g => [g.name + (g.parent ? ` (from ${g.parent})` : ''), g.status, g.tOpt + ' °C', g.rainPref + ' mm', g.regions, h('button', { class: 'mini', on: { click: () => { focus = g.id; highlight(); } } }, 'Range')])),
        h('h4', {}, 'Tree of descent'), h('ul', { class: 'events' }, tree(eco).map(t => h('li', { style: `margin-left:${t.depth * 14}px` }, (t.extinct ? '† ' : '') + t.name + (t.born ? ` (gen ${t.born})` : '')))),
        h('h4', {}, 'History of life'), h('ol', { class: 'events' }, eco.events.filter(e => e.type !== 'origin').slice(-12).map(e => h('li', {}, `Gen ${e.generation}: ${e.text}`))),
        rules(ER.text));
    }
  };
  return { panels, reset() { hist = null; year = CR.years; caseIdx = 0; notebook = []; verdict = null; eco = null; focus = -1; if (playing) clearInterval(playing); playing = null; } };
}
