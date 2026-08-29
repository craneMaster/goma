/**
 * Reconstruct table frames from a recorded hand (deal + events).
 * All hands stay visible — this is an omniscient review, not live privacy.
 */

function cloneTile(tile) {
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

function cloneTiles(tiles) {
  return (tiles ?? []).map(cloneTile);
}

function cloneDiscard(entry) {
  return {
    tile: cloneTile(entry.tile ?? entry),
    sideways: !!entry.sideways,
    tsumogiri: !!entry.tsumogiri,
    riichiDeclaration: !!entry.riichiDeclaration,
  };
}

function cloneMeld(meld) {
  return {
    type: meld.type,
    open: !!meld.open,
    fromSeat: meld.fromSeat ?? null,
    calledTileId: meld.calledTileId ?? null,
    addedTileId: meld.addedTileId ?? null,
    tiles: cloneTiles(meld.tiles),
  };
}

function sortHand(tiles) {
  const suitOrder = { man: 0, pin: 1, sou: 2, wind: 3, dragon: 3 };
  function honorKey(t) {
    if (t.suit === 'wind') return t.rank;
    if (t.suit === 'dragon') return { 3: 6, 2: 7, 1: 8 }[t.rank] ?? 9;
    return 0;
  }
  return [...tiles].sort((a, b) => {
    const sa = suitOrder[a.suit] ?? 9;
    const sb = suitOrder[b.suit] ?? 9;
    if (sa !== sb) return sa - sb;
    if (a.suit === 'wind' || a.suit === 'dragon' || b.suit === 'wind' || b.suit === 'dragon') {
      return honorKey(a) - honorKey(b);
    }
    if (a.rank !== b.rank) return a.rank - b.rank;
    return (a.copy ?? 0) - (b.copy ?? 0);
  });
}

function removeTileById(hand, tileId) {
  const i = hand.findIndex((t) => t.id === tileId);
  if (i < 0) return null;
  return hand.splice(i, 1)[0];
}

function removeTilesByIds(hand, ids) {
  const out = [];
  for (const id of ids ?? []) {
    const t = removeTileById(hand, id);
    if (t) out.push(t);
  }
  return out;
}

function playerName(replay, seat) {
  return replay?.meta?.players?.[seat]?.name ?? `Seat ${seat + 1}`;
}

/**
 * @param {object} handRecord one entry from replay.hands
 * @param {object} replay full replay (for names)
 */
export function initialHandState(handRecord, replay) {
  const n = handRecord.hands?.length ?? 5;
  const players = [];
  for (let seat = 0; seat < n; seat++) {
    players.push({
      seat,
      name: playerName(replay, seat),
      hand: sortHand(cloneTiles(handRecord.hands[seat])),
      melds: [],
      discards: [],
      riichi: false,
      riichiPending: false,
      doubleRiichi: false,
      points: handRecord.points?.[seat] ?? 0,
    });
  }
  return {
    round: handRecord.round,
    dealerIndex: handRecord.dealerIndex,
    riichiPot: handRecord.riichiPot ?? 0,
    wallRemaining: handRecord.liveWall?.length ?? 0,
    doraIndicators: cloneTiles(handRecord.doraIndicators),
    uraDoraIndicators: [],
    players,
    lastEvent: null,
    caption: `${handRecord.round?.name ?? 'Hand'} — deal`,
    ended: false,
    endType: null,
    summary: null,
  };
}

function cloneState(state) {
  return {
    round: state.round,
    dealerIndex: state.dealerIndex,
    riichiPot: state.riichiPot,
    wallRemaining: state.wallRemaining,
    doraIndicators: cloneTiles(state.doraIndicators),
    uraDoraIndicators: cloneTiles(state.uraDoraIndicators),
    players: state.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      hand: cloneTiles(p.hand),
      melds: p.melds.map(cloneMeld),
      discards: p.discards.map(cloneDiscard),
      riichi: p.riichi,
      riichiPending: p.riichiPending,
      doubleRiichi: p.doubleRiichi,
      points: p.points,
    })),
    lastEvent: state.lastEvent,
    caption: state.caption,
    ended: state.ended,
    endType: state.endType,
    summary: state.summary,
  };
}

