import { tileKey } from './claims.js';
import { canWin, isWildcardReadyShape } from './win.js';

/** Every distinct tile type in the 5-player deck */
export const ALL_WAIT_KEYS = (() => {
  const keys = [];
  for (const suit of ['man', 'pin', 'sou']) {
    for (let rank = 1; rank <= 9; rank++) keys.push(`${suit}-${rank}`);
  }
  for (let rank = 1; rank <= 5; rank++) keys.push(`wind-${rank}`);
  for (let rank = 1; rank <= 3; rank++) keys.push(`dragon-${rank}`);
  return keys;
})();

function waitTile(key) {
  const [suit, rank] = key.split('-');
  return { id: `wait-${key}`, suit, rank: Number(rank), copy: 0 };
}

/**
 * Hand is fully concealed: no open melds.
 * Closed kan (ankan) and closed kin are allowed for riichi.
 */
export function isClosedHand(melds) {
  return melds.every((m) => !m.open);
}

/**
 * Tenpai: one tile away from a valid win (standard, seven pairs, or thirteen orphans).
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 */
export function isTenpai(hand, melds, wildcard = null) {
  if (melds.length > 4) return false;
  if (canWin(hand, melds, null, wildcard)) return false;

  if (wildcard) {
    // The awaited tile is itself a joker: ready iff hand + 2 jokers completes.
    // The swap form mirrors ron on an over-full hand (e.g. after an open kan).
    if (isWildcardReadyShape(hand, melds)) return true;
    const seen = new Set();
    for (let i = 0; i < hand.length; i++) {
      const k = tileKey(hand[i]);
      if (seen.has(k)) continue;
      seen.add(k);
      if (isWildcardReadyShape(hand.filter((_, j) => j !== i), melds)) return true;
    }
    return false;
  }

  for (const key of ALL_WAIT_KEYS) {
    const wait = waitTile(key);
    if (canWin([...hand, wait], melds, null, wildcard)) return true;
    if (canWin(hand, melds, wait, wildcard)) return true;
  }
  return false;
}

/**
 * Ready at round end — winning shape or one tile from it.
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 */
export function isReady(hand, melds, wildcard = null) {
  if (canWin(hand, melds, null, wildcard)) return true;
  if (isTenpai(hand, melds, wildcard)) return true;
  return hasTenpaiDiscard(hand, melds, wildcard);
}

/**
 * True if some discard leaves a tenpai hand.
 * Includes already-complete (winning) 14-tile hands — you may discard into
 * tenpai to declare riichi (and typically enter discard furiten).
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 */
export function hasTenpaiDiscard(hand, melds, wildcard = null) {
  const seen = new Set();
  for (let i = 0; i < hand.length; i++) {
    const k = tileKey(hand[i]);
    if (seen.has(k)) continue;
    seen.add(k);
    const rest = hand.filter((_, j) => j !== i);
    if (isTenpai(rest, melds, wildcard)) return true;
  }
  return false;
}

/** Tile ids that can be discarded while staying tenpai. */
export function tenpaiDiscardIds(hand, melds, wildcard = null) {
  const byKey = new Map();
  const ids = [];
  for (let i = 0; i < hand.length; i++) {
    const k = tileKey(hand[i]);
    if (!byKey.has(k)) {
      const rest = hand.filter((_, j) => j !== i);
      byKey.set(k, isTenpai(rest, melds, wildcard));
    }
    if (byKey.get(k)) ids.push(hand[i].id);
  }
  return ids;
}

export function isTenpaiDiscard(hand, melds, tileId, wildcard = null) {
  const idx = hand.findIndex((t) => t.id === tileId);
  if (idx < 0) return false;
  const rest = hand.filter((_, j) => j !== idx);
  return isTenpai(rest, melds, wildcard);
}

/** Shape wait keys for a tenpai hand (empty if already complete). */
export function getWaitKeys(hand, melds, wildcard = null) {
  if (canWin(hand, melds, null, wildcard)) return [];
  const waits = [];
  for (const key of ALL_WAIT_KEYS) {
    if (canWin(hand, melds, waitTile(key), wildcard)) waits.push(key);
  }
  return waits;
}

