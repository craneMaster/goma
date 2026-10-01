import { canWin } from './win.js';

const NUMBERED = new Set(['man', 'pin', 'sou']);
const CLAIM_RANK = { win: 5, kin: 4, kan: 3, pon: 2, chi: 1, largeChi: 0 };

export function tileKey(tile) {
  return `${tile.suit}-${tile.rank}`;
}

export function sameTile(a, b) {
  return a.suit === b.suit && a.rank === b.rank;
}

export function isNumbered(tile) {
  return NUMBERED.has(tile.suit);
}

/**
 * Next seat in turn order after discarder (CCW: 东→南→西→北→花).
 * Chi: e.g. South (南) may chi East's (东) discard.
 */
export function nextInTurn(seat, n = 5) {
  return (seat + 1) % n;
}

/** Second seat after discarder in turn order (large chi 大吃). */
export function secondNextInTurn(seat, n = 5) {
  return (seat + 2) % n;
}

export function claimPriority(type) {
  return CLAIM_RANK[type] ?? 0;
}

export function tilesMatching(hand, tile) {
  return hand.filter((t) => sameTile(t, tile));
}

/** Signature distinguishing aka vs normal copies of the same rank. */
function akaSignature(tiles) {
  return tiles
    .map((t) => `${tileKey(t)}${t.red ? 'r' : ''}`)
    .sort()
    .join('|');
}

/** All k-subsets of `arr` (by index order). */
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (k < 0 || arr.length < k) return [];
  const out = [];
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) {
      out.push([arr[i], ...rest]);
    }
  }
  return out;
}

function tilesOfRank(hand, suit, rank) {
  return hand.filter((t) => t.suit === suit && t.rank === rank);
}

/**
 * Choose `count` matching tiles from hand for pon/kan/kin.
 * Distinct options when red vs normal 5s can be mixed differently.
 */
export function findCallTileOptions(hand, discard, count) {
  const matches = tilesMatching(hand, discard);
  if (matches.length < count) return [];
  const seen = new Set();
  const options = [];
  for (const picked of combinations(matches, count)) {
    const sig = akaSignature(picked);
    if (seen.has(sig)) continue;
    seen.add(sig);
    options.push({
      handTileIds: picked.map((t) => t.id),
      tiles: [...picked, discard],
    });
  }
  return options;
}

/** All chi sequences using discard + two from hand (aka variants expanded). */
export function findChiOptions(hand, discard) {
  if (!isNumbered(discard)) return [];
  const { suit, rank } = discard;
  const options = [];
  const seen = new Set();

  const pushPair = (rankA, rankB, buildTiles) => {
    const poolA = tilesOfRank(hand, suit, rankA);
    const poolB = tilesOfRank(hand, suit, rankB);
    for (const ta of poolA) {
      for (const tb of poolB) {
        if (ta.id === tb.id) continue;
        const handTiles = [ta, tb];
        const sig = akaSignature(handTiles);
        // Also distinguish sequence shape (left/middle/right chi).
        const shapeKey = `${rankA},${rankB}|${sig}`;
        if (seen.has(shapeKey)) continue;
        seen.add(shapeKey);
        options.push({
          type: 'chi',
          tiles: buildTiles(ta, tb),
          handTileIds: [ta.id, tb.id],
        });
      }
    }
  };

  if (rank >= 3) {
    pushPair(rank - 2, rank - 1, (a, b) => [a, b, discard]);
  }
  if (rank >= 2 && rank <= 8) {
    pushPair(rank - 1, rank + 1, (a, b) => [a, discard, b]);
  }
  if (rank <= 7) {
    pushPair(rank + 1, rank + 2, (a, b) => [discard, a, b]);
  }

  return options;
}

export function findPonOptions(hand, discard) {
  return findCallTileOptions(hand, discard, 2);
}

export function findKanCallOptions(hand, discard) {
  return findCallTileOptions(hand, discard, 3);
}

export function findKinCallOptions(hand, discard) {
  return findCallTileOptions(hand, discard, 4);
}

export function canPon(hand, discard) {
  return tilesMatching(hand, discard).length >= 2;
}

export function canKan(hand, discard) {
  return tilesMatching(hand, discard).length >= 3;
}

export function canKin(hand, discard) {
  return tilesMatching(hand, discard).length >= 4;
}

/** Closed kan on table — claim discard as 5th copy (opens hand as kin). */
export function canKinFromClosedKan(melds, discard) {
  return melds.some(
    (m) =>
      m.type === 'kan' &&
      !m.open &&
      m.tiles.length === 4 &&
      sameTile(m.tiles[0], discard)
  );
}

