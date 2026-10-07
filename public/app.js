import { getMeldTileViews } from './melds.js';
import { openReplayViewer, openReplayFile } from './replay-view.js?v=2';

const socket = io();

const $ = (sel) => document.querySelector(sel);

const lobby = $('#lobby');
const game = $('#game');
const joinForm = $('#join-form');
const joinError = $('#join-error');
const tableEl = $('#table');
const yourHand = $('#your-hand');
const yourMelds = $('#your-melds');
const yourDiscards = $('#your-discards');
const claimPanel = $('#claim-panel');
const claimButtons = $('#claim-buttons');
const btnPass = $('#btn-pass');
const btnOpenCalls = $('#btn-open-calls');
const OPEN_CALLS_KEY = 'mahjong-open-calls';

function loadOpenCallsEnabled() {
  try {
    const v = localStorage.getItem(OPEN_CALLS_KEY);
    if (v == null) return true;
    return v !== '0' && v !== 'false';
  } catch {
    return true;
  }
}

/** When false, auto-pass non-ron claims on others' discards. Default on. */
let openCallsEnabled = loadOpenCallsEnabled();
/** Prevent repeat auto-pass for the same claim window. */
let autoSkippedClaimKey = null;
/** Last playing-hand identity — used to force Open Calls on each new deal. */
let lastOpenCallsHandKey = null;

