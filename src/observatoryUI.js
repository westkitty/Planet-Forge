// Observatory drawer: an intentionally opened, dismissible panel over the viewer (the persistent console stays at
// 14.5 % of the screen). Each tab drives a real system: Why (PF-12), Transect (PF-27), Correlate (PF-31),
// Investigate (PF-30), Tours & bookmarks (PF-09), Journal & saves (PF-13). The panel reads the world through `app`.
import { explain, TOPICS, TOPIC_LABELS } from './why.js';
import { transect, transectCsv, QUERIES, runQuery } from './analysis.js';
import { INVESTIGATIONS, investigationAvailability, recordObservation, evaluate, SITES_PER_GROUP, ROUTES } from './observatory.js';
import { makeSave, parseSave } from './gameState.js';
import { createPlay } from './playUI.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f); else if (k === 'text') el.textContent = v; else el.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
};
const download = (name, text, type) => { const url = URL.createObjectURL(new Blob([text], { type })); const a = h('a', { href: url, download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };

export function createObservatoryUI(app) {
  const drawer = document.querySelector('#drawer'), body = drawer.querySelector('.drawer-body'), tabs = [...drawer.querySelectorAll('[role=tab]')];
  let active = 'cell', transectA = -1, transectB = -1, lastTransect = null, inv = { id: null, record: [], result: null }, lastQuery = null;
  const status = msg => { drawer.querySelector('.drawer-status').textContent = msg; };
  const cellLabel = i => i < 0 ? 'none' : `${app.planet.lat[i]}°, ${app.planet.lon[i]}° (cell ${i})`;
  const goButton = (i, text = 'Go') => h('button', { class: 'mini', on: { click: () => { app.select(i); app.flyTo(i); } } }, text);

  function open(tab = active) { drawer.hidden = false; document.querySelector('#observatory').setAttribute('aria-expanded', 'true'); show(tab); }
  function close() { play.leave(); drawer.hidden = true; document.querySelector('#observatory').setAttribute('aria-expanded', 'false'); app.overlays.clearHighlights(); document.querySelector('#observatory').focus(); }
  function show(tab) {
    if (tab !== 'play') play.leave();
    active = tab;
    for (const t of tabs) { const on = t.dataset.tab === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; }
    body.replaceChildren(render[tab]());
    status('');
  }
  const refresh = () => { if (!drawer.hidden) show(active); };

  const play = createPlay(app, msg => status(msg));
  const render = {
    play: () => play.render(),
    cell() {
      const i = app.selected;
      if (i < 0) return h('p', {}, 'Select a place on the globe (click, tap, or Enter for the centre), then ask why it is the way it is.');
      const out = h('div', { class: 'why-out', 'aria-live': 'polite' });
      const ask = topic => { const r = explain(app.planet, i, topic); out.replaceChildren(h('h3', {}, r.question),
        h('h4', {}, 'Computed facts'), h('ul', {}, r.facts.map(t => h('li', {}, t))),
        h('h4', {}, 'Model-based inference'), h('ul', {}, (r.inferences.length ? r.inferences : ['No model rule applies strongly here.']).map(t => h('li', {}, t))),
        h('h4', {}, 'Not modelled / unknown'), h('ul', {}, r.unknowns.map(t => h('li', {}, t))), h('p', { class: 'fine' }, 'Model ' + r.model)); };
      return h('div', {}, h('p', {}, 'Selected: ' + cellLabel(i)),
        h('div', { class: 'row wrap' }, Object.entries(TOPICS).map(([k, q]) => h('button', { class: 'mini', title: q, 'data-topic': k, on: { click: () => ask(k) } }, 'Why: ' + TOPIC_LABELS[k]))),
        h('div', { class: 'row' }, h('button', { class: 'mini', on: { click: () => { app.store.apply('discover', { id: 'cell-' + i, name: 'Site ' + cellLabel(i), cell: i }) ? status('Recorded in the journal.') : status('Already recorded.'); } } }, 'Record discovery')),
        out);
    },
    transect() {
      const out = h('div', {});
      const draw = t => {
        const W = 320, H = 120, rows = t.rows, maxD = t.lengthKm || 1, lo = Math.min(0, t.summary.minElevationM), hi = Math.max(100, t.summary.maxElevationM);
        const x = d => (d / maxD) * W, y = e => H - ((e - lo) / (hi - lo)) * H;
        const line = rows.map((r, k) => (k ? 'L' : 'M') + x(r.distanceKm).toFixed(1) + ' ' + y(r.elevationM).toFixed(1)).join(' ');
        const svg = `<svg viewBox="0 0 ${W} ${H + 14}" width="100%" role="img" aria-label="Elevation profile along the transect"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#4a7ea0" stroke-dasharray="3 3"/><path d="${line}" fill="none" stroke="#f0d49a" stroke-width="1.5"/>${t.crossings.map(c => `<line x1="${x(c.distanceKm)}" x2="${x(c.distanceKm)}" y1="0" y2="${H}" stroke="#6fc3ff" stroke-width="1"/>`).join('')}<text x="0" y="${H + 12}" fill="#9fb8c4" font-size="9">0 km</text><text x="${W}" y="${H + 12}" fill="#9fb8c4" font-size="9" text-anchor="end">${t.lengthKm} km</text><text x="2" y="9" fill="#9fb8c4" font-size="9">${hi} m</text><text x="2" y="${H - 2}" fill="#9fb8c4" font-size="9">${lo} m</text></svg>`;
        const s = t.summary;
        out.replaceChildren(h('div', { class: 'svgbox' }), h('ul', {},
          h('li', {}, `${t.lengthKm.toLocaleString('en-US')} km, ${t.samples} cells (sampled every ${t.sampleSpacingKm} km)`),
          h('li', {}, `Elevation ${s.minElevationM} to ${s.maxElevationM} m; deepest water ${s.maxDepthM} m`),
          h('li', {}, `Temperature ${s.tempRangeC[0]} to ${s.tempRangeC[1]} °C; rainfall ${s.rainRangeMm[0]}–${s.rainRangeMm[1]} mm/yr`),
          h('li', {}, `River crossings: ${s.riverCrossings}${t.crossings.length ? ' (' + t.crossings.map(c => c.distanceKm + ' km, ' + c.dischargeM3s.toLocaleString('en-US') + ' m³/s').join('; ') + ')' : ''} — blue lines`),
          h('li', {}, `Ice thickness: ${s.iceModelled ? 'included (glacial maximum)' : 'not computed'}`)),
          h('p', { class: 'fine' }, t.limitations),
          h('div', { class: 'row' }, h('button', { class: 'mini', on: { click: () => download('transect.csv', transectCsv(t), 'text/csv') } }, 'Export CSV'), h('button', { class: 'mini', on: { click: () => download('transect.json', JSON.stringify(t, null, 1), 'application/json') } }, 'Export JSON')));
        out.firstChild.innerHTML = svg;
      };
      const run = () => {
        if (transectA < 0 || transectB < 0 || transectA === transectB) return status('Set two different end points first.');
        lastTransect = transect(app.planet, transectA, transectB); app.overlays.showTransect(lastTransect.rows); draw(lastTransect); status('Transect drawn on the globe.');
      };
      const ends = h('p', {}, `Start: ${cellLabel(transectA)} · End: ${cellLabel(transectB)}`);
      const set = which => () => { if (app.selected < 0) return status('Select a place on the globe first.'); if (which === 'A') transectA = app.selected; else transectB = app.selected; ends.textContent = `Start: ${cellLabel(transectA)} · End: ${cellLabel(transectB)}`; };
      if (lastTransect && lastTransect.from === transectA && lastTransect.to === transectB) draw(lastTransect);
      return h('div', {}, h('p', {}, 'Select a place, set it as the start, select another, set the end, then draw the cross-section.'), ends,
        h('div', { class: 'row' }, h('button', { class: 'mini', on: { click: set('A') } }, 'Set start'), h('button', { class: 'mini', on: { click: set('B') } }, 'Set end'), h('button', { class: 'mini', id: 'transect-run', on: { click: run } }, 'Draw transect'), h('button', { class: 'mini', on: { click: () => { app.overlays.clearTransect(); lastTransect = null; out.replaceChildren(); } } }, 'Clear')), out);
    },
    correlate() {
      const sel = h('select', { 'aria-label': 'Correlation query', id: 'query' }, Object.entries(QUERIES).map(([k, q]) => h('option', { value: k }, q.title)));
      const params = h('div', { class: 'row wrap' }), out = h('div', { 'aria-live': 'polite' });
      const fill = () => { const q = QUERIES[sel.value]; params.replaceChildren(...Object.entries(q.params).map(([k, v]) => h('label', { class: 'param' }, k + ' ', h('input', { type: 'number', name: k, value: v, step: 'any', 'aria-label': k })))); };
      sel.addEventListener('change', fill); fill();
      const run = () => {
        const prm = {}; for (const inp of params.querySelectorAll('input')) { const v = Number(inp.value); if (!Number.isFinite(v)) return status('Parameters must be numbers.'); prm[inp.name] = v; }
        const t0 = performance.now(), r = runQuery(app.planet, sel.value, prm), ms = Math.round(performance.now() - t0); lastQuery = r;
        const shown = app.overlays.highlight(r.matches);
        out.replaceChildren(h('p', {}, r.logic), r.kind === 'compare'
          ? h('ul', {}, h('li', {}, `${r.count.toLocaleString('en-US')} matching cells highlighted${shown < r.count ? ' (first ' + shown + ')' : ''}`), h('li', {}, `Share where B holds: ${(r.shareB * 100).toFixed(1)}% of ${r.inB.toLocaleString('en-US')} cells`), h('li', {}, `Share across all P: ${(r.shareP * 100).toFixed(1)}% of ${r.population.toLocaleString('en-US')} cells`), h('li', {}, `Lift: ${r.lift === null ? 'n/a' : r.lift.toFixed(2)}× (${r.lift > 1.1 ? 'over-represented' : r.lift < 0.9 ? 'under-represented' : 'about as common'})`))
          : h('p', {}, `${r.count} of ${r.population} settlements within the threshold.`),
          h('h4', {}, 'Ranked findings'), h('ol', {}, r.ranked.map(x => h('li', {}, `${x.label}: ${typeof x.value === 'number' ? (Number.isFinite(x.value) ? Math.round(x.value).toLocaleString('en-US') : 'none') : x.value}${x.unit ? ' ' + x.unit : ''} `, goButton(x.cell)))),
          h('p', { class: 'fine' }, r.caution + ` Computed in ${ms} ms.`));
        app.lastQuery = r;
      };
      return h('div', {}, sel, params, h('button', { class: 'mini', id: 'query-run', on: { click: run } }, 'Run query'), out);
    },
    investigate() {
      const avail = investigationAvailability(app.planet);
      const sel = h('select', { 'aria-label': 'Investigation', id: 'investigation' }, h('option', { value: '' }, 'Choose an investigation…'), Object.entries(INVESTIGATIONS).map(([k, v]) => h('option', avail[k] ? { value: k } : { value: k, disabled: '' }, v.title + (avail[k] ? '' : ' (not possible on this world)'))));
      if (inv.id) sel.value = inv.id;
      const out = h('div', { 'aria-live': 'polite' });
      const paint = () => {
        if (!inv.id) return out.replaceChildren();
        const d = INVESTIGATIONS[inv.id], list = g => inv.record.filter(o => o.group === g).map(o => h('li', {}, `${o.lat}°, ${o.lon}°: ${o.value} ${d.measure.unit} `, goButton(o.cell)));
        const add = g => () => {
          if (app.selected < 0) return status('Select a site on the globe first.');
          const r = recordObservation(app.planet, inv.id, inv.record, g, app.selected);
          if (!r.ok) return status(r.reason);
          inv.record.push(r.observation); inv.result = null; app.overlays.pulse(app.selected, 'observation'); status(`Measured ${r.observation.value} ${d.measure.unit}.`); paint();
        };
        const conclude = claim => () => {
          const r = evaluate(inv.id, inv.record, claim); if (!r.complete) return status(r.reason);
          inv.result = { ...r, claim };
          app.store.apply('journal', { id: inv.id + '-' + app.store.state.journal.length, title: d.title, kind: 'investigation', world: app.planet.seed, claim, verdict: r.verdict, correct: r.correct, meanA: r.meanA, meanB: r.meanB, unit: r.unit, observations: inv.record.slice() });
          paint();
        };
        out.replaceChildren(h('p', {}, d.question), h('p', {}, h('b', {}, 'H1: '), d.h1), h('p', {}, h('b', {}, 'H0: '), d.h0), h('p', { class: 'fine' }, `Measure: ${d.measure.label} (${d.measure.unit}). Group A: ${d.groups.A.rule}. Group B: ${d.groups.B.rule}. ${SITES_PER_GROUP} sites each.`),
          h('div', { class: 'row' }, h('button', { class: 'mini', id: 'inv-add-a', on: { click: add('A') } }, 'Add selected as A'), h('button', { class: 'mini', id: 'inv-add-b', on: { click: add('B') } }, 'Add selected as B')),
          h('h4', {}, 'A — ' + d.groups.A.label + 's'), h('ul', {}, list('A')), h('h4', {}, 'B — ' + d.groups.B.label + 's'), h('ul', {}, list('B')),
          h('div', { class: 'row' }, h('button', { class: 'mini', id: 'inv-supported', on: { click: conclude('supported') } }, 'Conclude: H1 supported'), h('button', { class: 'mini', id: 'inv-rejected', on: { click: conclude('rejected') } }, 'Conclude: H1 rejected')),
          inv.result ? h('div', { class: 'verdict' }, h('p', {}, `Observed: mean A ${inv.result.meanA} vs mean B ${inv.result.meanB} ${inv.result.unit} (difference ${inv.result.difference}).`), h('p', {}, `${inv.result.rule} The evidence says: H1 ${inv.result.verdict}. Your conclusion was ${inv.result.correct ? 'consistent with the evidence' : 'not consistent with the evidence'}.`), h('p', { class: 'fine' }, inv.result.note)) : null);
      };
      sel.addEventListener('change', () => { inv = { id: sel.value || null, record: [], result: null }; paint(); });
      paint();
      return h('div', {}, sel, out);
    },
    tours() {
      const sel = h('select', { 'aria-label': 'Tour route', id: 'tour-route' }, Object.entries(ROUTES).map(([k, v]) => h('option', { value: k }, v)));
      const name = h('input', { 'aria-label': 'Bookmark name', placeholder: 'Bookmark name', maxlength: '40' });
      const list = h('ul', {}, app.store.state.bookmarks.map(b => h('li', {}, b.name + ' ', h('button', { class: 'mini', on: { click: () => app.restoreView(b) } }, 'Go'), h('button', { class: 'mini', on: { click: () => app.store.apply('unbookmark', { name: b.name }) } }, 'Delete'))));
      return h('div', {}, h('p', {}, 'Tours fly the globe to places picked from this world\'s data. Any drag, wheel, key or tap stops a tour immediately.'),
        h('div', { class: 'row' }, sel, h('button', { class: 'mini', id: 'tour-start', on: { click: () => app.startTour(sel.value) } }, 'Start tour'), h('button', { class: 'mini', on: { click: () => app.stopTour('stopped') } }, 'Stop')),
        h('p', { class: 'tour-progress', 'aria-live': 'polite' }, app.tourText()),
        h('h4', {}, 'Bookmarks'), h('div', { class: 'row' }, name, h('button', { class: 'mini', id: 'bookmark-save', on: { click: () => { const n = name.value.trim() || 'View ' + (app.store.state.bookmarks.length + 1); app.store.apply('bookmark', { name: n, ...app.captureView() }); } } }, 'Save view')), list);
    },
    journal() {
      const s = app.store.state, file = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Import a save file', id: 'save-import' });
      const load = text => { const r = parseSave(text, app.planet.version); if (!r.ok) return status('Load refused: ' + r.error); app.loadSave(r.save); status('Save loaded.'); };
      file.addEventListener('change', () => { const f = file.files[0]; if (!f) return; if (f.size > 2e6) return status('Load refused: file larger than 2 MB'); f.text().then(load); });
      const save = () => makeSave(app.worldIdentity(), app.captureView(), app.store.state);
      return h('div', {},
        h('div', { class: 'row wrap' },
          h('button', { class: 'mini', id: 'save-local', on: { click: () => { localStorage.setItem('planet-forge-save', JSON.stringify(save())); status('Saved in this browser.'); } } }, 'Save'),
          h('button', { class: 'mini', id: 'load-local', on: { click: () => { const t = localStorage.getItem('planet-forge-save'); t ? load(t) : status('No save in this browser yet.'); } } }, 'Load'),
          h('button', { class: 'mini', id: 'save-export', on: { click: () => download('planet-forge-' + app.planet.seed.replace(/[^a-z0-9-]/gi, '_') + '.save.json', JSON.stringify(save(), null, 1), 'application/json') } }, 'Export save'),
          file,
          h('button', { class: 'mini', id: 'undo', ...(app.store.canUndo() ? {} : { disabled: '' }), on: { click: () => app.store.undo() } }, 'Undo'),
          h('button', { class: 'mini', id: 'redo', ...(app.store.canRedo() ? {} : { disabled: '' }), on: { click: () => app.store.redo() } }, 'Redo')),
        h('p', { class: 'fine' }, 'Saves store the world seed, tilt and model version (the world is regenerated exactly), the view and your gameplay record — never the world data itself. The atlas export is unchanged.'),
        h('h4', {}, `Discoveries (${s.discoveries.length})`), h('ul', {}, s.discoveries.map(d => h('li', {}, d.name + ' ', goButton(d.cell)))),
        h('h4', {}, `Investigations (${s.journal.length})`), h('ul', {}, s.journal.map(j => h('li', {}, `${j.title}: you concluded H1 ${j.claim}; evidence ${j.verdict} (A ${j.meanA} vs B ${j.meanB} ${j.unit})`))),
        h('h4', {}, `Event log (${s.events.length})`), h('ol', { class: 'events' }, s.events.slice(-30).map(e => h('li', {}, `#${e.seq} ${e.summary}`))));
    }
  };

  document.querySelector('#observatory').addEventListener('click', () => drawer.hidden ? open() : close());
  drawer.querySelector('.drawer-close').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) { e.preventDefault(); close(); } });
  drawer.addEventListener('keydown', e => {
    if (e.target.getAttribute('role') === 'tab' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { const k = tabs.indexOf(e.target), n = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; show(n.dataset.tab); n.focus(); }
  });
  for (const t of tabs) t.addEventListener('click', () => show(t.dataset.tab));
  app.store.subscribe(() => { if (active === 'journal' || active === 'tours') refresh(); });
  // the Play tab re-renders itself; it is not refreshed on store changes so in-progress inputs are kept
  return { open, close, refresh, show, get active() { return active; }, resetWorld() { play.reset(); transectA = transectB = -1; lastTransect = null; inv = { id: null, record: [], result: null }; refresh(); } };
}
