/** Starting score for each seat in a 5-player game. */
export const STARTING_POINTS = 40000;

/** Match target — needed to avoid a tiebreaker go-around, and to end overtime early. */
export const TARGET_POINTS = 45000;

/**
 * Placement uma in thousands (×1000 points): 1st…5th.
 * Applied only at match end.
 */
export const UMA_THOUSANDS = [20, 10, 0, -10, -20];

/** Points placed on the table when declaring riichi. */
export const RIICHI_BET = 1000;

/**
 * Total points transferred on exhaustive draw when both ready and not-ready
 * players exist (tenpai ↔ noten payment). Split as 3600/a to each ready player
 * and −3600/b from each not-ready player (a,b ∈ {1,2,3,4}).
 */
export const NOTEN_BAO = 3600;

/** Limitless Asura: the noten pool shrinks with the players still in the hand. */
const ASURA_NOTEN_POOL = { 5: 3600, 4: 3000, 3: 2000, 2: 1000 };

export function notenPoolForPlayers(remaining) {
  return ASURA_NOTEN_POOL[remaining] ?? 0;
}

/** Round a payment up to the next 100 (riichi convention). */
export function roundUpTo100(n) {
  if (n <= 0) return 0;
  return Math.ceil(n / 100) * 100;
}

/**
 * Seat closest to the discarder in turn order (CCW) — head bump / アタマハネ.
 * @param {number[]} seats
 * @param {number} fromSeat
 * @param {number} [playerCount]
 */
export function headBumpWinner(seats, fromSeat, playerCount = 5) {
  if (!seats.length) return null;
  return [...seats].sort((a, b) => {
    const da = (a - fromSeat + playerCount) % playerCount;
    const db = (b - fromSeat + playerCount) % playerCount;
    return da - db;
  })[0];
}

/**
 * 4-player-style basic points from han/fu.
 * @param {number} han total han including dora (or yakuman han units)
 * @param {number} fu
 * @param {{ isYakuman?: boolean, yakuman?: number }} [opts]
 */
export function basicPoints(han, fu, opts = {}) {
  const { isYakuman = false, yakuman = 1 } = opts;
  if (isYakuman) {
    return 8000 * Math.max(1, yakuman);
  }
  if (han >= 13) return 8000; // kazoe yakuman
  if (han >= 11) return 6000; // sanbaiman
  if (han >= 8) return 4000; // baiman
  if (han >= 6) return 3000; // haneman
  if (han >= 5) return 2000; // mangan

  const f = Math.max(fu, 20);
  let raw = f * 2 ** (han + 2);
  if (raw >= 2000) return 2000; // mangan by fu
  return raw;
}

/**
 * Point deltas for one winning hand (5 players).
 *
 * Tsumo: same per-player payments as 4-player mahjong
 *   - dealer win: each other pays roundUp(2 × basic)
 *   - non-dealer win: dealer pays roundUp(2 × basic), others pay roundUp(1 × basic)
 *
 * Ron:
 *   - non-dealer win: discarder pays roundUp(5 × basic)
 *   - dealer win: discarder pays roundUp(8 × basic)
 *
 * Honba: +400 to ron payment; +100 from each tsumo payer.
 *
 * @returns {{
 *   basic: number,
 *   deltas: number[],
 *   payments: Array<{ from: number, to: number, amount: number }>,
 * }}
 */
export function scoreWin({
  mode,
  winnerSeat,
  dealerIndex,
  fromSeat = null,
  han,
  fu,
  isYakuman = false,
  yakuman = 1,
  honba = 0,
  activeSeats = null,
  playerCount = 5,
}) {
  const basic = basicPoints(han, fu, { isYakuman, yakuman });
  const deltas = Array.from({ length: playerCount }, () => 0);
  /** @type {Array<{ from: number, to: number, amount: number }>} */
  const payments = [];
  const active = activeSeats == null ? null : new Set(activeSeats);

  const addPay = (from, to, amount) => {
    if (amount <= 0 || from === to) return;
    deltas[from] -= amount;
    deltas[to] += amount;
    payments.push({ from, to, amount });
  };

  const canPay = (seat) => active == null || active.has(seat);

  const winnerIsDealer = winnerSeat === dealerIndex;

  if (mode === 'ron') {
    if (fromSeat == null || fromSeat < 0) {
      return { basic, deltas, payments };
    }
    const mult = winnerIsDealer ? 8 : 5;
    const amount = roundUpTo100(basic * mult) + 400 * honba;
    if (canPay(fromSeat)) addPay(fromSeat, winnerSeat, amount);
    return { basic, deltas, payments };
  }

  // tsumo — 4-player payment amounts
  for (let s = 0; s < playerCount; s++) {
    if (s === winnerSeat || !canPay(s)) continue;
    let amount;
    if (winnerIsDealer) {
      amount = roundUpTo100(2 * basic) + 100 * honba;
    } else if (s === dealerIndex) {
      amount = roundUpTo100(2 * basic) + 100 * honba;
    } else {
      amount = roundUpTo100(1 * basic) + 100 * honba;
    }
    addPay(s, winnerSeat, amount);
  }

  return { basic, deltas, payments };
}

