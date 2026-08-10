/** @typedef {'man' | 'pin' | 'sou' | 'wind' | 'dragon'} Suit */

/**
 * @typedef {Object} Tile
 * @property {string} id
 * @property {Suit} suit
 * @property {number} rank
 * @property {number} copy
 * @property {boolean} [red] — aka dora (red five)
 */

/** Copy indices replaced with red fives (still rank 5 for play/sort). */
const RED_FIVE_COPIES = {
  man: new Set([4]),
  pin: new Set([3, 4]),
  sou: new Set([4]),
};

/** Winds: 東南西北花 (rank 1–5) */
const WIND_LABELS = ['東', '南', '西', '北', '花'];
/** Rank 1=紅中, 2=發, 3=白 — hand order is white → green → red */
const DRAGON_LABELS = ['中', '發', '白'];

let nextId = 0;

function makeTile(suit, rank, copy) {
  const tile = {
    id: `${suit}-${rank}-${copy}-${nextId++}`,
    suit,
    rank,
    copy,
  };
  if (rank === 5 && RED_FIVE_COPIES[suit]?.has(copy)) {
    tile.red = true;
  }
  return tile;
}

/**
 * Full deck: 5 copies of each tile.
 * Winds are ranks 1–5 (東南西北花); 花 is the fifth wind, not a separate suit.
 */
export function buildDeck() {
  nextId = 0;
  const deck = [];

  for (const suit of ['man', 'pin', 'sou']) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let copy = 0; copy < 5; copy++) {
        deck.push(makeTile(suit, rank, copy));
      }
    }
  }

  for (let rank = 1; rank <= 5; rank++) {
    for (let copy = 0; copy < 5; copy++) {
      deck.push(makeTile('wind', rank, copy));
    }
  }

  for (let rank = 1; rank <= 3; rank++) {
    for (let copy = 0; copy < 5; copy++) {
      deck.push(makeTile('dragon', rank, copy));
    }
  }

  return deck;
}

export function tileLabel(tile) {
  if (tile.suit === 'man') return tile.red ? '赤5万' : `${tile.rank}万`;
  if (tile.suit === 'pin') return tile.red ? '赤5筒' : `${tile.rank}筒`;
  if (tile.suit === 'sou') return tile.red ? '赤5条' : `${tile.rank}条`;
  if (tile.suit === 'wind') return WIND_LABELS[tile.rank - 1] ?? '?';
  if (tile.suit === 'dragon') return DRAGON_LABELS[tile.rank - 1];
  return '?';
}

export function tileShort(tile) {
  if (tile.suit === 'wind') return WIND_LABELS[tile.rank - 1] ?? '?';
  if (tile.suit === 'dragon') return DRAGON_LABELS[tile.rank - 1];
  if (tile.suit === 'man') return `${tile.rank}`;
  if (tile.suit === 'pin') return `○${tile.rank}`;
  return `‖${tile.rank}`;
}

/**
 * Hand order: man → pin → sou → honors
 * Honors: east, south, west, north, flower (wind 1–5), white, green, red
 */
export function sortHand(tiles) {
  const suitOrder = { man: 0, pin: 1, sou: 2, wind: 3, dragon: 3 };

  /** @param {Tile} t */
  function honorKey(t) {
    if (t.suit === 'wind') return t.rank; // 1–5
    if (t.suit === 'dragon') {
      // white(3), green(2), red(1)
      return { 3: 6, 2: 7, 1: 8 }[t.rank] ?? 9;
    }
    return 99;
  }

  return [...tiles].sort((a, b) => {
    const ao = suitOrder[a.suit] ?? 9;
    const bo = suitOrder[b.suit] ?? 9;
    if (ao !== bo) return ao - bo;
    if (ao === 3) return honorKey(a) - honorKey(b);
    return a.rank - b.rank;
  });
}

/** 5× (27 numbered + 5 winds + 3 dragons) = 175 */
export const DECK_SIZE = 5 * (9 * 3 + 5 + 3);

/** Seat winds — 花 is the fifth wind */
export const PLAYER_WINDS = ['东', '南', '西', '北', '花'];

/** Seat wind relative to the current dealer (dealer is always 东). */
export function windForSeat(seat, dealerIndex, playerCount = 5) {
  const offset = (seat - dealerIndex + playerCount) % playerCount;
  return PLAYER_WINDS[offset];
}

/** Display label for a seat wind (东风 / 南风 / … / 花风). */
export function windLabel(wind) {
  if (!wind) return '';
  if (wind.endsWith('风')) return wind;
  return `${wind}风`;
}

/** Terminals (1/9) and honors (winds including 花, dragons). */
export function isTerminalOrHonorTile(tile) {
  if (!tile) return false;
  if (tile.suit === 'wind' || tile.suit === 'dragon') return true;
  return (
    (tile.suit === 'man' || tile.suit === 'pin' || tile.suit === 'sou') &&
    (tile.rank === 1 || tile.rank === 9)
  );
}