function applySummaryPlayers(state, summary) {
  if (!summary?.players) return;
  for (const pr of summary.players) {
    const p = state.players[pr.seat];
    if (!p) continue;
    // Always show every seat's hand in replay (ignore live-game redaction).
    p.hand = sortHand(cloneTiles(pr.hand ?? []));
    p.melds = (pr.melds ?? []).map(cloneMeld);
    p.discards = (pr.discards ?? []).map(cloneDiscard);
    p.riichi = !!(pr.riichi ?? p.riichi);
    p.points = pr.points ?? p.points;
    p.name = pr.name || p.name;
  }
  if (summary.riichiPot != null) state.riichiPot = summary.riichiPot;
}

/**
 * @param {object} state
 * @param {object} event
 * @param {object} replay
 */
export function applyReplayEvent(state, event, replay) {
  const next = cloneState(state);
  next.lastEvent = event;
  const type = event.type;
  const seat = event.seat;
  const p = seat != null ? next.players[seat] : null;

  if (type === 'draw' && p && event.tile) {
    p.hand.push(cloneTile(event.tile));
    p.hand = sortHand(p.hand);
    if (event.source === 'live') next.wallRemaining = Math.max(0, next.wallRemaining - 1);
    next.caption = `${p.name} draws${event.source === 'rinshan' ? ' (rinshan)' : ''}`;
  } else if (type === 'discard' && p && event.tile) {
    removeTileById(p.hand, event.tile.id);
    p.hand = sortHand(p.hand);
    p.discards.push({
      tile: cloneTile(event.tile),
      sideways: !!event.sideways,
      tsumogiri: !!event.tsumogiri,
      riichiDeclaration: !!event.riichiDeclaration,
    });
    if (event.riichiDeclaration) {
      p.riichi = true;
      p.riichiPending = false;
      next.riichiPot += 1000;
      p.points -= 1000;
    }
    next.caption = `${p.name} discards`;
  } else if (type === 'passClaim') {
    const name = p?.name ?? playerName(replay, seat);
    next.caption = event.auto ? `${name} auto-passes` : `${name} passes`;
  } else if (type === 'claim') {
    next.caption = `${p?.name ?? '?'} declares ${event.claimType ?? '?'}`;
  } else if (type === 'claimApplied' && p && event.tile) {
    const claimType = event.claimType ?? event.type;
    const from = next.players[event.fromSeat];
    if (from?.discards?.length) {
      const idx = from.discards.findIndex(
        (d) => (d.tile ?? d).id === event.tile.id
      );
      if (idx >= 0) from.discards.splice(idx, 1);
      else from.discards.pop();
    }
    const handTaken = removeTilesByIds(p.hand, event.handTileIds);
    p.hand = sortHand(p.hand);
    const called = cloneTile(event.tile);
    if (claimType === 'kin' && handTaken.length === 0) {
      // Upgrade closed kan → open kin
      const meld = p.melds.find(
        (m) =>
          (m.type === 'kan' || m.type === 'kin') &&
          !m.open &&
          m.tiles.some((t) => t.suit === called.suit && t.rank === called.rank)
      );
      if (meld) {
        meld.type = 'kin';
        meld.open = true;
        meld.fromSeat = event.fromSeat;
        meld.calledTileId = called.id;
        meld.tiles.push(called);
      } else {
        p.melds.push({
          type: 'kin',
          open: true,
          fromSeat: event.fromSeat,
          calledTileId: called.id,
          tiles: [...handTaken, called],
        });
      }
    } else {
      p.melds.push({
        type: claimType,
        open: true,
        fromSeat: event.fromSeat,
        calledTileId: called.id,
        tiles: [...handTaken, called],
      });
    }
    next.caption = `${p.name} ${claimType}`;
  } else if (type === 'declareMeld' && p) {
    const ids = event.tileIds ?? [];
    const taken = removeTilesByIds(p.hand, ids);
    p.hand = sortHand(p.hand);
    const kind = event.kind;
    if (kind === 'ankan') {
      p.melds.push({ type: 'kan', open: false, fromSeat: null, tiles: taken });
    } else if (kind === 'kin_closed') {
      p.melds.push({ type: 'kin', open: false, fromSeat: null, tiles: taken });
    } else if (kind === 'kakan' || kind === 'kin_kakan' || kind === 'kin_from_ankan') {
      const meld = p.melds[event.meldIndex];
      const added = taken[0];
      if (meld && added) {
        meld.tiles.push(added);
        meld.addedTileId = added.id;
        if (kind === 'kakan') meld.type = 'kan';
        if (kind === 'kin_kakan' || kind === 'kin_from_ankan') meld.type = 'kin';
        if (kind === 'kin_from_ankan') {
          meld.open = false;
          meld.fromSeat = null;
        }
      }
    }
    next.caption = `${p.name} ${kind?.replace(/_/g, ' ') ?? 'meld'}`;
  } else if (type === 'declareRiichi' && p) {
    p.riichi = true;
    p.riichiPending = true;
    p.doubleRiichi = !!event.doubleRiichi;
    next.caption = `${p.name} declares${p.doubleRiichi ? ' double' : ''} riichi`;
  } else if (type === 'undoRiichi' && p) {
    p.riichi = false;
    p.riichiPending = false;
    p.doubleRiichi = false;
    next.caption = `${p.name} cancels riichi`;
  } else if (type === 'doraReveal' && event.tile) {
    next.doraIndicators.push(cloneTile(event.tile));
    next.caption = 'New dora indicator';
  } else if (type === 'declareWin') {
    next.caption = `${p?.name ?? '?'} tsumo`;
  } else if (type === 'abortNineTerminals') {
    next.caption = `${p?.name ?? '?'} nine terminals`;
  } else if (type === 'win') {
    const names = (event.seats ?? [])
      .map((s) => next.players[s]?.name ?? `Seat ${s + 1}`)
      .join(', ');
    next.caption =
      event.mode === 'ron' ? `Ron — ${names}` : `Tsumo — ${names}`;
  } else if (type === 'handEnd') {
    next.ended = true;
    next.endType = event.endType;
    next.caption = `Hand end — ${event.endType}`;
  } else {
    next.caption = type;
  }

  return next;
}

