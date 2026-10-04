import { tileKey } from './claims.js';

const NUMBERED = new Set(['man', 'pin', 'sou']);
const WIN_TILES = 14;

/** Every tile identity the Limitless Asura wildcard may represent. */
export const WILDCARD_KEYS = (() => {
  const keys = [];
  for (const suit of ['man', 'pin', 'sou']) {
    for (let rank = 1; rank <= 9; rank++) keys.push(`${suit}-${rank}`);
  }
  for (let rank = 1; rank <= 5; rank++) keys.push(`wind-${rank}`);
  for (let rank = 1; rank <= 3; rank++) keys.push(`dragon-${rank}`);
  return keys;
})();

function parseKey(key) {
  const [suit, rank] = key.split('-');
  return { suit, rank: Number(rank) };
}

function tileForKey(key) {
  const [suit, rank] = key.split('-');
  return {
    id: `wildcard-as-${key}`,
    suit,
    rank: Number(rank),
    copy: 5,
    wildcardAssignment: true,
  };
}

/** Concrete wildcard assignments for shared yaku/scoring evaluation. */
export function wildcardAssignments(wildcard) {
  return wildcard ? WILDCARD_KEYS.map(tileForKey) : [null];
}

/** @param {Map<string, number>} counts */
function cloneCounts(counts) {
  return new Map(counts);
}

