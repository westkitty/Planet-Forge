// "Play" tab of the observatory drawer: Milestone 3 modes. Every panel drives the pure gameplay modules in
// src/gameplay/ and records outcomes in the gameplay store; none of them writes to the world.
import { generateTrials, attempt, hint, parseChallenge, KINDS } from './gameplay/trials.js';
import { forecast, runExpedition, RULES as XR } from './gameplay/expedition.js';
import { newSurvey, scan, progress, SURVEY } from './gameplay/survey.js';
import { riversForCouncil, setupBasin, simulateCouncil, RULES as WR } from './gameplay/watershed.js';
import { setupThaw, newThaw, thawTurn, RULES as TR } from './gameplay/thaw.js';
import { newCampaign, act, advance, forecastRisk, impactLab, RULES as FR } from './gameplay/faultline.js';
import { monthName } from './gameplay/core.js';
import { historyPanels, HISTORY_MODES } from './playHistory.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f); else el.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
};
const rules = list => h('details', {}, h('summary', {}, 'Rules (gameplay approximations)'), h('ul', {}, list.map(t => h('li', {}, t))));
export const MODES_M3 = { trials: 'Planet Trials', expedition: 'Seasonal expedition', survey: 'Cartographer\'s Oath', watershed: 'Watershed Council', thaw: 'The Great Thaw', faultline: 'Faultline Command' };
export const MODES = { ...MODES_M3, ...HISTORY_MODES };