export function findClosedKanMeldIndex(melds, discard) {
  return melds.findIndex(
    (m) =>
      m.type === 'kan' &&
      !m.open &&
      m.tiles.length === 4 &&
      sameTile(m.tiles[0], discard)
  );
}

function optionPayload(opts) {
  return opts.map((o, i) => ({
    index: i,
    tiles: o.tiles,
    handTileIds: o.handTileIds,
  }));
}

/**
 * Swap-calling (kuikae) ban: after a claim, these tile keys may not be discarded
 * on the same turn.
 * - Always: another copy of the called tile
 * - Chi / large chi: any tile that completes a sequence with the two tiles taken
 *   from hand (matagi — the other side of the wait)
 */
export function kuikaeForbiddenKeys(claimType, handTilesUsed, calledTile) {
  const keys = new Set([tileKey(calledTile)]);
  if (claimType !== 'chi' && claimType !== 'largeChi') return keys;
  if (!handTilesUsed || handTilesUsed.length !== 2) return keys;
  const suit = handTilesUsed[0].suit;
  if (
    !isNumbered(handTilesUsed[0]) ||
    handTilesUsed[1].suit !== suit ||
    calledTile.suit !== suit
  ) {
    return keys;
  }
  const a = handTilesUsed[0].rank;
  const b = handTilesUsed[1].rank;
  for (let r = 1; r <= 9; r++) {
    const ranks = [a, b, r].sort((x, y) => x - y);
    if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) continue;
    if (ranks[0] + 1 === ranks[1] && ranks[1] + 1 === ranks[2]) {
      keys.add(`${suit}-${r}`);
    }
  }
  return keys;
}

export function hasLegalKuikaeDiscard(hand, forbiddenKeys) {
  return hand.some((t) => !forbiddenKeys.has(tileKey(t)));
}

/** True if claiming with this option leaves at least one legal discard. */
export function claimOptionAllowsDiscard(hand, claimType, option, calledTile) {
  const ids = new Set(option.handTileIds || []);
  const used = (option.handTileIds || [])
    .map((id) => hand.find((t) => t.id === id))
    .filter(Boolean);
  const remaining = hand.filter((t) => !ids.has(t.id));
  const forbidden = kuikaeForbiddenKeys(claimType, used, calledTile);
  return hasLegalKuikaeDiscard(remaining, forbidden);
}

/** Drop claim options (or whole claims) that would force a kuikae discard. */
export function filterKuikaeClaims(claims, hand, discard) {
  return claims
    .map((c) => {
      if (c.type === 'win') return c;
      if (c.options?.length) {
        const options = c.options.filter((o) =>
          claimOptionAllowsDiscard(hand, c.type, o, discard)
        );
        if (options.length === 0) return null;
        // Keep original option.index so applyClaim matches find*Options arrays.
        return { ...c, options };
      }
      // Kin from closed kan: hand tiles unchanged; still ban discarding the called tile.
      const forbidden = kuikaeForbiddenKeys(c.type, [], discard);
      if (!hasLegalKuikaeDiscard(hand, forbidden)) return null;
      return c;
    })
    .filter(Boolean);
}

export function getClaimsForPlayer(
  hand,
  discard,
  discarderSeat,
  mySeat,
  playerCount = 5,
  melds = [],
  wildcard = null
) {
  const claims = [];

  if (canWin(hand, melds, discard, wildcard)) {
    claims.push({ type: 'win', label: 'Ron' });
  }

  const kinFromHand = findKinCallOptions(hand, discard);
  if (kinFromHand.length > 0) {
    claims.push({
      type: 'kin',
      label: 'Kin',
      options: optionPayload(kinFromHand),
    });
  } else if (canKinFromClosedKan(melds, discard)) {
    claims.push({ type: 'kin', label: 'Kin (closed kan)' });
  }

  const kanOpts = findKanCallOptions(hand, discard);
  if (kanOpts.length > 0) {
    claims.push({
      type: 'kan',
      label: 'Kan 杠',
      options: optionPayload(kanOpts),
    });
  }

  const ponOpts = findPonOptions(hand, discard);
  if (ponOpts.length > 0) {
    claims.push({
      type: 'pon',
      label: 'Pon 碰',
      options: optionPayload(ponOpts),
    });
  }

  const chiOpts = findChiOptions(hand, discard);
  const chiOptionPayload = optionPayload(chiOpts);

  if (nextInTurn(discarderSeat, playerCount) === mySeat && chiOpts.length > 0) {
    claims.push({
      type: 'chi',
      label: 'Chi 吃',
      options: chiOptionPayload,
    });
  }

  if (secondNextInTurn(discarderSeat, playerCount) === mySeat && chiOpts.length > 0) {
    claims.push({
      type: 'largeChi',
      label: 'Large chi 大吃',
      options: chiOptionPayload,
    });
  }

  return filterKuikaeClaims(claims, hand, discard);
}

