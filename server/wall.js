/** @typedef {import('./tiles.js').Tile} Tile */

/** Kan/kin supplement draws (rinshan) in the 5-player dead wall */
export const RINSHAN_COUNT = 5;
/** Face-up dora indicators — one shown at deal, one more per supplement draw */
export const DORA_SLOTS = 6;
/** Face-down ura dora paired under each dora slot */
export const URA_DORA_SLOTS = 6;

export const DEAD_WALL_SIZE = RINSHAN_COUNT + DORA_SLOTS + URA_DORA_SLOTS;

/**
 * Riichi-style dead wall at the live-wall end.
 *
 * Index layout (0 = next to live wall):
 *   [0 .. DORA_SLOTS-1]  dora indicators (slot DORA_SLOTS-1 revealed at deal)
 *   [DORA_SLOTS .. DORA_SLOTS+URA-1]  ura dora (under matching dora slot)
 *   [remainder .. end]  rinshan tiles (drawn from the far end inward)
 *
 * Each rinshan draw is paired with shifting the last live-wall tile into the
 * emptied rinshan slot (kan wall), so the live wall shortens by one.
 */
export class DeadWall {
  /** @param {Tile[]} tiles length must equal DEAD_WALL_SIZE */
  constructor(tiles) {
    if (tiles.length !== DEAD_WALL_SIZE) {
      throw new Error(`Dead wall requires ${DEAD_WALL_SIZE} tiles.`);
    }
    this.tiles = tiles;
    this.rinshanBase = DORA_SLOTS + URA_DORA_SLOTS;
    this.rinshanDrawn = 0;
    /** How many dora slots are face-up (starts at 1). */
    this.doraRevealed = 1;
  }

  /** Slot index of the first revealed dora indicator. */
  firstDoraSlot() {
    return DORA_SLOTS - 1;
  }

  /** Slot index for the n-th revealed dora (0 = first shown at deal). */
  doraSlotForRevealOrder(n) {
    return DORA_SLOTS - 1 - n;
  }

  rinshanRemaining() {
    return RINSHAN_COUNT - this.rinshanDrawn;
  }

  doraRemaining() {
    return DORA_SLOTS - this.doraRevealed;
  }

  /** Index of the rinshan slot that was most recently drawn (or -1). */
  lastDrawnRinshanIndex() {
    if (this.rinshanDrawn <= 0) return -1;
    return this.rinshanBase + (RINSHAN_COUNT - this.rinshanDrawn);
  }

  /** Draw one supplement tile from the rinshan end. */
  drawRinshan() {
    if (this.rinshanDrawn >= RINSHAN_COUNT) return null;
    const idx = this.rinshanBase + (RINSHAN_COUNT - 1 - this.rinshanDrawn);
    this.rinshanDrawn++;
    return this.tiles[idx];
  }

  /**
   * Place a tile taken from the end of the live wall into the slot just drawn
   * for rinshan (keeps dead-wall size; that tile is no longer live).
   * @param {Tile} tile
   */
  receiveFromLiveWall(tile) {
    if (!tile) return;
    const idx = this.lastDrawnRinshanIndex();
    if (idx >= this.rinshanBase && idx < this.tiles.length) {
      this.tiles[idx] = tile;
    } else {
      this.tiles.push(tile);
    }
  }

  /** Flip the next dora indicator after a supplement draw. */
  revealNextDora() {
    if (this.doraRevealed >= DORA_SLOTS) return null;
    const slot = this.doraSlotForRevealOrder(this.doraRevealed);
    this.doraRevealed++;
    return this.tiles[slot];
  }

  /** All currently face-up dora indicator tiles (deal order). */
  revealedDoraIndicators() {
    const out = [];
    for (let i = 0; i < this.doraRevealed; i++) {
      out.push(this.tiles[this.doraSlotForRevealOrder(i)]);
    }
    return out;
  }

  /** Ura dora tile under a dora slot (only meaningful once that slot is revealed). */
  uraDoraForSlot(slot) {
    if (slot < 0 || slot >= DORA_SLOTS) return null;
    return this.tiles[DORA_SLOTS + slot];
  }

  /** Ura dora paired with each revealed dora, same order as revealedDoraIndicators(). */
  revealedUraDora() {
    const out = [];
    for (let i = 0; i < this.doraRevealed; i++) {
      out.push(this.uraDoraForSlot(this.doraSlotForRevealOrder(i)));
    }
    return out;
  }

  /** Snapshot for clients — ura sent only after a riichi win (see game.finishWin). */
  toSnapshot({ includeUra = false } = {}) {
    const doraIndicators = this.revealedDoraIndicators();
    return {
      rinshanRemaining: this.rinshanRemaining(),
      doraRevealed: this.doraRevealed,
      doraSlots: DORA_SLOTS,
      doraIndicators,
      uraDoraIndicators: includeUra ? this.revealedUraDora() : null,
    };
  }
}

/**
 * Split the post-deal wall into live + dead segments.
 * @param {Tile[]} wall
 * @returns {{ liveWall: Tile[], deadWall: DeadWall }}
 */
export function splitWall(wall, { doraRevealed = 1 } = {}) {
  if (wall.length < DEAD_WALL_SIZE) {
    throw new Error('Not enough tiles to form a dead wall.');
  }
  const deadTiles = wall.slice(-DEAD_WALL_SIZE);
  const liveWall = wall.slice(0, -DEAD_WALL_SIZE);
  const deadWall = new DeadWall(deadTiles);
  deadWall.doraRevealed = doraRevealed;
  return { liveWall, deadWall };
}
