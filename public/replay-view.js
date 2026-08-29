import { getMeldTileViews } from './melds.js';
import { buildHandFrames, eventLabel, parseReplayDocument } from './replay-engine.js';

const TILE_BACK_SRC = '/tiles/Tile-unknown.png';

function tileImageSrc(tile) {
  if (tile.red && tile.rank === 5) {
    if (tile.suit === 'man') return '/tiles/Tile-0m.png';
    if (tile.suit === 'pin') return '/tiles/Tile-0p.png';
    if (tile.suit === 'sou') return '/tiles/Tile-0s.png';
  }
  if (tile.suit === 'man') return `/tiles/Tile-${tile.rank}m.png`;
  if (tile.suit === 'pin') return `/tiles/Tile-${tile.rank}p.png`;
  if (tile.suit === 'sou') return `/tiles/Tile-${tile.rank}s.png`;
  if (tile.suit === 'wind') {
    if (tile.rank === 5) return '/tiles/Tile-1f.png';
    return `/tiles/Tile-${tile.rank}z.png`;
  }
  if (tile.suit === 'dragon') {
    const honorRank = { 1: 7, 2: 6, 3: 5 };
    return `/tiles/Tile-${honorRank[tile.rank]}z.png`;
  }
  return TILE_BACK_SRC;
}