function sameWaitKeys(a, b) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((k) => set.has(k));
}

/**
 * Riichi closed kan/kin may only be declared if waits stay identical.
 * Compares waits of the hand before this draw to waits after forming the meld.
 *
 * @param {import('./tiles.js').Tile[]} hand full hand (including drawn tile)
 * @param {object[]} melds
 * @param {string[]} tileIds tiles used for the closed kan (4) or kin (5)
 * @param {string|null} lastDrawnId id of the tile drawn this turn
 */
export function closedKanPreservesWaits(
  hand,
  melds,
  tileIds,
  lastDrawnId = null,
  wildcard = null
) {
  const idSet = new Set(tileIds);
  const removed = hand.filter((t) => idSet.has(t.id));
  if (removed.length !== tileIds.length) return false;

  let beforeHand = hand;
  if (lastDrawnId && hand.some((t) => t.id === lastDrawnId)) {
    beforeHand = hand.filter((t) => t.id !== lastDrawnId);
  }

  const beforeWaits = getWaitKeys(beforeHand, melds, wildcard);
  if (beforeWaits.length === 0) return false;

  const afterHand = hand.filter((t) => !idSet.has(t.id));
  const kind = tileIds.length >= 5 ? 'kin' : 'kan';
  const afterMelds = [...melds, { type: kind, tiles: removed, open: false }];
  const afterWaits = getWaitKeys(afterHand, afterMelds, wildcard);
  return sameWaitKeys(beforeWaits, afterWaits);
}

/**
 * Riichi: upgrading closed kan → closed kin must keep the same waits.
 * @param {import('./tiles.js').Tile[]} hand
 * @param {object[]} melds
 * @param {number} meldIndex closed kan index
 * @param {string} tileId fifth tile from hand
 * @param {string|null} lastDrawnId
 */
export function closedKinFromKanPreservesWaits(
  hand,
  melds,
  meldIndex,
  tileId,
  lastDrawnId = null,
  wildcard = null
) {
  const meld = melds[meldIndex];
  if (!meld || meld.type !== 'kan' || meld.open) return false;
  const added = hand.find((t) => t.id === tileId);
  if (!added) return false;

  let beforeHand = hand;
  if (lastDrawnId && hand.some((t) => t.id === lastDrawnId)) {
    beforeHand = hand.filter((t) => t.id !== lastDrawnId);
  }

  const beforeWaits = getWaitKeys(beforeHand, melds, wildcard);
  if (beforeWaits.length === 0) return false;

  const afterHand = hand.filter((t) => t.id !== tileId);
  const afterMelds = melds.map((m, i) =>
    i === meldIndex
      ? {
          ...m,
          type: 'kin',
          tiles: [...m.tiles, added],
          open: false,
          addedTileId: added.id,
        }
      : m
  );
  const afterWaits = getWaitKeys(afterHand, afterMelds, wildcard);
  return sameWaitKeys(beforeWaits, afterWaits);
}

/**
 * Closed tenpai (or complete hand that can discard into tenpai) — eligible for riichi.
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 * @param {{ drewThisTurn: boolean, mustDiscard: boolean, canDraw: boolean, alreadyRiichi: boolean }} ctx
 */
export function canDeclareRiichi(hand, melds, ctx) {
  if (ctx.alreadyRiichi) return false;
  if (!isClosedHand(melds)) return false;

  // 13-tile tenpai (claim turn / before draw), or 14-tile with a tenpai discard
  // (including a complete winning hand — discard into tenpai / furiten).
  if (
    ctx.mustDiscard &&
    (isTenpai(hand, melds, ctx.wildcard) || hasTenpaiDiscard(hand, melds, ctx.wildcard))
  ) {
    return true;
  }
  if (ctx.drewThisTurn && hasTenpaiDiscard(hand, melds, ctx.wildcard)) return true;
  if (ctx.canDraw && isTenpai(hand, melds, ctx.wildcard)) return true;

  return false;
}