/**
 * Apply several win scores (e.g. multi-ron) into one delta vector.
 * @param {Array<ReturnType<typeof scoreWin>>} scores
 * @param {number} playerCount
 */
export function mergeScoreDeltas(scores, playerCount = 5) {
  const deltas = Array.from({ length: playerCount }, () => 0);
  const payments = [];
  for (const s of scores) {
    for (let i = 0; i < playerCount; i++) {
      deltas[i] += s.deltas[i] ?? 0;
    }
    payments.push(...s.payments);
  }
  return { deltas, payments };
}

/**
 * Noten (未听) penalty on exhaustive draw.
 * With a ready and b not-ready players (1..4 each): ready +3600/a, noten −3600/b.
 * When `activeSeats` is given (Limitless Asura), the 3600 pool is replaced by
 * the pool for the remaining player count (5: 3600, 4: 3000, 3: 2000, 2: 1000).
 * If a = 0 or b = 0, no exchange.
 *
 * @param {boolean[]} readyFlags length = playerCount
 * @param {number} [playerCount]
 * @returns {{
 *   deltas: number[],
 *   payments: Array<{ from: number, to: number, amount: number }>,
 *   gain: number,
 *   loss: number,
 *   readyCount: number,
 *   notenCount: number,
 * }}
 */
export function scoreNotenPenalty(readyFlags, playerCount = 5, activeSeats = null) {
  const deltas = Array.from({ length: playerCount }, () => 0);
  /** @type {Array<{ from: number, to: number, amount: number }>} */
  const payments = [];
  const ready = [];
  const noten = [];
  const active = activeSeats == null ? null : new Set(activeSeats);
  for (let i = 0; i < playerCount; i++) {
    if (active && !active.has(i)) continue;
    if (readyFlags[i]) ready.push(i);
    else noten.push(i);
  }
  const a = ready.length;
  const b = noten.length;
  if (a === 0 || b === 0) {
    return { deltas, payments, gain: 0, loss: 0, readyCount: a, notenCount: b };
  }

  const pool = activeSeats == null ? NOTEN_BAO : notenPoolForPlayers(a + b);
  const gain = pool / a;
  const loss = pool / b;
  for (const s of ready) deltas[s] += gain;
  for (const s of noten) deltas[s] -= loss;

  // Each not-ready pays an equal share of each ready player's gain.
  const perPair = gain / b; // = loss / a = pool/(a*b)
  for (const from of noten) {
    for (const to of ready) {
      payments.push({ from, to, amount: perPair });
    }
  }

  return { deltas, payments, gain, loss, readyCount: a, notenCount: b };
}

/**
 * Han result for nagashi mangan (流し満貫) on exhaustive draw.
 * Paid as mangan tsumo; noten exchange is skipped when this applies.
 */
export const NAGASHI_MANGAN_HAN = {
  yakus: [
    {
      id: 'nagashiMangan',
      name: '流し満貫',
      nameEn: 'Nagashi Mangan',
      han: 5,
    },
  ],
  han: 5,
  yakuman: 0,
  dora: 0,
  uraDora: 0,
  totalHan: 5,
  isYakuman: false,
  fu: 0,
};

/**
 * Score one or more nagashi mangan winners as mangan tsumo each.
 * @param {{
 *   winnerSeats: number[],
 *   dealerIndex: number,
 *   honba?: number,
 *   playerCount?: number,
 * }} opts
 */
export function scoreNagashiMangan({
  winnerSeats,
  dealerIndex,
  honba = 0,
  activeSeats = null,
  playerCount = 5,
}) {
  const scores = winnerSeats.map((winnerSeat) =>
    scoreWin({
      mode: 'tsumo',
      winnerSeat,
      dealerIndex,
      han: 5,
      fu: 0,
      honba,
      activeSeats,
      playerCount,
    })
  );
  const merged = mergeScoreDeltas(scores, playerCount);
  return {
    ...merged,
    basic: basicPoints(5, 0),
    scores,
  };
}

/** @param {number} n */
export function formatPoints(n) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n}`;
}

/**
 * Rank seats by score and attach uma (+20/+10/0/−10/−20 thousand).
 * @param {Array<{ seat: number, name: string, points: number }>} players
 */
export function computeUmaStandings(players) {
  const ranked = [...players].sort(
    (a, b) => b.points - a.points || a.seat - b.seat
  );
  return ranked.map((p, i) => {
    const uma = UMA_THOUSANDS[i] ?? 0;
    const umaPoints = uma * 1000;
    return {
      seat: p.seat,
      name: p.name,
      points: p.points,
      rank: i + 1,
      uma,
      umaPoints,
      finalPoints: p.points + umaPoints,
    };
  });
}