/**
 * Build ordered frames for one hand. Final frame uses full summary hands.
 * @param {object} handRecord
 * @param {object} replay
 */
export function buildHandFrames(handRecord, replay) {
  const frames = [];
  let state = initialHandState(handRecord, replay);
  frames.push({ ...cloneState(state), event: null });

  for (const event of handRecord.events ?? []) {
    // Passes don't change the board and dominate step count — skip in the viewer.
    if (event.type === 'passClaim') continue;
    state = applyReplayEvent(state, event, replay);
    if (event.type === 'handEnd' && (handRecord.summary || handRecord.finalHands)) {
      state.summary = handRecord.summary;
      applySummaryPlayers(state, handRecord.summary);
      applyFinalHands(state, handRecord.finalHands);
      applyHandEndIndicators(state, handRecord);
      if (handRecord.summary?.endType) {
        state.endType = handRecord.summary.endType;
        state.caption = `${handRecord.summary.roundName ?? handRecord.round?.name ?? 'Hand'} — ${handRecord.summary.endType}`;
      }
    }
    frames.push({ ...cloneState(state), event });
  }

  // Guarantee a terminal frame with every seat's hand from the summary / finalHands.
  if ((handRecord.summary?.players || handRecord.finalHands) && !state.summary) {
    state = cloneState(state);
    state.summary = handRecord.summary;
    state.ended = true;
    applySummaryPlayers(state, handRecord.summary);
    applyFinalHands(state, handRecord.finalHands);
    applyHandEndIndicators(state, handRecord);
    frames.push({ ...state, event: state.lastEvent });
  }

  return frames;
}