function tileCodeLabel(tile) {
  if (!tile) return '?';
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

function createTileEl(tile, opts = {}) {
  const {
    small = true,
    sideways = false,
    faceDown = false,
    tsumogiri = false,
    tedashi = false,
    highlight = false,
  } = opts;
  const el = document.createElement('div');
  el.className = `tile ${tile.suit} rank-${tile.rank}`;
  if (small) el.classList.add('small');
  if (sideways) el.classList.add('sideways');
  if (tsumogiri) el.classList.add('tsumogiri');
  if (tedashi) el.classList.add('tedashi');
  if (highlight) el.classList.add('claimed-highlight');
  el.title = tileCodeLabel(tile);
  el.dataset.tileId = tile.id;
  const img = document.createElement('img');
  img.src = faceDown ? TILE_BACK_SRC : tileImageSrc(tile);
  img.alt = tileCodeLabel(tile);
  img.draggable = false;
  el.appendChild(img);
  return el;
}

function appendTiles(container, tiles, opts = {}) {
  for (const t of tiles ?? []) {
    container.appendChild(createTileEl(t, opts));
  }
}

function appendDiscards(container, discards) {
  for (const entry of discards ?? []) {
    const tile = entry.tile ?? entry;
    container.appendChild(
      createTileEl(tile, {
        sideways: !!entry.sideways,
        tsumogiri: !!entry.tsumogiri,
        tedashi: !entry.tsumogiri,
      })
    );
  }
}

function appendMelds(container, melds, ownerSeat) {
  for (const meld of melds ?? []) {
    const g = document.createElement('div');
    g.className = `meld-group ${meld.type} ${meld.open ? 'open' : 'closed'}`;
    const views = getMeldTileViews(meld, ownerSeat);
    for (const v of views) {
      const slot = document.createElement('div');
      slot.className = 'meld-tile-slot';
      if (v.stackAbove) {
        slot.classList.add('has-added-above');
        g.classList.add('has-stack');
        const stack = document.createElement('div');
        stack.className = 'kakan-stack';
        stack.appendChild(
          createTileEl(v.stackAbove.tile, {
            faceDown: v.stackAbove.faceDown,
            sideways: v.stackAbove.sideways,
          })
        );
        stack.firstChild.classList.add('added-above');
        stack.appendChild(
          createTileEl(v.tile, {
            faceDown: v.faceDown,
            sideways: v.sideways,
          })
        );
        slot.appendChild(stack);
      } else {
        slot.appendChild(
          createTileEl(v.tile, {
            faceDown: v.faceDown,
            sideways: v.sideways,
          })
        );
      }
      g.appendChild(slot);
    }
    container.appendChild(g);
  }
}

function highlightTileId(event) {
  if (!event) return null;
  if (event.tile?.id) return event.tile.id;
  if (event.winTile?.id) return event.winTile.id;
  return null;
}

/**
 * @param {object} replay
 * @param {{ onClose?: () => void }} [opts]
 */
export function openReplayViewer(replay, opts = {}) {
  const parsed = parseReplayDocument(replay);
  if (!parsed.ok) {
    alert(parsed.error);
    return;
  }
  replay = parsed.replay;
  closeReplayViewer();
  if (!replay?.hands?.length) {
    alert('This replay has no hands to show.');
    return;
  }

  let handIndex = 0;
  let frameIndex = 0;
  let frames = buildHandFrames(replay.hands[0], replay);
  let playing = false;
  let playTimer = null;

  const root = document.createElement('div');
  root.id = 'replay-viewer';
  root.className = 'replay-viewer';
  root.innerHTML = `
    <div class="replay-viewer-panel" role="dialog" aria-modal="true" aria-label="Replay viewer">
      <header class="replay-viewer-header">
        <div class="replay-viewer-titles">
          <h2>Replay</h2>
          <p class="replay-viewer-meta"></p>
        </div>
        <button type="button" class="btn replay-viewer-close" aria-label="Close">Close</button>
      </header>
      <div class="replay-viewer-toolbar">
        <label class="replay-hand-pick">
          Hand
          <select class="replay-hand-select"></select>
        </label>
        <div class="replay-step-controls">
          <button type="button" class="btn replay-first" title="First">⏮</button>
          <button type="button" class="btn replay-prev" title="Previous">◀</button>
          <button type="button" class="btn primary replay-play" title="Play/Pause">Play</button>
          <button type="button" class="btn replay-next" title="Next">▶</button>
          <button type="button" class="btn replay-last" title="Last">⏭</button>
        </div>
        <p class="replay-frame-label"></p>
      </div>
      <p class="replay-caption"></p>
      <div class="replay-indicators">
        <div class="replay-indicator-row replay-dora-row">
          <span class="replay-dora-label">Dora</span>
          <div class="replay-dora-tiles tile-row"></div>
        </div>
        <div class="replay-indicator-row replay-ura-row" hidden>
          <span class="replay-dora-label">Ura</span>
          <div class="replay-ura-tiles tile-row"></div>
        </div>
        <p class="replay-wall-meta"></p>
      </div>
      <div class="replay-seats"></div>
      <p class="replay-hint">All hands are shown face-up. Passes are skipped. Use the controls to step through the hand.</p>
    </div>
  `;
  document.body.appendChild(root);
  document.body.classList.add('replay-open');

  const metaEl = root.querySelector('.replay-viewer-meta');
  const handSelect = root.querySelector('.replay-hand-select');
  const captionEl = root.querySelector('.replay-caption');
  const frameLabel = root.querySelector('.replay-frame-label');
  const doraTilesEl = root.querySelector('.replay-dora-tiles');
  const uraRow = root.querySelector('.replay-ura-row');
  const uraTilesEl = root.querySelector('.replay-ura-tiles');
  const wallMetaEl = root.querySelector('.replay-wall-meta');
  const seatsEl = root.querySelector('.replay-seats');
  const playBtn = root.querySelector('.replay-play');

  metaEl.textContent = [
    replay.meta?.gameLengthLabel || replay.meta?.gameLength || '',
    replay.meta?.code ? `Room ${replay.meta.code}` : '',
    replay.result?.gameOverReason ? `Ended: ${replay.result.gameOverReason}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  handSelect.innerHTML = '';
  replay.hands.forEach((hand, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    const end = hand.summary?.endType ? ` — ${hand.summary.endType}` : '';
    opt.textContent = `${hand.round?.name ?? `Hand ${i + 1}`}${end}`;
    handSelect.appendChild(opt);
  });

  function stopPlay() {
    playing = false;
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    playBtn.textContent = 'Play';
  }

  function loadHand(i) {
    stopPlay();
    handIndex = Math.max(0, Math.min(i, replay.hands.length - 1));
    handSelect.value = String(handIndex);
    frames = buildHandFrames(replay.hands[handIndex], replay);
    frameIndex = 0;
    render();
  }

  function setFrame(i) {
    frameIndex = Math.max(0, Math.min(i, frames.length - 1));
    render();
    if (playing && frameIndex >= frames.length - 1) stopPlay();
  }

  function render() {
    const frame = frames[frameIndex];
    if (!frame) return;
    const event = frame.event ?? null;
    const hi = highlightTileId(event);

    captionEl.textContent = frame.caption || eventLabel(event, replay);
    frameLabel.textContent = `Step ${frameIndex + 1} / ${frames.length}`;

    if (wallMetaEl) {
      wallMetaEl.textContent = `Wall ${frame.wallRemaining} · pot ${frame.riichiPot}`;
    }
    if (doraTilesEl) {
      doraTilesEl.innerHTML = '';
      appendTiles(doraTilesEl, frame.doraIndicators);
    }
    const ura = frame.uraDoraIndicators ?? [];
    const showUra = Array.isArray(ura) && ura.length > 0;
    if (uraRow) uraRow.hidden = !showUra;
    if (uraTilesEl) {
      uraTilesEl.innerHTML = '';
      if (showUra) appendTiles(uraTilesEl, ura);
    }

    seatsEl.innerHTML = '';
    for (const p of frame.players) {
      const card = document.createElement('article');
      card.className = 'replay-seat';
      if (p.seat === frame.dealerIndex) card.classList.add('is-dealer');
      if (event?.seat === p.seat) card.classList.add('is-active');
      if (p.riichi && !p.riichiPending) card.classList.add('is-riichi');

      const head = document.createElement('header');
      head.className = 'replay-seat-head';
      const badges = [];
      if (p.seat === frame.dealerIndex) badges.push('Dealer');
      if (p.riichi && !p.riichiPending) {
        badges.push(p.doubleRiichi ? 'Double riichi' : 'Riichi');
      } else if (p.riichiPending) {
        badges.push('Riichi…');
      }
      const pr = frame.summary?.players?.find((x) => x.seat === p.seat);
      if (pr?.won) badges.push(pr.hanText || 'Win');
      if (pr?.ready && frame.endType === 'exhaustive') badges.push('Ready');
      head.innerHTML = `
        <strong>${p.name}</strong>
        <span class="replay-seat-points">${Number(p.points).toLocaleString()}</span>
        <span class="replay-seat-badges">${badges.join(' · ')}</span>
      `;
      card.appendChild(head);

      if (p.melds?.length) {
        const melds = document.createElement('div');
        melds.className = 'replay-melds meld-row';
        appendMelds(melds, p.melds, p.seat);
        card.appendChild(melds);
      }

      const handRow = document.createElement('div');
      handRow.className = 'replay-hand tile-row';
      // Always face-up for every seat in replay.
      for (const t of p.hand ?? []) {
        handRow.appendChild(
          createTileEl(t, { highlight: !!(hi && t.id === hi) })
        );
      }
      if (!p.hand?.length) {
        const empty = document.createElement('span');
        empty.className = 'replay-empty';
        empty.textContent = '(no tiles in hand)';
        handRow.appendChild(empty);
      }
      card.appendChild(handRow);

      if (p.discards?.length) {
        const river = document.createElement('div');
        river.className = 'replay-river tile-row';
        appendDiscards(river, p.discards);
        card.appendChild(river);
      }

      seatsEl.appendChild(card);
    }

    if (hi) {
      for (const el of root.querySelectorAll('.tile')) {
        if (el.dataset.tileId === hi) el.classList.add('claimed-highlight');
      }
    }
  }

  root.querySelector('.replay-viewer-close').addEventListener('click', () => {
    closeReplayViewer();
    opts.onClose?.();
  });
  root.addEventListener('click', (ev) => {
    if (ev.target === root) {
      closeReplayViewer();
      opts.onClose?.();
    }
  });
  handSelect.addEventListener('change', () => loadHand(Number(handSelect.value)));
  root.querySelector('.replay-first').addEventListener('click', () => {
    stopPlay();
    setFrame(0);
  });
  root.querySelector('.replay-prev').addEventListener('click', () => {
    stopPlay();
    setFrame(frameIndex - 1);
  });
  root.querySelector('.replay-next').addEventListener('click', () => {
    stopPlay();
    setFrame(frameIndex + 1);
  });
  root.querySelector('.replay-last').addEventListener('click', () => {
    stopPlay();
    setFrame(frames.length - 1);
  });
  playBtn.addEventListener('click', () => {
    if (playing) {
      stopPlay();
      return;
    }
    if (frameIndex >= frames.length - 1) setFrame(0);
    playing = true;
    playBtn.textContent = 'Pause';
    playTimer = setInterval(() => setFrame(frameIndex + 1), 700);
  });

  const onKey = (ev) => {
    if (!document.body.classList.contains('replay-open')) return;
    if (ev.key === 'Escape') {
      closeReplayViewer();
      opts.onClose?.();
    } else if (ev.key === 'ArrowRight' || ev.key === ' ') {
      ev.preventDefault();
      stopPlay();
      setFrame(frameIndex + 1);
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      stopPlay();
      setFrame(frameIndex - 1);
    }
  };
  document.addEventListener('keydown', onKey);
  root._replayKeyHandler = onKey;

  loadHand(0);
}

export function closeReplayViewer() {
  const root = document.getElementById('replay-viewer');
  if (root?._replayKeyHandler) {
    document.removeEventListener('keydown', root._replayKeyHandler);
  }
  root?.remove();
  document.body.classList.remove('replay-open');
}

/**
 * Read a downloaded replay .json File and open the viewer.
 * @param {File} file
 * @returns {Promise<object>}
 */
export function openReplayFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file selected.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const data = JSON.parse(text);
        const parsed = parseReplayDocument(data);
        if (!parsed.ok) {
          reject(new Error(parsed.error));
          return;
        }
        openReplayViewer(parsed.replay);
        resolve(parsed.replay);
      } catch (err) {
        reject(
          new Error(
            err?.message?.includes('JSON')
              ? 'File is not valid JSON.'
              : err?.message || 'Could not open replay.'
          )
        );
      }
    };
    reader.readAsText(file);
  });
}
