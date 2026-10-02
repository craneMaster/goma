import { tileKey } from './claims.js';
import {
  countsFromTiles,
  isSevenPairs,
  isThirteenOrphans,
  wildcardAssignments,
} from './win.js';
import { countDora } from './dora.js';
import { basicPoints } from './scoring.js';

const NUMBERED = new Set(['man', 'pin', 'sou']);

/**
 * @typedef {{ id: string, name: string, nameEn: string, han: number, yakuman?: boolean }} Yaku
 * @typedef {{
 *   yakus: Yaku[],
 *   han: number,
 *   yakuman: number,
 *   dora: number,
 *   uraDora: number,
 *   totalHan: number,
 *   isYakuman: boolean,
 *   fu: number,
 * }} HanResult
 */

function parseKey(key) {
  const [suit, rank] = key.split('-');
  return { suit, rank: Number(rank) };
}

function cloneCounts(counts) {
  return new Map(counts);
}

function sortedKeys(counts) {
  return [...counts.keys()].filter((k) => (counts.get(k) || 0) > 0).sort();
}

/** Seat wind tile key: 东/南/西/北/花 → wind-1…wind-5 */
export function seatWindKey(seat, dealerIndex, playerCount = 5) {
  const offset = (seat - dealerIndex + playerCount) % playerCount;
  return `wind-${offset + 1}`;
}

/** Round wind tile key from 场风 index 0–3 */
export function roundWindKey(roundWindIndex) {
  return `wind-${(roundWindIndex % 4) + 1}`;
}

function isHonorKey(key) {
  const { suit } = parseKey(key);
  return suit === 'wind' || suit === 'dragon';
}

function isTerminalKey(key) {
  const { suit, rank } = parseKey(key);
  return NUMBERED.has(suit) && (rank === 1 || rank === 9);
}

function isTerminalOrHonorKey(key) {
  return isHonorKey(key) || isTerminalKey(key);
}

function isSimpleKey(key) {
  const { suit, rank } = parseKey(key);
  return NUMBERED.has(suit) && rank >= 2 && rank <= 8;
}

/** Pon, kan, and kin all count as one triplet/set for triplet-based yaku. */
function isTripletGroup(g) {
  return (
    g.triplet === true ||
    g.kind === 'pon' ||
    g.kind === 'kan' ||
    g.kind === 'kin'
  );
}

function tripletTileKey(g) {
  if (!isTripletGroup(g)) return null;
  if (g.tileKey) return g.tileKey;
  return g.keys[0] ?? null;
}

function makeTripletGroup(kind, key, count, { open = false, kan = false } = {}) {
  return {
    kind,
    tileKey: key,
    keys: Array.from({ length: count }, () => key),
    open,
    kan,
    triplet: true,
  };
}

/**
 * @param {{ type: string, tiles: object[], open?: boolean }} meld
 */
function tableMeldInfo(meld) {
  const keys = meld.tiles.map(tileKey);
  const open = meld.open !== false;
  if (meld.type === 'chi' || meld.type === 'largeChi') {
    return { kind: 'chi', keys, open, kan: false, triplet: false };
  }
  const key = keys[0];
  if (meld.type === 'pon') {
    return makeTripletGroup('pon', key, 3, { open, kan: false });
  }
  if (meld.type === 'kan') {
    return makeTripletGroup('kan', key, 4, { open, kan: true });
  }
  if (meld.type === 'kin') {
    return makeTripletGroup('kin', key, 5, { open, kan: true });
  }
  return makeTripletGroup('pon', key, keys.length || 3, { open, kan: false });
}

/**
 * Recursively find every standard partition of counts into `groupsLeft` groups.
 * @returns {object[][]}
 */
function findAllGroups(counts, groupsLeft) {
  if (groupsLeft === 0) {
    return sortedKeys(counts).length === 0 ? [[]] : [];
  }

  const keys = sortedKeys(counts);
  if (keys.length === 0) return [];
  const first = keys[0];
  const n = counts.get(first) || 0;
  const { suit, rank } = parseKey(first);
  /** @type {object[][]} */
  const results = [];

  if (n >= 5) {
    const next = cloneCounts(counts);
    next.set(first, n - 5);
    if (next.get(first) === 0) next.delete(first);
    for (const rest of findAllGroups(next, groupsLeft - 1)) {
      results.push([makeTripletGroup('kin', first, 5, { open: false, kan: true }), ...rest]);
    }
  }
  if (n >= 4) {
    const next = cloneCounts(counts);
    next.set(first, n - 4);
    if (next.get(first) === 0) next.delete(first);
    for (const rest of findAllGroups(next, groupsLeft - 1)) {
      results.push([makeTripletGroup('kan', first, 4, { open: false, kan: true }), ...rest]);
    }
  }
  if (n >= 3) {
    const next = cloneCounts(counts);
    next.set(first, n - 3);
    if (next.get(first) === 0) next.delete(first);
    for (const rest of findAllGroups(next, groupsLeft - 1)) {
      results.push([makeTripletGroup('pon', first, 3, { open: false, kan: false }), ...rest]);
    }
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
      for (const rest of findAllGroups(next, groupsLeft - 1)) {
        results.push([
          { kind: 'chi', keys: [first, k2, k3], open: false, kan: false, triplet: false },
          ...rest,
        ]);
      }
    }
  }
  return results;
}

