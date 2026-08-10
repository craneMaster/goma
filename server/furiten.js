import { tileKey } from './claims.js';
import { canWin } from './win.js';
import { ALL_WAIT_KEYS } from './riichi.js';

function waitTile(key) {
  const [suit, rank] = key.split('-');
  return { id: `wait-${key}`, suit, rank: Number(rank), copy: 0 };
}

/**
 * Tile keys that complete a tenpai hand (shape waits).
 * Furiten uses shape only — yakuless waits still count.
 * Optional `isValidWin` can further filter (unused by default game rules).
 * @param {import('./tiles.js').Tile[]} hand
 * @param {object[]} melds
 * @param {(winTile: object) => boolean} [isValidWin]
 * @returns {string[]}
 */
export function getWaitKeys(hand, melds, isValidWin = null) {
  if (canWin(hand, melds)) return [];
  const waits = [];
  for (const key of ALL_WAIT_KEYS) {
    const wait = waitTile(key);
    if (!canWin(hand, melds, wait)) continue;
    if (isValidWin && !isValidWin(wait)) continue;
    waits.push(key);
  }
  return waits;
}

/**
 * Discard furiten: a shape-wait tile was discarded this hand.
 * Uses `furitenDiscardKeys` when present so called-away river tiles still count.
 * @param {import('./tiles.js').Tile[]} hand
 * @param {object[]} melds
 * @param {Array<{ tile?: import('./tiles.js').Tile }|import('./tiles.js').Tile>} discards
 * @param {(winTile: object) => boolean} [isValidWin]
 * @param {string[]|null} [furitenDiscardKeys]
 */
export function isDiscardFuriten(
  hand,
  melds,
  discards,
  isValidWin = null,
  furitenDiscardKeys = null
) {
  const waits = getWaitKeys(hand, melds, isValidWin);
  if (waits.length === 0) return false;
  const waitSet = new Set(waits);
  const keys =
    furitenDiscardKeys != null
      ? furitenDiscardKeys
      : (discards || []).map((d) => {
          const tile = d?.tile ?? d;
          return tile ? tileKey(tile) : null;
        });
  for (const key of keys) {
    if (key && waitSet.has(key)) return true;
  }
  return false;
}

/**
 * True if the player may not ron (tsumo still allowed).
 * Based on shape waits; yaku is irrelevant for furiten.
 * @param {{ temporaryFuriten?: boolean, riichiFuriten?: boolean, discards: object[], furitenDiscardKeys?: string[] }} player
 * @param {import('./tiles.js').Tile[]} hand
 * @param {object[]} melds
 * @param {(winTile: object) => boolean} [isValidWin]
 */
export function isFuriten(player, hand, melds, isValidWin = null) {
  if (player.temporaryFuriten || player.riichiFuriten) return true;
  return isDiscardFuriten(
    hand,
    melds,
    player.discards ?? [],
    isValidWin,
    player.furitenDiscardKeys ?? null
  );
}

/**
 * @returns {'riichi'|'temporary'|'discard'|null}
 */
export function furitenReason(player, hand, melds, isValidWin = null) {
  if (player.riichiFuriten) return 'riichi';
  if (player.temporaryFuriten) return 'temporary';
  if (
    isDiscardFuriten(
      hand,
      melds,
      player.discards ?? [],
      isValidWin,
      player.furitenDiscardKeys ?? null
    )
  ) {
    return 'discard';
  }
  return null;
}
