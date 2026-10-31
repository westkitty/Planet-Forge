// PF-12 The Why Engine: rule-based explanations of a selected cell, built only from the authoritative arrays and the
// documented model rules (docs/features/F-0002…F-0007). Every answer is split into
//   facts      — values read directly from the world arrays,
//   inferences — what the model's own rules imply from those values,
//   unknowns   — causes this model does not represent.
// No external service or language model is involved; the same cell always gives the same answer.
import { BOUNDARY, LAKE_TYPES, BIOMES, KOPPEN } from './planet.js';
import { RIVER_MIN_M3S } from './hydrology.js';
import { GLACIAL_CELL } from './glaciation.js';

const r1 = x => Math.round(x * 10) / 10;
function zonalMean(planet, i, arr, onlyLand = true) {
  let s = 0, c = 0; const lat = planet.lat[i];
  for (let j = 0; j < planet.cellCount; j += 7) if (Math.abs(planet.lat[j] - lat) < 2.5 && (!onlyLand || planet.elevation[j] >= 0)) { s += arr[j]; c++; }
  return c ? s / c : arr[i];
}

export const TOPIC_LABELS = { terrain: 'Terrain', climate: 'Wet or dry', river: 'Water flow', settlement: 'Settlement', ice: 'Ice' };
export const TOPICS = { terrain: 'Why is the terrain like this here?', climate: 'Why is it this wet or dry?', river: 'Why does water flow this way?', settlement: 'Why is a settlement here?', ice: 'Why did ice build up here?' };