function persistOpenCallsEnabled() {
  try {
    localStorage.setItem(OPEN_CALLS_KEY, openCallsEnabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function setOpenCallsEnabled(on) {
  openCallsEnabled = !!on;
  persistOpenCallsEnabled();
  syncOpenCallsButton();
}

function handKeyForOpenCalls(s) {
  if (!s || s.phase !== 'playing' || !s.round) return null;
  return [
    s.round.windIndex,
    s.round.inWind,
    s.round.repeatCount,
    s.dealerIndex,
  ].join('|');
}

/** Turn Open Calls on at the start of each new hand. */
function syncOpenCallsForNewHand(s) {
  const key = handKeyForOpenCalls(s);
  if (!key) {
    if (s?.phase !== 'playing') lastOpenCallsHandKey = null;
    return;
  }
  if (key === lastOpenCallsHandKey) return;
  lastOpenCallsHandKey = key;
  if (!openCallsEnabled) setOpenCallsEnabled(true);
  else syncOpenCallsButton();
}
const selfMeldPanel = $('#self-meld-panel');
const selfMeldButtons = $('#self-meld-buttons');
const swapPanel = $('#swap-panel');
const swapStatus = $('#swap-status');
const btnConfirmSwap = $('#btn-confirm-swap');
const statusMessage = $('#status-message');
const wallCount = $('#wall-count');
const rinshanCountEl = $('#rinshan-count');
const riichiPotEl = $('#riichi-pot');
const indicatorsBar = $('#indicators-bar');
const doraIndicatorsEl = $('#dora-indicators');
const uraIndicatorsBar = $('#ura-indicators');
const uraIndicatorTilesEl = $('#ura-indicator-tiles');
const displayCode = $('#display-code');
const seatLabel = $('#seat-label');
const btnStart = $('#btn-start');
const btnNextRound = $('#btn-next-round');
const hostStartPanel = $('#host-start-panel');
const hostStartHint = $('#host-start-hint');
const gameLengthSelect = $('#game-length');
const gameModeSelect = $('#game-mode');
const rematchSetup = $('#rematch-setup');
const rematchGameLengthSelect = $('#rematch-game-length');
const rematchGameModeSelect = $('#rematch-game-mode');
const rematchSetupHint = $('#rematch-setup-hint');
const btnRematchStart = $('#btn-rematch-start');
const gameLengthLockedEl = $('#game-length-locked');
const gameLengthLockedValue = $('#game-length-locked-value');
const lobbyRoster = $('#lobby-roster');
const lobbyRosterList = $('#lobby-roster-list');
const btnWin = $('#btn-win');
const btnRiichi = $('#btn-riichi');
const btnUndoRiichi = $('#btn-undo-riichi');
const riichiPanel = $('#riichi-panel');
const tsumoPanel = $('#tsumo-panel');
const btnAbortNine = $('#btn-abort-nine');
const abortNinePanel = $('#abort-nine-panel');
const yourArea = document.querySelector('.your-area');
const youZone = document.querySelector('.seat-bottom');
const roundEndPanel = $('#round-end-panel');
const roundEndTitle = $('#round-end-title');
const roundEndDealerNote = $('#round-end-dealer-note');
const roundEndStandings = $('#round-end-standings');
const roundEndHands = $('#round-end-hands');
const replayDownload = $('#replay-download');
const btnDownloadReplay = $('#btn-download-replay');
const btnViewReplay = $('#btn-view-replay');
const replayDownloadHint = $('#replay-download-hint');
const replayFileInput = $('#replay-file-input');
const lobbyReplayFile = $('#lobby-replay-file');
const lobbyReplayHint = $('#lobby-replay-hint');
/** Cached completed replay for view/download without re-fetching. */
let cachedReplay = null;

/** Latest server snapshot for this client (ES modules are strict — must declare). */
let state = null;
let pendingDiscard = false;
let pendingSwapSelection = [];
/** True while the last rendered state was in the opening exchange. */
let swapPhaseActive = false;
/** Last gameLength value we copied from the server into the length selects. */
let syncedGameLength = null;

/** Setup bar only for the room host (first / seat-0 player). */
function mayShowStartPanel(s) {
  if (!s) return false;
  const isHost = !!(s.isHost || (s.hostSeat >= 0 && s.mySeat === s.hostSeat));
  if (!isHost) return false;
  if (s.phase === 'lobby') return true;
  return s.phase === 'roundEnd' && !!s.roundSummary?.gameOver;
}

function seatedCount(s) {
  return (s?.players || []).filter((p) => p.occupied).length;
}

function lobbyReadyToStart(s) {
  if (!mayShowStartPanel(s)) return false;
  return seatedCount(s) >= 5;
}

function syncLobbyRoster(s) {
  if (!lobbyRoster || !lobbyRosterList) return;
  const show = s.phase === 'lobby' || (s.phase === 'roundEnd' && s.roundSummary?.gameOver);
  lobbyRoster.hidden = !show;
  if (!show) return;

  const hostSeat = s.hostSeat ?? -1;
  lobbyRosterList.innerHTML = '';
  for (const p of s.players || []) {
    const li = document.createElement('li');
    li.className = `lobby-roster-seat${p.occupied ? ' filled' : ' empty'}${
      p.isYou ? ' is-you' : ''
    }${p.seat === hostSeat ? ' is-host' : ''}`;
    const tags = [];
    if (p.seat === hostSeat) tags.push('Host');
    if (p.isYou) tags.push('You');
    li.innerHTML = `
      <span class="lobby-seat-num">Seat ${p.seat + 1}</span>
      <span class="lobby-seat-name">${p.occupied ? escapeHtml(p.name) : 'Empty'}</span>
      ${tags.length ? `<span class="lobby-seat-tags">${tags.join(' · ')}</span>` : ''}
    `;
    lobbyRosterList.appendChild(li);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Match-end score as (finalAfterUma − 40000) / 1000, with sign (e.g. +32.0). */
const STARTING_POINTS_DISPLAY = 40000;
function formatFinalScorePt(finalPoints) {
  const pt = (Number(finalPoints) - STARTING_POINTS_DISPLAY) / 1000;
  const sign = pt > 0 ? '+' : '';
  const body = Object.is(pt, -0) ? '0.0' : pt.toFixed(1);
  return `${sign}${body}`;
}

function setStartPanelVisible(show) {
  const panel = hostStartPanel || document.getElementById('host-start-panel');
  if (!panel) return;
  if (show) {
    panel.hidden = false;
    panel.removeAttribute('hidden');
    panel.classList.add('is-visible');
    panel.style.display = 'flex';
  } else {
    panel.hidden = true;
    panel.classList.remove('is-visible');
    panel.style.display = '';
  }
}

function setRematchSetupVisible(show) {
  if (!rematchSetup) return;
  rematchSetup.hidden = !show;
}

/** Keep lobby + rematch length selects in sync without fighting the host. */
function syncGameLengthSelects(s, { force = false } = {}) {
  const canChoose = !!s?.canChooseGameLength;
  const serverLength = s?.gameLength || 'south';
  const selects = [gameLengthSelect, rematchGameLengthSelect].filter(Boolean);

  for (const sel of selects) {
    sel.disabled = !canChoose;
  }

  if (!canChoose) {
    syncedGameLength = null;
    return;
  }

  // Only push the server value when entering choose-mode or after a match applies a new length.
  if (force || syncedGameLength !== serverLength) {
    for (const sel of selects) sel.value = serverLength;
    syncedGameLength = serverLength;
  }
}

function syncGameModeSelects(s, { force = false } = {}) {
  const canChoose = !!s?.canChooseGameLength;
  const serverMode = s?.gameMode || 'standard';
  const selects = [gameModeSelect, rematchGameModeSelect].filter(Boolean);
  for (const sel of selects) sel.disabled = !canChoose;
  if (!canChoose) return;
  if (force || selects.some((sel) => sel.value !== serverMode)) {
    for (const sel of selects) sel.value = serverMode;
  }
}

function selectedGameLength() {
  if (
    rematchGameLengthSelect &&
    rematchSetup &&
    !rematchSetup.hidden
  ) {
    return rematchGameLengthSelect.value || state?.gameLength || 'south';
  }
  return gameLengthSelect?.value || state?.gameLength || 'south';
}

function selectedGameMode() {
  if (rematchGameModeSelect && rematchSetup && !rematchSetup.hidden) {
    return rematchGameModeSelect.value || state?.gameMode || 'standard';
  }
  return gameModeSelect?.value || state?.gameMode || 'standard';
}

function syncHostStartControls(s) {
  const showLobbyPanel = mayShowStartPanel(s) && s.phase === 'lobby';
  const rematch = s.phase === 'roundEnd' && !!s.roundSummary?.gameOver;
  const showRematch = mayShowStartPanel(s) && rematch;
  const filled = seatedCount(s);
  const canPressStart = !!s.canStart && lobbyReadyToStart(s);

  setStartPanelVisible(showLobbyPanel);
  setRematchSetupVisible(showRematch);
  syncGameLengthSelects(s);
  syncGameModeSelects(s);

  const title = hostStartPanel?.querySelector('.host-start-title');
  if (title) title.textContent = 'Host · Game setup';

  const buttons = document.querySelectorAll(
    '#btn-start, #btn-start-actions, #btn-rematch-start'
  );
  for (const btn of buttons) {
    btn.toggleAttribute('aria-disabled', !canPressStart);
    btn.classList.toggle('is-waiting', !canPressStart);
    btn.classList.remove('is-busy');
    if (rematch) {
      btn.textContent = canPressStart ? 'New game' : `New game (${filled}/5)`;
    } else {
      btn.textContent = canPressStart ? 'Start game' : `Start game (${filled}/5)`;
    }
    btn.title = canPressStart
      ? rematch
        ? 'Start a new match with the selected length'
        : 'Start the match'
      : `Need all 5 players (${filled}/5).`;
  }

  if (hostStartHint) {
    if (!showLobbyPanel) {
      hostStartHint.textContent = '';
    } else if (canPressStart) {
      hostStartHint.textContent = 'Table full — choose length and press Start.';
    } else {
      hostStartHint.textContent = `You are host — waiting (${filled}/5). Start unlocks at 5/5.`;
    }
  }

  if (rematchSetupHint) {
    if (!showRematch) {
      rematchSetupHint.textContent = '';
    } else if (canPressStart) {
      rematchSetupHint.textContent =
        'Choose a game length, then start a new match.';
    } else {
      rematchSetupHint.textContent = `Waiting for players (${filled}/5) before a new game.`;
    }
  }

  const showLocked =
    !showLobbyPanel &&
    !showRematch &&
    !!s.gameLengthLabel &&
    (s.phase === 'playing' ||
      (s.phase === 'roundEnd' && !s.roundSummary?.gameOver));
  if (gameLengthLockedEl) {
    gameLengthLockedEl.hidden = !showLocked;
    if (showLocked && gameLengthLockedValue) {
      gameLengthLockedValue.textContent = s.gameLengthLabel;
    }
  }

  const actionsStart = $('#btn-start-actions');
  if (actionsStart) actionsStart.hidden = !showLobbyPanel && !showRematch;

  syncLobbyRoster(s);
  syncYourAreaVisibility();
}

let startInFlight = false;
let startTimer = null;

function clearStartBusy() {
  startInFlight = false;
  if (startTimer) {
    clearTimeout(startTimer);
    startTimer = null;
  }
  for (const btn of document.querySelectorAll(
    '#btn-start, #btn-start-actions, #btn-rematch-start'
  )) {
    btn.classList.remove('is-busy');
  }
}

function requestStart(ev) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  if (startInFlight) return;

  if (!state) {
    alert('Not connected to a room yet — join first.');
    return;
  }
  if (!state.isHost) {
    alert('Only the first player in the room (host) can start the game.');
    return;
  }

  const filled = seatedCount(state);
  if (filled < 5) {
    alert(`Need all 5 players before starting (${filled}/5).`);
    return;
  }
  if (state.phase !== 'lobby' && !(state.phase === 'roundEnd' && state.roundSummary?.gameOver)) {
    alert(`Cannot start from phase “${state.phase}”.`);
    return;
  }

  const gameLength = selectedGameLength();
  const gameMode = selectedGameMode();
  startInFlight = true;
  for (const btn of document.querySelectorAll(
    '#btn-start, #btn-start-actions, #btn-rematch-start'
  )) {
    btn.classList.add('is-busy');
    btn.textContent = 'Starting…';
  }

  const finishFail = (msg) => {
    clearStartBusy();
    alert(msg);
    if (state) syncHostStartControls(state);
  };

  // Prefer ack; also time out so the button never sticks forever.
  let acked = false;
  socket.emit('start', { gameLength, gameMode }, (res) => {
    acked = true;
    if (!res?.ok) {
      finishFail(res?.error ?? 'Could not start.');
      return;
    }
    if (hostStartHint) hostStartHint.textContent = 'Game starting…';
    // applyState will clear busy when phase flips to playing
    startTimer = setTimeout(() => {
      if (state?.phase === 'lobby') {
        finishFail('Start acknowledged but game did not begin — refresh and try again.');
      } else {
        clearStartBusy();
      }
    }, 4000);
  });

  startTimer = setTimeout(() => {
    if (!acked && startInFlight) {
      finishFail(
        'No response from server. Restart the game server (`npm start`) and hard-refresh the page.'
      );
    }
  }, 5000);
}


const LABELS = {
  man: (r) => `${r}万`,
  pin: (r) => `${r}筒`,
  sou: (r) => `${r}条`,
  wind: ['东', '南', '西', '北', '花'],
  dragon: ['中', '发', '白'],
};

const TILE_BACK_SRC = '/tiles/Tile-unknown.png';

/** Map game tiles to standard riichi image names (m/p/s/z). */
function tileImageSrc(tile) {
  if (tile.red && tile.rank === 5) {
    if (tile.suit === 'man') return '/tiles/Tile-0m.png';
    if (tile.suit === 'pin') return '/tiles/Tile-0p.png';
    if (tile.suit === 'sou') return '/tiles/Tile-0s.png';
  }
  if (tile.suit === 'man') return `/tiles/Tile-${tile.rank}m.png`;
  if (tile.suit === 'pin') return `/tiles/Tile-${tile.rank}p.png`;
  if (tile.suit === 'sou') return `/tiles/Tile-${tile.rank}s.png`;
  // 花 is wind rank 5 — do not use Tile-5z (that is white dragon 白)
  if (tile.suit === 'wind') {
    if (tile.rank === 5) return '/tiles/Tile-1f.png';
    return `/tiles/Tile-${tile.rank}z.png`;
  }
  if (tile.suit === 'dragon') {
    const honorRank = { 1: 7, 2: 6, 3: 5 };
    return `/tiles/Tile-${honorRank[tile.rank]}z.png`;
  }
  if (tile.suit === 'wild' || tile.wildcard) return '/tiles/Tile-Wild.png';
  return TILE_BACK_SRC;
}

/** Seat wind label — East / South / West / North / Flower. */
function windLabel(wind) {
  if (!wind) return '';
  const base = wind.endsWith('风') ? wind.slice(0, -1) : wind;
  const en = {
    东: 'East',
    南: 'South',
    西: 'West',
    北: 'North',
    花: 'Flower',
  };
  return en[base] ?? en[wind] ?? wind;
}

function tileLabel(tile) {
  if (tile.suit === 'man' || tile.suit === 'pin' || tile.suit === 'sou') {
    if (tile.red && tile.rank === 5) {
      const base = LABELS[tile.suit](5);
      return `赤${base}`;
    }
    return LABELS[tile.suit](tile.rank);
  }
  if (tile.suit === 'wind') return LABELS.wind[tile.rank - 1] ?? '?';
  if (tile.suit === 'dragon') return LABELS.dragon[tile.rank - 1];
  return '?';
}

/** Short English codes for call buttons: 1m, 2p, 3s, east, white, … */
function tileCodeLabel(tile) {
  if (!tile) return '?';
  if (tile.suit === 'wild' || tile.wildcard) return 'wild';
  if (tile.suit === 'man' || tile.suit === 'pin' || tile.suit === 'sou') {
    const suit = tile.suit === 'man' ? 'm' : tile.suit === 'pin' ? 'p' : 's';
    const rank = tile.red && tile.rank === 5 ? '0' : String(tile.rank);
    return `${rank}${suit}`;
  }
  if (tile.suit === 'wind') {
    return ['east', 'south', 'west', 'north', 'flower'][tile.rank - 1] ?? '?';
  }
  if (tile.suit === 'dragon') {
    return ['red', 'green', 'white'][tile.rank - 1] ?? '?';
  }
  return '?';
}

function tileKeyCodeLabel(key) {
  if (!key) return '?';
  const [suit, rankStr] = key.split('-');
  return tileCodeLabel({ suit, rank: Number(rankStr) });
}

function createTileEl(tile, opts = {}) {
  const {
    small = false,
    selectable = false,
    justDrawn = false,
    highlight = false,
    winTile = false,
    ronWin = false,
    faceDown = false,
    sideways = false,
    tsumogiri = false,
    tedashi = false,
  } = opts;
  const el = document.createElement('div');
  el.className = `tile ${tile.suit} rank-${tile.rank}`;
  if (small) el.classList.add('small');
  if (selectable) el.classList.add('selectable');
  if (justDrawn) el.classList.add('just-drawn');
  if (highlight) el.classList.add('claimed-highlight');
  if (winTile) el.classList.add('win-tile');
  if (ronWin) el.classList.add('ron-win-tile');
  if (sideways) el.classList.add('sideways');
  if (tsumogiri) el.classList.add('tsumogiri');
  if (tedashi) el.classList.add('tedashi');
  el.dataset.tileId = tile.id;
  const baseLabel = tileCodeLabel(tile);
  const kind =
    tsumogiri ? ' · draw-discard' : tedashi ? ' · from hand' : '';
  el.title = `${baseLabel}${kind}`;

  const img = document.createElement('img');
  if (tile.suit === 'wild' || tile.wildcard) el.classList.add('wildcard-tile');
  img.src = faceDown ? TILE_BACK_SRC : tileImageSrc(tile);
  img.alt = baseLabel;
  img.draggable = false;
  el.appendChild(img);
  return el;
}

function discardOriginOpts(entry) {
  const tsumogiri = !!entry.tsumogiri;
  return {
    sideways: !!entry.sideways,
    tsumogiri,
    tedashi: !tsumogiri,
    ronWin: !!entry.ronWin,
  };
}

/** Rows 1–2: 6 tiles; row 3 shows the rest (may exceed 6). */
const DISCARD_FIXED_ROWS = 2;
const DISCARD_ROW_COLS = 6;

/** Riichi is public only after the declaration discard confirms it. */
function riichiConfirmed(p) {
  return !!(p?.riichi && !p.riichiFirstDiscard && p.riichiStickOnTable !== false);
}

/** Show/hide the riichi stick in front of a seat's discard river. */
function setRiichiStick(riverCluster, showStick) {
  if (!riverCluster) return;
  const stick = riverCluster.querySelector('.riichi-stick');
  if (!stick) return;
  const show = !!showStick;
  stick.hidden = !show;
  stick.setAttribute('aria-hidden', show ? 'false' : 'true');
  riverCluster.classList.toggle('has-riichi-stick', show);
}

function fillDiscardRow(container, entries, tileOpts = {}) {
  if (!container) return;
  container.innerHTML = '';
  container.classList.add('discard-row');
  const list = entries || [];
  const fixedCap = DISCARD_FIXED_ROWS * DISCARD_ROW_COLS;

  const main = document.createElement('div');
  main.className = 'discard-main';
  const mainTiles = list.length > fixedCap ? list.slice(0, fixedCap) : list;
  for (let i = 0; i < mainTiles.length; i++) {
    const entry = mainTiles[i];
    const t = entry.tile ?? entry;
    const opts =
      typeof tileOpts === 'function' ? tileOpts(entry, i, list) : { ...tileOpts };
    main.appendChild(createTileEl(t, { small: true, ...discardOriginOpts(entry), ...opts }));
  }
  container.appendChild(main);

  if (list.length > fixedCap) {
    container.classList.add('has-overflow-row');
    const tail = document.createElement('div');
    tail.className = 'discard-tail';
    for (let i = fixedCap; i < list.length; i++) {
      const entry = list[i];
      const t = entry.tile ?? entry;
      const opts =
        typeof tileOpts === 'function' ? tileOpts(entry, i, list) : { ...tileOpts };
      tail.appendChild(createTileEl(t, { small: true, ...discardOriginOpts(entry), ...opts }));
    }
    container.appendChild(tail);
  } else {
    container.classList.remove('has-overflow-row');
  }
}

function seatHeaderHtml(p, s) {
  const wonBadge = p.won ? '<span class="won-badge">Won</span>' : '';
  const riichiBadge = riichiConfirmed(p)
    ? `<span class="riichi-badge${p.doubleRiichi ? ' double' : ''}">${
        p.doubleRiichi ? 'Double riichi' : 'Riichi'
      }</span>`
    : '';
  const furitenBadge =
    p.isYou && s.furiten?.furiten
      ? '<span class="furiten-badge">Furiten</span>'
      : '';
  const points =
    s.phase !== 'lobby' && p.points != null
      ? `<span class="points">${Number(p.points).toLocaleString()}</span>`
      : '';
  const roundResult = s.roundSummary?.players?.find((r) => r.seat === p.seat);
  const statusBadge = roundEndStatusBadgeHtml(roundResult, s.roundSummary);
  const dealerBadge =
    s.dealerIndex === p.seat && (s.phase === 'playing' || s.phase === 'roundEnd')
      ? '<span class="dealer-badge">Dealer</span>'
      : '';
  const name = p.occupied ? escapeHtml(p.name) : 'Empty';
  const offlineBadge =
    p.occupied && p.connected === false
      ? '<span class="offline-badge" title="Reconnecting — seat is held">Offline</span>'
      : '';
  return `
    <span class="wind">${windLabel(p.wind)}</span>
    <span class="name">${name}</span>${offlineBadge}${dealerBadge}${wonBadge}${riichiBadge}${furitenBadge}${statusBadge}
    ${points}
  `;
}

function createTileBackEl() {
  const el = document.createElement('div');
  el.className = 'tile-back';
  const img = document.createElement('img');
  img.src = TILE_BACK_SRC;
  img.alt = 'Concealed tile';
  img.draggable = false;
  el.appendChild(img);
  return el;
}

function renderIndicatorRow(container, indicators, hiddenCount = 0) {
  container.innerHTML = '';
  for (const t of indicators) {
    container.appendChild(createTileEl(t, { small: true }));
  }
  for (let i = 0; i < hiddenCount; i++) {
    container.appendChild(createTileBackEl());
  }
}

function renderMeldGroup(meld, ownerSeat, viewerSeat = null, opts = {}) {
  const g = document.createElement('div');
  g.className = `meld-group ${meld.type} ${meld.open ? 'open' : 'closed'}`;

  const seat = ownerSeat ?? meld.ownerSeat ?? 0;
  if (viewerSeat != null && viewerSeat >= 0) {
    g.classList.add(`meld-rel-${relativeSeat(viewerSeat, seat)}`);
  }
  const views = getMeldTileViews(meld, seat);
  const highlightId = opts.highlightTileId ?? null;

  for (const v of views) {
    const slot = document.createElement('div');
    slot.className = 'meld-tile-slot';

    if (v.stackAbove) {
      slot.classList.add('has-added-above');
      g.classList.add('has-stack');
      const stack = document.createElement('div');
      stack.className = 'kakan-stack';
      const added = v.stackAbove;
      const addedEl = createTileEl(added.tile, {
        small: true,
        faceDown: added.faceDown,
        sideways: added.sideways,
        highlight: !!(highlightId && added.tile?.id === highlightId),
      });
      addedEl.classList.add('added-above');
      stack.appendChild(addedEl);
      stack.appendChild(
        createTileEl(v.tile, {
          small: true,
          faceDown: v.faceDown,
          sideways: v.sideways,
          highlight: !!(highlightId && v.tile?.id === highlightId),
        })
      );
      slot.appendChild(stack);
    } else {
      slot.appendChild(
        createTileEl(v.tile, {
          small: true,
          faceDown: v.faceDown,
          sideways: v.sideways,
          highlight: !!(highlightId && v.tile?.id === highlightId),
        })
      );
    }

    g.appendChild(slot);
  }
  return g;
}

/** Highlight the live claim target for the whole claim window. */
function claimHighlightTileId(cw, seat) {
  if (!cw || cw.fromSeat !== seat || !cw.tile) return null;
  return cw.tile.id;
}

/** Claims this viewer should act on (filters non-ron when Open Calls is off). */
function claimsForViewer(s) {
  const claims = s?.availableClaims || [];
  if (openCallsEnabled) return claims;
  return claims.filter((c) => c.type === 'win');
}

/** True if this viewer still has at least one legal call on the live claim window. */
function viewerCanClaim(s) {
  const cw = s?.claimWindow;
  if (!cw || s.mySeat < 0 || s.mySeat === cw.fromSeat) return false;
  if (cw.responded?.includes(s.mySeat)) return false;
  return claimsForViewer(s).length > 0;
}

function claimWindowKey(cw) {
  if (!cw?.tile) return null;
  return `${cw.fromSeat}:${cw.tile.id}:${cw.reason ?? 'discard'}`;
}

/**
 * Open Calls off: auto-pass when the only options are non-ron calls.
 * Ron (and pass) still prompt when available.
 */
function maybeAutoSkipClosedCalls(s) {
  if (openCallsEnabled) {
    autoSkippedClaimKey = null;
    return;
  }
  const cw = s?.claimWindow;
  if (!cw || s.phase !== 'playing') {
    autoSkippedClaimKey = null;
    return;
  }
  if (s.mySeat < 0 || s.mySeat === cw.fromSeat) return;
  if (cw.responded?.includes(s.mySeat)) return;

  const all = s.availableClaims || [];
  if (all.length === 0) return;
  if (all.some((c) => c.type === 'win')) return;

  const key = claimWindowKey(cw);
  if (!key || autoSkippedClaimKey === key) return;
  autoSkippedClaimKey = key;
  socket.emit('passClaim', {}, (res) => {
    if (!res?.ok) autoSkippedClaimKey = null;
  });
}

function syncOpenCallsButton() {
  if (!btnOpenCalls) return;
  btnOpenCalls.classList.toggle('is-on', openCallsEnabled);
  btnOpenCalls.setAttribute('aria-pressed', openCallsEnabled ? 'true' : 'false');
  btnOpenCalls.textContent = openCallsEnabled ? 'Open Calls: On' : 'Open Calls: Off';
  btnOpenCalls.title = openCallsEnabled
    ? 'Open Calls on — you will be prompted for chi/pon/kan/kin/ron'
    : 'Open Calls off — auto-pass chi/pon/kan/kin; ron still prompts';
}

function isClaimTargetDiscard(cw, seat, entry, index, list, canClaim) {
  if (!canClaim) return false;
  if (!cw || cw.fromSeat !== seat || cw.reason === 'chankan') return false;
  if (index !== list.length - 1) return false;
  const t = entry?.tile ?? entry;
  return !!(t && cw.tile && t.id === cw.tile.id);
}

/**
 * Place all melds in a single row (never split a meld group).
 */
function layoutRoundEndMelds(container, melds, ownerSeat, viewerSeat) {
  container.replaceChildren();
  if (!melds?.length) return;
  const row = document.createElement('div');
  row.className = 'meld-row';
  for (const m of melds) {
    row.appendChild(renderMeldGroup(m, ownerSeat, viewerSeat));
  }
  container.appendChild(row);
}

/**
 * Prefer melds + hand on one row; if they don't fit, stack melds then hand.
 * `tilesEl` must already be in the document for width measurement.
 */
function fitRoundEndTiles(tilesEl) {
  if (!tilesEl) return;
  tilesEl.classList.remove('is-stacked');
  const melds = tilesEl.querySelector('.round-end-melds');
  const hand = tilesEl.querySelector('.round-end-hand');
  if (!melds || !hand) return;

  const gap = parseFloat(getComputedStyle(tilesEl).columnGap || getComputedStyle(tilesEl).gap) || 0;
  const avail = tilesEl.clientWidth;
  if (!(avail > 0)) return;

  const meldsW = melds.scrollWidth;
  const handW = hand.scrollWidth;
  if (meldsW + gap + handW > avail + 0.5) {
    tilesEl.classList.add('is-stacked');
  }
}

function roundWinInfo(s) {
  const summary = s.roundSummary;
  if (s.phase !== 'roundEnd' || summary?.endType !== 'win') return null;
  const winners =
    summary.winners ??
    s.winners ??
    (summary.winner != null || s.winner != null
      ? [summary.winner ?? s.winner]
      : []);
  return {
    winners,
    winner: winners[0] ?? null,
    winTile: summary.winTile ?? s.winTile,
    winMode: summary.winMode ?? s.winMode,
    winFromSeat: summary.winFromSeat ?? s.winFromSeat,
    winResults: summary.winResults ?? s.winResults ?? [],
  };
}

function seatWon(win, seat) {
  return !!win?.winners?.includes(seat);
}

/**
 * Winning tile + mode for one seat. Limitless Asura can have several wins
 * per hand, so the round-level winTile/winMode only describe the latest win.
 */
function seatWinDisplay(s, seat, win = roundWinInfo(s)) {
  const pr =
    s.phase === 'roundEnd'
      ? s.roundSummary?.players?.find((r) => r.seat === seat)
      : null;
  if (pr?.won && pr.winMode) {
    return { tile: pr.winTile ?? null, mode: pr.winMode };
  }
  const p = s.players?.find((x) => x.seat === seat);
  if (p?.winningTile) return { tile: p.winningTile, mode: 'tsumo' };
  if (seatWon(win, seat)) return { tile: win.winTile, mode: win.winMode };
  return { tile: null, mode: null };
}

function concealedHandTiles(hand, winTile) {
  if (!hand?.length) return [];
  if (!winTile) return hand;
  const idx = hand.findIndex((t) => t.id === winTile.id);
  if (idx < 0) return hand;
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

function populateWinningHand(container, hand, winTile, { small = true, winMode = null } = {}) {
  for (const t of concealedHandTiles(hand, winTile)) {
    container.appendChild(createTileEl(t, { small }));
  }

  if (winTile) {
    const winSlot = document.createElement('div');
    winSlot.className = 'win-tile-slot';
    const label = document.createElement('span');
    label.className = 'win-tile-label';
    label.textContent = winMode === 'tsumo' ? 'tsumo' : 'ron';
    winSlot.appendChild(label);
    winSlot.appendChild(createTileEl(winTile, { small, winTile: true }));
    container.appendChild(winSlot);
  }
}

function relativeSeat(mySeat, seat) {
  if (mySeat < 0) return seat;
  return (seat - mySeat + 5) % 5;
}

function renderIndicators(s) {
  if (!indicatorsBar) return;
  const dw = s.deadWall;
  const show = dw && (s.phase === 'playing' || s.phase === 'roundEnd');
  indicatorsBar.hidden = !show;
  if (!show) return;

  const hiddenDora = Math.max(0, (dw.doraSlots ?? 0) - (dw.doraRevealed ?? 0));
  if (doraIndicatorsEl) {
    renderIndicatorRow(doraIndicatorsEl, dw.doraIndicators || [], hiddenDora);
  }

  const ura = dw.uraDoraIndicators;
  const showUra = Array.isArray(ura) && ura.length > 0;
  if (uraIndicatorsBar) uraIndicatorsBar.hidden = !showUra;
  if (showUra && uraIndicatorTilesEl) {
    renderIndicatorRow(uraIndicatorTilesEl, ura, 0);
  } else if (uraIndicatorTilesEl) {
    uraIndicatorTilesEl.innerHTML = '';
  }
}

function readyLabel(playerResult) {
  if (playerResult.nagashi) return 'Nagashi';
  if (playerResult.won) return 'Won';
  return playerResult.ready ? 'Ready' : 'Not ready';
}

/** Whether this seat's hand should be face-up at round end. */
function shouldRevealHandAtRoundEnd(s, seat) {
  const summary = s.roundSummary;
  if (s.phase !== 'roundEnd' || !summary) return false;
  const pr = summary.players?.find((r) => r.seat === seat);
  if (!pr) return false;
  if (summary.endType === 'abortive') {
    return summary.abortiveReason === 'fiveRiichi';
  }
  if (summary.endType === 'win') return !!pr.won;
  // Exhaustive: nagashi shows only nagashi winners; otherwise ready hands.
  if (summary.nagashi) return !!(pr.nagashi || pr.won);
  return !!pr.ready;
}

/** Status badge for round end — never exposes not-ready on a win. */
function roundEndStatusBadgeHtml(pr, summary) {
  if (!pr || !summary) return '';
  if (summary.endType === 'win') {
    if (!pr.won) return '';
    return `<span class="ready-badge won">${readyLabel(pr)}</span>`;
  }
  if (pr.nagashi || pr.won) {
    return `<span class="ready-badge won">${readyLabel(pr)}</span>`;
  }
  if (pr.ready) {
    return `<span class="ready-badge ready">Ready</span>`;
  }
  return '';
}

function formatYakuDisplay(y) {
  if (!y) return '';
  return y.nameEn ? `${y.nameEn} / ${y.name}` : y.name;
}

/** Dedicated yaku panel for a winning player's round-end card. */
function renderYakuBox(han) {
  const box = document.createElement('div');
  box.className = 'yaku-box';
  if (!han) {
    box.innerHTML = '<div class="yaku-box-empty">Win</div>';
    return box;
  }

  const title = document.createElement('div');
  title.className = 'yaku-box-title';
  title.textContent = han.isYakuman ? 'Yakuman / 役満' : 'Yaku / 役';
  box.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'yaku-list';

  for (const y of han.yakus || []) {
    const li = document.createElement('li');
    li.className = 'yaku-item' + (y.yakuman ? ' yakuman' : '');
    const name = document.createElement('span');
    name.className = 'yaku-name';
    name.textContent = formatYakuDisplay(y);
    li.appendChild(name);
    if (!han.isYakuman && y.han) {
      const hanSpan = document.createElement('span');
      hanSpan.className = 'yaku-han';
      hanSpan.textContent = `${y.han}`;
      li.appendChild(hanSpan);
    }
    list.appendChild(li);
  }

  if (!han.isYakuman && (han.dora || 0) + (han.uraDora || 0) > 0) {
    const li = document.createElement('li');
    li.className = 'yaku-item yaku-dora';
    const name = document.createElement('span');
    name.className = 'yaku-name';
    const ura =
      han.uraDora > 0 ? ` + Ura / 裏${han.uraDora}` : '';
    name.textContent = `Dora / ドラ${han.dora || 0}${ura}`;
    li.appendChild(name);
    const hanSpan = document.createElement('span');
    hanSpan.className = 'yaku-han';
    hanSpan.textContent = `${(han.dora || 0) + (han.uraDora || 0)}`;
    li.appendChild(hanSpan);
    list.appendChild(li);
  }

  box.appendChild(list);

  const footer = document.createElement('div');
  footer.className = 'yaku-box-footer';
  if (han.isYakuman) {
    const mult = han.yakuman > 1 ? `${han.yakuman}× ` : '';
    footer.textContent = `${mult}Yakuman / 役満`;
  } else {
    const fu = han.fu > 0 ? `${han.fu} fu / 符 · ` : '';
    footer.textContent = `${fu}${han.totalHan ?? han.han ?? 0} han / 翻`;
  }
  box.appendChild(footer);
  return box;
}

function renderPaymentLedger(summary) {
  const players = summary?.players || [];
  const paidPlayers = players.filter((player) => (player.payments || []).length > 0);
  if (!paidPlayers.length) return null;

  const box = document.createElement('div');
  box.className = 'payment-ledger';
  const title = document.createElement('div');
  title.className = 'payment-ledger-title';
  title.textContent = 'Point payments';
  box.appendChild(title);

  for (const player of paidPlayers) {
    const row = document.createElement('div');
    row.className = 'payment-ledger-player';
    const name = document.createElement('strong');
    name.textContent = player.name;
    row.appendChild(name);

    const list = document.createElement('ul');
    list.className = 'payment-ledger-list';
    for (const payment of player.payments) {
      const item = document.createElement('li');
      const incoming = payment.direction === 'in';
      item.className = incoming ? 'payment-in' : 'payment-out';
      const amount = `${incoming ? '+' : '−'}${Number(payment.amount).toLocaleString()}`;
      let counterparty = 'another player';
      if (payment.type === 'riichi' || payment.type === 'riichi-pot') {
        counterparty = 'riichi pot';
      } else {
        const otherSeat = incoming ? payment.fromSeat : payment.toSeat;
        counterparty =
          players.find((other) => other.seat === otherSeat)?.name ?? counterparty;
      }
      item.textContent = `${amount} ${incoming ? 'from' : 'to'} ${counterparty}`;
      list.appendChild(item);
    }
    row.appendChild(list);
    box.appendChild(row);
  }
  return box;
}

function renderGameOverStandings(summary, mySeat) {
  if (!roundEndStandings) return;
  const standings = summary.standings || [];
  if (!summary.gameOver || !standings.length) {
    roundEndStandings.hidden = true;
    roundEndStandings.innerHTML = '';
    return;
  }

  roundEndStandings.hidden = false;
  roundEndStandings.innerHTML = '';

  const title = document.createElement('p');
  title.className = 'round-end-standings-title';
  title.textContent = 'Final rankings';
  roundEndStandings.appendChild(title);

  const list = document.createElement('ol');
  list.className = 'round-end-standings-list';

  const bySeat = new Map((summary.players || []).map((p) => [p.seat, p]));
  for (const row of [...standings].sort(
    (a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.seat - b.seat
  )) {
    const pr = bySeat.get(row.seat) || row;
    const li = document.createElement('li');
    li.className = 'round-end-standing';
    if (row.seat === mySeat) li.classList.add('is-you');
    if (pr.busted || (pr.points ?? row.points) < 0) li.classList.add('busted');
    if (row.rank === 1) li.classList.add('place-1');

    const finalPts = pr.finalPoints ?? row.finalPoints;
    const umaPts = pr.umaPoints ?? row.umaPoints ?? (row.uma ?? 0) * 1000;
    const umaSign = umaPts > 0 ? '+' : '';
    const points = pr.points ?? row.points ?? 0;

    li.innerHTML = `
      <span class="round-end-rank">#${row.rank ?? '—'}</span>
      <span class="round-end-standing-name">${escapeHtml(pr.name ?? row.name ?? 'Player')}</span>
      <span class="round-end-final">${
        finalPts != null ? formatFinalScorePt(finalPts) : '—'
      }</span>
      <span class="round-end-uma-breakdown">
        <span class="round-end-raw">${Number(points).toLocaleString()}</span>
        <span class="round-end-uma ${umaPts >= 0 ? 'plus' : 'minus'}">${umaSign}${Number(
          umaPts
        ).toLocaleString()} uma</span>
      </span>
    `;
    list.appendChild(li);
  }

  roundEndStandings.appendChild(list);
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function replayFilename(replay, s) {
  const code = (replay?.meta?.code || s?.code || 'table').toLowerCase();
  const length = replay?.meta?.gameLength || s?.gameLength || 'game';
  const ended = (replay?.meta?.endedAt || new Date().toISOString()).slice(0, 10);
  return `mahjong-replay-${code}-${length}-${ended}.json`;
}

function syncReplayDownload(s) {
  if (!replayDownload) return;
  const show = !!(s?.phase === 'roundEnd' && s.roundSummary?.gameOver && s.replayAvailable);
  replayDownload.hidden = !show;
  if (!show) cachedReplay = null;
  if (replayDownloadHint) {
    replayDownloadHint.textContent = show
      ? 'View now, download JSON, or open a saved replay file anytime from the lobby.'
      : '';
  }
  if (btnDownloadReplay) btnDownloadReplay.disabled = !show;
  if (btnViewReplay) btnViewReplay.disabled = !show;
}

function fetchReplay(cb) {
  if (cachedReplay) {
    cb(null, cachedReplay);
    return;
  }
  socket.emit('getReplay', {}, (res) => {
    if (!res?.ok || !res.replay) {
      cb(res?.error || 'Could not load replay.', null);
      return;
    }
    cachedReplay = res.replay;
    cb(null, res.replay);
  });
}

function requestReplayDownload() {
  if (!btnDownloadReplay) return;
  btnDownloadReplay.disabled = true;
  if (btnViewReplay) btnViewReplay.disabled = true;
  if (replayDownloadHint) replayDownloadHint.textContent = 'Preparing download…';
  fetchReplay((err, replay) => {
    if (err || !replay) {
      if (replayDownloadHint) {
        replayDownloadHint.textContent = err || 'Could not download replay.';
      }
      if (btnDownloadReplay) btnDownloadReplay.disabled = false;
      if (btnViewReplay) btnViewReplay.disabled = false;
      return;
    }
    try {
      downloadJsonFile(replayFilename(replay, state), replay);
      if (replayDownloadHint) {
        replayDownloadHint.textContent =
          'Saved. View or download again until a new game starts.';
      }
    } catch (e) {
      if (replayDownloadHint) {
        replayDownloadHint.textContent = e?.message || 'Download failed.';
      }
    }
    if (btnDownloadReplay) btnDownloadReplay.disabled = false;
    if (btnViewReplay) btnViewReplay.disabled = false;
  });
}

function requestReplayView() {
  if (!btnViewReplay) return;
  btnViewReplay.disabled = true;
  if (replayDownloadHint) replayDownloadHint.textContent = 'Loading replay…';
  fetchReplay((err, replay) => {
    if (err || !replay) {
      if (replayDownloadHint) {
        replayDownloadHint.textContent = err || 'Could not open replay.';
      }
      if (btnViewReplay) btnViewReplay.disabled = false;
      return;
    }
    openReplayViewer(replay);
    if (replayDownloadHint) {
      replayDownloadHint.textContent =
        'All five hands are shown face-up. Arrow keys or on-screen controls to step.';
    }
    if (btnViewReplay) btnViewReplay.disabled = false;
    if (btnDownloadReplay) btnDownloadReplay.disabled = false;
  });
}

function handleReplayFileSelected(file, hintEl) {
  if (!file) return;
  if (hintEl) hintEl.textContent = `Opening ${file.name}…`;
  openReplayFile(file)
    .then(() => {
      if (hintEl) {
        hintEl.textContent = `Loaded ${file.name}. Download again from a finished match anytime.`;
      }
    })
    .catch((err) => {
      if (hintEl) hintEl.textContent = err?.message || 'Could not open replay file.';
      else alert(err?.message || 'Could not open replay file.');
    })
    .finally(() => {
      // Allow selecting the same file again.
      if (replayFileInput) replayFileInput.value = '';
      if (lobbyReplayFile) lobbyReplayFile.value = '';
    });
}

function renderRoundEndPanel(s) {
  const summary = s.roundSummary;
  const show = s.phase === 'roundEnd' && summary;
  if (roundEndPanel) roundEndPanel.hidden = !show;
  if (!show) {
    if (roundEndHands) roundEndHands.innerHTML = '';
    if (roundEndStandings) {
      roundEndStandings.hidden = true;
      roundEndStandings.innerHTML = '';
    }
    syncReplayDownload(s);
    return;
  }

  const endLabel = summary.gameOver
    ? summary.gameOverReason === 'negative'
      ? 'Game over (negative points)'
      : summary.gameOverReason === 'target'
        ? 'Game over (50k)'
        : summary.gameOverReason === 'tiebreaker'
          ? 'Game over (tiebreaker)'
          : 'Game over'
    : summary.enteringTiebreaker
      ? 'Tiebreaker'
      : summary.endType === 'abortive'
        ? summary.abortiveLabel || 'Abortive draw'
        : summary.nagashi
          ? 'Nagashi mangan'
          : summary.endType === 'exhaustive'
            ? 'Exhaustive draw'
            : summary.endType === 'win'
              ? 'Win'
              : 'Round over';
  roundEndTitle.textContent = `${summary.roundName ?? summary.round?.name ?? 'Round'} — ${endLabel}`;

  if (summary.gameOver) {
    const reason =
      summary.gameOverReason === 'negative'
        ? 'Someone finished below 0 points.'
        : summary.gameOverReason === 'target'
          ? `Someone reached ${(summary.targetPoints ?? 50000).toLocaleString()} points.`
          : summary.gameOverReason === 'tiebreaker'
            ? 'Tiebreaker go-around finished.'
            : `${summary.gameLengthLabel || 'Match'} complete.`;
    roundEndDealerNote.textContent = `${reason} Uma +20/+10/0/−10/−20. ${
      s.canChooseGameLength
        ? 'Host: choose a new game length below, then start.'
        : 'Waiting for host to choose length and start a new game.'
    }`;
  } else if (summary.enteringTiebreaker) {
    roundEndDealerNote.textContent = `Nobody at ${(summary.targetPoints ?? 50000).toLocaleString()} — tiebreaker ${summary.nextRoundName ?? 'next wind'} begins. Match ends when someone reaches ${(summary.targetPoints ?? 50000).toLocaleString()}.`;
  } else if (summary.endType === 'abortive') {
    const nextName = summary.nextRoundName ?? summary.nextRound?.name ?? '';
    const pot = summary.riichiPot ?? 0;
    const potNote =
      pot > 0 ? ` Riichi pot ${pot.toLocaleString()} stays on the table.` : '';
    roundEndDealerNote.textContent = `${
      summary.abortiveLabel || 'Abortive draw'
    }.${potNote} Dealer stays — next: ${nextName}.`;
  } else {
    const prevResult = summary.players.find((p) => p.seat === summary.previousDealer);
    const nextPlayer = s.players[summary.nextDealer];
    const nextName = summary.nextRoundName ?? summary.nextRound?.name ?? '';
    roundEndDealerNote.textContent = summary.dealerRotated
      ? `Next hand: ${nextName} — ${nextPlayer?.name ?? '?'} (East)`
      : `Next hand: ${nextName} — ${prevResult?.name ?? '?'} stays dealer`;
  }

  renderGameOverStandings(summary, s.mySeat);
  syncReplayDownload(s);

  roundEndHands.innerHTML = '';
  const paymentLedger = renderPaymentLedger(summary);
  if (paymentLedger) roundEndHands.appendChild(paymentLedger);
  // Game over: rankings are separate; only show last-hand reveal boxes (winners / ready).
  const shownPlayers = summary.players.filter((pr) =>
    shouldRevealHandAtRoundEnd(s, pr.seat)
  );
  for (const pr of shownPlayers) {
    const card = document.createElement('div');
    card.className = `round-end-card ${pr.won ? 'won' : pr.ready ? 'ready' : 'not-ready'}`;
    if (pr.seat === s.mySeat) card.classList.add('is-you');
    if (pr.busted || pr.points < 0) card.classList.add('busted');

    const header = document.createElement('div');
    header.className = 'round-end-card-header';
    const statusHtml = roundEndStatusBadgeHtml(pr, summary);
    header.innerHTML = `
      <span class="round-end-name">${escapeHtml(pr.name)}</span>
      <span class="round-end-wind">${windLabel(pr.wind)}</span>
      <span class="round-end-points">${Number(pr.points ?? 0).toLocaleString()}</span>
      ${
        statusHtml
          ? statusHtml.replace(
              'class="ready-badge',
              'class="round-end-status ready-badge'
            )
          : ''
      }
    `;
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'round-end-body';

    if (pr.won) {
      body.appendChild(renderYakuBox(pr.han));
    }

    const revealHand = shouldRevealHandAtRoundEnd(s, pr.seat);
    const tilesRow = document.createElement('div');
    tilesRow.className = 'round-end-tiles';

    const meldsHost = document.createElement('div');
    meldsHost.className = 'melds-block round-end-melds';
    const hasMelds = revealHand && (pr.melds || []).length > 0;
    if (hasMelds) tilesRow.appendChild(meldsHost);

    const seatWin = pr.won ? seatWinDisplay(s, pr.seat) : { tile: null, mode: null };
    const handRow = document.createElement('div');
    handRow.className = 'hand round-end-hand winning-hand';
    if (revealHand) {
      populateWinningHand(handRow, pr.hand, seatWin.tile, {
        small: true,
        winMode: seatWin.mode,
      });
      if (pr.wildcard) handRow.appendChild(createTileEl(pr.wildcard, { small: true }));
    }
    tilesRow.appendChild(handRow);
    body.appendChild(tilesRow);
    card.appendChild(body);

    if (summary.endType === 'win' && !summary.gameOver) {
      // Non-winners keep their river; winners hide it.
      if (!pr.won && (pr.discards || []).length) {
        const discRow = document.createElement('div');
        discRow.className = 'discard-row round-end-discards';
        fillDiscardRow(discRow, pr.discards || []);
        card.appendChild(discRow);
      }
    }

    roundEndHands.appendChild(card);
    if (hasMelds) {
      layoutRoundEndMelds(meldsHost, pr.melds, pr.seat, s.mySeat);
    }
    fitRoundEndTiles(tilesRow);
  }
}

function roundLabel(s) {
  return s.round?.name ?? 'East 1';
}

function renderTable(s) {
  if (!tableEl) return;
  const mySeat = s.mySeat;
  const roundName = roundLabel(s);
  // CCW pentagon: you at bottom; seat+1 lower-right → upper-right → upper-left → lower-left
  const positions = ['bottom', 'lr', 'ur', 'ul', 'll'];
  const cw = s.claimWindow;
  const win = roundWinInfo(s);
  const canClaim = viewerCanClaim(s);

  // Preserve local seat + permanent table-center (wall / pot)
  const bottomSeat = tableEl.querySelector('.seat-bottom');
  tableEl
    .querySelectorAll(':scope > .seat:not(.seat-bottom)')
    .forEach((el) => el.remove());

  const centerMeta = tableEl.querySelector('#table-center-meta');
  if (centerMeta) {
    centerMeta.innerHTML = `
      <span class="center-round">五麻 · ${roundName}${s.gameLengthLabel ? ` · ${s.gameLengthLabel}` : ''}${s.gameModeLabel && s.gameMode !== 'standard' ? ` · ${s.gameModeLabel}` : ''}${s.inTiebreaker ? ' · tiebreaker' : ''}${s.phase === 'roundEnd' ? ' (ended)' : ''}</span>
      ${cw ? `<span class="claim-wait">${cw.reason === 'chankan' ? 'Chankan' : 'Claim'}: ${tileCodeLabel(cw.tile)}</span>` : ''}
    `;
  }

  const me = s.players.find((p) => p.seat === mySeat);
  if (bottomSeat && me) {
    bottomSeat.classList.toggle(
      'is-turn',
      s.phase === 'playing' && s.currentTurn === mySeat && !cw
    );
    const yourHeader = bottomSeat.querySelector('#your-seat-header');
    if (yourHeader) yourHeader.innerHTML = seatHeaderHtml(me, s);
    setRiichiStick(bottomSeat.querySelector('.seat-river-cluster'), riichiConfirmed(me));
    bottomSeat.classList.toggle('empty', !me.occupied);
    bottomSeat.classList.toggle('lobby-waiting', s.phase === 'lobby');
    bottomSeat.classList.toggle('lobby-occupied', s.phase === 'lobby' && !!me.occupied);
  }

  document.getElementById('game')?.classList.toggle('phase-lobby', s.phase === 'lobby');

  for (const p of s.players) {
    if (p.seat === mySeat) continue;

    const rel = relativeSeat(mySeat, p.seat);
    const pos = positions[rel] || 'center';
    if (pos === 'bottom') continue;

    const seat = document.createElement('div');
    seat.className = `seat seat-${pos} ${p.occupied ? '' : 'empty'}${
      s.phase === 'lobby' ? ' lobby-waiting' : ''
    }${s.phase === 'lobby' && p.occupied ? ' lobby-occupied' : ''}`;
    if (s.phase === 'playing' && s.currentTurn === p.seat && !cw) {
      seat.classList.add('is-turn');
    }

    seat.innerHTML = `
      <div class="seat-inner">
        <div class="seat-tiles">
          <div class="seat-river-cluster">
            <div class="seat-header">${seatHeaderHtml(p, s)}</div>
            <div class="riichi-stick" hidden aria-hidden="true">
              <img src="/calls/riichi_stick.png" alt="Riichi stick" />
            </div>
            <div class="discard-row"></div>
          </div>
          <div class="seat-edge-cluster">
            <div class="melds-row opponent-melds"></div>
            <div class="hand-back"></div>
          </div>
        </div>
      </div>
    `;

    const meldsEl = seat.querySelector('.opponent-melds');
    const meldHighlightId =
      canClaim && cw?.reason === 'chankan'
        ? claimHighlightTileId(cw, p.seat)
        : null;
    for (const m of p.melds || []) {
      meldsEl?.appendChild(
        renderMeldGroup(m, p.seat, mySeat, { highlightTileId: meldHighlightId })
      );
    }

    const backRow = seat.querySelector('.hand-back');
    // Lobby: names live in seat-header only (classic look). Hands stay empty until deal.
    if (s.phase !== 'lobby' && backRow) {
      if (shouldRevealHandAtRoundEnd(s, p.seat) && p.hand?.length) {
        backRow.classList.remove('hand-back');
        backRow.classList.add('hand', 'revealed-hand', 'winning-hand');
        const seatWin = seatWinDisplay(s, p.seat, win);
        populateWinningHand(backRow, p.hand, seatWin.tile, {
          small: true,
          winMode: seatWin.mode,
        });
        if (p.wildcard) backRow.appendChild(createTileEl(p.wildcard, { small: true }));
      } else {
        if (p.winningTile) {
          backRow.appendChild(createTileEl(p.winningTile, { small: true, winTile: true }));
        }
        const hiddenCount = Math.max(0, (p.handCount || 0) - (p.winningTile ? 1 : 0));
        for (let i = 0; i < hiddenCount; i++) {
          const back = createTileBackEl();
          if (p.awaitingDiscard && i === p.handCount - 1) {
            back.classList.add('just-drawn');
          }
          backRow.appendChild(back);
        }
      }
    }

    const riverCluster = seat.querySelector('.seat-river-cluster');
    setRiichiStick(riverCluster, riichiConfirmed(p));

    const discRow = seat.querySelector('.discard-row');
    if (discRow && s.phase !== 'lobby') {
      fillDiscardRow(discRow, p.discards, (entry, i, list) => ({
        highlight: isClaimTargetDiscard(cw, p.seat, entry, i, list, canClaim),
      }));
    }

    if (bottomSeat) tableEl.insertBefore(seat, bottomSeat);
    else tableEl.appendChild(seat);
  }
}

function renderClaimPanel(s) {
  claimButtons.innerHTML = '';
  const cw = s.claimWindow;
  const claims = claimsForViewer(s);
  const responded = cw?.responded?.includes(s.mySeat);

  if (!cw || s.mySeat === cw.fromSeat || responded) {
    claimPanel.hidden = true;
    return;
  }

  if (claims.length === 0) {
    claimPanel.hidden = true;
    return;
  }
  claimPanel.hidden = false;

  for (const c of claims) {
    if (c.options?.length) {
      const prefix =
        c.type === 'largeChi'
          ? 'Large chi'
          : c.type === 'chi'
            ? 'Chi'
            : c.type === 'pon'
              ? 'Pon'
              : c.type === 'kan'
                ? 'Kan'
                : c.type === 'kin'
                  ? 'Kin'
                  : c.label || c.type;
      const showTiles = c.options.length > 1 || c.type === 'chi' || c.type === 'largeChi';
      c.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn claim ${c.type === 'largeChi' ? 'large-chi' : c.type}`;
        btn.textContent = showTiles
          ? `${prefix} ${opt.tiles.map(tileCodeLabel).join(' ')}`
          : prefix;
        btn.addEventListener('click', () => doClaim(c.type, idx));
        claimButtons.appendChild(btn);
      });
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn claim ${c.type}`;
      btn.textContent = c.label || c.type;
      btn.addEventListener('click', () => doClaim(c.type));
      claimButtons.appendChild(btn);
    }
  }
}

function renderSelfMeldPanel(s) {
  selfMeldButtons.innerHTML = '';
  const opts = s.selfMeldOptions;
  const me = s.players.find((p) => p.isYou);
  const canShow =
    s.phase === 'playing' &&
    s.mySeat === s.currentTurn &&
    !s.claimWindow &&
    s.needsDiscard &&
    opts &&
    (opts.ankan?.length ||
      opts.kinClosed?.length ||
      opts.kakan?.length ||
      opts.kinKakan?.length ||
      opts.kinFromAnkan?.length);

  selfMeldPanel.hidden = !canShow;
  if (!canShow) return;

  for (const o of opts.ankan || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn claim kan';
    const akaNote = (o.tiles || []).some((t) => t.red)
      ? ` (${(o.tiles || []).map(tileCodeLabel).join(' ')})`
      : '';
    btn.textContent = `Ankan ${tileKeyCodeLabel(o.tileKey)}${akaNote}`;
    btn.addEventListener('click', () =>
      doDeclare('ankan', { tileIds: o.tileIds })
    );
    selfMeldButtons.appendChild(btn);
  }

  for (const o of opts.kinClosed || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn claim kin';
    const akaNote = (o.tiles || []).some((t) => t.red)
      ? ` (${(o.tiles || []).map(tileCodeLabel).join(' ')})`
      : '';
    btn.textContent = `Kin (closed) ${tileKeyCodeLabel(o.tileKey)}${akaNote}`;
    btn.addEventListener('click', () =>
      doDeclare('kin_closed', { tileIds: o.tileIds })
    );
    selfMeldButtons.appendChild(btn);
  }

  for (const o of opts.kakan || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn claim kan';
    const aka = o.tile?.red ? ` (${tileCodeLabel(o.tile)})` : '';
    btn.textContent = `Kakan ${tileKeyCodeLabel(o.tileKey)}${aka}`;
    btn.addEventListener('click', () =>
      doDeclare('kakan', { meldIndex: o.meldIndex, tileIds: [o.tileId] })
    );
    selfMeldButtons.appendChild(btn);
  }

  for (const o of opts.kinKakan || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn claim kin';
    const aka = o.tile?.red ? ` (${tileCodeLabel(o.tile)})` : '';
    btn.textContent = `Kin (from kan) ${tileKeyCodeLabel(o.tileKey)}${aka}`;
    btn.addEventListener('click', () =>
      doDeclare('kin_kakan', { meldIndex: o.meldIndex, tileIds: [o.tileId] })
    );
    selfMeldButtons.appendChild(btn);
  }

  for (const o of opts.kinFromAnkan || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn claim kin';
    const aka = o.tile?.red ? ` (${tileCodeLabel(o.tile)})` : '';
    btn.textContent = `Kin (from ankan) ${tileKeyCodeLabel(o.tileKey)}${aka}`;
    btn.addEventListener('click', () =>
      doDeclare('kin_from_ankan', {
        meldIndex: o.meldIndex,
        tileIds: [o.tileId],
      })
    );
    selfMeldButtons.appendChild(btn);
  }
}

function syncYourAreaVisibility() {
  if (!yourArea) return;
  const startBtn = $('#btn-start-actions');
  const hasAction = [startBtn, btnNextRound].some((btn) => btn && !btn.hidden);
  yourArea.hidden = !hasAction;
}

function syncSwapPanel(s) {
  if (!swapPanel) return;
  const active = s.phase === 'tile-swap';
  swapPanel.hidden = !active;
  if (!active) return;

  const readyCount = (s.swapReadySeats || []).length;
  const selectedCount = pendingSwapSelection.length;
  const serverSelection = s.swapSelection || [];
  const confirmed =
    (s.swapReadySeats || []).includes(s.mySeat) &&
    serverSelection.length === pendingSwapSelection.length &&
    serverSelection.every((id) => pendingSwapSelection.includes(id));
  const reveal = 'The receiver is revealed after everyone confirms.';
  if (swapStatus) {
    swapStatus.textContent =
      confirmed
        ? `Swap confirmed. ${reveal} ${readyCount}/5 players have confirmed.`
        : selectedCount === 3
          ? `Confirm your 3 tiles. ${reveal} ${readyCount}/5 players have confirmed.`
        : `Select ${3 - selectedCount} more physical tile${3 - selectedCount === 1 ? '' : 's'} to pass. ${reveal} ${readyCount}/5 players have confirmed.`;
  }
  if (btnConfirmSwap) {
    btnConfirmSwap.disabled = selectedCount !== 3;
    btnConfirmSwap.textContent = confirmed
      ? 'Unconfirm'
      : selectedCount === 3
        ? 'Confirm 3 tiles'
        : `Confirm (${selectedCount}/3)`;
    btnConfirmSwap.disabled = !confirmed && selectedCount !== 3;
  }
}

function renderYourArea(s) {
  if (yourHand) {
    yourHand.innerHTML = '';
    yourHand.classList.remove('winning-hand', 'lobby-hand-slot');
  }
  if (yourMelds) yourMelds.innerHTML = '';
  if (yourDiscards) yourDiscards.innerHTML = '';
  if (swapPanel) swapPanel.hidden = true;
  document.getElementById('game')?.classList.toggle('game-round-end', s.phase === 'roundEnd');

  const wasSwapPhase = swapPhaseActive;
  swapPhaseActive = s.phase === 'tile-swap';

  const me = s.players.find((p) => p.isYou);
  if (!me) return;

  if (s.phase === 'tile-swap') {
    // Other players' confirmations re-render the hand; keep this player's
    // unconfirmed picks. The server only knows confirmed selections.
    const confirmedSelection = s.swapSelection || [];
    if (!wasSwapPhase) pendingSwapSelection = [];
    if (confirmedSelection.length > 0) pendingSwapSelection = [...confirmedSelection];
    const handIds = new Set((me.hand || []).map((t) => t.id));
    pendingSwapSelection = pendingSwapSelection.filter((id) => handIds.has(id));
    for (const t of me.hand || []) {
      const selected = pendingSwapSelection.includes(t.id);
      const el = createTileEl(t, { selectable: true });
      if (selected) el.classList.add('swap-selected');
      el.addEventListener('click', () => {
        const index = pendingSwapSelection.indexOf(t.id);
        if (index >= 0) {
          pendingSwapSelection.splice(index, 1);
        } else if (pendingSwapSelection.length < 3) {
          pendingSwapSelection.push(t.id);
        }
        yourHand.querySelectorAll('.tile[data-tile-id]').forEach((tileEl) => {
          tileEl.classList.toggle(
            'swap-selected',
            pendingSwapSelection.includes(tileEl.dataset.tileId)
          );
        });
        syncSwapPanel(s);
      });
      yourHand.appendChild(el);
    }
    if (btnConfirmSwap) btnConfirmSwap.hidden = false;
    syncSwapPanel(s);
    btnWin.hidden = true;
    if (tsumoPanel) tsumoPanel.hidden = true;
    btnRiichi.hidden = true;
    btnUndoRiichi.hidden = true;
    if (riichiPanel) riichiPanel.hidden = true;
    if (btnAbortNine) btnAbortNine.hidden = true;
    if (abortNinePanel) abortNinePanel.hidden = true;
    claimPanel.hidden = true;
    selfMeldPanel.hidden = true;
    btnPass.hidden = true;
    btnNextRound.hidden = true;
    syncYourAreaVisibility();
    return;
  }

  if (s.phase === 'lobby') {
    // Classic lobby: seat headers (via renderTable) show names; hand stays empty.
    if (btnWin) btnWin.hidden = true;
    if (tsumoPanel) tsumoPanel.hidden = true;
    if (btnRiichi) btnRiichi.hidden = true;
    if (btnUndoRiichi) btnUndoRiichi.hidden = true;
    if (riichiPanel) riichiPanel.hidden = true;
    if (btnAbortNine) btnAbortNine.hidden = true;
    if (abortNinePanel) abortNinePanel.hidden = true;
    if (claimPanel) claimPanel.hidden = true;
    if (selfMeldPanel) selfMeldPanel.hidden = true;
    if (btnPass) btnPass.hidden = true;
    if (btnNextRound) btnNextRound.hidden = true;
    syncHostStartControls(s);
    syncYourAreaVisibility();
    return;
  }

  if (s.phase === 'roundEnd') {
    for (const m of me.melds || []) {
      yourMelds.appendChild(renderMeldGroup(m, s.mySeat, s.mySeat));
    }
    if (s.roundSummary?.endType !== 'abortive') {
      fillDiscardRow(yourDiscards, me.discards || []);
    }
    const revealMine = shouldRevealHandAtRoundEnd(s, s.mySeat);
    if (revealMine) {
      const seatWin = seatWinDisplay(s, s.mySeat);
      yourHand.classList.add('winning-hand');
      populateWinningHand(yourHand, me.hand, seatWin.tile, {
        small: true,
        winMode: seatWin.mode,
      });
      if (me.wildcard) yourHand.appendChild(createTileEl(me.wildcard, { small: true }));
    } else {
      const count = me.hand?.length ?? me.handCount ?? 0;
      for (let i = 0; i < count; i++) {
        yourHand.appendChild(createTileBackEl());
      }
    }
    btnWin.hidden = true;
    if (tsumoPanel) tsumoPanel.hidden = true;
    btnRiichi.hidden = true;
    btnUndoRiichi.hidden = true;
    if (riichiPanel) riichiPanel.hidden = true;
    if (btnAbortNine) btnAbortNine.hidden = true;
    if (abortNinePanel) abortNinePanel.hidden = true;
    claimPanel.hidden = true;
    selfMeldPanel.hidden = true;
    btnPass.hidden = true;
    yourArea?.classList.remove('riichi-locked');
    yourArea?.classList.remove('furiten');
    youZone?.classList.remove('riichi-locked');
    youZone?.classList.remove('furiten');

    syncHostStartControls(s);
    btnNextRound.hidden = !s.canNextRound;
    btnNextRound.disabled = !s.canNextRound;
    syncYourAreaVisibility();
    return;
  }

  if (!me.hand) {
    syncHostStartControls(s);
    syncYourAreaVisibility();
    return;
  }

  for (const m of me.melds || []) {
    const meldHighlightId =
      viewerCanClaim(s) && s.claimWindow?.reason === 'chankan'
        ? claimHighlightTileId(s.claimWindow, s.mySeat)
        : null;
    yourMelds.appendChild(
      renderMeldGroup(m, s.mySeat, s.mySeat, { highlightTileId: meldHighlightId })
    );
  }

  const isTurn = s.phase === 'playing' && s.currentTurn === s.mySeat;
  const mustDiscard = isTurn && s.needsDiscard && !s.claimWindow;
  const tenpaiDiscards = s.tenpaiDiscards || [];
  const kuikaeForbidden = new Set(s.kuikaeForbiddenKeys || []);
  const riichiFirstDiscard = !!me.riichi && mustDiscard && tenpaiDiscards.length > 0;
  const riichiDiscardOnly = !!me.riichi && mustDiscard && !riichiFirstDiscard;

  pendingDiscard =
    mustDiscard &&
    (!me.riichi || riichiFirstDiscard || !!s.lastDrawn);

  const drawnId = s.lastDrawn;
  const handRest = [];
  const handDrawn = [];
  for (const t of me.hand) {
    if (drawnId && t.id === drawnId) handDrawn.push(t);
    else handRest.push(t);
  }

  const appendHandTile = (t, justDrawn) => {
    const kuikaeBlocked =
      mustDiscard && kuikaeForbidden.has(`${t.suit}-${t.rank}`);
    const selectable = kuikaeBlocked
      ? false
      : riichiFirstDiscard
        ? tenpaiDiscards.includes(t.id)
        : mustDiscard && (!riichiDiscardOnly || t.id === s.lastDrawn);
    const el = createTileEl(t, { selectable, justDrawn });
    if (kuikaeBlocked) {
      el.classList.add('kuikae-blocked');
      el.title = `${tileCodeLabel(t)} — swap calling (kuikae) banned this turn`;
    }
    if (selectable) el.addEventListener('click', () => onDiscard(t.id));
    yourHand.appendChild(el);
  };

  if (me.won && me.winningTile) {
    yourHand.classList.add('winning-hand');
    populateWinningHand(yourHand, me.hand, me.winningTile, { winMode: 'tsumo', small: false });
  } else {
    for (const t of handRest) appendHandTile(t, false);
    for (const t of handDrawn) appendHandTile(t, true);
  }
  if (me.wildcard) yourHand.appendChild(createTileEl(me.wildcard));

  const cw = s.claimWindow;
  const canClaim = viewerCanClaim(s);
  fillDiscardRow(yourDiscards, me.discards, (entry, i, list) => ({
    highlight: isClaimTargetDiscard(cw, s.mySeat, entry, i, list, canClaim),
  }));

  syncHostStartControls(s);
  btnNextRound.hidden = true;

  const canTsumo = s.canWin?.canTsumo && s.phase === 'playing';
  btnWin.hidden = !canTsumo;
  btnWin.disabled = !canTsumo;
  if (tsumoPanel) tsumoPanel.hidden = !canTsumo;
  btnWin.textContent = 'Tsumo';
  btnWin.removeAttribute('title');

  const canRiichi = s.canRiichi && s.phase === 'playing' && !me.riichi;
  btnRiichi.hidden = !canRiichi;
  btnRiichi.disabled = !canRiichi;
  const canUndoRiichi = !!s.canUndoRiichi && s.phase === 'playing';
  btnUndoRiichi.hidden = !canUndoRiichi;
  btnUndoRiichi.disabled = !canUndoRiichi;
  if (riichiPanel) riichiPanel.hidden = !canRiichi && !canUndoRiichi;
  const canAbortNine = !!s.canAbortNineTerminals && s.phase === 'playing';
  if (abortNinePanel) abortNinePanel.hidden = !canAbortNine;
  if (btnAbortNine) {
    btnAbortNine.hidden = !canAbortNine;
    btnAbortNine.disabled = !canAbortNine;
  }
  yourArea?.classList.toggle('riichi-locked', !!me.riichi);
  yourArea?.classList.toggle('furiten', !!s.furiten?.furiten);
  youZone?.classList.toggle('riichi-locked', !!me.riichi);
  youZone?.classList.toggle('furiten', !!s.furiten?.furiten);

  renderClaimPanel(s);
  renderSelfMeldPanel(s);

  btnPass.hidden = !canClaim;

  syncYourAreaVisibility();
}

function applyState(s) {
  try {
    state = s;
    syncOpenCallsForNewHand(s);
    if (s.phase === 'playing' || s.phase === 'roundEnd') {
      clearStartBusy();
    }
    maybeAutoSkipClosedCalls(s);
    if (statusMessage) {
      const msg = s.message || '';
      const claimNoise =
        s.claimWindow &&
        !viewerCanClaim(s) &&
        /claims?\s+open|chankan\s+open/i.test(msg);
      statusMessage.textContent = claimNoise ? '' : msg;
    }
    syncHostStartControls(s);
    if (wallCount) wallCount.textContent = String(s.wallRemaining ?? 0);
    const dw = s.deadWall;
    const showWallInfo = dw && (s.phase === 'playing' || s.phase === 'roundEnd');
    if (rinshanCountEl) {
      rinshanCountEl.hidden = !showWallInfo;
      if (showWallInfo) {
        const strong = rinshanCountEl.querySelector('strong');
        if (strong) strong.textContent = String(dw.rinshanRemaining ?? 0);
      }
    }
    const pot = s.riichiPot ?? 0;
    const showPot =
      (s.phase === 'playing' || s.phase === 'roundEnd') &&
      (pot > 0 || s.roundSummary?.riichiPotClaimed);
    if (riichiPotEl) {
      riichiPotEl.hidden = !showPot;
      if (showPot) {
        const claimed = s.roundSummary?.riichiPotClaimed;
        const strong = riichiPotEl.querySelector('strong');
        if (strong) {
          strong.textContent = claimed?.amount
            ? `${pot} (claimed ${claimed.amount})`
            : String(pot);
        }
      }
    }
    if (displayCode) displayCode.textContent = s.code;

    const me = s.players.find((p) => p.isYou);
    if (seatLabel) {
      if (me) {
        const riichiTag = riichiConfirmed(me) ? ' · Riichi' : '';
        const furitenTag = s.furiten?.furiten ? ' · Furiten' : '';
        const pointsTag =
          me.points != null ? ` · ${Number(me.points).toLocaleString()} pts` : '';
        const dealerTag =
          s.dealerIndex === s.mySeat && (s.phase === 'playing' || s.phase === 'roundEnd')
            ? ' · Dealer'
            : '';
        const hostTag = s.isHost ? ' · Host' : '';
        const roundTag =
          s.round && (s.phase === 'playing' || s.phase === 'roundEnd')
            ? ` · ${roundLabel(s)}`
            : '';
        seatLabel.textContent = `${me.name} · ${windLabel(me.wind)}${hostTag}${riichiTag}${furitenTag}${pointsTag}${dealerTag}${roundTag} · Seat ${s.mySeat + 1}`;
      } else {
        seatLabel.textContent = '';
      }
    }

    renderIndicators(s);
    renderTable(s);
    renderRoundEndPanel(s);
    renderYourArea(s);
  } catch (err) {
    console.error('applyState failed', err);
    if (statusMessage) {
      statusMessage.textContent = `UI error: ${err?.message || err}`;
    }
  }
}

function doClaim(type, optionIndex) {
  socket.emit('claim', { type, optionIndex, chiIndex: optionIndex }, (res) => {
    if (!res?.ok) {
      alert(res?.error ?? 'Claim failed.');
      return;
    }
    if (res?.error) alert(res.error);
  });
}

function doDeclare(kind, payload) {
  socket.emit('declareMeld', { kind, ...payload }, (res) => {
    if (!res?.ok) alert(res?.error ?? 'Declare failed.');
  });
}

const PLAYER_TOKEN_KEY = 'mahjong5-player-token';
const SESSION_KEY = 'mahjong5-session';

/** Per-tab identity; sessionStorage survives a refresh but not a new tab. */
function playerToken() {
  let token = sessionStorage.getItem(PLAYER_TOKEN_KEY);
  if (!token) {
    token =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(PLAYER_TOKEN_KEY, token);
  }
  return token;
}

function savedSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function joinRoom(code, name, { auto = false } = {}) {
  socket.emit('join', { code, name, token: playerToken() }, (res) => {
    if (!res?.ok) {
      if (auto) {
        sessionStorage.removeItem(SESSION_KEY);
        lobby.hidden = false;
        game.hidden = true;
      }
      joinError.textContent = res?.error ?? 'Could not join room.';
      joinError.hidden = false;
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: res.code ?? code, name }));
    lobby.hidden = true;
    game.hidden = false;
    // Show host controls immediately from join ack (don't wait for state).
    if (res.isHost) {
      setStartPanelVisible(true);
      if (hostStartHint) {
        hostStartHint.textContent = 'You are host — waiting for players. Start unlocks at 5/5.';
      }
    } else {
      setStartPanelVisible(false);
    }
  });
}

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  joinError.hidden = true;

  const name = $('#player-name').value.trim() || 'Player';
  const code = $('#room-code').value.trim() || 'TABLE';
  joinRoom(code, name);
});

// Page refresh or a dropped connection: reclaim the same seat automatically.
function rejoinSavedSession() {
  const session = savedSession();
  if (!session?.code) return;
  joinRoom(session.code, session.name, { auto: true });
}
socket.on('connect', rejoinSavedSession);
if (savedSession()?.code) {
  lobby.hidden = true;
  game.hidden = false;
  if (socket.connected) rejoinSavedSession();
}

btnStart?.addEventListener('click', requestStart);

const actionsStartBtn = $('#btn-start-actions');
actionsStartBtn?.addEventListener('click', requestStart);
btnRematchStart?.addEventListener('click', requestStart);

function onGameLengthChange(ev) {
  const value = ev.target?.value;
  if (!value) return;
  if (gameLengthSelect && gameLengthSelect !== ev.target) {
    gameLengthSelect.value = value;
  }
  if (rematchGameLengthSelect && rematchGameLengthSelect !== ev.target) {
    rematchGameLengthSelect.value = value;
  }
}

gameLengthSelect?.addEventListener('change', onGameLengthChange);
rematchGameLengthSelect?.addEventListener('change', onGameLengthChange);

function onGameModeChange(ev) {
  const value = ev.target?.value;
  if (!value) return;
  if (gameModeSelect && gameModeSelect !== ev.target) gameModeSelect.value = value;
  if (rematchGameModeSelect && rematchGameModeSelect !== ev.target) {
    rematchGameModeSelect.value = value;
  }
}

gameModeSelect?.addEventListener('change', onGameModeChange);
rematchGameModeSelect?.addEventListener('change', onGameModeChange);

window.__startGame = requestStart;

btnNextRound.addEventListener('click', () => {
  socket.emit('nextRound', {}, (res) => {
    if (!res?.ok) alert(res?.error ?? 'Could not start next round.');
  });
});

btnConfirmSwap?.addEventListener('click', () => {
  const confirmed =
    state?.phase === 'tile-swap' &&
    (state.swapReadySeats || []).includes(state.mySeat) &&
    (state.swapSelection || []).length === pendingSwapSelection.length &&
    (state.swapSelection || []).every((id) => pendingSwapSelection.includes(id));
  if (!confirmed && pendingSwapSelection.length !== 3) return;
  socket.emit('selectSwap', { tileIds: confirmed ? [] : [...pendingSwapSelection] }, (res) => {
    if (!res?.ok) alert(res?.error ?? 'Could not confirm tile exchange.');
  });
});

btnDownloadReplay?.addEventListener('click', () => {
  requestReplayDownload();
});

btnViewReplay?.addEventListener('click', () => {
  requestReplayView();
});

replayFileInput?.addEventListener('change', () => {
  const file = replayFileInput.files?.[0];
  handleReplayFileSelected(file, replayDownloadHint);
});

lobbyReplayFile?.addEventListener('change', () => {
  const file = lobbyReplayFile.files?.[0];
  handleReplayFileSelected(file, lobbyReplayHint);
});

btnWin.addEventListener('click', () => {
  socket.emit('declareWin', {}, (res) => {
    if (!res?.ok) alert(res?.error ?? 'Could not declare win.');
  });
});

btnRiichi.addEventListener('click', () => {
  socket.emit('declareRiichi', {}, (res) => {
    if (!res?.ok) alert(res?.error ?? 'Could not declare riichi.');
  });
});

btnUndoRiichi.addEventListener('click', () => {
  socket.emit('undoRiichi', {}, (res) => {
    if (!res?.ok) alert(res?.error ?? 'Could not undo riichi.');
  });
});

btnAbortNine?.addEventListener('click', () => {
  socket.emit('declareAbortNineTerminals', {}, (res) => {
    if (!res?.ok) alert(res?.error ?? 'Could not declare nine terminals.');
  });
});

btnPass.addEventListener('click', () => {
  socket.emit('passClaim', {}, (res) => {
    if (!res?.ok) alert(res?.error ?? 'Pass failed.');
  });
});

btnOpenCalls?.addEventListener('click', () => {
  setOpenCallsEnabled(!openCallsEnabled);
  if (state) {
    maybeAutoSkipClosedCalls(state);
    applyState(state);
  }
});

syncOpenCallsButton();

function onDiscard(tileId) {
  if (!pendingDiscard) return;
  socket.emit('discard', { tileId }, (res) => {
    if (!res?.ok) alert(res?.error ?? 'Could not discard.');
  });
}

socket.on('state', applyState);
