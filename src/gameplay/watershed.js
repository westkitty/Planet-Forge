// PF-29 The Watershed Council. Water allocation along one exorheic river, built from the hydrology model's annual
// discharge. Gameplay model (declared): the river's main stem is split into four reaches; each reach gains the
// discharge added between its ends; that annual inflow is spread over the months in proportion to the basin's
// monthly precipitation. Each reach holds a district whose irrigation draws water (60 % consumed, 40 % returned
// downstream); an optional reservoir stores up to two months of reach inflow. Water is conserved exactly:
// every month, Σ inflow = Σ consumption + outflow at the mouth + Δ storage.
const SECONDS_PER_MONTH = 30.4 * 86400;
export const RULES = { consumedShare: .6, demandPerLevel: .15, reservoirMonths: 2, envFlowShare: .3, years: 5,
  text: ['Four reaches along the main stem; each gains the discharge added along it (from the hydrology model).', 'Monthly flow follows the basin\'s monthly rainfall (a gameplay approximation: the hydrology model is annual).', 'Irrigation level L (0–3) asks, in each growing-season month (basin mean above 8 °C), for L × 15 % of the mean monthly flow reaching that district; 60 % is consumed, 40 % returns to the river.', 'A reservoir stores up to two months of its reach\'s mean inflow, releasing water in dry months to meet demand.', 'Environmental flow: the mouth must keep at least 30 % of its natural monthly flow.', 'Harvest = share of irrigation demand met; ecology = share of months meeting the environmental flow.'] };

export function riversForCouncil(p) { return p.hydro.rivers.filter(r => !r.endorheic && r.path && r.path.length >= 8).slice(0, 5); }

export function setupBasin(p, riverIndex = 0) {
  const r = riversForCouncil(p)[riverIndex]; if (!r) return null;
  const path = r.path[0] === r.mouth ? r.path.slice().reverse() : r.path, q = k => p.hydro.discharge[path[k]], cuts = [0, .25, .5, .75, 1].map(f => Math.min(path.length - 1, Math.round(f * (path.length - 1))));
  const basinCells = []; for (let i = 0; i < p.cellCount; i++) if (p.hydro.basin[i] === p.hydro.basin[r.mouth] && p.elevation[i] >= 0) basinCells.push(i);
  const monthly = Array(12).fill(0), warm = Array(12).fill(0);
  for (const i of basinCells) for (let m = 0; m < 12; m++) { monthly[m] += p.climate.precipitationMonthly[12 * i + m]; warm[m] += p.climate.temperatureMonthly[12 * i + m]; }
  const total = monthly.reduce((a, b) => a + b, 0) || 1, shares = monthly.map(v => v / total), growing = warm.map(v => v / Math.max(1, basinCells.length) > 8);
  const reaches = [];
  for (let k = 0; k < 4; k++) {
    const top = k ? q(cuts[k]) : 0, bottom = q(cuts[k + 1]), cell = path[cuts[k + 1]];
    const settlement = p.settlements.find(s => p.hydro.basin[s.cell] === p.hydro.basin[r.mouth]);
    reaches.push({ id: k, name: `${['Upper', 'Middle', 'Lower', 'Delta'][k]} ${r.name.replace(/ River$/, '')}`, cell, gainKm3yr: Math.max(0, bottom - top) * SECONDS_PER_MONTH * 12 / 1e9, settlement: k === 0 && settlement ? settlement.name : null });
  }
  return { river: r.name, mouth: r.mouth, dischargeM3s: r.dischargeM3s, basinCells: basinCells.length, shares, growing, reaches };
}
/** Simulate RULES.years years with the council's decisions; returns per-year results and the mass-balance ledger. */
export function simulateCouncil(basin, decisions) {
  const R = basin.reaches, store = R.map(() => 0), years = [], ledger = { inflow: 0, consumed: 0, outflow: 0, storage: 0 };
  for (let y = 0; y < RULES.years; y++) {
    const dec = decisions[y] || decisions[decisions.length - 1] || { irrigation: [0, 0, 0, 0], reservoir: [false, false, false, false] };
    let demand = R.map(() => 0), met = R.map(() => 0), envOk = 0;
    for (let m = 0; m < 12; m++) {
      let flow = 0, natural = 0;
      for (let k = 0; k < R.length; k++) {
        const gain = R[k].gainKm3yr * basin.shares[m]; natural += gain; flow += gain; ledger.inflow += gain;
        const cap = dec.reservoir[k] ? R[k].gainKm3yr / 12 * RULES.reservoirMonths : 0;
        const meanFlowHere = R.slice(0, k + 1).reduce((a, x) => a + x.gainKm3yr, 0) / 12;
        const want = basin.growing[m] ? dec.irrigation[k] * RULES.demandPerLevel * meanFlowHere : 0; demand[k] += want;
        let take = Math.min(want, flow); flow -= take;
        if (take < want && store[k] > 0) { const rel = Math.min(store[k], want - take); store[k] -= rel; take += rel; ledger.storage -= rel; }
        if (cap > store[k] && flow > 0) { // fill the reservoir from what passes, keeping the environmental share of this reach's gain
          const room = cap - store[k], spare = Math.max(0, flow - RULES.envFlowShare * gain), fill = Math.min(room, spare); store[k] += fill; flow -= fill; ledger.storage += fill;
        }
        met[k] += take; const consumed = take * RULES.consumedShare; ledger.consumed += consumed; flow += take - consumed;
      }
      ledger.outflow += flow;
      if (flow >= RULES.envFlowShare * natural - 1e-12) envOk++;
    }
    const harvest = R.map((_, k) => demand[k] ? met[k] / demand[k] : 1);
    years.push({ year: y + 1, harvest: harvest.map(h => Math.round(h * 100)), ecology: Math.round(envOk / 12 * 100), stored: store.map(s => Math.round(s * 100) / 100), upstreamFirst: harvest.map((h, k) => ({ reach: R[k].name, met: Math.round(h * 100) })) });
  }
  const balance = ledger.inflow - ledger.consumed - ledger.outflow - ledger.storage;
  const last = years[years.length - 1], harvestScore = Math.round(years.reduce((s, y) => s + y.harvest.reduce((a, b) => a + b, 0) / y.harvest.length, 0) / years.length), ecology = Math.round(years.reduce((s, y) => s + y.ecology, 0) / years.length);
  return { years, ledger: Object.fromEntries(Object.entries(ledger).map(([k, v]) => [k, Math.round(v * 1000) / 1000])), balanceError: balance, harvestScore, ecology, verdict: harvestScore >= 70 && ecology >= 70 ? 'The council kept fields watered and the river alive.' : harvestScore >= 70 ? 'Fields were watered at the river\'s expense.' : ecology >= 70 ? 'The river stayed healthy but harvests fell short.' : 'Both farms and river suffered.', final: last };
}
