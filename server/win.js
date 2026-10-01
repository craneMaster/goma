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

export function getWinPatterns(hand, melds, winTile = null, wildcard = null) {
  if (!wildcard) return getConcreteWinPatterns(hand, melds, winTile);
  const found = new Set();
  for (const assignment of wildcardAssignments(wildcard)) {
    for (const pattern of getConcreteWinPatterns(
      [...hand, assignment],
      melds,
      winTile,
      true
    )) {
      found.add(pattern);
    }
  }
  return [...found];
}

export function canWin(hand, melds, winTile = null, wildcard = null) {
  return getWinPatterns(hand, melds, winTile, wildcard).length > 0;
}