export function createPlay(app, status) {
  let mode = 'trials', trials = null, trialMsg = {}, exp = { from: -1, to: -1, party: 6, supplies: 300, forced: false, month: 0, fc: null, result: null };
  let council = { river: 0, irrigation: [1, 1, 1, 1], reservoir: [false, false, false, false], result: null }, thaw = { setup: undefined, state: null }, fault = null, lab = null;
  const cell = i => i < 0 ? 'none' : `${app.planet.lat[i]}°, ${app.planet.lon[i]}°`;
  let root = null; const rerender = () => { if (root?.isConnected) root.replaceWith(render()); };
  const panels = {
    trials() {
      if (!trials) trials = generateTrials(app.planet, 1);
      const code = h('input', { 'aria-label': 'Challenge code', value: trials.code, size: '18' });
      const list = trials.trials.map((t, k) => {
        const month = h('select', { 'aria-label': 'Departure month' }, Array.from({ length: 12 }, (_, m) => h('option', { value: m }, monthName(m))));
        const go = () => {
          const r = attempt(app.planet, t, t.kind === 'route' ? Number(month.value) : app.selected);
          if (r.result.error) return status(r.result.error);
          trials.trials[k] = r.trial; trialMsg[k] = r.result;
          if (r.trial.won) { app.store.apply('journal', { id: `trial-${trials.code}-${t.kind}`, title: 'Trial won: ' + t.title, kind: 'trial', score: r.trial.score, code: trials.code }); if (trials.trials.every(x => x.won)) app.store.apply('flag', { key: 'achievement:all-trials:' + app.planet.seed, value: true }); }
          rerender();
        };
        const hn = () => { const r = hint(app.planet, t); trials.trials[k] = r.trial; status(r.text); if (r.cell >= 0) app.flyToLat(app.planet.lat[r.cell]); rerender(); };
        const m = trialMsg[k], target = t.kind === 'climate' ? ` (Köppen pair from this world)` : t.kind === 'route' ? `: ${t.params.fromName} → ${t.params.toName}` : t.kind === 'basin' ? ` (≥ ${t.params.minKm2.toLocaleString('en-US')} km²)` : '';
        return h('li', { class: 'trial' }, h('b', {}, t.title + target), h('div', { class: 'fine' }, t.goal + ` Attempts left: ${3 - t.attempts}. Hints used: ${t.hints} (−10 points each).`),
          t.done ? h('div', {}, t.won ? `Won — score ${t.score}.` : 'Out of attempts.') : h('div', { class: 'row' }, t.kind === 'route' ? month : null, h('button', { class: 'mini', 'data-trial': t.kind, on: { click: go } }, t.kind === 'route' ? 'Choose month' : 'Submit selected place'), h('button', { class: 'mini', on: { click: hn } }, 'Hint')),
          m && !m.error ? h('ul', { class: 'fine' }, m.criteria.map(c => h('li', {}, (c.ok ? '✔ ' : '✘ ') + c.name + (c.pts ? ` (${c.pts} pts)` : ''))), h('li', {}, `${m.points} points${m.won ? ' — passed' : ''}`)) : null);
      });
      return h('div', {}, h('p', {}, 'Five challenges generated from this world (each one is checked to be solvable before it is offered).'),
        h('div', { class: 'row' }, h('span', {}, 'Challenge code'), code, h('button', { class: 'mini', on: { click: () => { const c = parseChallenge(code.value); if (!c) return status('Code format: WORLD-SEED~number'); if (c.worldSeed !== app.planet.seed) { app.forge(c.worldSeed); } trials = generateTrials(app.planet, c.gameSeed); trialMsg = {}; rerender(); } } }, 'Load'), h('button', { class: 'mini', on: { click: () => { trials = generateTrials(app.planet, (trials.gameSeed % 999999) + 1); trialMsg = {}; rerender(); } } }, 'New set')),
        h('ol', {}, list), h('p', { class: 'fine' }, 'Share the code: the same world and number always generate the same trials.'));
    },
    expedition() {
      const num = (k, label, min, max) => h('label', { class: 'param' }, label + ' ', h('input', { type: 'number', min, max, value: exp[k], 'aria-label': label, on: { change: e => { exp[k] = Math.max(min, Math.min(max, Number(e.target.value) || min)); } } }));
      const month = h('select', { 'aria-label': 'Departure month', id: 'exp-month' }, Array.from({ length: 12 }, (_, m) => h('option', { value: m, ...(m === exp.month ? { selected: '' } : {}) }, monthName(m))));
      month.addEventListener('change', () => { exp.month = Number(month.value); });
      const set = k => () => { if (app.selected < 0) return status('Select a place first.'); exp[k] = app.selected; exp.fc = exp.result = null; rerender(); };
      const fc = () => { if (exp.from < 0 || exp.to < 0) return status('Set start and destination.'); status('Forecasting twelve departure months…'); setTimeout(() => { exp.fc = forecast(app.planet, exp.from, exp.to, { party: exp.party, forced: exp.forced }); status(''); rerender(); }, 20); };
      const go = () => {
        if (exp.from < 0 || exp.to < 0) return status('Set start and destination.');
        const r = runExpedition(app.planet, { from: exp.from, to: exp.to, month: exp.month, party: exp.party, supplies: exp.supplies, forced: exp.forced, seed: 0 }); // same decisions → same outcome
        if (!r.ok) return status(r.reason);
        exp.result = r; app.showRoute(r.path); for (const x of r.incidents.slice(0, 6)) app.pulse(x.cell, 'hazard'); app.pulse(r.path[r.path.length - 1], 'arrival');
        app.store.apply('journal', { id: 'expedition-' + app.store.state.journal.length, title: `Expedition ${cell(exp.from)} → ${cell(exp.to)} (${r.departure})`, kind: 'expedition', arrived: r.arrived, days: r.days, incidents: r.incidents.length });
        rerender();
      };
      const best = exp.fc ? exp.fc.filter(x => x.possible).sort((a, b) => a.expectedIncidents - b.expectedIncidents || a.days - b.days)[0] : null;
      return h('div', {}, h('p', {}, `Start: ${cell(exp.from)} · Destination: ${cell(exp.to)}`),
        h('div', { class: 'row' }, h('button', { class: 'mini', on: { click: set('from') } }, 'Set start'), h('button', { class: 'mini', on: { click: set('to') } }, 'Set destination')),
        h('div', { class: 'row wrap' }, num('party', 'Party', 1, 40), num('supplies', 'Rations', 10, 5000), h('label', { class: 'param' }, h('input', { type: 'checkbox', ...(exp.forced ? { checked: '' } : {}), 'aria-label': 'Forced march', on: { change: e => { exp.forced = e.target.checked; exp.fc = null; } } }), ' forced march')),
        h('div', { class: 'row' }, h('button', { class: 'mini', id: 'exp-forecast', on: { click: fc } }, 'Forecast 12 months'), month, h('button', { class: 'mini', id: 'exp-go', on: { click: go } }, 'Depart')),
        exp.fc ? h('table', { class: 'grid' }, h('tr', {}, ['Month', 'km', 'days', 'incidents', 'rations'].map(t => h('th', {}, t))), exp.fc.map(x => h('tr', x === best ? { class: 'best' } : {}, x.possible ? [x.name, x.km, x.days, x.expectedIncidents, x.rations].map(v => h('td', {}, v)) : [h('td', {}, x.name), h('td', { colspan: '4' }, 'no route')]))) : null,
        exp.result ? h('div', { class: 'verdict' }, h('p', {}, exp.result.arrived ? `Arrived after ${exp.result.days} days (${exp.result.endMonth}) with ${exp.result.suppliesLeft} rations; ${exp.result.restocks} restocks.` : `Failed on day ${exp.result.days}: rations ran out.`), h('ul', {}, exp.result.incidents.map(x => h('li', {}, `Day ${x.day}: ${x.kind} — ${x.effect}`)))) : null,
        rules(XR.text));
    },
    survey() {
      const s = app.store.state.scenario?.mode === 'survey' ? app.store.state.scenario.survey : null;
      if (!s) return h('div', {}, h('p', {}, 'Map an unknown world with a limited budget of probes and orbital passes. The free atlas stays available: leaving the survey restores the full map.'), h('button', { class: 'mini', id: 'survey-start', on: { click: () => { app.store.apply('scenario', { mode: 'survey', world: app.planet.seed, survey: newSurvey() }); app.setFog(progress(app.planet, newSurvey()).mask); rerender(); } } }, 'Begin survey'));
      const pr = progress(app.planet, s);
      const doScan = action => { const r = scan(app.planet, s, action); if (r.error) return status(r.error); app.store.apply('scenario', { mode: 'survey', world: app.planet.seed, survey: r.survey }); for (const f of r.findings) { app.store.apply('discover', { id: `survey-${f.kind}-${f.cell}`, name: `${f.kind} (${f.note})`, cell: f.cell }); } app.setFog(progress(app.planet, r.survey).mask); status(`Revealed ${r.revealed.toLocaleString('en-US')} cells; ${r.findings.length} new findings.`); rerender(); };
      return h('div', {}, h('p', {}, `Budget left: ${s.budget} (probe 1, orbital pass ${SURVEY.passCost}). Mapped: ${(pr.mapped * 100).toFixed(1)} % of the surface, ${(pr.landMapped * 100).toFixed(1)} % of land.`),
        h('div', { class: 'row' }, h('button', { class: 'mini', id: 'survey-probe', on: { click: () => app.selected < 0 ? status('Select a place to probe.') : doScan({ type: 'probe', cell: app.selected }) } }, 'Probe selected place'), h('button', { class: 'mini', on: { click: () => app.selected < 0 ? status('Select a latitude.') : doScan({ type: 'pass', lat: app.planet.lat[app.selected] }) } }, 'Orbital pass at its latitude')),
        h('h4', {}, 'Objectives'), h('ul', {}, pr.objectives.map(o => h('li', {}, (o.done ? '✔ ' : '○ ') + o.title + (o.done || o.cells.length > 1 ? '' : ` — ${o.clue}`)))),
        pr.complete ? h('p', { class: 'verdict' }, 'Survey complete: every objective charted.') : pr.outOfBudget ? h('p', { class: 'verdict' }, 'Budget spent. Objectives charted: ' + pr.objectives.filter(o => o.done).length + ' of ' + pr.objectives.length + '.') : null,
        h('h4', {}, `Findings (${s.findings.length})`), h('ul', {}, s.findings.map(f => h('li', {}, `${f.kind}: ${f.note} `, h('button', { class: 'mini', on: { click: () => { app.select(f.cell); app.flyTo(f.cell); } } }, 'Go')))),
        h('button', { class: 'mini', id: 'survey-leave', on: { click: () => { app.store.apply('scenario', null); app.setFog(null); rerender(); } } }, 'Leave survey (show full atlas)'));
    },
    watershed() {
      const rivers = riversForCouncil(app.planet);
      if (!rivers.length) return h('p', {}, 'This world has no river long enough for a council.');
      const basin = setupBasin(app.planet, council.river);
      const sel = h('select', { 'aria-label': 'River', id: 'council-river' }, rivers.map((r, k) => h('option', { value: k, ...(k === council.river ? { selected: '' } : {}) }, `${r.name} (${r.dischargeM3s.toLocaleString('en-US')} m³/s)`)));
      sel.addEventListener('change', () => { council.river = Number(sel.value); council.result = null; app.flyTo(rivers[council.river].mouth); rerender(); });
      const rows = basin.reaches.map((r, k) => h('tr', {}, h('td', {}, r.name), h('td', {}, r.gainKm3yr.toFixed(1)),
        h('td', {}, h('select', { 'aria-label': r.name + ' irrigation', on: { change: e => { council.irrigation[k] = Number(e.target.value); } } }, [0, 1, 2, 3].map(v => h('option', { value: v, ...(v === council.irrigation[k] ? { selected: '' } : {}) }, v)))),
        h('td', {}, h('input', { type: 'checkbox', 'aria-label': r.name + ' reservoir', ...(council.reservoir[k] ? { checked: '' } : {}), on: { change: e => { council.reservoir[k] = e.target.checked; } } }))));
      const run = () => {
        const dec = { irrigation: council.irrigation.slice(), reservoir: council.reservoir.slice() };
        council.result = simulateCouncil(basin, [dec]);
        app.store.apply('decide', { id: 'council-' + app.store.state.decisions.length, title: 'Watershed council: ' + basin.river, ...dec, harvest: council.result.harvestScore, ecology: council.result.ecology });
        rerender();
      };
      const r = council.result;
      return h('div', {}, sel, h('p', { class: 'fine' }, `${basin.basinCells.toLocaleString('en-US')} land cells; flow at the mouth ${basin.dischargeM3s.toLocaleString('en-US')} m³/s.`),
        h('table', { class: 'grid' }, h('tr', {}, ['Reach', 'gain km³/yr', 'irrigation', 'reservoir'].map(t => h('th', {}, t))), rows),
        h('button', { class: 'mini', id: 'council-run', on: { click: run } }, `Run ${WR.years} years`),
        r ? h('div', { class: 'verdict' }, h('p', {}, `Harvest ${r.harvestScore} %, river health ${r.ecology} %. ${r.verdict}`),
          h('p', { class: 'fine' }, `Water ledger (km³): inflow ${r.ledger.inflow}, consumed ${r.ledger.consumed}, to the sea ${r.ledger.outflow}, stored ${r.ledger.storage}; balance error ${r.balanceError.toExponential(1)}.`),
          h('table', { class: 'grid' }, h('tr', {}, ['Year', ...basin.reaches.map(x => x.name.split(' ')[0]), 'eco'].map(t => h('th', {}, t))), r.years.map(y => h('tr', {}, [y.year, ...y.harvest.map(v => v + '%'), y.ecology + '%'].map(v => h('td', {}, v)))))) : null,
        rules(WR.text));
    },
    thaw() {
      if (thaw.setup === undefined) return h('div', {}, h('p', {}, 'Lead a band across an ice-age land bridge before the rising sea closes it. Needs this world\'s glacial state (computed on demand, about a second).'), h('button', { class: 'mini', id: 'thaw-prepare', on: { click: () => { status('Computing the glacial maximum…'); setTimeout(() => { app.showGlacial(); thaw.setup = setupThaw(app.planet); thaw.state = thaw.setup ? newThaw(thaw.setup) : null; if (thaw.setup) { app.select(thaw.setup.start); app.flyTo(thaw.setup.start); } status(''); rerender(); }, 20); } } }, 'Prepare migration'));
      if (!thaw.setup) return h('div', {}, h('p', {}, 'This world has no land bridge joining two landmasses at the glacial maximum.'), h('p', { class: 'fine' }, 'Verified bridge worlds: DET-10, DET-11, DET-13, DET-15.'), h('button', { class: 'mini', on: { click: () => { thaw.setup = undefined; app.forge('DET-10'); rerender(); } } }, 'Forge DET-10'));
      const s = thaw.state, sea = -thaw.setup.seaFallM * (1 - s.turn / TR.turns);
      const turn = c => () => { thaw.state = thawTurn(app.planet, thaw.setup, s, c, 1); app.select(thaw.state.at); app.flyTo(thaw.state.at, .8); if (thaw.state.over) { app.store.apply('journal', { id: 'thaw-' + app.store.state.journal.length, title: 'The Great Thaw: ' + (thaw.state.won ? 'crossed ' : 'failed at ') + thaw.setup.bridge, kind: 'thaw', won: thaw.state.won, turns: thaw.state.turn, chronicle: thaw.state.log.map(l => l.text) }); if (thaw.state.won) app.pulse(thaw.state.at, 'arrival'); } rerender(); };
      return h('div', {}, h('p', {}, `${thaw.setup.bridge}: reach the far landmass (${thaw.setup.goalLandmassCells.toLocaleString('en-US')} cells). Turn ${s.turn}/${TR.turns}; sea level ${Math.round(sea)} m vs today; ${s.people} people, ${s.supplies} rations.`),
        s.over ? h('p', { class: 'verdict' }, s.won ? 'Victory: the band crossed before the sea closed the bridge.' : 'Defeat.') : h('div', { class: 'row' }, h('button', { class: 'mini', id: 'thaw-march', on: { click: turn('march') } }, 'Forced march'), h('button', { class: 'mini', id: 'thaw-steady', on: { click: turn('steady') } }, 'Travel and forage'), h('button', { class: 'mini', on: { click: turn('rest') } }, 'Rest and forage')),
        h('h4', {}, 'Chronicle'), h('ol', { class: 'events' }, s.log.map(l => h('li', {}, l.text))),
        h('button', { class: 'mini', on: { click: () => { thaw.state = newThaw(thaw.setup); app.select(thaw.setup.start); rerender(); } } }, 'Restart'), rules(TR.text));
    },
    faultline() {
      if (!fault) fault = newCampaign(app.planet);
      const doAct = (k, a) => () => { const r = act(fault, k, a); if (r.error) return status(r.error); fault = r.campaign; app.store.apply('decide', { id: 'fault-' + app.store.state.decisions.length, title: `${a} ${fault.towns[k].name}`, cell: fault.towns[k].cell }); rerender(); };
      const year = () => { fault = advance(app.planet, fault, 1); for (const e of fault.lastEvents) app.pulse(e.cell, 'hazard'); if (fault.over) app.store.apply('journal', { id: 'fault-' + app.store.state.journal.length, title: 'Faultline Command', kind: 'faultline', lost: fault.totalLost }); rerender(); };
      const diam = h('select', { 'aria-label': 'Impactor diameter' }, [50, 200, 1000, 5000].map(d => h('option', { value: d }, d + ' m')));
      return h('div', {}, h('p', {}, `Year ${fault.turn}/${FR.turns}; budget ${fault.budget}.`),
        h('table', { class: 'grid' }, h('tr', {}, ['Settlement', 'exposure', 'people', 'expected loss/yr', 'act'].map(t => h('th', {}, t))), fault.towns.map((t, k) => h('tr', {}, h('td', {}, t.name), h('td', {}, [t.quake && 'quake', t.eruption && 'volcano', t.flood && 'flood'].filter(Boolean).join(', ') || '—'), h('td', {}, t.population.toLocaleString('en-US')), h('td', {}, forecastRisk(t).toLocaleString('en-US')),
          h('td', {}, fault.over ? '' : h('span', {}, h('button', { class: 'mini', title: 'Reinforce (3)', on: { click: doAct(k, 'reinforce') } }, 'R'), h('button', { class: 'mini', title: 'Levee (2)', on: { click: doAct(k, 'levee') } }, 'L'), h('button', { class: 'mini', title: 'Evacuate this year (1)', on: { click: doAct(k, 'evacuate') } }, 'E')))))),
        fault.over ? h('p', { class: 'verdict' }, `Campaign over: ${fault.totalLost.toLocaleString('en-US')} people lost.`) : h('button', { class: 'mini', id: 'fault-year', on: { click: year } }, 'Advance one year'),
        h('ol', { class: 'events' }, fault.log.slice(-12).map(l => h('li', {}, l.text))),
        h('h4', {}, 'Catastrophe laboratory (separate, illustrative)'), h('div', { class: 'row' }, diam, h('button', { class: 'mini', on: { click: () => { if (app.selected < 0) return status('Select an impact site.'); lab = impactLab(app.planet, app.selected, Number(diam.value)); app.pulse(app.selected, 'hazard'); rerender(); } } }, 'Impact at selected place')),
        lab ? h('p', { class: 'fine' }, `${lab.diameterM} m impactor ${lab.ocean ? 'at sea' : 'on land'}: crater ≈ ${lab.craterKm} km, severe damage ≈ ${lab.blastKm} km; settlements inside: ${lab.settlementsInBlast.map(s => s.name + ' (' + s.km + ' km)').join(', ') || 'none'}. ${lab.note}`) : null,
        rules(FR.text));
    }
  };
  const hist = historyPanels(app, h, status, () => rerender());
  Object.assign(panels, hist.panels);
  function render() {
    const sel = h('select', { 'aria-label': 'Game mode', id: 'play-mode' }, Object.entries(MODES).map(([k, v]) => h('option', { value: k, ...(k === mode ? { selected: '' } : {}) }, v)));
    sel.addEventListener('change', () => { mode = sel.value; rerender(); });
    root = h('div', { class: 'play' }, sel, panels[mode]());
    return root;
  }
  return { render, reset() { hist.reset(); trials = null; trialMsg = {}; exp = { ...exp, from: -1, to: -1, fc: null, result: null }; council = { ...council, river: 0, result: null }; thaw = { setup: undefined, state: null }; fault = null; lab = null; } };
}