/**
 * Resolve claim window submissions.
 * Multiple ron claims all succeed; otherwise one highest-priority claim wins
 * (ties broken by nearest CCW from the discarder).
 * @returns {{ kind: 'wins', submissions: object[] } | { kind: 'claim', submission: object } | null}
 */
export function resolveClaims(submissions, discarderSeat, playerCount = 5) {
  if (submissions.length === 0) return null;

  const wins = submissions.filter((s) => s.type === 'win');
  if (wins.length > 0) {
    wins.sort((a, b) => {
      const da = (a.seat - discarderSeat + playerCount) % playerCount;
      const db = (b.seat - discarderSeat + playerCount) % playerCount;
      return da - db;
    });
    return { kind: 'wins', submissions: wins };
  }

  let best = submissions[0];
  for (const s of submissions.slice(1)) {
    const pBest = claimPriority(best.type);
    const pNew = claimPriority(s.type);
    if (pNew > pBest) {
      best = s;
      continue;
    }
    if (pNew < pBest) continue;
    const distBest = (best.seat - discarderSeat + playerCount) % playerCount;
    const distNew = (s.seat - discarderSeat + playerCount) % playerCount;
    if (distNew < distBest) best = s;
  }
  return { kind: 'claim', submission: best };
}

export function findAnkanOptions(hand) {
  const byKey = new Map();
  for (const t of hand) {
    const k = tileKey(t);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }
  const options = [];
  for (const tiles of byKey.values()) {
    if (tiles.length < 4) continue;
    const seen = new Set();
    for (const picked of combinations(tiles, 4)) {
      const sig = akaSignature(picked);
      if (seen.has(sig)) continue;
      seen.add(sig);
      options.push({
        type: 'kan',
        tileKey: tileKey(tiles[0]),
        tileIds: picked.map((t) => t.id),
        tiles: picked,
      });
    }
  }
  return options;
}

export function findClosedKinOptions(hand) {
  const byKey = new Map();
  for (const t of hand) {
    const k = tileKey(t);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
  }
  const options = [];
  for (const tiles of byKey.values()) {
    if (tiles.length < 5) continue;
    const seen = new Set();
    for (const picked of combinations(tiles, 5)) {
      const sig = akaSignature(picked);
      if (seen.has(sig)) continue;
      seen.add(sig);
      options.push({
        type: 'kin',
        tileKey: tileKey(tiles[0]),
        tileIds: picked.map((t) => t.id),
        tiles: picked,
      });
    }
  }
  return options;
}

export function findKakanOptions(hand, melds) {
  const options = [];
  for (let i = 0; i < melds.length; i++) {
    const m = melds[i];
    if (m.type !== 'pon' || !m.open) continue;
    const key = tileKey(m.tiles[0]);
    const inHand = hand.filter((t) => tileKey(t) === key);
    const seen = new Set();
    for (const t of inHand) {
      const sig = t.red ? 'r' : 'n';
      if (seen.has(sig)) continue;
      seen.add(sig);
      options.push({ meldIndex: i, tileId: t.id, tileKey: key, tile: t });
    }
  }
  return options;
}

/** Upgrade open kan to kin when the 5th copy is drawn. */
export function findKinKakanOptions(hand, melds) {
  const options = [];
  for (let i = 0; i < melds.length; i++) {
    const m = melds[i];
    if (m.type !== 'kan' || !m.open || m.tiles.length !== 4) continue;
    const key = tileKey(m.tiles[0]);
    const inHand = hand.filter((t) => tileKey(t) === key);
    const seen = new Set();
    for (const t of inHand) {
      const sig = t.red ? 'r' : 'n';
      if (seen.has(sig)) continue;
      seen.add(sig);
      options.push({ meldIndex: i, tileId: t.id, tileKey: key, tile: t });
    }
  }
  return options;
}

/**
 * Upgrade a closed kan (ankan) to closed kin when the 5th copy is in hand.
 * Stays concealed (no call from discard).
 */
export function findClosedKinFromKanOptions(hand, melds) {
  const options = [];
  for (let i = 0; i < melds.length; i++) {
    const m = melds[i];
    if (m.type !== 'kan' || m.open || m.tiles.length !== 4) continue;
    const key = tileKey(m.tiles[0]);
    const inHand = hand.filter((t) => tileKey(t) === key);
    const seen = new Set();
    for (const t of inHand) {
      const sig = t.red ? 'r' : 'n';
      if (seen.has(sig)) continue;
      seen.add(sig);
      options.push({
        meldIndex: i,
        tileId: t.id,
        tileKey: key,
        tile: t,
        fromAnkan: true,
      });
    }
  }
  return options;
}