function applyHandEndIndicators(state, handRecord) {
  if (handRecord.doraIndicators?.length) {
    state.doraIndicators = cloneTiles(handRecord.doraIndicators);
  }
  const ura = handRecord.uraDoraIndicators;
  state.uraDoraIndicators = Array.isArray(ura) && ura.length ? cloneTiles(ura) : [];
}

function applyFinalHands(state, finalHands) {
  if (!finalHands?.length) return;
  for (const pr of finalHands) {
    const p = state.players[pr.seat];
    if (!p) continue;
    p.hand = sortHand(cloneTiles(pr.hand ?? []));
    p.melds = (pr.melds ?? []).map(cloneMeld);
    p.discards = (pr.discards ?? []).map(cloneDiscard);
    p.riichi = !!pr.riichi;
    p.doubleRiichi = !!pr.doubleRiichi;
    p.points = pr.points ?? p.points;
    p.name = pr.name || p.name;
  }
}

export function eventLabel(event, replay) {
  if (!event) return 'Deal';
  const name =
    event.seat != null ? playerName(replay, event.seat) : '';
  switch (event.type) {
    case 'draw':
      return `${name} draw`;
    case 'discard':
      return `${name} discard`;
    case 'passClaim':
      return `${name} pass`;
    case 'claim':
      return `${name} ${event.claimType ?? 'claim'}`;
    case 'claimApplied':
      return `${name} ${event.claimType ?? 'call'}`;
    case 'declareMeld':
      return `${name} ${event.kind}`;
    case 'declareRiichi':
      return `${name} riichi`;
    case 'undoRiichi':
      return `${name} undo riichi`;
    case 'declareWin':
      return `${name} tsumo`;
    case 'win':
      return event.mode === 'ron' ? 'Ron' : 'Tsumo';
    case 'handEnd':
      return `End (${event.endType})`;
    case 'doraReveal':
      return 'Dora';
    case 'abortNineTerminals':
      return `${name} kyuu shu`;
    default:
      return event.type;
  }
}

/**
 * Validate / normalize a parsed replay JSON (from download or file open).
 * @param {unknown} data
 * @returns {{ ok: true, replay: object } | { ok: false, error: string }}
 */
export function parseReplayDocument(data) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Not a valid replay file.' };
  }
  const replay = data;
  if (replay.format && replay.format !== 'mahjong5-replay') {
    return { ok: false, error: `Unknown replay format: ${replay.format}` };
  }
  if (!Array.isArray(replay.hands) || replay.hands.length === 0) {
    return { ok: false, error: 'Replay has no hands to show.' };
  }
  for (let i = 0; i < replay.hands.length; i++) {
    const hand = replay.hands[i];
    if (!hand || typeof hand !== 'object') {
      return { ok: false, error: `Hand ${i + 1} is invalid.` };
    }
    if (!Array.isArray(hand.hands) || hand.hands.length < 1) {
      return { ok: false, error: `Hand ${i + 1} is missing dealt tiles.` };
    }
    if (!Array.isArray(hand.events)) {
      hand.events = [];
    }
  }
  if (!replay.meta || typeof replay.meta !== 'object') {
    replay.meta = {};
  }
  if (!Array.isArray(replay.meta.players)) {
    const n = replay.hands[0].hands.length;
    replay.meta.players = Array.from({ length: n }, (_, seat) => ({
      seat,
      name: `Seat ${seat + 1}`,
    }));
  }
  replay.format = replay.format || 'mahjong5-replay';
  replay.version = replay.version || 1;
  return { ok: true, replay };
}