export function explain(planet, i, topic) {
  const f = [], inf = [], unk = [], el = planet.elevation[i], b = planet.boundary[i], d = planet.boundaryDistance[i] * planet.spacingKm, plate = planet.plates[planet.plate[i]];
  if (topic === 'terrain') {
    f.push(`Elevation ${Math.round(el)} m; plate ${plate.id} (${plate.crust}, moving ${plate.speedCmYr} cm/yr).`);
    f.push(b ? `This cell lies on a ${BOUNDARY[b]} plate boundary.` : planet.boundaryDistance[i] >= 0 ? `Nearest plate boundary on its own plate ≈ ${Math.round(d)} km away.` : 'No boundary reached on this plate.');
    if (!planet.continental[i]) f.push(`Seafloor age ≈ ${Math.round(planet.seafloorAge[i])} Myr.`);
    if (!planet.continental[i] && el < 0) inf.push('Oceanic crust deepens as it ages and cools away from spreading ridges (GDH1 age–depth relation used by the model), so older seafloor sits deeper.');
    if (b === 1 || (planet.boundaryDistance[i] >= 0 && d < 600 && el > 1500)) inf.push('In this model relief is built where plates converge: uplift is largest at convergent boundaries and decays with distance, so high ground near a convergent margin is explained by that collision.');
    else if (b === 2) inf.push('Divergent boundaries form rifts and mid-ocean ridges in the model: ridge crests stand higher than the older seafloor around them.');
    else if (el > 0 && el < 800) inf.push('Away from active boundaries the model leaves continental crust at moderate elevation, so lowlands and plateaus here are plate-interior terrain.');
    unk.push('Erosion, sediment, volcanism away from boundaries and the time history of plate motion are not modelled: the plates are a kinematic snapshot.');
  } else if (topic === 'climate') {
    const z = zonalMean(planet, i, planet.rainfall, el >= 0), up = planet.climate.uplift[i];
    f.push(`Rainfall ${Math.round(planet.rainfall[i])} mm/yr; land at this latitude averages ≈ ${Math.round(z)} mm/yr.`);
    f.push(`Annual mean ${r1(planet.temperature[i])} °C; Köppen ${KOPPEN[planet.koppen[i]]}; biome ${BIOMES[planet.biome[i]]}.`);
    f.push(`Distance from the sea ≈ ${Math.round(Math.max(0, planet.climate.coastDist[i]) * planet.spacingKm)} km.`);
    const itcz = planet.climate.itcz.map(Math.round);
    f.push(`The model's rain belt (ITCZ) sits near ${itcz[0]}° in January and ${itcz[1]}° in July; this cell is at ${planet.lat[i]}°.`);
    if (up > 30) inf.push('Prevailing winds rise over higher ground downwind of this cell, so the model boosts precipitation here (windward ascent).');
    else if (up < -30) inf.push('Air descends from higher ground here; the model suppresses precipitation on descending lee slopes (rain shadow).');
    if (Math.abs(planet.lat[i]) > 15 && Math.abs(planet.lat[i]) < 35 && planet.rainfall[i] < z) inf.push('Subtropical latitudes sit under the descending branch of the model\'s three-cell circulation, which dries the air.');
    if (planet.climate.coastDist[i] > 15) inf.push('Moisture is carried inland from the oceans and rained out along the way, so deep continental interiors receive less.');
    if (Math.abs(planet.lat[i] - itcz[0]) < 8 || Math.abs(planet.lat[i] - itcz[1]) < 8) inf.push('The seasonal rain belt passes over this latitude, adding convective rainfall.');
    unk.push('Winds are prescribed, not solved; there are no ocean currents, monsoon dynamics, clouds or storms, and land is drier than Earth on average (documented arid bias).');
  } else if (topic === 'river') {
    const h = planet.hydro, q = h.discharge[i], r = h.receiver[i], basin = h.basins[h.basin[i]];
    f.push(`Runoff ${h.runoff[i]} mm/yr; flow through this cell ≈ ${Math.round(q).toLocaleString('en-US')} m³/s.`);
    f.push(r >= 0 ? `Water drains to the neighbouring cell at ${planet.lat[r]}°, ${planet.lon[r]}° (elevation ${Math.round(planet.elevation[r])} m).` : 'This cell is a drainage end point.');
    f.push(`Basin of ${basin.cells.toLocaleString('en-US')} cells, ${basin.endorheic ? 'endorheic (no outlet to the sea)' : 'draining to the sea'}.`);
    if (h.lake[i]) f.push(`Part of a ${LAKE_TYPES[h.lake[i]]}.`);
    inf.push('The model routes each cell\'s runoff to its lowest neighbour after filling depressions (priority-flood), so rivers follow the steepest available descent and merge downstream; discharge is the accumulated runoff of every upstream cell.');
    if (q >= RIVER_MIN_M3S) inf.push(`Flow exceeds the ${RIVER_MIN_M3S} m³/s threshold the atlas uses to call a channel a river.`);
    if (basin.endorheic) inf.push('An endorheic basin forms where a depression evaporates at least as much as it receives, so its water never reaches the sea.');
    unk.push('Groundwater, seasonal flow, erosion of channels and human water use are not modelled; flow is a steady annual balance.');
  } else if (topic === 'settlement') {
    const k = planet.settlements.findIndex(s => s.cell === i), s = planet.settlements[k];
    if (!s) { f.push('There is no generated settlement at this cell.'); unk.push('Select a settlement marker to ask about its site.'); }
    else {
      f.push(`${s.name}, founded in year ${s.founded}; water source: ${s.water}; ${s.setting}; ${s.biome}, Köppen ${s.climate}.`);
      f.push(`Site: elevation ${Math.round(el)} m, ${r1(planet.temperature[i])} °C, ${Math.round(planet.rainfall[i])} mm/yr.`);
      inf.push('Settlement sites are chosen by the generator\'s rules: land between 0 and 1,800 m, annual mean above 3 °C, rainfall above 300 mm/yr, not inside a lake, preferably on a river or lakeshore, and at least 24° from every other settlement. This site met those rules.');
      unk.push('Founding years are seeded, not simulated; there is no population, economy or history behind the choice yet.');
    }
  } else if (topic === 'ice') {
    if (!planet.glaciationComputed) { f.push('The glacial state has not been computed for this world yet.'); unk.push('Choose the Last glacial maximum era or the Ice age layer, then ask again.'); }
    else {
      const g = planet.glaciation, st = g.cell[i];
      f.push(`Glacial-maximum state: ${['unglaciated', 'ice sheet', 'exposed shelf', 'land bridge', 'present ice'][st]}${g.thickness[i] ? ', ice ' + Math.round(g.thickness[i]) + ' m thick' : ''}; global sea level fell ${g.stats.seaLevelFallM} m.`);
      f.push(`Today: ${r1(planet.temperature[i])} °C annual mean, July ${r1(planet.climate.temperatureMonthly[12 * i + 6])} °C, ${Math.round(planet.rainfall[i])} mm/yr.`);
      if (st === GLACIAL_CELL.ice) inf.push('In the glacial run the model cools the climate (lower obliquity, glacial CO₂, dust) and keeps a positive-degree-day snow budget; where winter snowfall outlasted summer melt for the 90,000-year build-up, an ice sheet grew to an accumulation-limited thickness.');
      else if (st === GLACIAL_CELL.shelf || st === GLACIAL_CELL.bridge) inf.push('Locking water in ice sheets lowered the sea, exposing this shallow shelf' + (st === GLACIAL_CELL.bridge ? ', which joined two landmasses.' : '.'));
      else inf.push('Summer melt exceeded snowfall here even in the glacial climate, so no ice accumulated.');
      unk.push('Ice flow, isostatic depression of the crust, and the gradual deglaciation are not modelled; only the glacial maximum and today exist.');
    }
  }
  return { cell: i, topic, question: TOPICS[topic], facts: f, inferences: inf, unknowns: unk, model: planet.version };
}
