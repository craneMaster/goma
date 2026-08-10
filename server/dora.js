import { tileKey, sameTile } from './claims.js';

/**
 * Dora from an indicator.
 * Numbered suits: +1 (9→1).
 * Winds: east → south → west → north → 花 → east.
 * Dragons: green → red → white → green.
 * @param {import('./tiles.js').Tile} indicator
 * @returns {{ suit: string, rank: number, id: string } | null}
 */
export function doraFromIndicator(indicator) {
  if (!indicator) return null;
  const { suit, rank } = indicator;

  if (suit === 'man' || suit === 'pin' || suit === 'sou') {
    return { ...indicator, id: `dora-${suit}-${rank}`, rank: rank === 9 ? 1 : rank + 1 };
  }

  // East(1) → South(2) → West(3) → North(4) → 花(5) → East(1)
  if (suit === 'wind') {
    const nextRank = rank >= 5 ? 1 : rank + 1;
    return { ...indicator, id: `dora-wind-${rank}`, suit: 'wind', rank: nextRank };
  }

  // Green(2) → Red(1) → White(3) → Green(2)
  if (suit === 'dragon') {
    const next = { 2: 1, 1: 3, 3: 2 };
    return { ...indicator, id: `dora-dragon-${rank}`, rank: next[rank] };
  }

  return null;
}

/** @param {import('./tiles.js').Tile[]} indicators */
export function doraTilesFromIndicators(indicators) {
  return indicators.map(doraFromIndicator).filter(Boolean);
}

/**
 * Count dora (and optional ura dora) in a winning hand.
 * Indicator dora stacks: two 1-pin indicators make each 2-pin worth 2.
 * Aka (red five) is +1 and stacks with indicator/ura dora on the same tile
 * (e.g. 4-pin indicator → red 5-pin is worth 2).
 *
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 * @param {import('./tiles.js').Tile} [winTile]
 * @param {import('./tiles.js').Tile[]} [doraIndicators]
 * @param {import('./tiles.js').Tile[]} [uraIndicators]
 * @returns {{ dora: number, uraDora: number, total: number }}
 */
export function countDora(hand, melds, winTile = null, doraIndicators = [], uraIndicators = []) {
  const concealed = winTile ? [...hand, winTile] : hand;
  const all = [...concealed, ...melds.flatMap((m) => m.tiles)];

  /** @type {Map<string, number>} */
  const doraMult = new Map();
  for (const ind of doraIndicators) {
    const d = doraFromIndicator(ind);
    if (!d) continue;
    const k = tileKey(d);
    doraMult.set(k, (doraMult.get(k) || 0) + 1);
  }
  /** @type {Map<string, number>} */
  const uraMult = new Map();
  for (const ind of uraIndicators) {
    const d = doraFromIndicator(ind);
    if (!d) continue;
    const k = tileKey(d);
    uraMult.set(k, (uraMult.get(k) || 0) + 1);
  }

  let dora = 0;
  let uraDora = 0;
  for (const t of all) {
    const k = tileKey(t);
    dora += doraMult.get(k) || 0;
    uraDora += uraMult.get(k) || 0;
    if (t.red) dora += 1;
  }
  return { dora, uraDora, total: dora + uraDora };
}

/** @param {import('./tiles.js').Tile} a @param {import('./tiles.js').Tile} b */
export function isDoraMatch(a, b) {
  return sameTile(a, b);
}
