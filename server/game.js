import { buildDeck, sortHand, PLAYER_WINDS, windForSeat, windLabel, tileLabel, isTerminalOrHonorTile } from './tiles.js';
import {
  getClaimsForPlayer,
  findChiOptions,
  findPonOptions,
  findKanCallOptions,
  findKinCallOptions,
  resolveClaims,
  findAnkanOptions,
  findClosedKinOptions,
  findKakanOptions,
  findKinKakanOptions,
  findClosedKinFromKanOptions,
  findClosedKanMeldIndex,
  tilesMatching,
  canKin,
  canKinFromClosedKan,
  tileKey,
  kuikaeForbiddenKeys,
  claimOptionAllowsDiscard,
  claimPriority,
} from './claims.js';
import { canWin, getWinPatterns, hasValidWinTotal, formatWinPatterns } from './win.js';
import { canDeclareRiichi, isTenpaiDiscard, tenpaiDiscardIds, isReady, closedKanPreservesWaits, closedKinFromKanPreservesWaits } from './riichi.js';
import { isFuriten, furitenReason } from './furiten.js';
import { splitWall } from './wall.js';
import { countDora, doraFromIndicator } from './dora.js';
import { calculateHan, formatHanResult, hasYaku } from './yaku.js';
import {
  STARTING_POINTS,
  RIICHI_BET,
  TARGET_POINTS,
  scoreWin,
  mergeScoreDeltas,
  scoreNotenPenalty,
  scoreNagashiMangan,
  NAGASHI_MANGAN_HAN,
  formatPoints,
  headBumpWinner,
  computeUmaStandings,
} from './scoring.js';
import {
  formatRoundName,
  computeNextRoundState,
  roundSnapshot,
  parseGameLength,
  ROUND_WINDS,
} from './round.js';
import {
  ABORTIVE,
  ABORTIVE_LABELS,
  hasNineTerminals,
  isFiveWindAbort,
  isFiveRiichiAbort,
  isFiveKanAbort,
  playersWithQuadCount,
} from './abortive.js';
import {
  cloneTile,
  cloneTiles,
  cloneJson,
  createReplayDocument,
  beginHand,
  pushHandEvent,
} from './replay.js';

const PLAYER_COUNT = 5;
const HAND_SIZE = 13;
const DEALER_EXTRA = 1;
const GAME_MODES = {
  standard: { id: 'standard', label: 'Standard 五麻' },
  limitlessAsura: { id: 'limitless-asura', label: 'Limitless Asura' },
};

function parseGameMode(mode) {
  if (mode === GAME_MODES.limitlessAsura.id || mode === 'limitlessAsura') {
    return GAME_MODES.limitlessAsura;
  }
  return GAME_MODES.standard;
}

function makeWildcard(seat) {
  return {
    id: `wildcard-${seat}`,
    suit: 'wild',
    rank: 0,
    copy: 0,
    wildcard: true,
  };
}

/** Fake think-time after an unclaimable discard (anti-tell). */
const NOBODY_CLAIM_LAG_CHANCE = 0.1;
const NOBODY_CLAIM_LAG_MIN_MS = 1800;
const NOBODY_CLAIM_LAG_MAX_MS = 4800;

