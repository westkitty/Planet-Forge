// PF-03 adaptive graphics quality. Presentation only: tiers change pixel ratio, sky detail, clouds, ocean effects and
// stellar twinkle; they never touch world data. The controller is pure (no DOM, no GPU), so it is unit-tested in Node.
//
// Measured adaptation: frame intervals are grouped into 2 s windows and each window's median is compared with a frame
// budget. Two consecutive slow windows step the tier down; five consecutive fast windows step it up. After any change
// the next 3 s are ignored (rebuilding resources causes a spike). If a step up is followed by a step down within 30 s
// the tier it fell back to becomes the ceiling for the rest of the session, so the tier cannot oscillate.
// Idea source: westkitty/Event-Horizon-Forge src/app/AdaptiveResolution.ts (measured, hysteretic resolution scaling).

export const TIERS = ['low', 'medium', 'high'];
export const PROFILES = {
  low: { pixelRatioCap: 1, sky: 'low', cloudTexture: [128, 64], cloudSegments: [64, 32], cloudShadows: false, cloudDetail: false, ocean: false, swell: false, twinkle: false },
  medium: { pixelRatioCap: 1.35, sky: 'medium', cloudTexture: [256, 128], cloudSegments: [96, 48], cloudShadows: true, cloudDetail: false, ocean: true, swell: false, twinkle: true },
  high: { pixelRatioCap: 2, sky: 'high', cloudTexture: [512, 256], cloudSegments: [128, 64], cloudShadows: true, cloudDetail: true, ocean: true, swell: true, twinkle: true }
};

/** Highest tier this device should ever use, from coarse capability hints (all optional). */
export function deviceCeiling({ hardwareConcurrency = 4, deviceMemory, maxTextureSize = 8192, coarsePointer = false } = {}) {
  if (hardwareConcurrency <= 2 || (deviceMemory && deviceMemory <= 2) || maxTextureSize < 4096) return 'low';
  if (coarsePointer || (deviceMemory && deviceMemory <= 4)) return 'medium';
  return 'high';
}

export function createQualityController({ mode = 'auto', ceiling = 'high', start, budgetMs = 1000 / 45, windowMs = 2000, now = 0 } = {}) {
  const idx = t => TIERS.indexOf(t);
  let cap = idx(ceiling), tier = mode === 'auto' ? Math.min(cap, idx(start || ceiling)) : idx(mode);
  let samples = [], windowStart = now, slow = 0, fast = 0, quietUntil = now + 3000, lastUp = -Infinity, changes = [];
  const state = () => ({ mode, tier: TIERS[tier], ceiling: TIERS[cap], changes: changes.slice() });
  function set(next, at, reason) {
    if (next === tier) return null;
    if (next < tier && at - lastUp < 30000) cap = next; // oscillation guard
    if (next > tier) lastUp = at;
    changes.push({ at: Math.round(at), from: TIERS[tier], to: TIERS[next], reason });
    tier = next; slow = fast = 0; samples = []; windowStart = at; quietUntil = at + 3000;
    return TIERS[tier];
  }
  return {
    state,
    get tier() { return TIERS[tier]; },
    /** Choose a mode ('auto' or a tier). Returns the new tier if it changed. */
    setMode(m, at = now) {
      mode = m;
      if (m !== 'auto') return set(idx(m), at, 'manual');
      slow = fast = 0; samples = []; windowStart = at; quietUntil = at + 3000;
      return null;
    },
    /** Feed one frame interval; returns the new tier name when auto mode decides to change, else null. */
    sample(dtMs, at) {
      if (mode !== 'auto' || at < quietUntil) { windowStart = at; return null; }
      if (!(dtMs > 0) || dtMs > 250) return null; // tab hidden, debugger or a one-off stall: not a rendering cost
      if (!samples.length) windowStart = at; // a window starts at its first counted frame
      samples.push(dtMs);
      if (at - windowStart < windowMs || samples.length < 8) return null;
      const sorted = samples.sort((a, b) => a - b), median = sorted[sorted.length >> 1];
      samples = []; windowStart = at;
      if (median > budgetMs * 1.4) { slow++; fast = 0; } else if (median < budgetMs * .55) { fast++; slow = 0; } else { slow = fast = 0; }
      if (slow >= 2 && tier > 0) return set(tier - 1, at, `median ${median.toFixed(1)} ms > ${(budgetMs * 1.4).toFixed(1)} ms`);
      if (fast >= 5 && tier < cap) return set(tier + 1, at, `median ${median.toFixed(1)} ms < ${(budgetMs * .55).toFixed(1)} ms`);
      return null;
    }
  };
}