/**
 * @param {import('./tiles.js').Tile[]} tiles
 * @param {object[]} tableMelds
 */
function findPartitions(tiles, tableMelds) {
  const groupsNeeded = Math.max(0, 4 - tableMelds.length);
  const counts = countsFromTiles(tiles);
  const partitions = [];
  const seen = new Set();

  for (const [key, n] of counts) {
    if (n < 2) continue;
    const next = cloneCounts(counts);
    next.set(key, n - 2);
    if (next.get(key) === 0) next.delete(key);
    for (const groups of findAllGroups(next, groupsNeeded)) {
      const part = {
        pair: key,
        groups: [...tableMelds.map(tableMeldInfo), ...groups],
      };
      const sig = partitionSignature(part);
      if (seen.has(sig)) continue;
      seen.add(sig);
      partitions.push(part);
    }
  }
  return partitions;
}

function partitionSignature(part) {
  const groupSigs = part.groups
    .map((g) => {
      if (g.kind === 'chi') return `chi:${[...g.keys].sort().join(',')}`;
      return `${g.kind}:${tripletTileKey(g)}`;
    })
    .sort();
  return `${part.pair}|${groupSigs.join(';')}`;
}

function handIsClosed(melds) {
  return melds.every((m) => !m.open);
}

/** Minimum 1112345678999 counts for nine gates (index = rank). */
const CHUUREN_BASE = [0, 3, 1, 1, 1, 1, 1, 1, 1, 3];

/**
 * Rank counts for a single numbered suit, or null if mixed/honors.
 * @param {import('./tiles.js').Tile[]} tiles
 * @returns {{ suit: string, counts: number[] }|null}
 */
function suitRankCounts(tiles) {
  if (!tiles.length) return null;
  let suit = null;
  const counts = Array(10).fill(0);
  for (const t of tiles) {
    const { suit: s, rank } = parseKey(tileKey(t));
    if (!NUMBERED.has(s) || rank < 1 || rank > 9) return null;
    if (suit == null) suit = s;
    else if (s !== suit) return null;
    counts[rank]++;
  }
  return { suit, counts };
}

