/** Replay recording helpers — omniscient event log for post-game download. */

/**
 * @param {import('./tiles.js').Tile | null | undefined} tile
 * @returns {object | null}
 */
export function cloneTile(tile) {
  if (!tile) return null;
  const out = {
    id: tile.id,
    suit: tile.suit,
    rank: tile.rank,
    copy: tile.copy,
  };
  if (tile.red) out.red = true;
  return out;
}

/**
 * @param {import('./tiles.js').Tile[]} tiles
 */
export function cloneTiles(tiles) {
  return (tiles ?? []).map(cloneTile);
}

/**
 * Deep-clone plain JSON-safe game data (round summaries, etc.).
 * @param {unknown} value
 */
export function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {{ code: string, gameLength: string, gameLengthLabel: string, players: { name: string }[] }} room
 */
export function createReplayDocument(room) {
  return {
    version: 1,
    format: 'mahjong5-replay',
    meta: {
      code: room.code,
      gameLength: room.gameLength,
      gameLengthLabel: room.gameLengthLabel,
      players: room.players.map((p, seat) => ({
        seat,
        name: p.name,
      })),
      startedAt: new Date().toISOString(),
      endedAt: null,
    },
    hands: [],
    result: null,
  };
}

/**
 * @param {object} replay
 * @param {object} handMeta
 */
export function beginHand(replay, handMeta) {
  if (!replay) return null;
  const hand = {
    index: replay.hands.length,
    ...handMeta,
    events: [],
    summary: null,
  };
  replay.hands.push(hand);
  return hand;
}

/**
 * @param {object | null} hand
 * @param {string} type
 * @param {object} [payload]
 */
export function pushHandEvent(hand, type, payload = {}) {
  if (!hand) return;
  const { type: _ignored, ...rest } = payload;
  hand.events.push({
    t: hand.events.length,
    at: Date.now(),
    ...rest,
    type, // keep event kind authoritative (payload must not overwrite)
  });
}
