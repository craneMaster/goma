import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { getOrCreateRoom, removeRoomIfEmpty } from './game.js';
import { DECK_SIZE } from './tiles.js';
import { DEAD_WALL_SIZE, RINSHAN_COUNT, DORA_SLOTS, URA_DORA_SLOTS } from './wall.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const clientDir = path.join(__dirname, '..', 'public');
const tilesDir = path.join(__dirname, '..', 'tiles');
const callsDir = path.join(__dirname, '..', 'calls');
app.use(express.static(clientDir));
app.use('/tiles', express.static(tilesDir));
app.use('/calls', express.static(callsDir));
app.get('/api/info', (_req, res) => {
  res.json({
    players: 5,
    copiesPerTile: 5,
    winds: 5,
    deckSize: DECK_SIZE,
    deadWall: {
      size: DEAD_WALL_SIZE,
      rinshan: RINSHAN_COUNT,
      doraSlots: DORA_SLOTS,
      uraDoraSlots: URA_DORA_SLOTS,
    },
  });
});

const LOBBY_RECONNECT_GRACE_MS = 30 * 1000;
const GAME_RECONNECT_GRACE_MS = 10 * 60 * 1000;

function emitState(room) {
  for (const p of room.players) {
    if (p.id) io.to(p.id).emit('state', room.snapshotFor(p.id));
  }
}

io.on('connection', (socket) => {
  let roomCode = null;

  socket.on('join', ({ code, name, token }, cb) => {
    const room = getOrCreateRoom(code || 'TABLE');
    room.onAsyncUpdate = emitState;

    const result = room.join(
      socket.id,
      name,
      typeof token === 'string' && token ? token.slice(0, 100) : null
    );
    if (!result.ok) {
      removeRoomIfEmpty(room.code);
      cb?.(result);
      return;
    }
    roomCode = room.code;
    socket.join(roomCode);
    cb?.({
      ok: true,
      seat: result.seat,
      code: room.code,
      isHost: !!result.isHost,
      rejoined: !!result.rejoined,
    });
    emitState(room);
    if (!result.rejoined) {
      socket.to(roomCode).emit('playerJoined', { seat: result.seat, name });
    }
  });

  socket.on('start', (payload, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    try {
      const room = getOrCreateRoom(roomCode);
      const result = room.start(socket.id, payload || {});
      cb?.(result);
      if (result.ok) emitState(room);
    } catch (err) {
      console.error('start failed', err);
      cb?.({ ok: false, error: err?.message || 'Start failed on server.' });
    }
  });

  socket.on('nextRound', (_, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    const room = getOrCreateRoom(roomCode);
    const result = room.nextRound(socket.id);
    cb?.(result);
    if (result.ok) emitState(room);
  });

  socket.on('selectSwap', ({ tileIds }, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    const room = getOrCreateRoom(roomCode);
    const result = room.selectSwap(socket.id, tileIds);
    cb?.(result);
    if (result.ok) emitState(room);
  });

  socket.on('discard', ({ tileId }, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    const room = getOrCreateRoom(roomCode);
    const result = room.discard(socket.id, tileId);
    cb?.(result);
    if (result.ok) emitState(room);
  });

  socket.on('passClaim', (_, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    const room = getOrCreateRoom(roomCode);
    const result = room.passClaim(socket.id);
    cb?.(result);
    if (result.ok) emitState(room);
  });

  socket.on('claim', (payload, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    const room = getOrCreateRoom(roomCode);
    const result = room.claim(socket.id, payload);
    cb?.(result);
    if (result.ok) emitState(room);
  });

  socket.on('declareMeld', (payload, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    const room = getOrCreateRoom(roomCode);
    const result = room.declareMeld(socket.id, payload);
    cb?.(result);
    if (result.ok) emitState(room);
  });

  socket.on('declareWin', (_, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    const room = getOrCreateRoom(roomCode);
    const result = room.declareWin(socket.id);
    cb?.(result);
    if (result.ok) emitState(room);
  });

  socket.on('declareRiichi', (_, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    const room = getOrCreateRoom(roomCode);
    const result = room.declareRiichi(socket.id);
    cb?.(result);
    if (result.ok || result.roundEnded) emitState(room);
  });

  socket.on('declareAbortNineTerminals', (_, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    const room = getOrCreateRoom(roomCode);
    const result = room.declareAbortNineTerminals(socket.id);
    cb?.(result);
    if (result.ok) emitState(room);
  });

  socket.on('undoRiichi', (_, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    const room = getOrCreateRoom(roomCode);
    const result = room.undoRiichi(socket.id);
    cb?.(result);
    if (result.ok) emitState(room);
  });

  socket.on('getReplay', (_, cb) => {
    if (!roomCode) return cb?.({ ok: false, error: 'Not in a room.' });
    const room = getOrCreateRoom(roomCode);
    const replay = room.getReplay();
    if (!replay) {
      cb?.({ ok: false, error: 'Replay is available after the match ends.' });
      return;
    }
    cb?.({ ok: true, replay });
  });

  socket.on('disconnect', () => {
    if (!roomCode) return;
    const code = roomCode;
    const room = getOrCreateRoom(code);
    const seat = room.markDisconnected(socket.id);
    if (seat < 0) return;
    emitState(room);

    // Hold the seat so a page refresh rejoins seamlessly; only free it if the
    // player stays away (longer once a match is underway).
    const graceMs =
      room.phase === 'lobby' ? LOBBY_RECONNECT_GRACE_MS : GAME_RECONNECT_GRACE_MS;
    setTimeout(() => {
      const p = room.players[seat];
      if (p.id !== socket.id || p.connected) return;
      room.leave(socket.id);
      emitState(room);
      io.to(code).emit('playerLeft');
      removeRoomIfEmpty(code);
    }, graceMs);
  });
});

const PORT = process.env.PORT || 3847;
httpServer.listen(PORT, () => {
  console.log(`Mahjong 5P — http://localhost:${PORT}`);
  console.log(`Deck: ${DECK_SIZE} tiles (5× each; 花 is wind rank 5)`);
});