function nobodyClaimLagMs() {
  return (
    NOBODY_CLAIM_LAG_MIN_MS +
    Math.floor(Math.random() * (NOBODY_CLAIM_LAG_MAX_MS - NOBODY_CLAIM_LAG_MIN_MS + 1))
  );
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function emptyPlayer(name) {
  return {
    id: null,
    /** Client-held secret that lets a refreshed page reclaim this seat. */
    token: null,
    connected: false,
    name,
    hand: [],
    /** Limitless Asura wildcard; kept outside the physical hand for now. */
    wildcard: null,
    active: true,
    won: false,
    winningTile: null,
    discards: [],
    melds: [],
    riichi: false,
    /** Whether this hand's declared riichi stick is still visible on the table. */
    riichiStickOnTable: false,
    riichiFirstDiscard: false,
    /** Riichi on first discard with no prior calls — 両立直. */
    doubleRiichi: false,
    /** Declared riichi this turn and may still undo before discarding. */
    riichiPendingUndo: false,
    /** Riichi declare auto-drew from a 13-tile hand — undo must return that tile. */
    riichiDrewOnDeclare: false,
    /** Next discard sideways after a called riichi sideways tile (追い立直). */
    riichiSidewaysPending: false,
    /** One-shot window after riichi discard — cleared by a call or the player's next discard. */
    ippatsu: false,
    /** Missed a ron this round — clears on next draw. */
    temporaryFuriten: false,
    /** Missed a ron while in riichi — lasts until the hand ends. */
    riichiFuriten: false,
    /** A discard was called (chi/pon/kan/kin) — voids nagashi mangan. */
    discardCalled: false,
    /** Tile keys discarded this hand — kept even if a discard is called away (furiten). */
    furitenDiscardKeys: [],
    points: STARTING_POINTS,
  };
}

export class MahjongRoom {
  constructor(code) {
    this.code = code;
    this.phase = 'lobby';
    this.players = Array.from({ length: PLAYER_COUNT }, (_, i) =>
      emptyPlayer(`Seat ${i + 1}`)
    );
    this.hostSocketId = null;
    this.dealerIndex = 0;
    this.currentTurn = 0;
    this.liveWall = [];
    /** @type {import('./wall.js').DeadWall | null} */
    this.deadWall = null;
    this.lastDrawn = null;
    /** True when lastDrawn came from a rinshan (dead-wall) supplement. */
    this.lastDrawWasRinshan = false;
    this.drewThisTurn = false;
    this.openingDiscardPending = false;
    this.mustDiscardAfterMeld = null;
    /** @type {{ seat: number, keys: Set<string> } | null} */
    this.kuikaeBan = null;
    this.message = '';
    /** @type {{ tile: import('./tiles.js').Tile, fromSeat: number } | null} */
    this.claimWindow = null;
    /** @type {Set<number>} */
    this.claimResponded = new Set();
    /** @type {Array<{ seat: number, type: string, chiIndex?: number }>} */
    this.claimSubmissions = [];
    this.winner = null;
    /** @type {number[]} */
    this.winners = [];
    this.winMode = null;
    this.winTile = null;
    this.winFromSeat = null;
    this.winPatterns = [];
    /** @type {Array<{ seat: number, patterns: string[], doraCount: number, han: object|null, hanText: string }>} */
    this.winResults = [];
    this.doraCount = 0;
    /** @type {number[]|null} point change from the last settled hand */
    this.lastPointDeltas = null;
    /** Individual point transfers recorded during the current hand. */
    this.handPayments = [];
    /** Table pot from riichi bets (1000 each). */
    this.riichiPot = 0;
    /** @type {{ seat: number, amount: number }|null} */
    this.lastRiichiPotClaim = null;
    this.riichiPotClaims = [];
    /** @type {0|1|2|3} prevailing round wind (东→南→西→北) */
    this.roundWindIndex = 0;
    /** @type {number} hand number within round wind (1…PLAYER_COUNT) */
    this.roundInWind = 1;
    /** @type {number} honba / repeat counter — +1 when dealer keeps, reset on non-dealer win */
    this.repeatCount = 0;
    /** Host-chosen match length id: east | south | west | north */
    this.gameLength = 'south';
    this.gameMode = GAME_MODES.standard.id;
    this.gameModeLabel = GAME_MODES.standard.label;
    /** Tile ids selected by each player during the Asura opening exchange. */
    this.swapSelections = Array.from({ length: PLAYER_COUNT }, () => null);
    this.swapOffset = null;
    /** Shared exchange-complete message; each viewer sees their own pass target appended. */
    this.swapCompleteMessage = null;
    /** True after start until the match ends — length cannot change mid-game. */
    this.gameLengthLocked = false;
    /** Scheduled final wind from game length (unchanged by overtime). */
    this.scheduledFinalWindIndex = parseGameLength('south').finalWindIndex;
    /** Effective last wind index for progression (extends for tiebreaker). */
    this.finalWindIndex = this.scheduledFinalWindIndex;
    /** True during the extra go-around when nobody reached TARGET_POINTS. */
    this.inTiebreaker = false;
    /** @type {object | null} */
    this.roundSummary = null;
    /**
     * True until the first call/kan of the hand — required for double riichi /
     * five-wind abort / nine-terminals window.
     * @type {boolean}
     */
    this.doubleRiichiEligible = true;
    /** @type {{ type: string, afterSeat: number }|null} */
    this.pendingAbortive = null;
    /** @type {string|null} */
    this.abortiveReason = null;
    /** @type {object | null} in-progress match replay */
    this.replay = null;
    /** @type {object | null} current hand within replay */
    this.replayHand = null;
    /** @type {object | null} finished match replay available for download */
    this.completedReplay = null;
    /** True while waiting out a fake lag after an unclaimable discard. */
    this.pendingNobodyClaimDefer = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.nobodyClaimLagTimer = null;
    /** @type {((room: MahjongRoom) => void) | null} */
    this.onAsyncUpdate = null;
  }

  /** Append an event to the current hand's replay log. */
  recordReplay(type, payload = {}) {
    pushHandEvent(this.replayHand, type, payload);
  }

  /**
   * Full replay JSON after game over (omniscient — all hands/events).
   * @returns {object | null}
   */
  getReplay() {
    return this.completedReplay ? cloneJson(this.completedReplay) : null;
  }

  totalTiles(seat) {
    const p = this.players[seat];
    const inMelds = p.melds.reduce((s, m) => s + m.tiles.length, 0);
    return p.hand.length + inMelds + (p.wildcard ? 1 : 0);
  }

  isLimitlessAsura() {
    return this.gameMode === GAME_MODES.limitlessAsura.id;
  }

  activeSeatList() {
    return this.players
      .map((p, seat) => (p.active ? seat : -1))
      .filter((seat) => seat >= 0);
  }

  nextActiveSeat(afterSeat) {
    for (let step = 1; step <= PLAYER_COUNT; step++) {
      const seat = (afterSeat + step) % PLAYER_COUNT;
      if (this.players[seat]?.active) return seat;
    }
    return null;
  }

  seatForSocket(socketId) {
    return this.players.findIndex((p) => p.id === socketId);
  }

  /** Keep hostSocketId pointing at a seated player (fixes stale host after reconnect). */
  ensureValidHost() {
    const seated = this.players.filter((p) => p.id);
    if (!seated.length) {
      this.hostSocketId = null;
      return;
    }
    if (!seated.some((p) => p.id === this.hostSocketId)) {
      this.hostSocketId = seated[0].id;
    }
  }

  join(socketId, name, token = null) {
    const taken = this.seatForSocket(socketId);
    if (taken >= 0) {
      this.ensureValidHost();
      return { ok: true, seat: taken, isHost: socketId === this.hostSocketId };
    }

    const reclaim = token
      ? this.players.findIndex((p) => p.id !== null && p.token === token)
      : -1;
    if (reclaim >= 0) return this.rejoin(reclaim, socketId);

    const empty = this.players.findIndex((p) => p.id === null);
    if (empty < 0) return { ok: false, error: 'Room is full (5 players).' };

    this.players[empty].id = socketId;
    this.players[empty].token = token;
    this.players[empty].connected = true;
    this.players[empty].name = name || `Player ${empty + 1}`;

    // First seated player (lowest seat index) is always host.
    // Seat 0 joiner claims host; otherwise keep/repair existing host.
    if (empty === 0 || !this.hostSocketId) {
      this.hostSocketId = socketId;
    } else {
      this.ensureValidHost();
    }

    const filled = this.players.filter((p) => p.id).length;
    const names = this.players
      .filter((p) => p.id)
      .map((p) => p.name)
      .join(', ');
    this.message =
      this.phase === 'lobby' ? `${filled}/5 seated: ${names}.` : this.message;
    return {
      ok: true,
      seat: empty,
      isHost: socketId === this.hostSocketId,
    };
  }

  /** A refreshed / reconnected client takes back its seat with a new socket. */
  rejoin(seat, socketId) {
    const p = this.players[seat];
    const oldId = p.id;
    p.id = socketId;
    p.connected = true;
    if (this.hostSocketId === oldId) this.hostSocketId = socketId;
    this.ensureValidHost();
    return {
      ok: true,
      seat,
      isHost: socketId === this.hostSocketId,
      rejoined: true,
    };
  }

  /** Keep the seat (and the game) while the player's page reloads. */
  markDisconnected(socketId) {
    const seat = this.seatForSocket(socketId);
    if (seat < 0) return -1;
    this.players[seat].connected = false;
    return seat;
  }

  leave(socketId) {
    const seat = this.seatForSocket(socketId);
    if (seat < 0) return;
    this.players[seat] = emptyPlayer(`Seat ${seat + 1}`);
    this.ensureValidHost();
    if (this.phase === 'playing' || this.phase === 'roundEnd') {
      this.phase = 'lobby';
      this.liveWall = [];
      this.deadWall = null;
      this.roundSummary = null;
      this.gameLengthLocked = false;
      this.clearClaimWindow();
      this.message = 'Game paused — a player left.';
    } else if (this.phase === 'lobby') {
      const filled = this.players.filter((p) => p.id).length;
      const names = this.players
        .filter((p) => p.id)
        .map((p) => p.name)
        .join(', ');
      this.message = filled
        ? `${filled}/5 seated: ${names}.`
        : 'Waiting for players…';
    }
  }

  canStart(socketId) {
    if (socketId !== this.hostSocketId) return false;
    const full = this.players.every((p) => p.id !== null);
    if (!full) return false;
    if (this.phase === 'lobby') return true;
    return this.phase === 'roundEnd' && !!this.roundSummary?.gameOver;
  }

  /** Host may pick length only before a match (lobby or rematch after game over). */
  canChooseGameLength(socketId) {
    if (socketId !== this.hostSocketId) return false;
    if (this.phase === 'lobby') return true;
    return this.phase === 'roundEnd' && !!this.roundSummary?.gameOver;
  }

  start(socketId, opts = {}) {
    if (socketId !== this.hostSocketId) {
      return { ok: false, error: 'Only the host (first player) can start the game.' };
    }
    if (!this.canStart(socketId)) {
      return { ok: false, error: 'Need all 5 seats filled before starting.' };
    }

    // Length is chosen at start; then locked for the match.
    const length = parseGameLength(opts.gameLength ?? this.gameLength);
    const mode = parseGameMode(opts.gameMode ?? this.gameMode);
    this.gameLength = length.id;
    this.gameMode = mode.id;
    this.gameModeLabel = mode.label;
    this.scheduledFinalWindIndex = length.finalWindIndex;
    this.finalWindIndex = length.finalWindIndex;
    this.inTiebreaker = false;
    this.gameLengthLocked = true;

    this.roundWindIndex = 0;
    this.roundInWind = 1;
    this.repeatCount = 0;
    this.dealerIndex = 0;
    this.roundSummary = null;
    for (const p of this.players) {
      p.points = STARTING_POINTS;
    }
    this.riichiPot = 0;
    this.lastRiichiPotClaim = null;
    this.riichiPotClaims = [];
    this.completedReplay = null;
    this.replay = createReplayDocument({
      code: this.code,
      gameLength: length.id,
      gameLengthLabel: length.label,
      gameMode: mode.id,
      gameModeLabel: mode.label,
      players: this.players,
    });
    this.replayHand = null;
    this.dealNewHand();
    this.message = `${formatRoundName(0, 1, 0)} — ${length.label}. ${this.message}`;
    return { ok: true, gameLength: length.id };
  }

  /** Select the three concealed physical tiles used in the Asura opening exchange. */
  selectSwap(socketId, tileIds) {
    const seat = this.seatForSocket(socketId);
    if (seat < 0) return { ok: false, error: 'Not in room.' };
    if (this.phase !== 'tile-swap') {
      return { ok: false, error: 'Tile swapping is not active.' };
    }
    if (Array.isArray(tileIds) && tileIds.length === 0) {
      this.swapSelections[seat] = null;
      return { ok: true, ready: false, phase: this.phase };
    }
    if (!Array.isArray(tileIds) || tileIds.length !== 3 || new Set(tileIds).size !== 3) {
      return { ok: false, error: 'Select exactly 3 tiles.' };
    }
    const player = this.players[seat];
    if (tileIds.some((id) => !player.hand.some((tile) => tile.id === id))) {
      return { ok: false, error: 'You may only select tiles from your hand.' };
    }

    this.swapSelections[seat] = [...tileIds];
    const ready = this.swapSelections.every((selection) => selection?.length === 3);
    if (ready) this.completeTileSwap();
    return { ok: true, ready, phase: this.phase };
  }

  completeTileSwap() {
    const selections = this.swapSelections;
    if (!selections.every((selection) => selection?.length === 3)) return false;

    const offset = this.swapOffset;
    const selectedTiles = selections.map((ids, seat) =>
      ids.map((id) => this.players[seat].hand.find((tile) => tile.id === id))
    );

    for (let seat = 0; seat < PLAYER_COUNT; seat++) {
      const selectedIds = new Set(selections[seat]);
      this.players[seat].hand = this.players[seat].hand.filter(
        (tile) => !selectedIds.has(tile.id)
      );
    }
    for (let seat = 0; seat < PLAYER_COUNT; seat++) {
      const sourceSeat = (seat - offset + PLAYER_COUNT) % PLAYER_COUNT;
      this.players[seat].hand.push(...selectedTiles[sourceSeat]);
      this.players[seat].hand = sortHand(this.players[seat].hand);
      this.players[seat].wildcard = makeWildcard(seat);
    }

    this.swapOffset = offset;
    this.deadWall.doraRevealed = 0;
    const doraIndicator = this.deadWall.revealNextDora();
    this.phase = 'playing';
    this.currentTurn = this.dealerIndex;
    this.lastDrawn = null;
    this.lastDrawWasRinshan = false;
    this.drewThisTurn = false;
    this.openingDiscardPending = true;
    const doraLabel = doraIndicator ? tileLabel(doraIndicator) : '?';
    this.message = `${formatRoundName(this.roundWindIndex, this.roundInWind, this.repeatCount)} — Tile exchange complete. Dora indicator: ${doraLabel}. ${this.players[this.dealerIndex].name} discards first.`;
    this.swapCompleteMessage = this.message;
    this.beginReplayHand();
    this.recordReplay('tileSwap', { offset });
    return true;
  }

  canNextRound(socketId) {
    return (
      socketId === this.hostSocketId &&
      this.phase === 'roundEnd' &&
      !this.roundSummary?.gameOver
    );
  }

  nextRound(socketId) {
    if (!this.canNextRound(socketId)) {
      return { ok: false, error: 'Only the host can start the next round after a round ends.' };
    }

    if (this.roundSummary) {
      this.dealerIndex = this.roundSummary.nextDealer;
      this.roundWindIndex = this.roundSummary.nextRoundWindIndex;
      this.roundInWind = this.roundSummary.nextRoundInWind;
      this.repeatCount = this.roundSummary.nextRepeatCount;
    }

    this.roundSummary = null;
    this.dealNewHand();
    return { ok: true };
  }

  dealNewHand() {
    const deck = shuffle(buildDeck());
    let idx = 0;

    for (const p of this.players) {
      p.hand = [];
      // In Limitless Asura the wildcard is dealt only after the opening exchange.
      p.wildcard = null;
      p.active = true;
      p.won = false;
      p.winningTile = null;
      p.discards = [];
      p.melds = [];
      p.riichi = false;
      p.riichiStickOnTable = false;
      p.riichiFirstDiscard = false;
      p.doubleRiichi = false;
      p.riichiPendingUndo = false;
      p.riichiDrewOnDeclare = false;
      p.riichiSidewaysPending = false;
      p.ippatsu = false;
      p.temporaryFuriten = false;
      p.riichiFuriten = false;
      p.discardCalled = false;
      p.furitenDiscardKeys = [];
    }

    const physicalHandSize =
      this.gameMode === GAME_MODES.limitlessAsura.id ? HAND_SIZE - 1 : HAND_SIZE;
    for (let round = 0; round < physicalHandSize; round++) {
      for (let s = 0; s < PLAYER_COUNT; s++) {
        this.players[s].hand.push(deck[idx++]);
      }
    }

    const dealer = this.dealerIndex;
    for (let i = 0; i < DEALER_EXTRA; i++) {
      this.players[dealer].hand.push(deck[idx++]);
    }

    for (const p of this.players) {
      p.hand = sortHand(p.hand);
    }

    const { liveWall, deadWall } = splitWall(deck.slice(idx), {
      doraRevealed: this.isLimitlessAsura() ? 0 : 1,
    });
    this.liveWall = liveWall;
    this.deadWall = deadWall;
    this.currentTurn = dealer;
    this.lastDrawn = null;
    this.lastDrawWasRinshan = false;
    this.drewThisTurn = false;
    this.openingDiscardPending = true;
    this.mustDiscardAfterMeld = null;
    this.kuikaeBan = null;
    this.doubleRiichiEligible = true;
    this.pendingAbortive = null;
    this.abortiveReason = null;
    this.clearClaimWindow();
    this.winner = null;
    this.winners = [];
    this.winMode = null;
    this.winTile = null;
    this.winFromSeat = null;
    this.winPatterns = [];
    this.winResults = [];
    this.doraCount = 0;
    /** @type {number[]|null} */
    this.lastPointDeltas = null;
    this.handPayments = [];
    this.riichiPotClaims = [];
    this.swapSelections = Array.from({ length: PLAYER_COUNT }, () => null);
    this.swapCompleteMessage = null;
    this.swapOffset = this.isLimitlessAsura()
      ? 1 + Math.floor(Math.random() * 4)
      : null;
    if (this.isLimitlessAsura()) {
      this.phase = 'tile-swap';
      this.replayHand = null;
      this.message = 'Opening exchange — select 3 tiles to pass. Who receives them is revealed after everyone confirms. Selections remain hidden.';
      return;
    }

    this.phase = 'playing';
    this.message = this.playingStartMessage(deadWall);
    this.beginReplayHand();
  }

  playingStartMessage(deadWall) {
    const doraTile = deadWall?.revealedDoraIndicators?.()[0];
    const indicatorName = doraTile ? tileLabel(doraTile) : '?';
    const roundName = formatRoundName(
      this.roundWindIndex,
      this.roundInWind,
      this.repeatCount
    );
    return `${roundName} — ${this.players[this.dealerIndex].name} (${windLabel(windForSeat(this.dealerIndex, this.dealerIndex))}) discards first. Indicator: ${indicatorName}.`;
  }

  beginReplayHand() {
    this.replayHand = beginHand(this.replay, {
      round: roundSnapshot(this.roundWindIndex, this.roundInWind, this.repeatCount),
      dealerIndex: this.dealerIndex,
      riichiPot: this.riichiPot,
      swapOffset: this.swapOffset,
      points: this.players.map((p) => p.points),
      hands: this.players.map((p) => cloneTiles(p.hand)),
      wildcards: this.players.map((p) => (p.wildcard ? { ...p.wildcard } : null)),
      liveWall: cloneTiles(this.liveWall),
      deadWall: cloneTiles(this.deadWall?.tiles ?? []),
      doraIndicators: cloneTiles(this.deadWall?.revealedDoraIndicators() ?? []),
    });
  }

  endRound(endType, winners = null) {
    const dealer = this.dealerIndex;
    let winnerSeats =
      winners == null ? [] : Array.isArray(winners) ? [...winners] : [winners];
    if (this.isLimitlessAsura() && endType !== 'abortive') {
      winnerSeats = [...this.winners];
    }
    let dealerKeeps = false;
    /** @type {number[]} */
    let nagashiSeats = [];

    if (endType === 'win') {
      dealerKeeps = winnerSeats.includes(dealer);
    } else if (endType === 'abortive') {
      // Re-deal: dealer keeps, honba +1; no noten / nagashi; riichi bets stay on the table.
      dealerKeeps = true;
      this.lastPointDeltas = Array(PLAYER_COUNT).fill(0);
      this.handPayments = [];
      this.lastRiichiPotClaim = null;
      this.winResults = [];
      this.winners = [];
      this.winner = null;
      this.winMode = null;
      this.winTile = null;
      this.winFromSeat = null;
      this.winPatterns = [];
    } else if (endType === 'exhaustive') {
      const d = this.players[dealer];
      dealerKeeps = isReady(d.hand, d.melds, d.wildcard);

      nagashiSeats = [];
      for (let i = 0; i < PLAYER_COUNT; i++) {
        if (this.players[i].active && this.isNagashiMangan(i)) nagashiSeats.push(i);
      }

      this.lastRiichiPotClaim = null;
      if (nagashiSeats.length > 0) {
        // Nagashi mangan: mangan tsumo payments; skip noten (3600) exchange.
        const scored = scoreNagashiMangan({
          winnerSeats: nagashiSeats,
          dealerIndex: dealer,
          honba: this.isLimitlessAsura() ? 0 : this.repeatCount,
          activeSeats: this.isLimitlessAsura() ? this.activeSeatList() : null,
          playerCount: PLAYER_COUNT,
        });
        this.lastPointDeltas = this.lastPointDeltas
          ? this.lastPointDeltas.map((delta, i) => delta + scored.deltas[i])
          : scored.deltas;
        this.winMode = 'tsumo';
        const priorWinners = this.isLimitlessAsura() ? [...this.winners] : [];
        this.winners = [...priorWinners, ...nagashiSeats];
        this.winner = this.winners[0] ?? null;
        this.winResults = [
          ...(this.isLimitlessAsura() ? this.winResults : []),
          ...nagashiSeats.map((seat, idx) => {
          const seatScore = scored.scores[idx];
          return {
            seat,
            patterns: ['nagashiMangan'],
            doraCount: 0,
            han: NAGASHI_MANGAN_HAN,
            hanText: formatHanResult(NAGASHI_MANGAN_HAN),
            basicPoints: scored.basic,
            payments: (seatScore?.payments ?? []).slice(),
            pointDelta: scored.deltas[seat],
            score: seatScore,
          };
          }),
        ];
        this.handPayments.push(
          ...scored.scores.flatMap((score) =>
            (score?.payments ?? []).map((payment) => ({
              fromSeat: payment.fromSeat ?? payment.from,
              toSeat: payment.toSeat ?? payment.to,
              amount: payment.amount,
              type: 'nagashi-mangan',
            }))
          )
        );
        winnerSeats = this.winners;
        for (let i = 0; i < PLAYER_COUNT; i++) {
          this.players[i].points += scored.deltas[i];
        }
      } else {
        // Noten penalty: ready +3600/a each, not-ready −3600/b each (a,b > 0).
        const readyFlags = this.players.map((p) => p.active && isReady(p.hand, p.melds, p.wildcard));
        const scored = scoreNotenPenalty(
          readyFlags,
          PLAYER_COUNT,
          this.isLimitlessAsura() ? this.activeSeatList() : null
        );
        this.handPayments.push(
          ...(scored.payments ?? []).map((payment) => ({
            fromSeat: payment.fromSeat ?? payment.from,
            toSeat: payment.toSeat ?? payment.to,
            amount: payment.amount,
            type: 'noten-penalty',
          }))
        );
        this.lastPointDeltas = this.lastPointDeltas
          ? this.lastPointDeltas.map((delta, i) => delta + scored.deltas[i])
          : scored.deltas;
        for (let i = 0; i < PLAYER_COUNT; i++) {
          this.players[i].points += scored.deltas[i];
        }
      }
    }

    if (this.isLimitlessAsura()) {
      // Asura never repeats the dealer or creates honba after a win or exhaustive draw.
      // Only an abortive draw keeps the dealer, and even then repeatCount remains zero.
      dealerKeeps = endType === 'abortive';
      this.repeatCount = 0;
    }

    const previousDealer = dealer;
    const next = computeNextRoundState(
      {
        roundWindIndex: this.roundWindIndex,
        roundInWind: this.roundInWind,
        repeatCount: this.repeatCount,
        dealerIndex: dealer,
      },
      { dealerKeeps },
      PLAYER_COUNT,
      this.finalWindIndex
    );
    if (this.isLimitlessAsura()) next.nextRepeatCount = 0;

    const bustedSeats = this.players
      .map((p, i) => (p.points < 0 ? i : -1))
      .filter((i) => i >= 0);
    const hasTarget = this.players.some((p) => p.points >= TARGET_POINTS);

    let gameOver = false;
    let gameOverReason = null;
    let enteringTiebreaker = false;

    if (bustedSeats.length > 0) {
      gameOver = true;
      gameOverReason = 'negative';
    } else if (this.inTiebreaker) {
      if (hasTarget) {
        gameOver = true;
        gameOverReason = 'target';
      } else if (next.gameOver) {
        gameOver = true;
        gameOverReason = 'tiebreaker';
      }
    } else if (next.gameOver) {
      if (hasTarget) {
        gameOver = true;
        gameOverReason = 'length';
      } else {
        // Nobody at 50k — one go-around of the next wind as tiebreaker.
        enteringTiebreaker = true;
        this.inTiebreaker = true;
        const tbWind =
          (this.scheduledFinalWindIndex + 1) % ROUND_WINDS.length;
        this.finalWindIndex = tbWind;
        next.gameOver = false;
        next.nextRoundWindIndex = tbWind;
        next.nextRoundInWind = 1;
        next.nextRepeatCount = 0;
      }
    }

    const roundName = formatRoundName(
      this.roundWindIndex,
      this.roundInWind,
      this.repeatCount
    );
    const nextRoundName = gameOver
      ? null
      : formatRoundName(
          next.nextRoundWindIndex,
          next.nextRoundInWind,
          next.nextRepeatCount
        );

    const deltas = this.lastPointDeltas ?? Array(PLAYER_COUNT).fill(0);

    const playerResults = this.players.map((p, i) => {
      const result = this.winResults.find((r) => r.seat === i);
      return {
        seat: i,
        name: p.name,
        wind: windForSeat(i, previousDealer),
        hand: [...p.hand],
        wildcard: p.wildcard ? { ...p.wildcard } : null,
        melds: p.melds,
        discards: p.discards.map((d) => ({
          // Discards are public state; send a detached tile snapshot so
          // later hand/meld operations cannot alter what other clients see.
          tile: cloneTile(d.tile ?? d),
          sideways: !!d.sideways,
          tsumogiri: !!d.tsumogiri,
          ronWin: !!d.ronWin,
        })),
        ready: isReady(p.hand, p.melds, p.wildcard),
        won:
          (endType === 'win' && winnerSeats.includes(i)) ||
          (endType === 'exhaustive' && (nagashiSeats.includes(i) || this.winners.includes(i))),
        nagashi: endType === 'exhaustive' && nagashiSeats.includes(i),
        winMode: result?.mode ?? null,
        winTile: result?.winTile ?? null,
        winFromSeat: result?.fromSeat ?? null,
        patterns: result?.patterns ?? null,
        doraCount: result?.doraCount ?? 0,
        han: result?.han ?? null,
        hanText: result?.hanText ?? '',
        totalHan: result?.han?.totalHan ?? 0,
        fu: result?.han?.fu ?? result?.fu ?? 0,
        points: p.points,
        pointDelta: deltas[i] ?? 0,
        basicPoints: result?.basicPoints ?? null,
        payments: this.handPayments
          .filter((payment) => payment.fromSeat === i || payment.toSeat === i)
          .map((payment) => ({
            ...payment,
            direction: payment.toSeat === i ? 'in' : 'out',
          })),
        busted: p.points < 0,
      };
    });

    const standings = gameOver
      ? computeUmaStandings(playerResults)
      : [...playerResults]
          .sort((a, b) => b.points - a.points || a.seat - b.seat)
          .map((p, rank) => ({
            seat: p.seat,
            name: p.name,
            points: p.points,
            rank: rank + 1,
          }));

    if (gameOver) {
      const bySeat = new Map(standings.map((s) => [s.seat, s]));
      for (const pr of playerResults) {
        const s = bySeat.get(pr.seat);
        if (!s) continue;
        pr.rank = s.rank;
        pr.uma = s.uma;
        pr.umaPoints = s.umaPoints;
        pr.finalPoints = s.finalPoints;
      }
    }

    this.roundSummary = {
      endType,
      abortiveReason: endType === 'abortive' ? this.abortiveReason : null,
      abortiveLabel:
        endType === 'abortive'
          ? ABORTIVE_LABELS[this.abortiveReason] ?? 'Abortive draw'
          : null,
      nagashi: nagashiSeats.length > 0,
      nagashiSeats,
      winner: winnerSeats[0] ?? null,
      winners: winnerSeats,
      winMode: this.winMode,
      winTile: this.winTile,
      winFromSeat: this.winFromSeat,
      winResults: this.winResults,
      pointDeltas: deltas,
      swapOffset: this.isLimitlessAsura() ? this.swapOffset : null,
      payments: this.handPayments,
      riichiPotClaimed: this.lastRiichiPotClaim,
      riichiPotClaims: this.riichiPotClaims,
      riichiPot: this.riichiPot,
      roundName,
      nextRoundName,
      round: roundSnapshot(this.roundWindIndex, this.roundInWind, this.repeatCount),
      nextRound: gameOver
        ? null
        : roundSnapshot(
            next.nextRoundWindIndex,
            next.nextRoundInWind,
            next.nextRepeatCount
          ),
      previousDealer,
      nextDealer: gameOver ? null : next.nextDealer,
      nextRoundWindIndex: gameOver ? this.roundWindIndex : next.nextRoundWindIndex,
      nextRoundInWind: gameOver ? this.roundInWind : next.nextRoundInWind,
      nextRepeatCount: gameOver ? this.repeatCount : next.nextRepeatCount,
      dealerRotated: !dealerKeeps,
      players: playerResults,
      gameOver,
      gameOverReason,
      bustedSeats,
      standings,
      gameLength: this.gameLength,
      gameLengthLabel: parseGameLength(this.gameLength).label,
      inTiebreaker: this.inTiebreaker,
      enteringTiebreaker,
      targetPoints: TARGET_POINTS,
      uma: gameOver ? standings.map((s) => ({ seat: s.seat, uma: s.uma })) : null,
    };

    this.clearClaimWindow();
    this.phase = 'roundEnd';
    this.mustDiscardAfterMeld = null;
    this.kuikaeBan = null;
    if (gameOver) this.gameLengthLocked = false;

    if (this.replayHand) {
      this.recordReplay('handEnd', { endType, gameOver: !!gameOver });
      this.replayHand.summary = cloneJson(this.roundSummary);
      this.replayHand.doraIndicators = cloneTiles(
        this.deadWall?.revealedDoraIndicators() ?? []
      );
      const uraVisible =
        endType === 'win' &&
        this.winners.some((s) => this.players[s]?.riichi);
      this.replayHand.uraDoraIndicators = uraVisible
        ? cloneTiles(this.deadWall?.revealedUraDora() ?? [])
        : [];
      // Explicit full hands for every seat (replay always reveals all).
      this.replayHand.finalHands = this.players.map((p, seat) => ({
        seat,
        name: p.name,
        hand: cloneTiles(p.hand),
        wildcard: p.wildcard ? { ...p.wildcard } : null,
        melds: cloneJson(p.melds),
        discards: p.discards.map((d) => ({
          tile: cloneTile(d.tile ?? d),
          sideways: !!d.sideways,
          tsumogiri: !!d.tsumogiri,
          riichiDeclaration: !!d.riichiDeclaration,
          ronWin: !!d.ronWin,
        })),
        riichi: !!p.riichi,
        doubleRiichi: !!p.doubleRiichi,
        points: p.points,
      }));
      this.replayHand = null;
    }
    if (gameOver && this.replay) {
      this.replay.meta.endedAt = new Date().toISOString();
      this.replay.result = {
        gameOverReason,
        standings: cloneJson(standings),
        gameLength: this.gameLength,
        gameLengthLabel: parseGameLength(this.gameLength).label,
      };
      this.completedReplay = this.replay;
      this.replay = null;
    }

    const bustedNames = bustedSeats.map((s) => this.players[s].name).join(', ');
    let gameOverNote = '';
    if (gameOver) {
      if (gameOverReason === 'negative') {
        gameOverNote = ` Game over — ${bustedNames} below 0 points.`;
      } else if (gameOverReason === 'target') {
        gameOverNote = ` Game over — someone reached ${TARGET_POINTS.toLocaleString()}.`;
      } else if (gameOverReason === 'tiebreaker') {
        gameOverNote = ` Game over — tiebreaker go-around finished.`;
      } else {
        gameOverNote = ` Game over — ${parseGameLength(this.gameLength).label} complete.`;
      }
      const umaLine = standings
        .map(
          (s) =>
            `${s.rank}. ${s.name} ${Number(s.points).toLocaleString()} (uma ${s.uma >= 0 ? '+' : ''}${s.uma})`
        )
        .join(' · ');
      gameOverNote += ` Uma: ${umaLine}.`;
    } else if (enteringTiebreaker) {
      gameOverNote = ` Nobody at ${TARGET_POINTS.toLocaleString()} — tiebreaker ${nextRoundName} begins. Ends when someone reaches ${TARGET_POINTS.toLocaleString()}.`;
    }

    if (endType === 'win' && winnerSeats.length > 0) {
      const names = winnerSeats.map((s) => this.players[s].name).join(', ');
      const multi = winnerSeats.length > 1;
      const hanText = multi
        ? winnerSeats
            .map((s) => {
              const r = this.winResults.find((x) => x.seat === s);
              return `${this.players[s].name}: ${r?.hanText || formatWinPatterns(r?.patterns ?? [])}`;
            })
            .join(' · ')
        : this.winResults[0]?.hanText || formatWinPatterns(this.winPatterns);
      const scoreText = playerResults
        .filter((p) => p.pointDelta)
        .map((p) => `${p.name} ${formatPoints(p.pointDelta)}`)
        .join(', ');
      const potClaim = this.lastRiichiPotClaim;
      const potNote =
        potClaim && potClaim.amount > 0
          ? ` Riichi pot ${potClaim.amount} → ${this.players[potClaim.seat].name}.`
          : '';
      const dealerNote = gameOver
        ? ''
        : dealerKeeps
          ? `${this.players[previousDealer].name} stays dealer — next: ${nextRoundName}.`
          : `Dealer passes to ${this.players[next.nextDealer].name} — next: ${nextRoundName}.`;
      const pointsNote = scoreText ? ` Points: ${scoreText}.` : '';
      if (this.winMode === 'ron') {
        this.message = multi
          ? `${roundName} — ${names} win (ron) — ${hanText}.${pointsNote}${potNote} ${dealerNote}${gameOverNote}`
          : `${roundName} — ${names} wins (ron) — ${hanText}.${pointsNote}${potNote} ${dealerNote}${gameOverNote}`;
      } else if (this.winMode === 'tsumo') {
        this.message = `${roundName} — ${names} wins (tsumo) — ${hanText}.${pointsNote}${potNote} ${dealerNote}${gameOverNote}`;
      } else {
        this.message = `${roundName} — ${names} win — ${hanText}.${pointsNote}${potNote} ${dealerNote}${gameOverNote}`;
      }
    } else if (endType === 'abortive') {
      const label = ABORTIVE_LABELS[this.abortiveReason] ?? 'Abortive draw';
      const dealerNote = gameOver
        ? ''
        : `${this.players[previousDealer].name} stays dealer — next: ${nextRoundName}.`;
      const potNote =
        this.riichiPot > 0
          ? ` Riichi pot ${this.riichiPot} stays on the table.`
          : '';
      this.message = `${roundName} — ${label}.${potNote} ${dealerNote}${gameOverNote}`;
    } else if (nagashiSeats.length > 0) {
      const names = nagashiSeats.map((s) => this.players[s].name).join(', ');
      const scoreText = playerResults
        .filter((p) => p.pointDelta)
        .map((p) => `${p.name} ${formatPoints(p.pointDelta)}`)
        .join(', ');
      const pointsNote = scoreText ? ` Points: ${scoreText}.` : '';
      const dealerNote = gameOver
        ? ''
        : dealerKeeps
          ? `${this.players[previousDealer].name} stays dealer (ready) — next: ${nextRoundName}.`
          : `Dealer passes to ${this.players[next.nextDealer].name} — next: ${nextRoundName}.`;
      this.message = `${roundName} — nagashi mangan (流し満貫): ${names}.${pointsNote} ${dealerNote}${gameOverNote}`;
    } else {
      const scoreText = playerResults
        .filter((p) => p.pointDelta)
        .map((p) => `${p.name} ${formatPoints(p.pointDelta)}`)
        .join(', ');
      const pointsNote = scoreText ? ` Points: ${scoreText}.` : '';
      const dealerNote = gameOver
        ? ''
        : dealerKeeps
          ? `${this.players[previousDealer].name} stays dealer (ready) — next: ${nextRoundName}.`
          : `Dealer passes to ${this.players[next.nextDealer].name} — next: ${nextRoundName}.`;
      this.message = `${roundName} — exhaustive draw.${pointsNote} ${dealerNote}${gameOverNote}`;
    }
  }

  clearClaimWindow() {
    this.clearNobodyClaimLag();
    this.claimWindow = null;
    this.claimResponded = new Set();
    this.claimSubmissions = [];
  }

  clearNobodyClaimLag() {
    if (this.nobodyClaimLagTimer) {
      clearTimeout(this.nobodyClaimLagTimer);
      this.nobodyClaimLagTimer = null;
    }
    this.pendingNobodyClaimDefer = false;
  }

  /**
   * The room owns the lag timer so every discard path (manual, riichi
   * auto-discard after a draw/pass/kan, chained lags) is released.
   * `onAsyncUpdate` is set by the socket layer to push state to clients.
   */
  scheduleNobodyClaimClose(ms) {
    this.clearNobodyClaimLag();
    this.pendingNobodyClaimDefer = true;
    this.nobodyClaimLagTimer = setTimeout(() => {
      this.nobodyClaimLagTimer = null;
      if (!this.pendingNobodyClaimDefer) return;
      try {
        this.finishDeferredNobodyClaimClose();
      } catch (err) {
        console.error('deferred claim close failed', err);
      }
      this.onAsyncUpdate?.(this);
    }, ms);
  }

  /**
   * Finish a deferred close after an unclaimable discard's fake lag.
   * @returns {{ ok: boolean, closed?: boolean }}
   */
  finishDeferredNobodyClaimClose() {
    if (!this.pendingNobodyClaimDefer || !this.claimWindow) {
      this.pendingNobodyClaimDefer = false;
      return { ok: false };
    }
    this.pendingNobodyClaimDefer = false;
    this.nobodyClaimLagTimer = null;
    const result = this.tryCloseClaimWindow();
    return { ok: true, ...result };
  }

  /** Any call interrupts one-shot for every riichi player. */
  clearAllIppatsu() {
    for (const p of this.players) p.ippatsu = false;
  }

  /** Calls / kans end the first go-around — no further double riichi. */
  invalidateDoubleRiichi() {
    this.doubleRiichiEligible = false;
  }

  /**
   * End the hand as an abortive draw (流局).
   * @param {string} reason ABORTIVE.* id
   */
  abortiveDraw(reason) {
    this.abortiveReason = reason;
    this.pendingAbortive = null;
    this.clearClaimWindow();
    this.endRound('abortive');
    return { ok: true, closed: true, abortive: true, reason };
  }

  /** After a passed discard claim window — check automatic abortives. */
  checkAbortiveAfterPassedDiscard(fromSeat) {
    if (
      !this.isLimitlessAsura() &&
      isFiveWindAbort(this.players, this.doubleRiichiEligible)
    ) {
      return this.abortiveDraw(ABORTIVE.fiveWinds);
    }
    if (this.winners.length === 0 && isFiveRiichiAbort(this.players)) {
      return this.abortiveDraw(ABORTIVE.fiveRiichi);
    }
    if (
      !this.isLimitlessAsura() &&
      this.pendingAbortive?.type === ABORTIVE.fiveKans &&
      this.pendingAbortive.afterSeat === fromSeat
    ) {
      return this.abortiveDraw(ABORTIVE.fiveKans);
    }
    return null;
  }

  /**
   * Arm 五槓散了 when rinshan is empty and ≥3 players have kan/kin.
   * Triggers after that seat's next discard is not won.
   */
  armFiveKanAbort(seat) {
    if (this.isLimitlessAsura()) return;
    const rinshanRemaining = this.deadWall?.rinshanRemaining() ?? 0;
    const playersWithQuads = playersWithQuadCount(this.players);
    if (isFiveKanAbort({ rinshanRemaining, playersWithQuads })) {
      this.pendingAbortive = { type: ABORTIVE.fiveKans, afterSeat: seat };
    }
  }

  /** First-turn nine terminals / honors — player may declare abortive draw. */
  canAbortNineTerminals(seat) {
    if (this.phase !== 'playing' || seat < 0 || !this.players[seat]?.active) return false;
    if (this.claimWindow) return false;
    if (!this.doubleRiichiEligible) return false;
    if (seat !== this.currentTurn) return false;
    const p = this.players[seat];
    if (!p || p.riichi || p.melds.length > 0 || p.discards.length > 0) return false;
    if (!this.needsDiscard(seat)) return false;
    return hasNineTerminals(p.hand);
  }

  declareAbortNineTerminals(socketId) {
    const seat = this.seatForSocket(socketId);
    if (seat < 0) return { ok: false, error: 'Not in room.' };
    if (!this.canAbortNineTerminals(seat)) {
      return {
        ok: false,
        error: 'Nine terminals only on your first turn before any call (9+ distinct terminals/honors).',
      };
    }
    this.recordReplay('abortNineTerminals', { seat });
    return this.abortiveDraw(ABORTIVE.nineTerminals);
  }

  needsDiscard(seat) {
    if (this.phase !== 'playing' || seat !== this.currentTurn || !this.players[seat]?.active) return false;
    if (this.claimWindow) return false;
    if (this.mustDiscardAfterMeld != null && this.mustDiscardAfterMeld === seat) {
      return true;
    }
    if (this.openingDiscardPending && seat === this.dealerIndex) return true;
    if (this.drewThisTurn) return this.totalTiles(seat) > HAND_SIZE;
    return false;
  }

  /**
   * After chi / large chi / pon you must discard before any hand kan/kin.
   * After a called kan/kin, rinshan was drawn (drewThisTurn) — further kans/kins OK.
   */
  blockedSelfKanAfterCall(seat) {
    return this.mustDiscardAfterMeld === seat && !this.drewThisTurn;
  }

  canDraw(seat) {
    if (this.phase !== 'playing' || seat !== this.currentTurn || !this.players[seat]?.active) return false;
    if (this.claimWindow) return false;
    if (this.needsDiscard(seat)) return false;
    if (this.mustDiscardAfterMeld === seat) return false;
    return true;
  }

  /** Rinshan tiles still available for kan/kin supplements. */
  rinshanRemaining() {
    return this.deadWall?.rinshanRemaining() ?? 0;
  }

  /**
   * Supplement draws required for a claim kan/kin.
   * Fresh kin (5 tiles) needs 2; upgrading closed kan → kin needs 1; kan needs 1.
   */
  rinshanNeededForClaim(type, hand, melds, tile) {
    if (type === 'kan') return 1;
    if (type === 'kin') {
      if (canKin(hand, tile)) return 2;
      if (canKinFromClosedKan(melds, tile)) return 1;
      return 2;
    }
    return 0;
  }

  rinshanNeededForSelfMeld(kind) {
    if (kind === 'kin_closed') return 2;
    if (
      kind === 'ankan' ||
      kind === 'kakan' ||
      kind === 'kin_kakan' ||
      kind === 'kin_from_ankan'
    ) {
      return 1;
    }
    return 0;
  }

  canAffordRinshan(needed) {
    return needed <= 0 || this.rinshanRemaining() >= needed;
  }

  drawSupplements(count = 1) {
    if (!this.deadWall || count < 1) return [];

    const drawn = [];
    const flipped = [];

    for (let i = 0; i < count; i++) {
      const tile = this.deadWall.drawRinshan();
      if (!tile) break;
      drawn.push(tile);
      this.recordReplay('draw', {
        seat: this.currentTurn,
        tile: cloneTile(tile),
        source: 'rinshan',
      });

      // Kan wall: last live-wall tile moves into the dead wall for each rinshan draw.
      if (this.liveWall.length > 0) {
        this.deadWall.receiveFromLiveWall(this.liveWall.pop());
      }

      const indicator = this.deadWall.revealNextDora();
      if (indicator) {
        flipped.push(indicator);
        this.recordReplay('doraReveal', { tile: cloneTile(indicator) });
      }
    }

    if (drawn.length === 0) {
      this.message = 'Rinshan exhausted — no supplement tile.';
    } else if (flipped.length > 0) {
      const names = flipped.map(tileLabel).join(', ');
      const plural = drawn.length > 1 ? 's' : '';
      this.message = `Supplement draw${plural} (${drawn.length}). New indicator${flipped.length > 1 ? 's' : ''}: ${names}.`;
    } else {
      this.message = `Supplement draw (${drawn.length} tile${drawn.length > 1 ? 's' : ''}) from dead wall.`;
    }

    return drawn;
  }

  drawSupplement() {
    const tiles = this.drawSupplements(1);
    return tiles[0] ?? null;
  }

  drawForSeat(seat) {
    if (this.phase !== 'playing') {
      return { ok: false, error: 'Game not started.' };
    }
    if (!this.canDraw(seat)) {
      return { ok: false, error: 'Cannot draw now.' };
    }
    if (this.liveWall.length === 0) {
      this.endRound('exhaustive');
      return { ok: false, error: 'Live wall exhausted — exhaustive draw.', roundEnded: true };
    }

    const tile = this.liveWall.shift();
    const player = this.players[seat];
    player.hand.push(tile);
    player.hand = sortHand(player.hand);
    player.temporaryFuriten = false;
    this.lastDrawn = tile.id;
    this.lastDrawWasRinshan = false;
    this.drewThisTurn = true;
    this.recordReplay('draw', {
      seat,
      tile: cloneTile(tile),
      source: 'live',
    });
    return { ok: true, tile };
  }

  /** Draw from live wall when this seat is due to draw. */
  autoDrawForSeat(seat) {
    if (!this.canDraw(seat)) return null;

    const result = this.drawForSeat(seat);
    if (result.roundEnded) return result;
    if (result.ok) {
      this.message = `${this.players[seat].name} drew from the wall.`;
      const autoDiscard = this.tryAutoRiichiDiscard();
      if (autoDiscard) return { ...result, autoDiscarded: true, discard: autoDiscard };
    }
    return result;
  }

  /** True if the riichi player still has a meaningful choice (tsumo / kan / declare discard / undo). */
  riichiMustActManually(seat) {
    const p = this.players[seat];
    if (!p?.riichi) return false;
    if (p.riichiFirstDiscard) return true;
    if (this.canUndoRiichi(seat)) return true;
    if (this.canTsumo(seat)) return true;
    const opts = this.selfMeldOptions(seat);
    return (
      (opts.ankan?.length ?? 0) > 0 ||
      (opts.kinClosed?.length ?? 0) > 0 ||
      (opts.kakan?.length ?? 0) > 0 ||
      (opts.kinKakan?.length ?? 0) > 0 ||
      (opts.kinFromAnkan?.length ?? 0) > 0
    );
  }

  /**
   * After draw (or rinshan), if riichi is locked with only tsumogiri available, discard automatically.
   */
  tryAutoRiichiDiscard() {
    if (this.phase !== 'playing' || this.claimWindow) return null;
    const seat = this.currentTurn;
    const p = this.players[seat];
    if (!p?.riichi) return null;
    if (!this.needsDiscard(seat)) return null;
    if (this.riichiMustActManually(seat)) return null;
    if (!this.lastDrawn) return null;

    return this.discardFromSeat(seat, this.lastDrawn);
  }

  /** Draw automatically when a player's turn begins and they need a tile. */
  autoDrawForCurrentTurn() {
    return this.autoDrawForSeat(this.currentTurn);
  }

  openClaimWindow(tile, fromSeat, opts = {}) {
    const reason = opts.reason ?? 'discard';
    this.claimWindow = {
      tile,
      fromSeat,
      reason,
      kanKind: opts.kanKind ?? null,
      meldIndex: opts.meldIndex ?? null,
      previousAddedTileId: opts.previousAddedTileId ?? null,
      /** True when this discard is the sideways riichi declaration tile. */
      riichiDeclaration: !!opts.riichiDeclaration,
    };
    this.claimResponded = new Set();
    this.claimSubmissions = [];
    const kanLabel =
      opts.kanKind === 'ankan'
        ? 'ankan'
        : opts.kanKind === 'kin_kakan'
          ? 'kin'
          : 'kakan';
    this.message =
      reason === 'chankan'
        ? `Chankan open on ${this.players[fromSeat].name}'s ${kanLabel}.`
        : `Claims open on ${this.players[fromSeat].name}'s discard.`;
    return this.autoPassWithNoClaims();
  }

  /** Auto-pass any player who has no valid claim on the current discard */
  autoPassWithNoClaims() {
    if (!this.claimWindow) return { closed: false };
    const { fromSeat, reason } = this.claimWindow;
    let added = false;

    for (let s = 0; s < PLAYER_COUNT; s++) {
      if (s === fromSeat || !this.players[s].active || this.claimResponded.has(s)) continue;
      if (this.claimsForSeat(s).length === 0) {
        this.claimResponded.add(s);
        this.recordReplay('passClaim', { seat: s, auto: true });
        added = true;
      }
    }

    if (!added) return { closed: false };

    const responders = PLAYER_COUNT - 1;
    const nobodyCanClaim =
      reason === 'discard' &&
      this.claimSubmissions.length === 0 &&
      this.claimResponded.size >= responders;

    // 10%: hold the window briefly so instant pass isn't a tell.
    if (nobodyCanClaim && Math.random() < NOBODY_CLAIM_LAG_CHANCE) {
      const ms = nobodyClaimLagMs();
      this.scheduleNobodyClaimClose(ms);
      this.message = `${this.players[fromSeat].name} discarded.`;
      return {
        closed: false,
        deferCloseMs: ms,
        nobodyCanClaim: true,
      };
    }

    return this.tryCloseClaimWindow();
  }

  /** Highest priority among claims already submitted this window (−1 if none). */
  highestSubmittedClaimPriority() {
    let best = -1;
    for (const s of this.claimSubmissions) {
      best = Math.max(best, claimPriority(s.type));
    }
    return best;
  }

  /**
   * After a higher-priority claim is locked in, auto-pass anyone whose remaining
   * options are all lower priority (buttons removed via claimsForSeat filter).
   */
  autoPassDominatedClaimers() {
    if (!this.claimWindow) return false;
    if (this.highestSubmittedClaimPriority() < 0) return false;
    const { fromSeat } = this.claimWindow;
    let added = false;
    for (let s = 0; s < PLAYER_COUNT; s++) {
      if (s === fromSeat || !this.players[s].active || this.claimResponded.has(s)) continue;
      if (this.claimsForSeat(s).length === 0) {
        this.claimResponded.add(s);
        this.recordReplay('passClaim', { seat: s, auto: true });
        added = true;
      }
    }
    return added;
  }

  removeLastDiscard(fromSeat, triggerSidewaysChain = true) {
    const discards = this.players[fromSeat].discards;
    const entry = discards.pop();
    if (!entry) return null;
    const tile = entry.tile ?? entry;
    const sideways = !!entry.sideways;
    if (triggerSidewaysChain && sideways && this.players[fromSeat].riichi) {
      this.players[fromSeat].riichiSidewaysPending = true;
    }
    return tile;
  }

  markWinningDiscard(fromSeat, winnerSeats) {
    const discards = this.players[fromSeat]?.discards ?? [];
    const entry = discards[discards.length - 1];
    if (!entry) return null;
    entry.ronWin = true;
    entry.ronWinners = [...winnerSeats];
    this.clearClaimWindow();
    return entry.tile ?? entry;
  }

  /**
   * Nagashi mangan: every discard is a terminal/honor, none were called,
   * and the river is non-empty.
   */
  isNagashiMangan(seat) {
    const p = this.players[seat];
    if (!p || p.discardCalled) return false;
    if (!p.discards.length) return false;
    return p.discards.every((d) => isTerminalOrHonorTile(d.tile ?? d));
  }

  /**
   * At round end, winners (win), ready hands (exhaustive), nagashi winners only
   * when nagashi mangan fires, or all seats on five-riichi abortive.
   */
  shouldRevealHandAtRoundEnd(seat) {
    if (this.phase !== 'roundEnd' || !this.roundSummary) return false;
    const pr = this.roundSummary.players?.find((r) => r.seat === seat);
    if (!pr) return false;
    if (this.roundSummary.endType === 'abortive') {
      return this.roundSummary.abortiveReason === ABORTIVE.fiveRiichi;
    }
    if (this.roundSummary.endType === 'win') return !!pr.won;
    if (this.roundSummary.nagashi) return !!(pr.nagashi || pr.won);
    if (this.isLimitlessAsura() && this.roundSummary.endType === 'exhaustive') {
      return !!(pr.won || pr.ready);
    }
    return !!pr.ready;
  }

  /** Per-viewer round summary with concealed hands / ready flags redacted. */
  roundSummaryForSeat(viewerSeat) {
    const summary = this.roundSummary;
    if (!summary) return null;
    if (this.phase !== 'roundEnd') return summary;
    return {
      ...summary,
      players: summary.players.map((pr) => {
        const reveal = this.shouldRevealHandAtRoundEnd(pr.seat);
        const isViewer = pr.seat === viewerSeat;
        return {
          ...pr,
          hand: reveal || isViewer ? pr.hand : [],
          wildcard: reveal || isViewer ? pr.wildcard : null,
          // On a win, don't advertise ready/noten of non-winners.
          ready:
            summary.endType === 'win' && !pr.won && !isViewer ? null : pr.ready,
        };
      }),
    };
  }

  finishClaimWindowAdvanceTurn(fromSeat) {
    const abort = this.checkAbortiveAfterPassedDiscard(fromSeat);
    if (abort) return abort;
    this.clearClaimWindow();
    this.currentTurn = this.nextActiveSeat(fromSeat);
    if (this.currentTurn == null) return { closed: true, passed: true };
    const drawResult = this.autoDrawForCurrentTurn();
    if (!drawResult?.ok && !drawResult?.roundEnded) {
      const next = this.players[this.currentTurn];
      this.message = `${next.name}'s turn.`;
    }
    return { closed: true, passed: true };
  }

  tryCloseClaimWindow() {
    if (!this.claimWindow) return { closed: false };
    const { tile, fromSeat, reason } = this.claimWindow;
    const responders = this.activeSeatList().filter((seat) => seat !== fromSeat).length;

    if (this.claimResponded.size < responders) return { closed: false };

    this.markMissedRonOpportunities(fromSeat, tile);

    if (this.claimSubmissions.length > 0) {
      const resolved = resolveClaims(this.claimSubmissions, fromSeat, PLAYER_COUNT);
      if (!resolved) {
        if (reason === 'chankan') return this.completeKanAfterChankanPass();
        return this.finishClaimWindowAdvanceTurn(fromSeat);
      }
      if (resolved.kind === 'wins') {
        return this.applyMultipleRon(resolved.submissions);
      }
      return this.applyClaim(resolved.submission);
    }

    if (reason === 'chankan') return this.completeKanAfterChankanPass();
    return this.finishClaimWindowAdvanceTurn(fromSeat);
  }

  /**
   * Options for han / yaku checks for a seat.
   * @param {number} seat
   * @param {'ron'|'tsumo'} mode
   * @param {import('./tiles.js').Tile|null} winTile
   */
  hanOptionsForSeat(seat, mode, winTile = null, extra = {}, wildcard = null) {
    const p = this.players[seat];
    const wallEmpty = this.liveWall.length === 0;
    const rinshan = mode === 'tsumo' && this.lastDrawWasRinshan;
    const chankan =
      extra.chankan ??
      (mode === 'ron' && this.claimWindow?.reason === 'chankan');
    return {
      mode,
      winTile: mode === 'ron' ? winTile : this.winTileForTsumo(seat) ?? winTile,
      riichi: !!p.riichi,
      doubleRiichi: !!(p.riichi && p.doubleRiichi),
      ippatsu: !!(p.riichi && p.ippatsu),
      seat,
      dealerIndex: this.dealerIndex,
      roundWindIndex: this.roundWindIndex,
      dora: 0,
      uraDora: 0,
      rinshan,
      chankan: !!chankan,
      haitei: mode === 'tsumo' && wallEmpty && !rinshan,
      houtei: mode === 'ron' && wallEmpty && !chankan,
      tenhou: this.isTenhou(seat, mode),
      chiihou: this.isChiihou(seat, mode),
      wildcard,
    };
  }

  /** Dealer wins on the dealt hand before the first discard. */
  isTenhou(seat, mode) {
    if (mode !== 'tsumo' || seat !== this.dealerIndex) return false;
    const p = this.players[seat];
    return (
      !!this.openingDiscardPending &&
      p.discards.length === 0 &&
      p.melds.length === 0
    );
  }

  /** Non-dealer wins on their first draw with no prior calls/kans. */
  isChiihou(seat, mode) {
    if (mode !== 'tsumo' || seat === this.dealerIndex) return false;
    const p = this.players[seat];
    if (p.discards.length > 0 || p.melds.length > 0) return false;
    if (!this.doubleRiichiEligible) return false;
    return !!(this.drewThisTurn && this.lastDrawn);
  }

  winTileForTsumo(seat) {
    const p = this.players[seat];
    if (!this.lastDrawn) return null;
    return p.hand.find((t) => t.id === this.lastDrawn) ?? null;
  }

  /** Shape + yaku (dora does not count). */
  canWinWithYaku(seat, mode, winTile = null, extra = {}) {
    const p = this.players[seat];
    const tile = mode === 'ron' ? winTile : null;
    if (!canWin(p.hand, p.melds, tile, p.wildcard)) return false;
    return hasYaku(
      p.hand,
      p.melds,
      this.hanOptionsForSeat(seat, mode, winTile, extra, p.wildcard)
    );
  }

  /**
   * Chankan eligibility: win-only. Ankan may only be robbed by kokushi.
   */
  canRobKan(seat, tile) {
    if (!this.claimWindow || this.claimWindow.reason !== 'chankan') return false;
    if (this.claimWindow.kanKind === 'ankan') {
      const patterns = getWinPatterns(
        this.players[seat].hand,
        this.players[seat].melds,
        tile,
        this.players[seat].wildcard
      );
      if (!patterns.includes('thirteenOrphans')) return false;
    }
    return this.canWinWithYaku(seat, 'ron', tile, { chankan: true });
  }

  /**
   * Furiten uses shape waits only (not yaku). Passing a yakuless complete tile
   * still sets temporary furiten; discard furiten includes yakuless waits.
   */
  isSeatFuriten(seat) {
    const p = this.players[seat];
    return isFuriten(p, p.hand, p.melds, null, p.wildcard);
  }

  seatFuritenReason(seat) {
    const p = this.players[seat];
    return furitenReason(p, p.hand, p.melds, null, p.wildcard);
  }

  /** True if this tile completes the hand shape (yaku not required). */
  completesHandShape(seat, tile, { chankan = false, kanKind = null } = {}) {
    const p = this.players[seat];
    if (chankan && kanKind === 'ankan') {
      return getWinPatterns(p.hand, p.melds, tile, p.wildcard).includes('thirteenOrphans');
    }
    return canWin(p.hand, p.melds, tile, p.wildcard);
  }

  markMissedRonOpportunities(fromSeat, tile) {
    const chankan = this.claimWindow?.reason === 'chankan';
    const kanKind = this.claimWindow?.kanKind ?? null;
    for (let s = 0; s < PLAYER_COUNT; s++) {
      if (s === fromSeat || !this.players[s].active) continue;
      const p = this.players[s];
      // Shape only: skipping because of no yaku (or declining a real win) both furiten.
      if (!this.completesHandShape(s, tile, { chankan, kanKind })) continue;
      if (this.isSeatFuriten(s)) continue;
      const declaredWin = this.claimSubmissions.some(
        (sub) => sub.seat === s && sub.type === 'win'
      );
      if (declaredWin) continue;
      p.temporaryFuriten = true;
      if (p.riichi) p.riichiFuriten = true;
    }
  }

  /** Return a riichi stick when a declaration ron invalidates the declaration. */
  cancelFailedRiichiDeclaration(fromSeat) {
    const p = this.players[fromSeat];
    if (!p?.riichi) return false;
    p.points += RIICHI_BET;
    this.riichiPot = Math.max(0, this.riichiPot - RIICHI_BET);
    this.handPayments = this.handPayments.filter(
      (payment) => !(payment.type === 'riichi' && payment.fromSeat === fromSeat)
    );
    p.riichi = false;
    p.riichiStickOnTable = false;
    p.riichiFirstDiscard = false;
    p.riichiPendingUndo = false;
    p.riichiDrewOnDeclare = false;
    p.riichiSidewaysPending = false;
    p.doubleRiichi = false;
    p.ippatsu = false;
    return true;
  }

  /**
   * @param {Array<{ seat: number, patterns: string[] }>} results
   * @param {'ron'|'tsumo'} mode
   * @param {number|null} fromSeat
   * @param {import('./tiles.js').Tile|null} winTile
   */
  finishWins(results, mode, fromSeat = null, winTile = null) {
    if (!results.length) return { closed: false, error: 'No winners.' };

    const chankan = this.claimWindow?.reason === 'chankan';
    const declarationRon =
      mode === 'ron' &&
      !chankan &&
      !!this.claimWindow?.riichiDeclaration &&
      fromSeat != null;
    this.clearClaimWindow();

    let winnerSeats = results.map((r) => r.seat);
    if (mode === 'ron' && fromSeat != null) {
      winnerSeats = [...winnerSeats].sort((a, b) => {
        const da = (a - fromSeat + PLAYER_COUNT) % PLAYER_COUNT;
        const db = (b - fromSeat + PLAYER_COUNT) % PLAYER_COUNT;
        return da - db;
      });
      results = winnerSeats.map((seat) => results.find((r) => r.seat === seat));
    }

    const activeSeats = new Set(this.activeSeatList());
    const remainingAfterRon = [...activeSeats].filter(
      (seat) => !winnerSeats.includes(seat)
    );
    const returnDeclarationStick =
      declarationRon &&
      (!this.isLimitlessAsura() ||
        (remainingAfterRon.length === 1 && remainingAfterRon[0] === fromSeat));
    if (returnDeclarationStick) this.cancelFailedRiichiDeclaration(fromSeat);

    const declarationStickStaysInPot =
      declarationRon && this.isLimitlessAsura() && !returnDeclarationStick;
    const previousWinners = this.isLimitlessAsura() ? [...this.winners] : [];
    const firstWinner = winnerSeats[0];
    this.winners = [...previousWinners, ...winnerSeats];
    this.winner = this.winners[0];
    const priorModes = this.winResults.map((result) => result.mode).filter(Boolean);
    this.winMode = [...new Set([...priorModes, mode])].length > 1 ? 'multi' : mode;
    this.winPatterns = results[0].patterns;
    this.currentTurn = firstWinner;
    this.mustDiscardAfterMeld = null;
    this.kuikaeBan = null;

    if (mode === 'tsumo') {
      const player = this.players[this.winner];
      this.winTile = this.lastDrawn
        ? (player.hand.find((t) => t.id === this.lastDrawn) ?? null)
        : null;
      this.winFromSeat = null;
    } else {
      this.winTile = winTile;
      this.winFromSeat = fromSeat;
    }

    const doraIndicators = this.deadWall?.revealedDoraIndicators() ?? [];
    const anyRiichi = winnerSeats.some((s) => this.players[s].riichi);
    const uraIndicators = anyRiichi ? (this.deadWall?.revealedUraDora() ?? []) : [];

    const wallEmpty = this.liveWall.length === 0;
    const rinshan = mode === 'tsumo' && this.lastDrawWasRinshan;
    const haitei = mode === 'tsumo' && wallEmpty && !rinshan;
    const houtei = mode === 'ron' && wallEmpty && !chankan;

    const scoredResults = results.map((r) => {
      const player = this.players[r.seat];
      const doraCounts = countDora(
        player.hand,
        player.melds,
        mode === 'ron' ? this.winTile : null,
        doraIndicators,
        player.riichi ? uraIndicators : []
      );
      const han = calculateHan(player.hand, player.melds, {
        mode,
        winTile: this.winTile,
        riichi: !!player.riichi,
        ippatsu: !!(player.riichi && player.ippatsu),
        doubleRiichi: !!(player.riichi && player.doubleRiichi),
        seat: r.seat,
        dealerIndex: this.dealerIndex,
        roundWindIndex: this.roundWindIndex,
        dora: player.wildcard ? 0 : doraCounts.dora,
        uraDora: player.wildcard ? 0 : doraCounts.uraDora,
        wildcard: player.wildcard,
        doraIndicators,
        uraIndicators,
        rinshan,
        chankan: mode === 'ron' && chankan,
        haitei,
        houtei,
        tenhou: this.isTenhou(r.seat, mode),
        chiihou: this.isChiihou(r.seat, mode),
      });
      const scored = scoreWin({
        mode,
        winnerSeat: r.seat,
        dealerIndex: this.dealerIndex,
        fromSeat: mode === 'ron' ? fromSeat : null,
        han: han.isYakuman ? han.han : han.totalHan,
        fu: han.fu,
        isYakuman: han.isYakuman,
        yakuman: han.yakuman || 1,
        honba: this.isLimitlessAsura() ? 0 : this.repeatCount,
        activeSeats: this.isLimitlessAsura() ? activeSeats : null,
        playerCount: PLAYER_COUNT,
      });
      return {
        seat: r.seat,
        mode,
        winTile: mode === 'tsumo' ? this.winTile : winTile,
        fromSeat: mode === 'ron' ? fromSeat : null,
        patterns: r.patterns,
        doraCount: han.dora + han.uraDora,
        han,
        hanText: formatHanResult(han),
        basicPoints: scored.basic,
        payments: scored.payments,
        pointDelta: scored.deltas[r.seat],
        score: scored,
      };
    });
    this.doraCount = scoredResults.reduce((sum, r) => sum + r.doraCount, 0);

    const merged = mergeScoreDeltas(
      scoredResults.map((r) => r.score),
      PLAYER_COUNT
    );

    // Riichi pot — head bump: closest winner to discarder (or sole tsumo winner)
    const pot = Math.max(
      0,
      this.riichiPot - (declarationStickStaysInPot ? RIICHI_BET : 0)
    );
    let potSeat = null;
    if (pot > 0) {
      potSeat =
        mode === 'ron' && fromSeat != null
          ? headBumpWinner(winnerSeats, fromSeat, PLAYER_COUNT)
          : firstWinner;
      if (potSeat != null) {
        merged.deltas[potSeat] += pot;
        this.riichiPot -= pot;

        // A collected pot removes the visible declaration sticks. In Asura,
        // the declaration stick that caused a ron remains visible only when
        // it is being carried into the next winner's pot.
        for (let seat = 0; seat < PLAYER_COUNT; seat++) {
          if (declarationStickStaysInPot && seat === fromSeat) continue;
          if (this.players[seat].riichi) {
            this.players[seat].riichiStickOnTable = false;
          }
        }
      }
    }
    this.handPayments.push(
      ...scoredResults.flatMap((result) =>
        (result.payments ?? []).map((payment) => ({
          fromSeat: payment.fromSeat ?? payment.from,
          toSeat: payment.toSeat ?? payment.to,
          amount: payment.amount,
          type: mode === 'ron' ? 'ron' : 'tsumo',
        }))
      )
    );
    if (potSeat != null && pot > 0) {
      this.handPayments.push({
        fromSeat: null,
        toSeat: potSeat,
        amount: pot,
        type: 'riichi-pot',
      });
    }
    this.lastRiichiPotClaim = potSeat != null && pot > 0 ? { seat: potSeat, amount: pot } : null;
    if (this.lastRiichiPotClaim) this.riichiPotClaims.push({ ...this.lastRiichiPotClaim });

    this.lastPointDeltas = this.lastPointDeltas
      ? this.lastPointDeltas.map((delta, i) => delta + merged.deltas[i])
      : merged.deltas;
    for (let i = 0; i < PLAYER_COUNT; i++) {
      this.players[i].points += merged.deltas[i];
    }

    for (const seat of winnerSeats) {
      const player = this.players[seat];
      player.active = false;
      player.won = true;
      player.winningTile = mode === 'tsumo' ? this.winTile : null;
    }
    this.winResults = this.isLimitlessAsura()
      ? [...this.winResults, ...scoredResults]
      : scoredResults;
    this.clearAllIppatsu();
    this.invalidateDoubleRiichi();
    this.openingDiscardPending = false;

    this.recordReplay('win', {
      mode,
      seats: winnerSeats,
      fromSeat: mode === 'ron' ? fromSeat : null,
      winTile: cloneTile(this.winTile),
    });
    // In Asura a bust ends the whole game at once — no further wins this hand.
    const anyoneBusted = this.players.some((p) => p.points < 0);
    if (
      this.isLimitlessAsura() &&
      !anyoneBusted &&
      this.winners.length < PLAYER_COUNT - 1 &&
      this.activeSeatList().length > 0
    ) {
      // Ron is a tile call in Limitless Asura: resume after the caller's seat,
      // rather than continuing after the discarder as though the claim passed.
      const afterSeat = firstWinner;
      this.currentTurn = this.nextActiveSeat(afterSeat);
      this.mustDiscardAfterMeld = null;
      this.kuikaeBan = null;
      this.drewThisTurn = false;
      this.lastDrawn = null;
      this.lastDrawWasRinshan = false;
      if (this.currentTurn != null) this.autoDrawForCurrentTurn();
      const names = winnerSeats.map((seat) => this.players[seat].name).join(', ');
      const remaining = this.activeSeatList().length;
      this.message = `${names} won — ${remaining} player${remaining === 1 ? '' : 's'} remain. Play continues.`;
      return { closed: true, win: true, ongoing: true, seats: winnerSeats, seat: firstWinner };
    }
    this.endRound('win', this.winners);
    return { closed: true, win: true, seats: this.winners, seat: this.winner };
  }

  finishWin(seat, mode, patterns, fromSeat = null, winTile = null) {
    return this.finishWins([{ seat, patterns }], mode, fromSeat, winTile);
  }

  applyMultipleRon(submissions) {
    const { tile, fromSeat, reason } = this.claimWindow;
    const chankan = reason === 'chankan';
    const results = [];
    for (const sub of submissions) {
      const player = this.players[sub.seat];
      if (this.isSeatFuriten(sub.seat)) continue;
      const canWinSeat = chankan
        ? this.canRobKan(sub.seat, tile)
        : this.canWinWithYaku(sub.seat, 'ron', tile);
      if (!canWinSeat) continue;
      const patterns = getWinPatterns(player.hand, player.melds, tile, player.wildcard);
      if (patterns.length === 0) continue;
      if (chankan && this.claimWindow.kanKind === 'ankan') {
        if (!patterns.includes('thirteenOrphans')) continue;
      }
      results.push({ seat: sub.seat, patterns });
    }
    if (results.length === 0) {
      if (chankan) return this.completeKanAfterChankanPass();
      const other = this.claimSubmissions.filter((s) => s.type !== 'win');
      const resolved = resolveClaims(other, fromSeat, PLAYER_COUNT);
      if (resolved?.kind === 'claim') {
        return this.applyClaim(resolved.submission);
      }
      this.finishClaimWindowAdvanceTurn(fromSeat);
      return { closed: true, passed: true };
    }
    let winTile = tile;
    if (chankan) {
      winTile = this.stealKanTileForChankan() ?? tile;
    } else {
      if (this.isLimitlessAsura()) {
        this.markWinningDiscard(fromSeat, results.map((r) => r.seat));
      } else {
        this.removeLastDiscard(fromSeat, false);
      }
    }
    return this.finishWins(results, 'ron', fromSeat, winTile);
  }

  applyClaim(submission) {
    const { tile, fromSeat } = this.claimWindow;
    const seat = submission.seat;
    const player = this.players[seat];
    const type = submission.type;

    if (type === 'win') {
      if (this.isSeatFuriten(seat)) {
        return { closed: false, error: 'Furiten — cannot ron.' };
      }
      const chankan = this.claimWindow.reason === 'chankan';
      const canWinSeat = chankan
        ? this.canRobKan(seat, tile)
        : this.canWinWithYaku(seat, 'ron', tile);
      if (!canWinSeat) {
        return { closed: false, error: 'Need at least one yaku to win.' };
      }
      const patterns = getWinPatterns(player.hand, player.melds, tile, player.wildcard);
      if (patterns.length === 0) {
        return { closed: false, error: 'Not a winning hand.' };
      }
      let winTile = tile;
      if (chankan) {
        winTile = this.stealKanTileForChankan() ?? tile;
      } else {
        if (this.isLimitlessAsura()) this.markWinningDiscard(fromSeat, [seat]);
        else this.removeLastDiscard(fromSeat, false);
      }
      return this.finishWin(seat, 'ron', patterns, fromSeat, winTile);
    }

    const removed = this.removeLastDiscard(fromSeat);
    if (!removed || removed.id !== tile.id) {
      return { closed: false, error: 'Discard already taken.' };
    }
    this.players[fromSeat].discardCalled = true;

    let meldTiles = [];
    let upgradedExisting = false;
    /** @type {import('./tiles.js').Tile[]} */
    let kuikaeHandUsed = [];

    if (type === 'chi' || type === 'largeChi') {
      const opts = findChiOptions(player.hand, tile);
      const opt = opts[submission.optionIndex ?? submission.chiIndex ?? 0];
      if (!opt) return { closed: false, error: 'Invalid chi.' };
      if (!claimOptionAllowsDiscard(player.hand, type, opt, tile)) {
        return { closed: false, error: 'Swap calling not allowed.' };
      }
      for (const id of opt.handTileIds) {
        const i = player.hand.findIndex((t) => t.id === id);
        if (i < 0) return { closed: false, error: 'Chi tiles missing.' };
        meldTiles.push(player.hand.splice(i, 1)[0]);
      }
      meldTiles.push(tile);
      kuikaeHandUsed = meldTiles.filter((t) => t.id !== tile.id);
    } else if (type === 'pon') {
      const opts = findPonOptions(player.hand, tile);
      const opt =
        opts[submission.optionIndex ?? 0] ??
        (submission.handTileIds
          ? opts.find(
              (o) =>
                o.handTileIds.length === submission.handTileIds.length &&
                submission.handTileIds.every((id) => o.handTileIds.includes(id))
            )
          : null);
      if (!opt) return { closed: false, error: 'Cannot pon.' };
      if (!claimOptionAllowsDiscard(player.hand, type, opt, tile)) {
        return { closed: false, error: 'Swap calling not allowed.' };
      }
      for (const id of opt.handTileIds) {
        const idx = player.hand.findIndex((t) => t.id === id);
        if (idx < 0) return { closed: false, error: 'Pon tiles missing.' };
        meldTiles.push(player.hand.splice(idx, 1)[0]);
      }
      meldTiles.push(tile);
      kuikaeHandUsed = meldTiles.filter((t) => t.id !== tile.id);
    } else if (type === 'kan') {
      if (!this.canAffordRinshan(1)) {
        return { closed: false, error: 'Not enough rinshan tiles for kan.' };
      }
      const opts = findKanCallOptions(player.hand, tile);
      const opt = opts[submission.optionIndex ?? 0];
      if (!opt) return { closed: false, error: 'Cannot kan.' };
      if (!claimOptionAllowsDiscard(player.hand, type, opt, tile)) {
        return { closed: false, error: 'Swap calling not allowed.' };
      }
      for (const id of opt.handTileIds) {
        const idx = player.hand.findIndex((t) => t.id === id);
        if (idx < 0) return { closed: false, error: 'Kan tiles missing.' };
        meldTiles.push(player.hand.splice(idx, 1)[0]);
      }
      meldTiles.push(tile);
      kuikaeHandUsed = meldTiles.filter((t) => t.id !== tile.id);
    } else if (type === 'kin') {
      const matches = tilesMatching(player.hand, tile);
      const needed = matches.length >= 4 ? 2 : 1;
      if (!this.canAffordRinshan(needed)) {
        return { closed: false, error: 'Not enough rinshan tiles for kin.' };
      }
      if (matches.length >= 4) {
        const opts = findKinCallOptions(player.hand, tile);
        const opt = opts[submission.optionIndex ?? 0];
        if (!opt) return { closed: false, error: 'Cannot kin.' };
        if (!claimOptionAllowsDiscard(player.hand, type, opt, tile)) {
          return { closed: false, error: 'Swap calling not allowed.' };
        }
        for (const id of opt.handTileIds) {
          const idx = player.hand.findIndex((t) => t.id === id);
          if (idx < 0) return { closed: false, error: 'Kin tiles missing.' };
          meldTiles.push(player.hand.splice(idx, 1)[0]);
        }
        meldTiles.push(tile);
        kuikaeHandUsed = meldTiles.filter((t) => t.id !== tile.id);
      } else {
        const meldIdx = findClosedKanMeldIndex(player.melds, tile);
        if (meldIdx < 0) return { closed: false, error: 'Cannot kin.' };
        const forbidden = kuikaeForbiddenKeys(type, [], tile);
        if (!player.hand.some((t) => !forbidden.has(tileKey(t)))) {
          return { closed: false, error: 'Swap calling not allowed.' };
        }
        const meld = player.melds[meldIdx];
        meld.tiles.push(tile);
        meld.type = 'kin';
        meld.open = true;
        meld.fromSeat = fromSeat;
        meld.calledTileId = tile.id;
        upgradedExisting = true;
        kuikaeHandUsed = [];
      }
    } else {
      return { closed: false, error: 'Unknown claim.' };
    }

    if (!upgradedExisting) {
      player.melds.push({
        type,
        tiles: meldTiles,
        open: true,
        fromSeat,
        calledTileId: tile.id,
      });
    }

    this.clearClaimWindow();
    this.clearAllIppatsu();
    this.invalidateDoubleRiichi();
    this.currentTurn = seat;
    this.drewThisTurn = false;
    this.openingDiscardPending = false;
    this.lastDrawn = null;
    this.lastDrawWasRinshan = false;

    const labels = {
      chi: 'Chi',
      largeChi: 'Large chi',
      pon: 'Pon',
      kan: 'Kan',
      kin: upgradedExisting ? 'Kin 檎 (from closed kan)' : 'Kin 檎',
    };
    if (type === 'kan' || type === 'kin') {
      const supplementCount = type === 'kin' && !upgradedExisting ? 2 : 1;
      const supplements = this.drawSupplements(supplementCount);
      for (const t of supplements) {
        player.hand.push(t);
      }
      if (supplements.length > 0) {
        player.hand = sortHand(player.hand);
        player.temporaryFuriten = false;
        this.lastDrawn = supplements[supplements.length - 1].id;
        this.lastDrawWasRinshan = true;
        this.drewThisTurn = true;
      }
      this.armFiveKanAbort(seat);
    }

    this.mustDiscardAfterMeld = seat;
    this.kuikaeBan = {
      seat,
      keys: kuikaeForbiddenKeys(type, kuikaeHandUsed, tile),
    };
    this.message = `${player.name} declared ${labels[type]}. Discard a tile.`;

    this.recordReplay('claimApplied', {
      seat,
      claimType: type,
      fromSeat,
      tile: cloneTile(tile),
      optionIndex: submission.optionIndex ?? submission.chiIndex ?? null,
      handTileIds: submission.handTileIds ?? null,
    });
    return { closed: true, claim: type, seat };
  }

  passClaim(socketId) {
    const seat = this.seatForSocket(socketId);
    if (seat < 0) return { ok: false, error: 'Not in room.' };
    if (!this.claimWindow) return { ok: false, error: 'No claim window.' };
    if (seat === this.claimWindow.fromSeat) {
      return { ok: false, error: 'Discarder cannot pass.' };
    }
    if (this.claimResponded.has(seat)) {
      return { ok: true, closed: false };
    }
    this.claimResponded.add(seat);
    this.recordReplay('passClaim', { seat });
    const result = this.tryCloseClaimWindow();
    return { ok: true, ...result };
  }

  claim(socketId, { type, chiIndex, optionIndex }) {
    const seat = this.seatForSocket(socketId);
    if (seat < 0) return { ok: false, error: 'Not in room.' };
    if (!this.claimWindow) return { ok: false, error: 'No claim window.' };
    if (seat === this.claimWindow.fromSeat) {
      return {
        ok: false,
        error:
          this.claimWindow.reason === 'chankan'
            ? 'Cannot claim your own kan.'
            : 'Cannot claim your own discard.',
      };
    }
    if (this.players[seat].riichi && type !== 'win') {
      return { ok: false, error: 'Riichi — hand locked (win only).' };
    }
    if (this.claimWindow.reason === 'chankan' && type !== 'win') {
      return { ok: false, error: 'Chankan — win only.' };
    }

    if (type === 'kan' || type === 'kin') {
      const needed = this.rinshanNeededForClaim(
        type,
        this.players[seat].hand,
        this.players[seat].melds,
        this.claimWindow.tile
      );
      if (!this.canAffordRinshan(needed)) {
        return {
          ok: false,
          error: `Not enough rinshan tiles for ${type} (need ${needed}).`,
        };
      }
    }

    const available = this.claimsForSeat(seat);
    const match = available.find((c) => c.type === type);
    if (!match) return { ok: false, error: `Cannot ${type} this tile.` };

    const resolvedIndex =
      optionIndex !== undefined && optionIndex !== null
        ? optionIndex
        : chiIndex;

    if (type === 'win') {
      if (this.isSeatFuriten(seat)) {
        return { ok: false, error: 'Furiten — cannot ron (tsumo still allowed).' };
      }
      if (!this.canWinWithYaku(seat, 'ron', this.claimWindow.tile)) {
        return { ok: false, error: 'Need at least one yaku to win (dora alone does not count).' };
      }
    } else if (match.options?.length) {
      if (resolvedIndex === undefined || !match.options[resolvedIndex]) {
        return { ok: false, error: `Pick which tiles to use for ${type}.` };
      }
    }

    this.claimSubmissions = this.claimSubmissions.filter((s) => s.seat !== seat);
    this.claimSubmissions.push({
      seat,
      type,
      optionIndex: resolvedIndex,
      chiIndex: resolvedIndex,
      handTileIds: match.options?.[resolvedIndex]?.handTileIds,
    });
    this.claimResponded.add(seat);
    this.recordReplay('claim', {
      seat,
      claimType: type,
      optionIndex: resolvedIndex ?? null,
      handTileIds: match.options?.[resolvedIndex]?.handTileIds ?? null,
    });

    this.autoPassDominatedClaimers();
    const result = this.tryCloseClaimWindow();
    if (result.error) return { ok: false, error: result.error };
    return { ok: true, ...result };
  }

  /** Closed melds on your turn (after drawing, when not in claim window) */
  declareMeld(socketId, { kind, tileIds, meldIndex }) {
    const seat = this.seatForSocket(socketId);
    if (seat < 0) return { ok: false, error: 'Not in room.' };
    if (this.phase !== 'playing') return { ok: false, error: 'Game not started.' };
    if (this.claimWindow) return { ok: false, error: 'Wait for claims to finish.' };
    if (seat !== this.currentTurn) return { ok: false, error: 'Not your turn.' };
    if (this.blockedSelfKanAfterCall(seat)) {
      return {
        ok: false,
        error: 'Cannot kan/kin immediately after chi or pon — discard first.',
      };
    }
    if (
      this.players[seat].riichi &&
      kind !== 'ankan' &&
      kind !== 'kin_closed' &&
      kind !== 'kin_from_ankan'
    ) {
      return { ok: false, error: 'Riichi — only closed kan/kin allowed.' };
    }

    const player = this.players[seat];

    if (!this.drewThisTurn && !this.needsDiscard(seat)) {
      return { ok: false, error: 'Draw first to declare kan or kin.' };
    }

    const needed = this.rinshanNeededForSelfMeld(kind);
    if (!this.canAffordRinshan(needed)) {
      return {
        ok: false,
        error: `Not enough rinshan tiles for ${kind.replace('_', ' ')} (need ${needed}).`,
      };
    }

    if (kind === 'ankan') {
      const opts = findAnkanOptions(player.hand);
      const opt = opts.find((o) => tileIds?.every((id) => o.tileIds.includes(id)));
      if (!opt) return { ok: false, error: 'Need 4 matching tiles for ankan.' };
      if (
        player.riichi &&
        !closedKanPreservesWaits(
          player.hand,
          player.melds,
          opt.tileIds,
          this.lastDrawn,
          player.wildcard
        )
      ) {
        return { ok: false, error: 'Riichi — closed kan must keep the same waits.' };
      }

      const meldTiles = [];
      for (const id of opt.tileIds) {
        const i = player.hand.findIndex((t) => t.id === id);
        meldTiles.push(player.hand.splice(i, 1)[0]);
      }
      player.melds.push({ type: 'kan', tiles: meldTiles, open: false, fromSeat: null });
      const meldIndex = player.melds.length - 1;
      this.invalidateDoubleRiichi();
      this.recordReplay('declareMeld', {
        seat,
        kind,
        tileIds: opt.tileIds,
        meldIndex,
      });
      const stealTile = meldTiles[0];
      const closed = this.openClaimWindow(stealTile, seat, {
        reason: 'chankan',
        kanKind: 'ankan',
        meldIndex,
      });
      if (closed.win) return { ok: true, ...closed };
      if (!closed.closed) {
        return { ok: true, claimWindow: true, chankan: true };
      }
      // Auto-closed (no robbers) — supplements already applied in completeKanAfterChankanPass
      return { ok: true };
    } else if (kind === 'kin_closed') {
      const opts = findClosedKinOptions(player.hand);
      const opt = opts.find((o) => tileIds?.every((id) => o.tileIds.includes(id)));
      if (!opt) return { ok: false, error: 'Need 5 matching tiles for kin.' };
      if (
        player.riichi &&
        !closedKanPreservesWaits(
          player.hand,
          player.melds,
          opt.tileIds,
          this.lastDrawn,
          player.wildcard
        )
      ) {
        return { ok: false, error: 'Riichi — closed kin must keep the same waits.' };
      }

      const meldTiles = [];
      for (const id of opt.tileIds) {
        const i = player.hand.findIndex((t) => t.id === id);
        meldTiles.push(player.hand.splice(i, 1)[0]);
      }
      player.melds.push({ type: 'kin', tiles: meldTiles, open: false, fromSeat: null });
    } else if (kind === 'kakan') {
      const opts = findKakanOptions(player.hand, player.melds);
      const opt = opts.find(
        (o) =>
          o.meldIndex === meldIndex &&
          (tileIds?.[0] == null || o.tileId === tileIds[0])
      );
      if (!opt) return { ok: false, error: 'No pon to extend.' };

      const i = player.hand.findIndex((t) => t.id === opt.tileId);
      if (i < 0) return { ok: false, error: 'Tile not in hand.' };
      const added = player.hand.splice(i, 1)[0];
      const meld = player.melds[meldIndex];
      meld.type = 'kan';
      meld.tiles.push(added);
      meld.addedTileId = added.id;
      this.invalidateDoubleRiichi();
      this.recordReplay('declareMeld', {
        seat,
        kind,
        tileIds: [opt.tileId],
        meldIndex,
      });
      const closed = this.openClaimWindow(added, seat, {
        reason: 'chankan',
        kanKind: 'kakan',
        meldIndex,
      });
      if (closed.win) return { ok: true, ...closed };
      if (!closed.closed) {
        return { ok: true, claimWindow: true, chankan: true };
      }
      return { ok: true };
    } else if (kind === 'kin_kakan') {
      const opts = findKinKakanOptions(player.hand, player.melds);
      const opt = opts.find(
        (o) =>
          o.meldIndex === meldIndex &&
          (tileIds?.[0] == null || o.tileId === tileIds[0])
      );
      if (!opt) return { ok: false, error: 'No open kan to upgrade to kin.' };

      const i = player.hand.findIndex((t) => t.id === opt.tileId);
      if (i < 0) return { ok: false, error: 'Tile not in hand.' };
      const added = player.hand.splice(i, 1)[0];
      const meld = player.melds[meldIndex];
      const previousAddedTileId = meld.addedTileId ?? null;
      meld.type = 'kin';
      meld.tiles.push(added);
      meld.addedTileId = added.id;
      this.invalidateDoubleRiichi();
      this.recordReplay('declareMeld', {
        seat,
        kind,
        tileIds: [opt.tileId],
        meldIndex,
      });
      const closed = this.openClaimWindow(added, seat, {
        reason: 'chankan',
        kanKind: 'kin_kakan',
        meldIndex,
        previousAddedTileId,
      });
      if (closed.win) return { ok: true, ...closed };
      if (!closed.closed) {
        return { ok: true, claimWindow: true, chankan: true };
      }
      return { ok: true };
    } else if (kind === 'kin_from_ankan') {
      const opts = findClosedKinFromKanOptions(player.hand, player.melds);
      const opt = opts.find(
        (o) =>
          o.meldIndex === meldIndex &&
          (tileIds?.[0] == null || o.tileId === tileIds[0])
      );
      if (!opt) return { ok: false, error: 'No closed kan to upgrade to kin.' };
      if (
        player.riichi &&
        !closedKinFromKanPreservesWaits(
          player.hand,
          player.melds,
          opt.meldIndex,
          opt.tileId,
          this.lastDrawn,
          player.wildcard
        )
      ) {
        return { ok: false, error: 'Riichi — closed kin must keep the same waits.' };
      }

      const i = player.hand.findIndex((t) => t.id === opt.tileId);
      if (i < 0) return { ok: false, error: 'Tile not in hand.' };
      const added = player.hand.splice(i, 1)[0];
      const meld = player.melds[meldIndex];
      if (!meld || meld.type !== 'kan' || meld.open) {
        return { ok: false, error: 'No closed kan to upgrade to kin.' };
      }
      meld.type = 'kin';
      meld.tiles.push(added);
      meld.addedTileId = added.id;
      meld.open = false;
      meld.fromSeat = null;
      // Stays closed — no chankan; one rinshan below.
    } else {
      return { ok: false, error: 'Unknown meld.' };
    }

    // kin_closed / kin_from_ankan — no chankan interrupt; draw supplements now
    const supplementCount = kind === 'kin_closed' ? 2 : 1;
    const supplements = this.drawSupplements(supplementCount);
    for (const t of supplements) {
      player.hand.push(t);
    }
    if (supplements.length > 0) {
      player.hand = sortHand(player.hand);
      player.temporaryFuriten = false;
      this.lastDrawn = supplements[supplements.length - 1].id;
      this.lastDrawWasRinshan = true;
      this.drewThisTurn = true;
    }

    this.clearAllIppatsu();
    this.invalidateDoubleRiichi();
    this.mustDiscardAfterMeld = seat;
    this.armFiveKanAbort(seat);
    this.recordReplay('declareMeld', {
      seat,
      kind,
      tileIds: tileIds ?? null,
      meldIndex: meldIndex ?? null,
    });
    const names = {
      ankan: 'Ankan',
      kin_closed: 'Kin 檎',
      kakan: 'Kakan',
      kin_kakan: 'Kin 檎 (from kan)',
      kin_from_ankan: 'Kin 檎 (from ankan)',
    };
    this.message = `${player.name} declared ${names[kind]}. Discard a tile.`;
    const autoDiscard = this.tryAutoRiichiDiscard();
    return { ok: true, autoDiscarded: !!autoDiscard?.ok };
  }

  /**
   * After a failed chankan window: draw rinshan and continue the kan turn.
   * Claim window still holds kanKind / fromSeat / meldIndex.
   */
  completeKanAfterChankanPass() {
    const cw = this.claimWindow;
    if (!cw || cw.reason !== 'chankan') {
      return { closed: false, error: 'No pending kan.' };
    }
    const seat = cw.fromSeat;
    const player = this.players[seat];
    const kanKind = cw.kanKind;
    this.clearClaimWindow();

    const supplements = this.drawSupplements(1);
    for (const t of supplements) {
      player.hand.push(t);
    }
    if (supplements.length > 0) {
      player.hand = sortHand(player.hand);
      player.temporaryFuriten = false;
      this.lastDrawn = supplements[supplements.length - 1].id;
      this.lastDrawWasRinshan = true;
      this.drewThisTurn = true;
    }

    this.clearAllIppatsu();
    this.invalidateDoubleRiichi();
    this.mustDiscardAfterMeld = seat;
    this.armFiveKanAbort(seat);
    const names = {
      ankan: 'Ankan',
      kakan: 'Kakan',
      kin_kakan: 'Kin 檎 (from kan)',
    };
    this.message = `${player.name} declared ${names[kanKind] ?? 'Kan'}. Discard a tile.`;
    const autoDiscard = this.tryAutoRiichiDiscard();
    return {
      closed: true,
      kan: true,
      seat,
      autoDiscarded: !!autoDiscard?.ok,
    };
  }

  /**
   * Undo pending kakan/ankan/kin_kakan and return the stolen tile for the winning hand.
   * Must run while claimWindow is still set.
   */
  stealKanTileForChankan() {
    const cw = this.claimWindow;
    if (!cw || cw.reason !== 'chankan') return null;
    const player = this.players[cw.fromSeat];
    const meldIndex = cw.meldIndex;
    const meld = player.melds[meldIndex];
    if (!meld) return null;

    if (cw.kanKind === 'kakan') {
      const idx = meld.tiles.findIndex((t) => t.id === cw.tile.id);
      const stolen =
        idx >= 0 ? meld.tiles.splice(idx, 1)[0] : meld.tiles.pop();
      meld.type = 'pon';
      delete meld.addedTileId;
      return stolen ?? null;
    }

    if (cw.kanKind === 'kin_kakan') {
      const idx = meld.tiles.findIndex((t) => t.id === cw.tile.id);
      const stolen =
        idx >= 0 ? meld.tiles.splice(idx, 1)[0] : meld.tiles.pop();
      meld.type = 'kan';
      if (cw.previousAddedTileId) meld.addedTileId = cw.previousAddedTileId;
      else delete meld.addedTileId;
      return stolen ?? null;
    }

    if (cw.kanKind === 'ankan') {
      const [meldTaken] = player.melds.splice(meldIndex, 1);
      if (!meldTaken) return null;
      const idx = meldTaken.tiles.findIndex((t) => t.id === cw.tile.id);
      const stolen =
        idx >= 0 ? meldTaken.tiles.splice(idx, 1)[0] : meldTaken.tiles.pop();
      for (const t of meldTaken.tiles) {
        player.hand.push(t);
      }
      player.hand = sortHand(player.hand);
      return stolen ?? null;
    }

    return null;
  }

  discard(socketId, tileId) {
    const seat = this.seatForSocket(socketId);
    if (seat < 0) return { ok: false, error: 'Not in room.' };
    return this.discardFromSeat(seat, tileId);
  }

  discardFromSeat(seat, tileId) {
    if (seat < 0) return { ok: false, error: 'Not in room.' };
    if (this.phase !== 'playing') return { ok: false, error: 'Game not started.' };
    if (this.claimWindow) return { ok: false, error: 'Resolve claims first.' };
    if (seat !== this.currentTurn) return { ok: false, error: 'Not your turn.' };
    if (!this.needsDiscard(seat)) {
      return { ok: false, error: 'Draw a tile first.' };
    }

    const p = this.players[seat];
    const hand = p.hand;
    if (p.riichi) {
      if (p.riichiFirstDiscard) {
        if (!isTenpaiDiscard(hand, p.melds, tileId, p.wildcard)) {
          return { ok: false, error: 'Riichi — discard a tile that keeps you tenpai.' };
        }
      } else if (!this.lastDrawn || tileId !== this.lastDrawn) {
        return { ok: false, error: 'Riichi — discard the drawn tile only.' };
      }
    }
    const idx = hand.findIndex((t) => t.id === tileId);
    if (idx < 0) return { ok: false, error: 'Tile not in hand.' };

    const [tile] = hand.splice(idx, 1);
    if (
      this.kuikaeBan &&
      this.kuikaeBan.seat === seat &&
      this.kuikaeBan.keys.has(tileKey(tile))
    ) {
      hand.splice(idx, 0, tile);
      return { ok: false, error: 'Swap calling (kuikae) not allowed.' };
    }
    const tsumogiri = !!(this.lastDrawn && tile.id === this.lastDrawn);
    const sideways =
      p.riichi && (p.riichiFirstDiscard || p.riichiSidewaysPending);
    const riichiDeclarationDiscard = !!(p.riichi && p.riichiFirstDiscard);
    if (riichiDeclarationDiscard) {
      if ((p.points ?? 0) < RIICHI_BET) {
        hand.splice(idx, 0, tile);
        return { ok: false, error: 'Need 1000 points to confirm riichi.' };
      }
      p.points -= RIICHI_BET;
      this.riichiPot += RIICHI_BET;
      this.handPayments.push({
        fromSeat: seat,
        toSeat: null,
        amount: RIICHI_BET,
        type: 'riichi',
      });
      p.riichiStickOnTable = true;
    }
    if (p.riichiSidewaysPending) p.riichiSidewaysPending = false;
    if (p.riichiFirstDiscard) p.riichiFirstDiscard = false;
    if (p.riichiPendingUndo) p.riichiPendingUndo = false;
    if (p.riichiDrewOnDeclare) p.riichiDrewOnDeclare = false;
    if (riichiDeclarationDiscard) p.ippatsu = true;
    else if (p.ippatsu) p.ippatsu = false;
    // Same-turn (temporary) furiten ends on your discard — including after chi/pon.
    p.temporaryFuriten = false;
    p.furitenDiscardKeys.push(tileKey(tile));
    p.discards.push({
      tile,
      sideways,
      tsumogiri,
      riichiDeclaration: riichiDeclarationDiscard,
    });
    this.lastDrawn = null;
    this.lastDrawWasRinshan = false;
    this.drewThisTurn = false;
    this.openingDiscardPending = false;
    this.mustDiscardAfterMeld = null;
    this.kuikaeBan = null;

    this.recordReplay('discard', {
      seat,
      tile: cloneTile(tile),
      sideways,
      tsumogiri,
      riichiDeclaration: riichiDeclarationDiscard,
    });

    const closed = this.openClaimWindow(tile, seat, {
      riichiDeclaration: riichiDeclarationDiscard,
    });
    if (!closed.closed) {
      return {
        ok: true,
        tile,
        claimWindow: true,
        deferCloseMs: closed.deferCloseMs ?? null,
      };
    }
    return { ok: true, tile, ...closed };
  }

  claimsForSeat(seat) {
    if (!this.claimWindow || seat < 0 || !this.players[seat]?.active) return [];
    const { tile, fromSeat, reason } = this.claimWindow;
    if (seat === fromSeat) return [];
    const p = this.players[seat];

    if (reason === 'chankan') {
      if (this.isSeatFuriten(seat) || !this.canRobKan(seat, tile)) return [];
      return [{ type: 'win', label: 'Ron (chankan)' }];
    }

    let claims = getClaimsForPlayer(
      p.hand,
      tile,
      fromSeat,
      seat,
      PLAYER_COUNT,
      p.melds,
      p.wildcard
    );
    if (this.isSeatFuriten(seat) || !this.canWinWithYaku(seat, 'ron', tile)) {
      claims = claims.filter((c) => c.type !== 'win');
    }
    claims = claims.filter((c) => {
      if (c.type !== 'kan' && c.type !== 'kin') return true;
      const needed = this.rinshanNeededForClaim(c.type, p.hand, p.melds, tile);
      return this.canAffordRinshan(needed);
    });
    if (p.riichi) claims = claims.filter((c) => c.type === 'win');

    // Drop options beaten by a higher-priority claim already submitted.
    const floor = this.highestSubmittedClaimPriority();
    if (floor >= 0) {
      claims = claims.filter((c) => claimPriority(c.type) >= floor);
    }
    return claims;
  }

  furitenInfoForSeat(seat) {
    if (seat < 0) return { furiten: false, reason: null };
    const reason = this.seatFuritenReason(seat);
    return { furiten: !!reason, reason };
  }

  canRiichi(seat) {
    if (this.phase !== 'playing' || seat !== this.currentTurn || !this.players[seat]?.active) return false;
    if (this.claimWindow) return false;
    const p = this.players[seat];
    if ((p.points ?? 0) < RIICHI_BET) return false;
    const mustDiscard =
      this.needsDiscard(seat) || this.mustDiscardAfterMeld === seat;
    return canDeclareRiichi(p.hand, p.melds, {
      drewThisTurn: this.drewThisTurn,
      mustDiscard,
      canDraw: this.canDraw(seat),
      alreadyRiichi: p.riichi,
      wildcard: p.wildcard,
    });
  }

  declareRiichi(socketId) {
    const seat = this.seatForSocket(socketId);
    if (seat < 0) return { ok: false, error: 'Not in room.' };
    if (this.phase !== 'playing') return { ok: false, error: 'Game not started.' };
    if (this.claimWindow) return { ok: false, error: 'Wait for claims to finish.' };
    if (seat !== this.currentTurn) return { ok: false, error: 'Not your turn.' };
    if (!this.canRiichi(seat)) {
      return { ok: false, error: 'Need a closed tenpai hand and 1000 points to declare riichi.' };
    }

    const p = this.players[seat];
    p.riichi = true;
    p.riichiStickOnTable = false;
    p.riichiFirstDiscard = true;
    p.riichiPendingUndo = true;
    p.riichiDrewOnDeclare = false;
    p.doubleRiichi = this.doubleRiichiEligible && p.discards.length === 0;
    const total = this.totalTiles(seat);
    if (total === 13) {
      const drawResult = this.autoDrawForSeat(seat);
      if (drawResult?.ok) p.riichiDrewOnDeclare = true;
      if (drawResult?.roundEnded) {
        p.riichiPendingUndo = false;
        return { ok: true, roundEnded: true };
      }
    }
    this.message = p.doubleRiichi
      ? `${p.name} declares double riichi (両立直). Discard to confirm (${RIICHI_BET} to the pot). Hand locked.`
      : `${p.name} declares riichi (立直). Discard to confirm (${RIICHI_BET} to the pot). Hand locked.`;
    this.recordReplay('declareRiichi', {
      seat,
      doubleRiichi: !!p.doubleRiichi,
    });
    return { ok: true };
  }

  canUndoRiichi(seat) {
    if (this.phase !== 'playing' || seat !== this.currentTurn || !this.players[seat]?.active) return false;
    if (this.claimWindow) return false;
    const p = this.players[seat];
    return !!(p.riichi && p.riichiPendingUndo && p.riichiFirstDiscard);
  }

  undoRiichi(socketId) {
    const seat = this.seatForSocket(socketId);
    if (seat < 0) return { ok: false, error: 'Not in room.' };
    if (!this.canUndoRiichi(seat)) {
      return { ok: false, error: 'Cannot undo riichi now.' };
    }

    const p = this.players[seat];
    if (p.riichiDrewOnDeclare && this.lastDrawn) {
      const idx = p.hand.findIndex((t) => t.id === this.lastDrawn);
      if (idx >= 0) {
        const [tile] = p.hand.splice(idx, 1);
        this.liveWall.unshift(tile);
        p.hand = sortHand(p.hand);
      }
      this.lastDrawn = null;
      this.lastDrawWasRinshan = false;
      this.drewThisTurn = false;
    }

    // Bet is only taken on the declaration discard — nothing to refund yet.
    p.riichi = false;
    p.riichiFirstDiscard = false;
    p.doubleRiichi = false;
    p.riichiPendingUndo = false;
    p.riichiDrewOnDeclare = false;
    p.ippatsu = false;

    this.message = `${p.name} cancels riichi.`;
    this.recordReplay('undoRiichi', { seat });
    return { ok: true };
  }

  canTsumo(seat) {
    if (this.phase !== 'playing' || seat !== this.currentTurn) return false;
    if (this.claimWindow) return false;
    // After chi / large chi / pon you must discard — no tsumo until a later draw.
    // (Kan/kin set drewThisTurn after rinshan and may tsumo.)
    if (this.mustDiscardAfterMeld === seat && !this.drewThisTurn) return false;
    const p = this.players[seat];
    if (!hasValidWinTotal(p.hand, p.melds, p.wildcard)) return false;
    return this.canWinWithYaku(seat, 'tsumo');
  }

  winInfoForSeat(seat) {
    if (seat < 0) return { canTsumo: false, patterns: [], needsYaku: false };
    const p = this.players[seat];
    const patterns = getWinPatterns(p.hand, p.melds, null, p.wildcard);
    const afterCallNoDraw =
      this.mustDiscardAfterMeld === seat && !this.drewThisTurn;
    const shapeOk =
      !afterCallNoDraw &&
      patterns.length > 0 &&
      hasValidWinTotal(p.hand, p.melds, p.wildcard) &&
      this.phase === 'playing' &&
      seat === this.currentTurn &&
      !this.claimWindow;
    const canTsumo = this.canTsumo(seat);
    return {
      canTsumo,
      patterns,
      needsYaku: shapeOk && !canTsumo,
    };
  }

  declareWin(socketId) {
    const seat = this.seatForSocket(socketId);
    if (seat < 0) return { ok: false, error: 'Not in room.' };
    if (this.phase !== 'playing') return { ok: false, error: 'Game not started.' };
    if (this.claimWindow) return { ok: false, error: 'Use Win on the discard (ron).' };
    if (seat !== this.currentTurn) return { ok: false, error: 'Not your turn.' };
    if (this.mustDiscardAfterMeld === seat && !this.drewThisTurn) {
      return { ok: false, error: 'Cannot tsumo after chi/pon — discard first.' };
    }

    const p = this.players[seat];
    const patterns = getWinPatterns(p.hand, p.melds, null, p.wildcard);
    if (patterns.length === 0) {
      return { ok: false, error: 'Hand is not a winning shape.' };
    }
    if (!hasValidWinTotal(p.hand, p.melds, p.wildcard)) {
      return { ok: false, error: 'Need a complete tile count to win (draw first).' };
    }
    if (!this.canWinWithYaku(seat, 'tsumo')) {
      return { ok: false, error: 'Need at least one yaku to win (dora alone does not count).' };
    }

    this.recordReplay('declareWin', { seat, mode: 'tsumo' });
    this.finishWin(seat, 'tsumo', patterns);
    return { ok: true, patterns };
  }

  selfMeldOptions(seat) {
    const empty = {
      ankan: [],
      kinClosed: [],
      kakan: [],
      kinKakan: [],
      kinFromAnkan: [],
    };
    if (seat < 0 || !this.players[seat]?.active || this.claimWindow || seat !== this.currentTurn) {
      return empty;
    }
    if (this.blockedSelfKanAfterCall(seat)) {
      return empty;
    }
    if (!this.drewThisTurn && !this.needsDiscard(seat)) {
      return empty;
    }
    const p = this.players[seat];
    const rinshan = this.rinshanRemaining();
    const allowKan = rinshan >= 1;
    const allowKin = rinshan >= 2;
    const lastDrawn = this.lastDrawn;
    const kinFromAnkan = allowKan
      ? findClosedKinFromKanOptions(p.hand, p.melds).filter((o) =>
          !p.riichi ||
          closedKinFromKanPreservesWaits(
            p.hand,
            p.melds,
            o.meldIndex,
            o.tileId,
            lastDrawn,
            p.wildcard
          )
        )
      : [];
    if (p.riichi) {
      return {
        ankan: allowKan
          ? findAnkanOptions(p.hand).filter((o) =>
              closedKanPreservesWaits(
                p.hand,
                p.melds,
                o.tileIds,
                lastDrawn,
                p.wildcard
              )
            )
          : [],
        kinClosed: allowKin
          ? findClosedKinOptions(p.hand).filter((o) =>
              closedKanPreservesWaits(
                p.hand,
                p.melds,
                o.tileIds,
                lastDrawn,
                p.wildcard
              )
            )
          : [],
        kakan: [],
        kinKakan: [],
        kinFromAnkan,
      };
    }
    return {
      ankan: allowKan ? findAnkanOptions(p.hand) : [],
      kinClosed: allowKin ? findClosedKinOptions(p.hand) : [],
      kakan: allowKan ? findKakanOptions(p.hand, p.melds) : [],
      kinKakan: allowKan ? findKinKakanOptions(p.hand, p.melds) : [],
      kinFromAnkan,
    };
  }

  swapPassedToSeat(seat) {
    if (seat < 0 || !this.isLimitlessAsura() || this.swapOffset == null) return null;
    if (this.phase === 'tile-swap') return null;
    return (seat + this.swapOffset) % PLAYER_COUNT;
  }

  messageForSeat(seat) {
    if (!this.swapCompleteMessage || this.message !== this.swapCompleteMessage) {
      return this.message;
    }
    const target = this.swapPassedToSeat(seat);
    if (target == null) return this.message;
    return `${this.message} You passed your 3 tiles to ${this.players[target].name}.`;
  }

  snapshotFor(socketId) {
    this.ensureValidHost();
    const mySeat = this.seatForSocket(socketId);
    const cw = this.claimWindow;
    return {
      code: this.code,
      phase: this.phase,
      message: this.messageForSeat(mySeat),
      swapSelection:
        mySeat >= 0 ? [...(this.swapSelections[mySeat] ?? [])] : [],
      // The pass distance stays secret until the exchange has happened.
      swapOffset:
        this.isLimitlessAsura() && this.phase !== 'tile-swap' ? this.swapOffset : null,
      swapPassedTo: this.swapPassedToSeat(mySeat),
      swapReadySeats: this.swapSelections
        .map((selection, seat) => (selection?.length === 3 ? seat : -1))
        .filter((seat) => seat >= 0),
      dealerIndex: this.dealerIndex,
      currentTurn: this.currentTurn,
      wallRemaining: this.liveWall.length,
      rinshanRemaining: this.deadWall?.rinshanRemaining() ?? 0,
      deadWall: this.deadWall?.toSnapshot({
        includeUra:
          this.phase === 'roundEnd' &&
          this.winners.some((s) => this.players[s]?.riichi),
      }) ?? null,
      doraCount: this.doraCount,
      riichiPot: this.riichiPot,
      round: roundSnapshot(this.roundWindIndex, this.roundInWind, this.repeatCount),
      roundSummary: this.roundSummaryForSeat(mySeat),
      gameLength: this.gameLength,
      gameLengthLabel: parseGameLength(this.gameLength).label,
      gameMode: this.gameMode,
      gameModeLabel: this.gameModeLabel,
      gameLengthLocked: this.gameLengthLocked,
      canChooseGameLength: this.canChooseGameLength(socketId),
      finalWindIndex: this.finalWindIndex,
      inTiebreaker: this.inTiebreaker,
      targetPoints: TARGET_POINTS,
      canStart: this.canStart(socketId),
      canNextRound: mySeat >= 0 ? this.canNextRound(socketId) : false,
      replayAvailable: !!(
        this.completedReplay &&
        this.phase === 'roundEnd' &&
        this.roundSummary?.gameOver
      ),
      lastDrawn: this.lastDrawn,
      needsDiscard: mySeat >= 0 ? this.needsDiscard(mySeat) : false,
      canDraw: mySeat >= 0 ? this.canDraw(mySeat) : false,
      kuikaeForbiddenKeys:
        mySeat >= 0 &&
        this.kuikaeBan &&
        this.kuikaeBan.seat === mySeat &&
        this.needsDiscard(mySeat)
          ? [...this.kuikaeBan.keys]
          : [],
      isHost: socketId === this.hostSocketId,
      hostSeat: this.players.findIndex((p) => p.id === this.hostSocketId),
      mySeat,
      claimWindow: cw
        ? {
            tile: cw.tile,
            fromSeat: cw.fromSeat,
            fromName: this.players[cw.fromSeat].name,
            responded: [...this.claimResponded],
            reason: cw.reason ?? 'discard',
            kanKind: cw.kanKind ?? null,
          }
        : null,
      availableClaims: mySeat >= 0 ? this.claimsForSeat(mySeat) : [],
      selfMeldOptions: mySeat >= 0 ? this.selfMeldOptions(mySeat) : null,
      canWin: mySeat >= 0 ? this.winInfoForSeat(mySeat) : null,
      furiten: mySeat >= 0 ? this.furitenInfoForSeat(mySeat) : null,
      canRiichi: mySeat >= 0 ? this.canRiichi(mySeat) : false,
      canAbortNineTerminals:
        mySeat >= 0 ? this.canAbortNineTerminals(mySeat) : false,
      canUndoRiichi: mySeat >= 0 ? this.canUndoRiichi(mySeat) : false,
      tenpaiDiscards:
        mySeat >= 0 &&
        this.players[mySeat].riichiFirstDiscard &&
        this.needsDiscard(mySeat)
          ? tenpaiDiscardIds(
              this.players[mySeat].hand,
              this.players[mySeat].melds,
              this.players[mySeat].wildcard
            )
          : [],
      winner: this.winner,
      winners: this.winners,
      winMode: this.winMode,
      winTile: this.winTile,
      winFromSeat: this.winFromSeat,
      winPatterns: this.winPatterns,
      winResults: this.winResults,
      players: this.players.map((p, i) => ({
        seat: i,
        name: p.name,
        occupied: p.id !== null,
        connected: p.id !== null && p.connected,
        isYou: p.id === socketId,
        wind: windForSeat(i, this.dealerIndex),
        handCount: p.hand.length + (p.wildcard ? 1 : 0),
        meldCount: p.melds.reduce((s, m) => s + m.tiles.length, 0),
        hand:
          p.id === socketId || this.shouldRevealHandAtRoundEnd(i)
            ? p.hand
            : null,
        wildcard:
          p.id === socketId || this.shouldRevealHandAtRoundEnd(i)
            ? p.wildcard
            : null,
        active: p.active,
        won: p.won,
        winningTile: p.winningTile,
        melds: p.melds.map((m, mi) => ({ ...m, ownerSeat: i, meldIndex: mi })),
        discards: p.discards.map((d) => ({
          // Keep each client's public discard state detached from the room.
          tile: cloneTile(d.tile ?? d),
          sideways: !!d.sideways,
          tsumogiri: !!d.tsumogiri,
          ronWin: !!d.ronWin,
        })),
        riichi: p.riichi,
        riichiStickOnTable: !!p.riichiStickOnTable,
        /** True until the sideways declaration discard is placed. */
        riichiFirstDiscard: !!p.riichiFirstDiscard,
        doubleRiichi: !!p.doubleRiichi,
        points: p.points ?? STARTING_POINTS,
        furiten:
          p.id === socketId ? !!this.seatFuritenReason(i) : undefined,
        awaitingDiscard: this.needsDiscard(i),
      })),
    };
  }
}

const rooms = new Map();

export function getOrCreateRoom(code) {
  const key = code.toUpperCase();
  if (!rooms.has(key)) rooms.set(key, new MahjongRoom(key));
  return rooms.get(key);
}

export function removeRoomIfEmpty(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.players.every((p) => p.id === null)) rooms.delete(code);
}
