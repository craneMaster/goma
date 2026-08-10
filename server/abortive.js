import { isTerminalOrHonorTile } from './tiles.js';
import { tileKey } from './claims.js';

/** Abortive draw kinds for the 5-player table. */
export const ABORTIVE = {
  fiveWinds: 'fiveWinds',
  nineTerminals: 'nineTerminals',
  fiveRiichi: 'fiveRiichi',
  fiveKans: 'fiveKans',
};

export const ABORTIVE_LABELS = {
  fiveWinds: 'Abortive draw — five winds (五風連打)',
  nineTerminals: 'Abortive draw — nine terminals (九種九牌)',
  fiveRiichi: 'Abortive draw — five riichi (五家立直)',
  fiveKans: 'Abortive draw — five quads (五槓散了)',
};

/**
 * Distinct terminal/honor types in a hand (aka 5s are not terminals).
 * @param {import('./tiles.js').Tile[]} hand
 */
export function countDistinctTerminalHonors(hand) {
  const keys = new Set();
  for (const t of hand || []) {
    if (isTerminalOrHonorTile(t)) keys.add(`${t.suit}-${t.rank}`);
  }
  return keys.size;
}

/**
 * True when the dealt / first-turn hand has ≥9 distinct terminals & honors.
 * @param {import('./tiles.js').Tile[]} hand
 */
export function hasNineTerminals(hand) {
  return countDistinctTerminalHonors(hand) >= 9;
}

/**
 * First go-around five-wind abort: every seat discarded once, all the same wind
 * (ranks 1–5, including 花), and no calls have broken the first go-around.
 * @param {Array<{ discards: object[] }>} players
 * @param {boolean} firstGoAround
 */
export function isFiveWindAbort(players, firstGoAround) {
  if (!firstGoAround || !players?.length) return false;
  if (!players.every((p) => (p.discards?.length ?? 0) === 1)) return false;
  const tiles = players.map((p) => {
    const entry = p.discards[0];
    return entry?.tile ?? entry;
  });
  if (!tiles.every((t) => t && t.suit === 'wind')) return false;
  const rank = tiles[0].rank;
  return tiles.every((t) => t.rank === rank);
}

/**
 * All seated players have declared riichi.
 * @param {Array<{ riichi: boolean }>} players
 */
export function isFiveRiichiAbort(players) {
  return !!players?.length && players.every((p) => !!p.riichi);
}

/**
 * Kan/kin melds count as quads for 五槓散了.
 * @param {object[]} melds
 */
export function meldIsQuad(meld) {
  return meld?.type === 'kan' || meld?.type === 'kin';
}

/**
 * How many distinct players have at least one kan or kin.
 * @param {Array<{ melds: object[] }>} players
 */
export function playersWithQuadCount(players) {
  let n = 0;
  for (const p of players || []) {
    if ((p.melds || []).some(meldIsQuad)) n++;
  }
  return n;
}

/**
 * Five-quad abort: rinshan exhausted and at least three players have kan/kin.
 * @param {{ rinshanRemaining: number, playersWithQuads: number }} opts
 */
export function isFiveKanAbort({ rinshanRemaining, playersWithQuads }) {
  return rinshanRemaining <= 0 && playersWithQuads >= 3;
}

/**
 * Tile key of a discard entry (for wind matching).
 * @param {object|import('./tiles.js').Tile} entry
 */
export function discardTileKey(entry) {
  const t = entry?.tile ?? entry;
  return t ? tileKey(t) : null;
}