/** True if counts are exactly 1112345678999 plus one extra of some rank. */
function matchesChuurenCounts(counts) {
  for (let extra = 1; extra <= 9; extra++) {
    let ok = true;
    for (let r = 1; r <= 9; r++) {
      if (counts[r] !== CHUUREN_BASE[r] + (r === extra ? 1 : 0)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Pure nine gates: removing the winning tile leaves exact 1112345678999. */
function isJunseiChuuren(counts, winKey) {
  if (!winKey) return false;
  const { suit, rank } = parseKey(winKey);
  if (!NUMBERED.has(suit) || rank < 1 || rank > 9) return false;
  if ((counts[rank] || 0) < 1) return false;
  const without = counts.slice();
  without[rank]--;
  for (let r = 1; r <= 9; r++) {
    if (without[r] !== CHUUREN_BASE[r]) return false;
  }
  return true;
}

/**
 * Nine Gates / Pure Nine Gates. Closed, no melds, one suit, 1112345678999+X.
 * @returns {Yaku|null}
 */
function nineGatesYaku(tiles, melds, winKey) {
  if ((melds || []).length > 0 || tiles.length !== 14) return null;
  const parsed = suitRankCounts(tiles);
  if (!parsed || !matchesChuurenCounts(parsed.counts)) return null;
  if (isJunseiChuuren(parsed.counts, winKey)) {
    return yaku('junseiChuuren', '純正九蓮宝燈', 'Pure Nine Gates', 26, true, 2);
  }
  return yaku('chuuren', '九蓮宝燈', 'Nine Gates', 13, true);
}

function yaku(id, name, nameEn, han, yakuman = false, yakumanCount = yakuman ? 1 : 0) {
  return { id, name, nameEn, han, yakuman, yakumanCount };
}

function formatYakuLabel(y) {
  return y.nameEn ? `${y.nameEn} / ${y.name}` : y.name;
}

function yakuhaiFromGroup(key, seatWind, roundWind) {
  const found = [];
  const { suit, rank } = parseKey(key);
  if (suit === 'dragon') {
    const labels = {
      1: ['役牌 · 中', 'Red Dragon'],
      2: ['役牌 · 發', 'Green Dragon'],
      3: ['役牌 · 白', 'White Dragon'],
    };
    const [ja, en] = labels[rank] || ['役牌', 'Valued Triplet'];
    found.push(yaku(`yakuhai-dragon-${rank}`, ja, en, 1));
  }
  if (key === seatWind) {
    found.push(yaku('yakuhai-seat', '役牌 · 自風', 'Seat Wind', 1));
  }
  if (key === roundWind) {
    found.push(yaku('yakuhai-round', '役牌 · 場風', 'Round Wind', 1));
  }
  return found;
}

function chiSequences(groups) {
  return groups
    .filter((g) => g.kind === 'chi')
    .map((g) => [...g.keys].sort().join('|'));
}

function chiWaitKind(g, winKey) {
  if (!winKey || g.kind !== 'chi' || g.open) return null;
  if (!g.keys.includes(winKey)) return null;
  const ranks = g.keys.map((k) => parseKey(k).rank).sort((a, b) => a - b);
  const suit = parseKey(g.keys[0]).suit;
  if (!NUMBERED.has(suit)) return null;
  const winRank = parseKey(winKey).rank;
  if (winRank === ranks[1]) return 'kanchan';
  if (ranks[0] === 1 && ranks[2] === 3 && winRank === 3) return 'penchan';
  if (ranks[0] === 7 && ranks[2] === 9 && winRank === 7) return 'penchan';
  if (winRank === ranks[0] || winRank === ranks[2]) {
    if (ranks[0] === 1 && winRank === 3) return 'penchan';
    if (ranks[2] === 9 && winRank === 7) return 'penchan';
    return 'ryanmen';
  }
  return null;
}

/**
 * When the winning tile could complete the pair or a sequence (e.g. 2344 win on 4),
 * return every legal wait assignment so scoring can pick the best.
 * @returns {Array<{ wait: 'tanki'|'chi'|'shanpon', group?: object }|null>}
 */
function waitInterpretations(partition, winKey) {
  if (!winKey) return [null];
  /** @type {Array<{ wait: string, group?: object }>} */
  const out = [];

  if (partition.pair === winKey) {
    out.push({ wait: 'tanki' });
  }

  for (const g of partition.groups) {
    if (g.kind !== 'chi' || g.open) continue;
    if (!chiWaitKind(g, winKey)) continue;
    out.push({ wait: 'chi', group: g });
  }

  for (const g of partition.groups) {
    if (!isTripletGroup(g) || g.open) continue;
    if (tripletTileKey(g) === winKey) {
      out.push({ wait: 'shanpon', group: g });
    }
  }

  if (out.length === 0) return [null];
  return out;
}

function isRyanmenWait(partition, winKey, interpretation = null) {
  if (!winKey) return false;
  if (interpretation?.wait === 'tanki' || interpretation?.wait === 'shanpon') {
    return false;
  }
  if (interpretation?.wait === 'chi' && interpretation.group) {
    return chiWaitKind(interpretation.group, winKey) === 'ryanmen';
  }
  // Default (no ambiguity flag): reject if win is the pair tile
  if (partition.pair === winKey) return false;
  for (const g of partition.groups) {
    if (chiWaitKind(g, winKey) === 'ryanmen') return true;
  }
  return false;
}

function pairIsYakuhai(pairKey, seatWind, roundWind) {
  if (parseKey(pairKey).suit === 'dragon') return true;
  return pairKey === seatWind || pairKey === roundWind;
}

/**
 * Closed for fu? Ron that completes a set counts as open (minkou/minkan).
 */
function isClosedSetForFu(g, tsumo, winKey) {
  if (g.open) return false;
  if (tsumo) return true;
  if (isTripletGroup(g) && tripletTileKey(g) === winKey) return false;
  return true;
}

/**
 * Fu for one triplet/kan/kin.
 * Kin = 4 × the corresponding kan value.
 */
function tripletFu(g, closed) {
  const key = tripletTileKey(g);
  const terminal = isTerminalOrHonorKey(key);
  if (g.kind === 'kin') {
    // Open kan 8/16 → kin 32/64; closed kan 16/32 → kin 64/128
    if (closed) return terminal ? 128 : 64;
    return terminal ? 64 : 32;
  }
  if (g.kind === 'kan') {
    if (closed) return terminal ? 32 : 16;
    return terminal ? 16 : 8;
  }
  // pon
  if (closed) return terminal ? 8 : 4;
  return terminal ? 4 : 2;
}

function pairFu(pairKey, seatWind, roundWind) {
  let fu = 0;
  if (parseKey(pairKey).suit === 'dragon') fu += 2;
  if (pairKey === seatWind) fu += 2;
  if (pairKey === roundWind) fu += 2;
  return fu;
}

/** +2 for tanki / kanchan / penchan; 0 for ryanmen / shanpon. */
function waitFu(partition, winKey, interpretation = null) {
  if (!winKey) return 0;

  if (interpretation?.wait === 'tanki') return 2;
  if (interpretation?.wait === 'shanpon') return 0;
  if (interpretation?.wait === 'chi' && interpretation.group) {
    const kind = chiWaitKind(interpretation.group, winKey);
    if (kind === 'ryanmen') return 0;
    if (kind === 'kanchan' || kind === 'penchan') return 2;
    return 0;
  }

  if (partition.pair === winKey) return 2; // tanki

  for (const g of partition.groups) {
    const kind = chiWaitKind(g, winKey);
    if (!kind) continue;
    if (kind === 'ryanmen') return 0;
    return 2; // kanchan / penchan
  }

  // shanpon (completing a triplet) — 0 fu
  return 0;
}

function roundUpFu(fu) {
  if (fu === 25) return 25;
  if (fu <= 0) return 0;
  return Math.ceil(fu / 10) * 10;
}

/**
 * Standard riichi fu for a scored partition / special hand.
 * @param {object|null} partition
 * @param {object} ctx
 * @param {{ yakus: Yaku[], isYakuman?: boolean }} yakuSummary
 * @param {'standard'|'sevenPairs'|'kokushi'} pattern
 */
function calculateFu(partition, ctx, yakuSummary, pattern, interpretation = null) {
  if (pattern === 'kokushi') return 0;
  if (pattern === 'sevenPairs') return 25;

  const hasPinfu = yakuSummary.yakus.some((y) => y.id === 'pinfu');
  if (hasPinfu) {
    return ctx.tsumo ? 20 : 30;
  }

  let fu = 20;
  if (ctx.tsumo) fu += 2;
  else if (ctx.closed) fu += 10; // menzen ron

  fu += pairFu(partition.pair, ctx.seatWind, ctx.roundWind);
  fu += waitFu(partition, ctx.winKey, interpretation);

  for (const g of partition.groups) {
    if (!isTripletGroup(g)) continue;
    const closed = isClosedSetForFu(g, ctx.tsumo, ctx.winKey);
    fu += tripletFu(g, closed);
  }

  return roundUpFu(fu);
}

function blessingYakus(ctx) {
  if (ctx.tenhou) return [yaku('tenhou', '天和', 'Blessing of Heaven', 13, true)];
  if (ctx.chiihou) return [yaku('chiihou', '地和', 'Blessing of Earth', 13, true)];
  return [];
}

function scorePartition(partition, ctx, interpretation = null) {
  const {
    closed,
    tsumo,
    riichi,
    doubleRiichi,
    ippatsu,
    seatWind,
    roundWind,
    winKey,
    rinshan,
    chankan,
    haitei,
    houtei,
  } = ctx;
  const groups = partition.groups;
  const yakus = [];

  if (doubleRiichi) yakus.push(yaku('doubleRiichi', '両立直', 'Double Reach', 2));
  else if (riichi) yakus.push(yaku('riichi', '立直', 'Reach', 1));
  if (riichi && ippatsu) yakus.push(yaku('ippatsu', '一発', 'One-shot', 1));
  if (closed && tsumo) yakus.push(yaku('menzenTsumo', '門前清自摸和', 'Self Draw', 1));
  if (rinshan) yakus.push(yaku('rinshan', '嶺上開花', 'Dead Wall Draw', 1));
  if (chankan && !tsumo) yakus.push(yaku('chankan', '搶槓', 'Robbing a Quad', 1));
  if (haitei && tsumo) yakus.push(yaku('haitei', '海底摸月', 'Under the Sea', 1));
  if (houtei && !tsumo) yakus.push(yaku('houtei', '河底撈魚', 'Under the River', 1));
  yakus.push(...blessingYakus(ctx));

  const allKeys = [partition.pair, ...groups.flatMap((g) => g.keys)];
  if (allKeys.every(isSimpleKey)) {
    yakus.push(yaku('tanyao', '断么九', 'All Simples', 1));
  }

  for (const g of groups) {
    if (!isTripletGroup(g)) continue;
    yakus.push(...yakuhaiFromGroup(tripletTileKey(g), seatWind, roundWind));
  }

  if (
    closed &&
    groups.every((g) => g.kind === 'chi') &&
    !pairIsYakuhai(partition.pair, seatWind, roundWind) &&
    isRyanmenWait(partition, winKey, interpretation)
  ) {
    yakus.push(yaku('pinfu', '平和', 'Flat Hand', 1));
  }

  if (closed) {
    const seqs = chiSequences(groups.filter((g) => !g.open));
    const counts = new Map();
    for (const s of seqs) counts.set(s, (counts.get(s) || 0) + 1);
    const vals = [...counts.values()];
    if (vals.filter((n) => n >= 2).length >= 2 || vals.some((n) => n >= 4)) {
      yakus.push(yaku('ryanpeikou', '二盃口', 'Twice Pure Double Sequence', 3));
    } else if (vals.some((n) => n >= 2)) {
      yakus.push(yaku('iipeikou', '一盃口', 'Pure Double Sequence', 1));
    }
  }

  {
    const byRanks = new Map();
    for (const g of groups.filter((g) => g.kind === 'chi')) {
      const ranks = g.keys
        .map((k) => parseKey(k).rank)
        .sort((a, b) => a - b)
        .join(',');
      const suit = parseKey(g.keys[0]).suit;
      if (!byRanks.has(ranks)) byRanks.set(ranks, new Set());
      byRanks.get(ranks).add(suit);
    }
    for (const suits of byRanks.values()) {
      if (suits.has('man') && suits.has('pin') && suits.has('sou')) {
        yakus.push(yaku('sanshoku', '三色同順', 'Three Color Straight', closed ? 2 : 1));
        break;
      }
    }
  }

  {
    for (const suit of ['man', 'pin', 'sou']) {
      const has = (a, b, c) =>
        groups.some(
          (g) =>
            g.kind === 'chi' &&
            g.keys.includes(`${suit}-${a}`) &&
            g.keys.includes(`${suit}-${b}`) &&
            g.keys.includes(`${suit}-${c}`)
        );
      if (has(1, 2, 3) && has(4, 5, 6) && has(7, 8, 9)) {
        yakus.push(yaku('ittsu', '一気通貫', 'Pure Straight', closed ? 2 : 1));
        break;
      }
    }
  }

  // Toitoi — kin counts as a triplet (same as pon/kan)
  if (groups.length === 4 && groups.every(isTripletGroup)) {
    yakus.push(yaku('toitoi', '対々和', 'All Triplets', 2));
  }

  {
    const ankou = groups.filter((g) => !g.open && isTripletGroup(g));
    let closedAnkou = ankou.length;
    if (!tsumo && winKey) {
      const completedPon = groups.find(
        (g) => !g.open && isTripletGroup(g) && tripletTileKey(g) === winKey
      );
      if (completedPon) closedAnkou = Math.max(0, closedAnkou - 1);
    }
    if (closedAnkou >= 4) {
      // Single-wait (tanki) four concealed triplets is double yakuman.
      if (winKey && winKey === partition.pair) {
        yakus.push(
          yaku('suuankouTanki', '四暗刻単騎', 'Four Concealed Triplets (Single Wait)', 26, true, 2)
        );
      } else {
        yakus.push(yaku('suuankou', '四暗刻', 'Four Concealed Triplets', 13, true));
      }
    } else if (closedAnkou >= 3) {
      yakus.push(yaku('sanankou', '三暗刻', 'Three Concealed Triplets', 2));
    }
  }

  {
    const byRank = new Map();
    for (const g of groups.filter(isTripletGroup)) {
      const key = tripletTileKey(g);
      const { suit, rank } = parseKey(key);
      if (!NUMBERED.has(suit)) continue;
      if (!byRank.has(rank)) byRank.set(rank, new Set());
      byRank.get(rank).add(suit);
    }
    for (const suits of byRank.values()) {
      if (suits.size >= 3) {
        yakus.push(yaku('sanshokuDoukou', '三色同刻', 'Three Color Triplets', 2));
        break;
      }
    }
  }

  {
    // Kin counts as two quads for sankantsu / suukantsu / uukantsu
    let quadUnits = 0;
    let kinMelds = 0;
    let kanMelds = 0;
    for (const g of groups) {
      if (g.kind === 'kin') {
        kinMelds++;
        quadUnits += 2;
      } else if (g.kind === 'kan') {
        kanMelds++;
        quadUnits += 1;
      }
    }
    if (quadUnits >= 5) {
      yakus.push(yaku('uukantsu', '五槓子', 'Five Quads', 26, true, 2));
    } else if (quadUnits >= 4) {
      yakus.push(yaku('suukantsu', '四槓子', 'Four Quads', 13, true));
    } else if (quadUnits >= 3) {
      yakus.push(yaku('sankantsu', '三槓子', 'Three Quads', 2));
    } else if (kinMelds === 1 && kanMelds === 0) {
      yakus.push(yaku('iikintsu', '一檎子', 'One Quint', 1));
    }
  }

  {
    const terminalsHonors = allKeys.every(isTerminalOrHonorKey);
    const hasHonor = allKeys.some(isHonorKey);
    const hasTerminal = allKeys.some(isTerminalKey);
    const eachGroupTerminalish =
      groups.every((g) => g.keys.some(isTerminalOrHonorKey)) &&
      isTerminalOrHonorKey(partition.pair);

    if (terminalsHonors && !hasHonor && hasTerminal) {
      yakus.push(yaku('chinroutou', '清老頭', 'All Terminals', 13, true));
    } else if (terminalsHonors && hasHonor && hasTerminal) {
      yakus.push(yaku('honroutou', '混老頭', 'All Terminals and Honors', 2));
    } else if (eachGroupTerminalish && hasTerminal && !hasHonor) {
      yakus.push(yaku('junchan', '純全帯么九', 'Full Outside Hand', closed ? 3 : 2));
    } else if (eachGroupTerminalish && hasHonor) {
      yakus.push(yaku('chanta', '混全帯么九', 'Half Outside Hand', closed ? 2 : 1));
    }
  }

  {
    const dragons = groups.filter(
      (g) => isTripletGroup(g) && parseKey(tripletTileKey(g)).suit === 'dragon'
    );
    const dragonKeys = new Set(dragons.map((g) => tripletTileKey(g)));
    if (dragonKeys.size >= 3) {
      yakus.push(yaku('daisangen', '大三元', 'Big Three Dragons', 13, true));
    } else if (dragonKeys.size === 2 && parseKey(partition.pair).suit === 'dragon') {
      yakus.push(yaku('shousangen', '小三元', 'Little Three Dragons', 2));
    }
  }

  {
    // Any four of the five winds (东南西北花) count — 花 is a full wind.
    const winds = groups.filter(
      (g) => isTripletGroup(g) && parseKey(tripletTileKey(g)).suit === 'wind'
    );
    const windKeys = new Set(winds.map((g) => tripletTileKey(g)));
    const pairIsWind = parseKey(partition.pair).suit === 'wind';
    // Big: four+ distinct wind triplets/quads/quints.
    if (windKeys.size >= 4) {
      yakus.push(yaku('daisuushii', '大四喜', 'Big Four Winds', 26, true, 2));
    }
    // Little: three+ wind triplets plus a wind pair (fourth/fifth wind).
    // Stacks with big four winds when the pair is also a wind (all five).
    if (windKeys.size >= 3 && pairIsWind) {
      yakus.push(yaku('shousuushii', '小四喜', 'Little Four Winds', 13, true));
    }
  }

  if (allKeys.every(isHonorKey)) {
    yakus.push(yaku('tsuuiisou', '字一色', 'All Honors', 13, true));
  }

  {
    const numbered = allKeys.filter((k) => NUMBERED.has(parseKey(k).suit));
    const suits = new Set(numbered.map((k) => parseKey(k).suit));
    const hasHonor = allKeys.some(isHonorKey);
    if (suits.size === 1 && numbered.length === allKeys.length) {
      yakus.push(yaku('chinitsu', '清一色', 'Full Flush', closed ? 6 : 5));
    } else if (suits.size === 1 && hasHonor) {
      yakus.push(yaku('honitsu', '混一色', 'Half Flush', closed ? 3 : 2));
    }
  }

  {
    const green = new Set(['sou-2', 'sou-3', 'sou-4', 'sou-6', 'sou-8', 'dragon-2']);
    if (allKeys.every((k) => green.has(k))) {
      yakus.push(yaku('ryuuiisou', '緑一色', 'All Green', 13, true));
    }
  }

  {
    const chuuren = nineGatesYaku(ctx.tiles, ctx.melds, winKey);
    if (chuuren) yakus.push(chuuren);
  }

  return yakus;
}

function scoreSevenPairs(ctx) {
  const yakus = [];
  if (ctx.doubleRiichi) yakus.push(yaku('doubleRiichi', '両立直', 'Double Reach', 2));
  else if (ctx.riichi) yakus.push(yaku('riichi', '立直', 'Reach', 1));
  if (ctx.riichi && ctx.ippatsu) yakus.push(yaku('ippatsu', '一発', 'One-shot', 1));
  if (ctx.closed && ctx.tsumo) {
    yakus.push(yaku('menzenTsumo', '門前清自摸和', 'Self Draw', 1));
  }
  if (ctx.rinshan) yakus.push(yaku('rinshan', '嶺上開花', 'Dead Wall Draw', 1));
  if (ctx.chankan && !ctx.tsumo) yakus.push(yaku('chankan', '搶槓', 'Robbing a Quad', 1));
  if (ctx.haitei && ctx.tsumo) yakus.push(yaku('haitei', '海底摸月', 'Under the Sea', 1));
  if (ctx.houtei && !ctx.tsumo) yakus.push(yaku('houtei', '河底撈魚', 'Under the River', 1));
  yakus.push(...blessingYakus(ctx));
  yakus.push(yaku('chiitoitsu', '七対子', 'Seven Pairs', 2));

  const keys = ctx.tiles.map(tileKey);
  if (keys.every(isSimpleKey)) yakus.push(yaku('tanyao', '断么九', 'All Simples', 1));
  if (keys.every(isHonorKey)) yakus.push(yaku('tsuuiisou', '字一色', 'All Honors', 13, true));
  const numbered = keys.filter((k) => NUMBERED.has(parseKey(k).suit));
  const suits = new Set(numbered.map((k) => parseKey(k).suit));
  const hasHonor = keys.some(isHonorKey);
  if (suits.size === 1 && numbered.length === keys.length) {
    yakus.push(yaku('chinitsu', '清一色', 'Full Flush', 6));
  } else if (suits.size === 1 && hasHonor) {
    yakus.push(yaku('honitsu', '混一色', 'Half Flush', 3));
  }
  if (keys.every(isTerminalOrHonorKey) && keys.some(isHonorKey) && keys.some(isTerminalKey)) {
    yakus.push(yaku('honroutou', '混老頭', 'All Terminals and Honors', 2));
  }
  return yakus;
}

function scoreKokushi(ctx) {
  return [...blessingYakus(ctx), yaku('kokushi', '国士無双', 'Thirteen Orphans', 13, true)];
}

function dedupeYakus(yakus) {
  const byId = new Map();
  for (const y of yakus) {
    const prev = byId.get(y.id);
    if (!prev || y.han > prev.han) byId.set(y.id, y);
  }
  if (byId.has('ryanpeikou')) byId.delete('iipeikou');
  if (byId.has('chinitsu')) byId.delete('honitsu');
  if (byId.has('junchan')) byId.delete('chanta');
  if (byId.has('chinroutou') || byId.has('honroutou')) {
    byId.delete('chanta');
    byId.delete('junchan');
  }
  if (byId.has('daisangen')) {
    byId.delete('shousangen');
    for (const id of [...byId.keys()]) {
      if (id.startsWith('yakuhai-dragon-')) byId.delete(id);
    }
  }
  if (byId.has('suuankouTanki')) {
    byId.delete('suuankou');
    byId.delete('sanankou');
  } else if (byId.has('suuankou')) {
    byId.delete('sanankou');
  }
  if (byId.has('uukantsu')) {
    byId.delete('suukantsu');
    byId.delete('sankantsu');
    byId.delete('iikintsu');
  } else if (byId.has('suukantsu')) {
    byId.delete('sankantsu');
    byId.delete('iikintsu');
  } else if (byId.has('sankantsu')) {
    byId.delete('iikintsu');
  }
  // Big and little four winds stack when both patterns are present (4 wind
  // triplets + wind pair using 花 as the fifth wind).
  if (byId.has('junseiChuuren')) byId.delete('chuuren');
  return [...byId.values()];
}

function summarizeYakus(yakus) {
  const list = dedupeYakus(yakus);
  const yakumanList = list.filter((y) => y.yakuman);
  if (yakumanList.length > 0) {
    return {
      yakus: yakumanList,
      han: yakumanList.reduce((s, y) => s + y.han, 0),
      yakuman: yakumanList.reduce((s, y) => s + (y.yakumanCount || 1), 0),
      isYakuman: true,
    };
  }
  return {
    yakus: list,
    han: list.reduce((s, y) => s + y.han, 0),
    yakuman: 0,
    isYakuman: false,
  };
}

/**
 * Tile assemblies to score. Ron usually adds the discard; with open kan/kin,
 * a 14-tile tenpai may instead swap one hand tile for the discard.
 * @param {import('./tiles.js').Tile[]} hand
 * @param {import('./tiles.js').Tile|null} winTile
 * @param {'ron'|'tsumo'} mode
 */
function tileAssembliesForWin(hand, winTile, mode, wildcardAssigned = false) {
  if (mode !== 'ron' || !winTile) return [[...hand]];
  const assemblies = [[...hand, winTile]];
  const replaceable = hand.length - (wildcardAssigned ? 1 : 0);
  for (let i = 0; i < replaceable; i++) {
    const swapped = [...hand];
    swapped[i] = winTile;
    assemblies.push(swapped);
  }
  return assemblies;
}

function scoreStrength(scored, dora = 0, uraDora = 0) {
  if (scored.isYakuman) {
    return {
      yakuman: scored.yakuman || 1,
      points: 8000 * (scored.yakuman || 1),
      han: scored.han,
      fu: scored.fu ?? 0,
    };
  }
  const han = (scored.han || 0) + dora + uraDora;
  const fu = scored.fu ?? 0;
  return {
    yakuman: 0,
    points: basicPoints(han, fu),
    han,
    fu,
  };
}

/**
 * Prefer the interpretation with the highest payment (basic points).
 * Yakuman beats non-yakuman; then higher basic points; then han; then fu.
 */
function pickBetterScore(best, scored, dora = 0, uraDora = 0) {
  const a = scoreStrength(
    best,
    best._dora ?? dora,
    best._scoreUraDora ?? best._uraDora ?? uraDora
  );
  const b = scoreStrength(
    scored,
    scored._dora ?? dora,
    scored._scoreUraDora ?? scored._uraDora ?? uraDora
  );
  if (b.yakuman !== a.yakuman) return b.yakuman > a.yakuman ? scored : best;
  if (b.points !== a.points) return b.points > a.points ? scored : best;
  if (b.han !== a.han) return b.han > a.han ? scored : best;
  if (b.fu !== a.fu) return b.fu > a.fu ? scored : best;
  return best;
}

/**
 * Calculate han and fu for a winning hand under standard riichi rules.
 * Kin sets are worth 4× the fu of the corresponding kan.
 *
 * @param {import('./tiles.js').Tile[]} hand
 * @param {object[]} melds
 * @param {object} options
 * @returns {HanResult}
 */
export function calculateHan(hand, melds, options) {
  const {
    mode,
    winTile = null,
    riichi = false,
    ippatsu = false,
    doubleRiichi = false,
    seat,
    dealerIndex,
    roundWindIndex,
    dora = 0,
    uraDora = 0,
    rinshan = false,
    chankan = false,
    haitei = false,
    houtei = false,
    tenhou = false,
    chiihou = false,
    wildcard = null,
    doraIndicators = [],
    uraIndicators = [],
  } = options;

  const tsumo = mode === 'tsumo';
  const closed = handIsClosed(melds);
  const winKey = winTile ? tileKey(winTile) : null;

  let best = {
    yakus: [],
    han: 0,
    yakuman: 0,
    isYakuman: false,
    fu: 0,
    _dora: dora,
    _uraDora: uraDora,
    _scoreUraDora: uraDora,
    wildcardTile: null,
  };

  for (const wildcardTile of wildcardAssignments(wildcard)) {
    const concreteHand = wildcardTile ? [...hand, wildcardTile] : hand;
    for (const tiles of tileAssembliesForWin(
      concreteHand,
      winTile,
      mode,
      !!wildcardTile
    )) {
      const candidateDora = wildcardTile
        ? countDora(tiles, melds, null, doraIndicators, []).dora
        : dora;
      const candidateUraDora = wildcardTile
        ? countDora(tiles, melds, null, [], uraIndicators).uraDora
        : uraDora;
      const ctx = {
      closed,
      tsumo,
      riichi,
      doubleRiichi: !!(riichi && doubleRiichi),
      ippatsu: !!(riichi && ippatsu),
      seatWind: seatWindKey(seat, dealerIndex),
      roundWind: roundWindKey(roundWindIndex),
      winKey:
        winKey ??
        (tiles.length ? tileKey(tiles[tiles.length - 1]) : null),
      rinshan,
      chankan,
      haitei,
      houtei,
      tenhou: !!tenhou,
      chiihou: !!chiihou,
      tiles,
      melds,
    };

      if (isThirteenOrphans(tiles, melds)) {
      const summary = summarizeYakus(scoreKokushi(ctx));
      const candidate = {
        ...summary,
        fu: calculateFu(null, ctx, summary, 'kokushi'),
        _dora: candidateDora,
        _uraDora: candidateUraDora,
        _scoreUraDora: wildcard ? 0 : candidateUraDora,
        wildcardTile,
      };
        best = pickBetterScore(
        best,
        candidate,
        candidateDora,
        wildcard ? 0 : candidateUraDora
      );
        continue;
      }
      if (isSevenPairs(tiles, melds)) {
      const summary = summarizeYakus(scoreSevenPairs(ctx));
      const candidate = {
        ...summary,
        fu: calculateFu(null, ctx, summary, 'sevenPairs'),
        _dora: candidateDora,
        _uraDora: candidateUraDora,
        _scoreUraDora: wildcard ? 0 : candidateUraDora,
        wildcardTile,
      };
        best = pickBetterScore(
        best,
        candidate,
        candidateDora,
        wildcard ? 0 : candidateUraDora
      );
        continue;
      }
      for (const part of findPartitions(tiles, melds)) {
        for (const interpretation of waitInterpretations(part, ctx.winKey)) {
        const summary = summarizeYakus(scorePartition(part, ctx, interpretation));
        const candidate = {
          ...summary,
          fu: calculateFu(part, ctx, summary, 'standard', interpretation),
          _dora: candidateDora,
          _uraDora: candidateUraDora,
          _scoreUraDora: wildcard ? 0 : candidateUraDora,
          wildcardTile,
        };
          best = pickBetterScore(
          best,
          candidate,
          candidateDora,
          wildcard ? 0 : candidateUraDora
          );
        }
      }
    }
  }

  const selectedDora = wildcard ? best._dora : dora;
  const selectedUraDora = wildcard ? best._uraDora : uraDora;
  const totalHan = best.isYakuman
    ? best.han
    : best.han + selectedDora + selectedUraDora;

  return {
    yakus: best.yakus,
    han: best.han,
    yakuman: best.yakuman,
    dora: selectedDora,
    uraDora: selectedUraDora,
    totalHan,
    isYakuman: best.isYakuman,
    fu: best.fu ?? 0,
    wildcardTile: best.wildcardTile ?? null,
  };
}

/**
 * True if the hand has at least one yaku (dora alone does not count).
 * @param {import('./tiles.js').Tile[]} hand
 * @param {object[]} melds
 * @param {object} options same as calculateHan (dora/ura ignored for this check)
 */
export function hasYaku(hand, melds, options) {
  const result = calculateHan(hand, melds, {
    ...options,
    dora: 0,
    uraDora: 0,
  });
  return result.isYakuman || result.han > 0;
}

export function formatHanResult(result) {
  if (!result) return '';
  if (result.isYakuman) {
    // Regular yakuman: dora does not count and is not shown.
    const names = result.yakus.map(formatYakuLabel).join(' · ');
    const mult = result.yakuman > 1 ? `${result.yakuman}× ` : '';
    return `${names} (${mult}Yakuman / 役満)`;
  }
  const yakuPart =
    result.yakus.map((y) => `${formatYakuLabel(y)}(${y.han})`).join(' · ') ||
    'No yaku / 役なし';
  const doraPart =
    result.dora + result.uraDora > 0
      ? ` · Dora / ドラ${result.dora}${result.uraDora ? `+Ura / 裏${result.uraDora}` : ''}`
      : '';
  const fuPart =
    result.fu > 0 ? `${result.fu} fu / 符 · ${result.totalHan} han / 翻` : `${result.totalHan} han / 翻`;
  return `${yakuPart}${doraPart} · ${fuPart}`;
}
