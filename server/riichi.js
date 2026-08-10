import { tileKey } from './claims.js';
import { canWin, canPartitionHandForMelds } from './win.js';

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
export function isTenpai(hand, melds) {
  if (melds.length > 4) return false;
  if (canWin(hand, melds)) return false;

  for (const key of ALL_WAIT_KEYS) {
    const wait = waitTile(key);
    if (canPartitionHandForMelds([...hand, wait], melds)) return true;
    if (canWin(hand, melds, wait)) return true;
  }
  return false;
}

/**
 * Ready at round end — winning shape or one tile from it.
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 */
export function isReady(hand, melds) {
  if (canWin(hand, melds)) return true;
  if (isTenpai(hand, melds)) return true;
  return hasTenpaiDiscard(hand, melds);
}

/**
 * True if some discard leaves a tenpai hand.
 * Includes already-complete (winning) 14-tile hands — you may discard into
 * tenpai to declare riichi (and typically enter discard furiten).
 * @param {import('./tiles.js').Tile[]} hand
 * @param {Array<{ tiles: import('./tiles.js').Tile[] }>} melds
 */
export function hasTenpaiDiscard(hand, melds) {
  for (let i = 0; i < hand.length; i++) {
    const rest = hand.filter((_, j) => j !== i);
    if (isTenpai(rest, melds)) return true;
  }
  return false;
}

/** Tile ids that can be discarded while staying tenpai. */
export function tenpaiDiscardIds(hand, melds) {
  const ids = [];
  for (let i = 0; i < hand.length; i++) {
    const rest = hand.filter((_, j) => j !== i);
    if (isTenpai(rest, melds)) ids.push(hand[i].id);
  }
  return ids;
}

export function isTenpaiDiscard(hand, melds, tileId) {
  const idx = hand.findIndex((t) => t.id === tileId);
  if (idx < 0) return false;
  const rest = hand.filter((_, j) => j !== idx);
  return isTenpai(rest, melds);
}

/** Shape wait keys for a tenpai hand (empty if already complete). */
export function getWaitKeys(hand, melds) {
  if (canWin(hand, melds)) return [];
  const waits = [];
  for (const key of ALL_WAIT_KEYS) {
    if (canWin(hand, melds, waitTile(key))) waits.push(key);
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
export function closedKanPreservesWaits(hand, melds, tileIds, lastDrawnId = null) {
  const idSet = new Set(tileIds);
  const removed = hand.filter((t) => idSet.has(t.id));
  if (removed.length !== tileIds.length) return false;

  let beforeHand = hand;
  if (lastDrawnId && hand.some((t) => t.id === lastDrawnId)) {
    beforeHand = hand.filter((t) => t.id !== lastDrawnId);
  }

  const beforeWaits = getWaitKeys(beforeHand, melds);
  if (beforeWaits.length === 0) return false;

  const afterHand = hand.filter((t) => !idSet.has(t.id));
  const kind = tileIds.length >= 5 ? 'kin' : 'kan';
  const afterMelds = [...melds, { type: kind, tiles: removed, open: false }];
  const afterWaits = getWaitKeys(afterHand, afterMelds);
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
  lastDrawnId = null
) {
  const meld = melds[meldIndex];
  if (!meld || meld.type !== 'kan' || meld.open) return false;
  const added = hand.find((t) => t.id === tileId);
  if (!added) return false;

  let beforeHand = hand;
  if (lastDrawnId && hand.some((t) => t.id === lastDrawnId)) {
    beforeHand = hand.filter((t) => t.id !== lastDrawnId);
  }

  const beforeWaits = getWaitKeys(beforeHand, melds);
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
  const afterWaits = getWaitKeys(afterHand, afterMelds);
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
  if (ctx.mustDiscard && (isTenpai(hand, melds) || hasTenpaiDiscard(hand, melds))) {
    return true;
  }
  if (ctx.drewThisTurn && hasTenpaiDiscard(hand, melds)) return true;
  if (ctx.canDraw && isTenpai(hand, melds)) return true;

  return false;
}