/** @param {import('./tiles.js').Tile[]} tiles */
export function countsFromTiles(tiles) {
  const counts = new Map();
  for (const t of tiles) {
    const k = tileKey(t);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

/** Kan/kin groups use 4–5 tiles but still count as one meld — raises the winning total above 14. */
function groupExtraFromCounts(counts) {
  let extra = 0;
  for (const n of counts.values()) {
    if (n > 3) extra += n - 3;
  }
  return extra;
}

/** @param {import('./tiles.js').Tile[]} allTiles */
export function expectedWinTotal(allTiles) {
  return WIN_TILES + groupExtraFromCounts(countsFromTiles(allTiles));
}

/** All terminal & honor types for Thirteen Orphans (fifth wind is wind-5). */
export const ORPHAN_KEYS = [
  'man-1',
  'man-9',
  'pin-1',
  'pin-9',
  'sou-1',
  'sou-9',
  'wind-1',
  'wind-2',
  'wind-3',
  'wind-4',
  'dragon-1',
  'dragon-2',
  'dragon-3',
  'wind-5',
];

const ORPHAN_KEY_SET = new Set(ORPHAN_KEYS);

/** @param {import('./tiles.js').Tile} tile */
export function isTerminalOrHonor(tile) {
  if (tile.suit === 'wind' || tile.suit === 'dragon') {
    return true;
  }
  return NUMBERED.has(tile.suit) && (tile.rank === 1 || tile.rank === 9);
}

/** Human-readable win pattern labels. */
export const WIN_PATTERN_LABELS = {
  standard: 'four melds & a pair',
  sevenPairs: 'seven pairs',
  thirteenOrphans: 'thirteen orphans',
};

export function formatWinPatterns(patterns) {
  return (patterns || [])
    .map((p) => WIN_PATTERN_LABELS[p] ?? p)
    .join(' · ');
}

/** @param {import('./tiles.js').Tile[]} hand */
/** @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds */
export function hasValidWinTotal(hand, melds, wildcard = null) {
  return (
    getWinPatterns(hand, melds, null, wildcard).length > 0
  );
}

/** @param {Map<string, number>} counts */
function sortedKeys(counts) {
  return [...counts.keys()].filter((k) => counts.get(k) > 0).sort();
}

function isEmpty(counts) {
  return sortedKeys(counts).length === 0;
}

/** @param {Map<string, number>} counts */
function canFormGroups(counts, groupsLeft) {
  if (groupsLeft === 0) return isEmpty(counts);

  const keys = sortedKeys(counts);
  if (keys.length === 0) return false;

  const first = keys[0];
  const n = counts.get(first);
  const { suit, rank } = parseKey(first);

  if (n >= 5) {
    const next = cloneCounts(counts);
    next.set(first, n - 5);
    if (next.get(first) === 0) next.delete(first);
    if (canFormGroups(next, groupsLeft - 1)) return true;
  }

  if (n >= 4) {
    const next = cloneCounts(counts);
    next.set(first, n - 4);
    if (next.get(first) === 0) next.delete(first);
    if (canFormGroups(next, groupsLeft - 1)) return true;
  }

  if (n >= 3) {
    const next = cloneCounts(counts);
    next.set(first, n - 3);
    if (next.get(first) === 0) next.delete(first);
    if (canFormGroups(next, groupsLeft - 1)) return true;
  }

  if (NUMBERED.has(suit) && rank <= 7) {
    const k2 = `${suit}-${rank + 1}`;
    const k3 = `${suit}-${rank + 2}`;
    if ((counts.get(k2) || 0) >= 1 && (counts.get(k3) || 0) >= 1) {
      const next = cloneCounts(counts);
      next.set(first, n - 1);
      if (next.get(first) === 0) next.delete(first);
      next.set(k2, (next.get(k2) || 0) - 1);
      if (next.get(k2) === 0) next.delete(k2);
      next.set(k3, (next.get(k3) || 0) - 1);
      if (next.get(k3) === 0) next.delete(k3);
      if (canFormGroups(next, groupsLeft - 1)) return true;
    }
  }

  return false;
}

/** @param {Map<string, number>} counts */
function canPartitionStandard(counts) {
  for (const [key, n] of counts) {
    if (n < 2) continue;
    const next = cloneCounts(counts);
    next.set(key, n - 2);
    if (next.get(key) === 0) next.delete(key);
    if (canFormGroups(next, 4)) return true;
  }
  return false;
}

/**
 * Concealed sets the hand must still form: 4 melds + pair, minus one meld per table meld.
 * Kan/kin count as one meld each (extra tiles live in the meld, not the hand).
 * @param {Array<{ tiles: import('./tiles.js').Tile[], open?: boolean }>} melds
 */
export function groupsNeededFromMelds(melds) {
  return Math.max(0, 4 - melds.length);
}

/**
 * Hand tiles partition into (4 − table melds) groups + one pair — no total tile count check.
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 */
export function canPartitionHandForMelds(hand, melds) {
  if (melds.length > 4) return false;

  const groupsNeeded = groupsNeededFromMelds(melds);
  const counts = countsFromTiles(hand);

  if (groupsNeeded === 0) {
    const keys = sortedKeys(counts);
    return keys.length === 1 && counts.get(keys[0]) === 2;
  }

  for (const [key, n] of counts) {
    if (n < 2) continue;
    const next = cloneCounts(counts);
    next.set(key, n - 2);
    if (next.get(key) === 0) next.delete(key);
    if (canFormGroups(next, groupsNeeded)) return true;
  }
  return false;
}

/**
 * Sets still needed in concealed hand (legacy helper for docs/tests).
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 */
export function concealedSetsNeeded(melds) {
  return groupsNeededFromMelds(melds);
}

/**
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 */
export function isStandardWin(hand, melds) {
  if (melds.length > 4) return false;
  if (melds.length === 0) {
    return canPartitionStandard(countsFromTiles(hand));
  }
  return canPartitionHandForMelds(hand, melds);
}

/**
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 */
export function isSevenPairs(hand, melds) {
  if (melds.length > 0) return false;
  if (hand.length !== WIN_TILES) return false;

  const counts = countsFromTiles(hand);
  if (counts.size !== 7) return false;
  for (const n of counts.values()) {
    if (n !== 2) return false;
  }
  return true;
}

/**
 * Thirteen Orphans 十三幺 — all terminals & honors, ≥13 distinct types, one pair.
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 */
export function isThirteenOrphans(hand, melds) {
  if (melds.length > 0) return false;
  if (hand.length !== WIN_TILES) return false;

  for (const t of hand) {
    if (!isTerminalOrHonor(t)) return false;
  }

  const counts = countsFromTiles(hand);
  if (counts.size < 13) return false;

  let pairs = 0;
  for (const [key, n] of counts) {
    if (!ORPHAN_KEY_SET.has(key)) return false;
    if (n > 2) return false;
    if (n === 2) pairs++;
  }

  return pairs === 1;
}

function collectPatterns(hand, melds) {
  const patterns = [];
  if (isStandardWin(hand, melds)) patterns.push('standard');
  if (isSevenPairs(hand, melds)) patterns.push('sevenPairs');
  if (isThirteenOrphans(hand, melds)) patterns.push('thirteenOrphans');
  return patterns;
}

/**
 * Ron from a 14-tile tenpai (common after open kan/kin): swap one hand tile for the discard.
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 * @param {import('./tiles.js').Tile} winTile
 */
function ronSwapPatterns(hand, melds, winTile, wildcardAssigned = false) {
  const found = new Set();
  const replaceable = hand.length - (wildcardAssigned ? 1 : 0);
  for (let i = 0; i < replaceable; i++) {
    const swapped = [...hand];
    swapped[i] = winTile;
    for (const p of collectPatterns(swapped, melds)) found.add(p);
  }
  return [...found];
}

/**
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 * @param {import('./tiles.js').Tile} [winTile] — discard for ron; omit for tsumo (14 in hand)
 */
function getConcreteWinPatterns(hand, melds, winTile = null, wildcardAssigned = false) {
  if (!winTile) return collectPatterns(hand, melds);

  const added = [...hand, winTile];
  const patterns = collectPatterns(added, melds);
  if (patterns.length > 0) return patterns;

  return ronSwapPatterns(hand, melds, winTile, wildcardAssigned);
}

/*
 * Joker evaluation: a wildcard (or an unknown wait tile) may stand for any
 * tile identity, including a sixth copy, so it fills any missing slot.
 * Counts are indexed by WILDCARD_KEYS; numbered suits occupy 0–26.
 */
const KEY_INDEX = new Map(WILDCARD_KEYS.map((k, i) => [k, i]));
const ORPHAN_INDEX_SET = new Set(ORPHAN_KEYS.map((k) => KEY_INDEX.get(k)));
const NUMBERED_KEY_COUNT = 27;

function countArray(tiles) {
  const c = new Array(WILDCARD_KEYS.length).fill(0);
  for (const t of tiles) {
    const i = KEY_INDEX.get(tileKey(t));
    if (i == null) return null;
    c[i]++;
  }
  return c;
}

function firstNonZero(c) {
  for (let i = 0; i < c.length; i++) if (c[i] > 0) return i;
  return -1;
}

/** Use every physical tile and exactly `jokers` jokers in `groups` sets. */
function jokerGroups(c, groups, jokers) {
  const i = firstNonZero(c);
  if (i < 0) return jokers === groups * 3;
  if (groups === 0) return false;
  const n = c[i];

  for (const size of [5, 4, 3]) {
    for (let k = Math.min(n, size); k >= 1; k--) {
      const need = size - k;
      if (need > jokers) continue;
      c[i] -= k;
      const ok = jokerGroups(c, groups - 1, jokers - need);
      c[i] += k;
      if (ok) return true;
    }
  }

  if (i < NUMBERED_KEY_COUNT) {
    const suitStart = i - (i % 9);
    // `i` is the lowest physical tile, so lower sequence slots must be jokers.
    for (let s = Math.max(suitStart, i - 2); s <= i && s + 2 < suitStart + 9; s++) {
      let need = 0;
      const used = [];
      for (let x = s; x <= s + 2; x++) {
        if (x !== i && c[x] > 0 && x > i) used.push(x);
        else if (x !== i) need++;
      }
      if (need > jokers) continue;
      c[i]--;
      for (const x of used) c[x]--;
      const ok = jokerGroups(c, groups - 1, jokers - need);
      c[i]++;
      for (const x of used) c[x]++;
      if (ok) return true;
    }
  }
  return false;
}

function jokerStandard(c, melds, jokers) {
  if (melds.length > 4) return false;
  const groups = groupsNeededFromMelds(melds);
  if (jokers >= 2 && jokerGroups(c, groups, jokers - 2)) return true;
  for (let i = 0; i < c.length; i++) {
    if (c[i] === 0) continue;
    const take = Math.min(c[i], 2);
    const need = 2 - take;
    if (need > jokers) continue;
    c[i] -= take;
    const ok = jokerGroups(c, groups, jokers - need);
    c[i] += take;
    if (ok) return true;
  }
  return false;
}

function jokerSevenPairs(c, melds, jokers, physical) {
  if (melds.length > 0 || physical + jokers !== WIN_TILES) return false;
  let singles = 0;
  for (const n of c) {
    if (n > 2) return false;
    if (n === 1) singles++;
  }
  return singles <= jokers && (jokers - singles) % 2 === 0;
}

function jokerThirteenOrphans(c, melds, jokers, physical) {
  if (melds.length > 0 || physical + jokers !== WIN_TILES) return false;
  let pairs = 0;
  for (let i = 0; i < c.length; i++) {
    if (c[i] === 0) continue;
    if (!ORPHAN_INDEX_SET.has(i) || c[i] > 2) return false;
    if (c[i] === 2) pairs++;
  }
  return pairs === 1 || (pairs === 0 && jokers >= 1);
}

function jokerPatterns(tiles, melds, jokers) {
  const c = countArray(tiles);
  if (!c) return [];
  const patterns = [];
  if (jokerStandard(c, melds, jokers)) patterns.push('standard');
  if (jokerSevenPairs(c, melds, jokers, tiles.length)) patterns.push('sevenPairs');
  if (jokerThirteenOrphans(c, melds, jokers, tiles.length)) {
    patterns.push('thirteenOrphans');
  }
  return patterns;
}

/** Each distinct tile identity once — removals of identical tiles are equivalent. */
function distinctIndexes(hand) {
  const seen = new Set();
  const idx = [];
  hand.forEach((t, i) => {
    const k = tileKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    idx.push(i);
  });
  return idx;
}

function wildcardWinPatterns(hand, melds, winTile) {
  if (!winTile) return jokerPatterns(hand, melds, 1);
  const direct = jokerPatterns([...hand, winTile], melds, 1);
  if (direct.length > 0) return direct;
  const found = new Set();
  for (const i of distinctIndexes(hand)) {
    const swapped = [...hand];
    swapped[i] = winTile;
    for (const p of jokerPatterns(swapped, melds, 1)) found.add(p);
  }
  return [...found];
}

/**
 * Limitless Asura ready hand: the physical tiles plus two jokers (the
 * wildcard and the awaited tile) complete four melds & a pair, seven
 * distinct pairs, or thirteen orphans. With 12 physical tiles:
 * - standard: 2 melds + 2 incomplete melds + pair; 3 melds + lone tile + pair;
 *   3 melds + incomplete meld + lone tile; 4 melds (waits on everything)
 * - seven pairs: 5 pairs + 2 distinct lone tiles; 6 pairs (waits on everything)
 * - thirteen orphans: 11 distinct orphans with one paired; 12 distinct orphans
 */
export function isWildcardReadyShape(hand, melds) {
  return jokerPatterns(hand, melds, 2).length > 0;
}

export function getWinPatterns(hand, melds, winTile = null, wildcard = null) {
  if (!wildcard) return getConcreteWinPatterns(hand, melds, winTile);
  return wildcardWinPatterns(hand, melds, winTile);
}

export function canWin(hand, melds, winTile = null, wildcard = null) {
  return getWinPatterns(hand, melds, winTile, wildcard).length > 0;
}
