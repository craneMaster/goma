import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDeck } from '../server/tiles.js';
import { countDora } from '../server/dora.js';
import { scoreWin } from '../server/scoring.js';
import { calculateHan } from '../server/yaku.js';
import { getWaitKeys, isTenpai } from '../server/riichi.js';
import { canWin, getWinPatterns } from '../server/win.js';
import { MahjongRoom } from '../server/game.js';
import { computeNextRoundState } from '../server/round.js';

const deck = buildDeck();

function tile(suit, rank, copy = 0) {
  const found = deck.find(
    (t) => t.suit === suit && t.rank === rank && t.copy === copy
  );
  assert.ok(found, `missing tile ${suit}-${rank}-${copy}`);
  return found;
}

function hand(specs) {
  return specs.map(([suit, rank, copy = 0]) => tile(suit, rank, copy));
}

const wildcard = {
  id: 'wildcard-test',
  suit: 'wild',
  rank: 0,
  copy: 0,
  wildcard: true,
};

// 123m 123p 123s 45m 11z: waits on 3m and 6m.
const twoSidedPhysicalHand = hand([
  ['man', 1],
  ['man', 2],
  ['man', 3],
  ['pin', 1],
  ['pin', 2],
  ['pin', 3],
  ['sou', 1],
  ['sou', 2],
  ['sou', 3],
  ['man', 4],
  ['man', 5],
  ['wind', 1],
  ['wind', 1, 1],
]);

function scoringOptions(extra = {}) {
  return {
    mode: 'tsumo',
    seat: 0,
    dealerIndex: 0,
    roundWindIndex: 0,
    doraIndicators: [],
    uraIndicators: [],
    ...extra,
  };
}

test('standard evaluation remains unchanged without a wildcard', () => {
  assert.deepEqual(getWaitKeys(twoSidedPhysicalHand, [], null), [
    'man-3',
    'man-6',
  ]);

  const winningHand = [...twoSidedPhysicalHand, tile('man', 6)];
  assert.equal(canWin(winningHand, [], null, null), true);
  assert.deepEqual(getWinPatterns(winningHand, [], null, null), ['standard']);

  const result = calculateHan(winningHand, [], scoringOptions({ dora: 1 }));
  assert.equal(result.isYakuman, false);
  assert.equal(result.han, 3);
  assert.equal(result.dora, 1);
  assert.equal(result.totalHan, 4);
  assert.deepEqual(result.yakus.map((y) => y.id), ['menzenTsumo', 'sanshoku']);
});

test('standard scoring still charges the normal ron payment', () => {
  const scored = scoreWin({
    mode: 'ron',
    winnerSeat: 1,
    dealerIndex: 0,
    fromSeat: 2,
    han: 3,
    fu: 30,
    playerCount: 5,
  });

  assert.equal(scored.basic, 960);
  assert.deepEqual(scored.deltas, [0, 4800, -4800, 0, 0]);
  assert.deepEqual(scored.payments, [{ from: 2, to: 1, amount: 4800 }]);
});

test('standard mode still deals the normal hand sizes without wildcards', () => {
  const room = new MahjongRoom('standard-test');
  for (let seat = 0; seat < room.players.length; seat++) {
    room.players[seat].id = `player-${seat}`;
  }
  room.hostSocketId = 'player-0';

  assert.equal(room.start('player-0', { gameMode: 'standard' }).ok, true);
  assert.equal(room.gameMode, 'standard');
  assert.equal(room.players[0].hand.length, 14);
  assert.deepEqual(
    room.players.slice(1).map((p) => p.hand.length),
    [13, 13, 13, 13]
  );
  assert.ok(room.players.every((p) => p.wildcard === null));
  assert.deepEqual(
    room.players.map((_, seat) => room.totalTiles(seat)),
    [14, 13, 13, 13, 13]
  );
});

test('public discard snapshots preserve the exact tile identity', () => {
  const room = new MahjongRoom('discard-snapshot-test');
  room.players[0].id = 'viewer';
  room.players[1].id = 'discarder';
  const discarded = tile('man', 3, 0);
  room.players[1].discards = [{ tile: discarded }];

  const snapshot = room.snapshotFor('viewer');
  assert.deepEqual(snapshot.players[1].discards[0].tile, {
    id: discarded.id,
    suit: 'man',
    rank: 3,
    copy: 0,
  });

  snapshot.players[1].discards[0].tile.rank = 1;
  assert.equal(room.players[1].discards[0].tile.rank, 3);
});

test('Limitless Asura performs a hidden three-tile exchange before wildcards', () => {
  const room = new MahjongRoom('swap-test');
  for (let seat = 0; seat < room.players.length; seat++) {
    room.players[seat].id = `swap-player-${seat}`;
  }
  room.hostSocketId = 'swap-player-0';

  assert.equal(
    room.start('swap-player-0', { gameMode: 'limitless-asura' }).ok,
    true
  );
  assert.equal(room.phase, 'tile-swap');
  assert.deepEqual(room.players.map((p) => p.hand.length), [13, 12, 12, 12, 12]);
  assert.ok(room.players.every((p) => p.wildcard === null));
  assert.ok(room.swapOffset >= 1 && room.swapOffset <= 4);
  assert.equal(room.deadWall.doraRevealed, 0);
  assert.equal(room.snapshotFor('swap-player-1').swapOffset, room.swapOffset);
  assert.deepEqual(room.snapshotFor('swap-player-1').deadWall.doraIndicators, []);

  const selected = room.players.map((player) => player.hand.slice(0, 3).map((t) => t.id));
  const beforeOtherView = room.snapshotFor('swap-player-1');
  assert.equal(beforeOtherView.players[0].hand, null);
  assert.equal(beforeOtherView.players[1].hand.length, 12);

  assert.equal(room.selectSwap('swap-player-0', selected[0]).ready, false);
  assert.deepEqual(room.snapshotFor('swap-player-0').swapSelection, selected[0]);
  assert.equal(room.selectSwap('swap-player-0', []).ok, true);
  assert.deepEqual(room.snapshotFor('swap-player-0').swapSelection, []);

  for (let seat = 0; seat < room.players.length; seat++) {
    const result = room.selectSwap(`swap-player-${seat}`, selected[seat]);
    assert.equal(result.ok, true);
  }

  assert.equal(room.phase, 'playing');
  assert.ok(room.swapOffset >= 1 && room.swapOffset <= 4);
  assert.equal(room.deadWall.doraRevealed, 1);
  assert.equal(room.snapshotFor('swap-player-1').deadWall.doraIndicators.length, 1);
  assert.ok(room.players.every((p) => p.wildcard?.wildcard === true));
  assert.deepEqual(room.players.map((p) => p.hand.length), [13, 12, 12, 12, 12]);
  for (let seat = 0; seat < room.players.length; seat++) {
    const sourceSeat = (seat - room.swapOffset + 5) % 5;
    for (const id of selected[sourceSeat]) {
      assert.ok(room.players[seat].hand.some((t) => t.id === id));
    }
  }
});

test('Limitless Asura honors every configured game length', () => {
  const expectedHands = {
    east: 5,
    south: 10,
    west: 15,
    north: 20,
  };

  for (const [gameLength, handCount] of Object.entries(expectedHands)) {
    const room = new MahjongRoom(`length-${gameLength}`);
    for (let seat = 0; seat < room.players.length; seat++) {
      room.players[seat].id = `length-${gameLength}-${seat}`;
    }
    room.hostSocketId = `length-${gameLength}-0`;

    assert.equal(
      room.start(room.hostSocketId, {
        gameLength,
        gameMode: 'limitless-asura',
      }).ok,
      true
    );

    assert.equal(room.gameLength, gameLength);
    assert.equal(room.finalWindIndex, {
      east: 0,
      south: 1,
      west: 2,
      north: 3,
    }[gameLength]);

    let completedHands = 0;
    let round = {
      roundWindIndex: 0,
      roundInWind: 1,
      repeatCount: 0,
      dealerIndex: 0,
    };
    while (true) {
      const next = computeNextRoundState(
        round,
        { dealerKeeps: false },
        5,
        room.finalWindIndex
      );
      completedHands += 1;
      if (next.gameOver) break;
      round = {
        roundWindIndex: next.nextRoundWindIndex,
        roundInWind: next.nextRoundInWind,
        repeatCount: next.nextRepeatCount,
        dealerIndex: next.nextDealer,
      };
    }

    assert.equal(completedHands, handCount);
  }
});

test('Limitless Asura extends into the next wind when East-only has no target', () => {
  const room = new MahjongRoom('asura-tiebreaker-test');
  room.gameMode = 'limitless-asura';
  room.gameLength = 'east';
  room.scheduledFinalWindIndex = 0;
  room.finalWindIndex = 0;
  room.roundWindIndex = 0;
  room.roundInWind = 5;
  room.phase = 'playing';
  room.players.forEach((player) => {
    player.active = true;
    player.points = 40000;
    player.hand = [];
    player.melds = [];
    player.wildcard = null;
  });

  room.endRound('exhaustive');

  assert.equal(room.roundSummary.gameOver, false);
  assert.equal(room.roundSummary.enteringTiebreaker, true);
  assert.equal(room.inTiebreaker, true);
  assert.equal(room.roundSummary.nextRoundWindIndex, 1);
  assert.equal(room.roundSummary.nextRoundInWind, 1);
  assert.equal(room.finalWindIndex, 1);
});

test('Limitless Asura ron resumes after the caller seat', () => {
  const room = new MahjongRoom('ron-turn-test');
  room.gameMode = 'limitless-asura';
  room.phase = 'playing';
  room.currentTurn = 0;
  room.liveWall = [tile('sou', 9)];
  room.players.forEach((player) => {
    player.active = true;
    player.points = 40000;
    player.melds = [];
  });
  room.players[2].hand = [...twoSidedPhysicalHand];

  room.finishWins(
    [{ seat: 2, patterns: ['standard'] }],
    'ron',
    0,
    tile('man', 6)
  );

  assert.equal(room.players[2].active, false);
  assert.equal(room.currentTurn, 3);
  assert.equal(room.players[3].hand.length, 1);
  assert.ok(
    room.handPayments.some(
      (payment) => payment.fromSeat === 0 && payment.toSeat === 2 && payment.amount > 0
    )
  );
});

test('Asura ron on a riichi declaration tile leaves the stick for the next winner', () => {
  const room = new MahjongRoom('riichi-ron-test');
  room.gameMode = 'limitless-asura';
  room.phase = 'playing';
  room.currentTurn = 0;
  room.liveWall = [tile('sou', 9)];
  room.claimWindow = { riichiDeclaration: true, reason: 'discard' };
  room.riichiPot = 1000;
  room.handPayments = [
    { fromSeat: 0, toSeat: null, amount: 1000, type: 'riichi' },
  ];
  room.players.forEach((player) => {
    player.active = true;
    player.points = 40000;
    player.melds = [];
  });
  room.players[0].points = 39000;
  room.players[0].riichi = true;
  room.players[0].riichiStickOnTable = true;
  room.players[2].hand = [...twoSidedPhysicalHand];

  room.finishWins(
    [{ seat: 2, patterns: ['standard'] }],
    'ron',
    0,
    tile('man', 6)
  );

  assert.equal(room.players[0].riichi, true);
  assert.equal(room.players[0].riichiStickOnTable, true);
  const ronPayment = room.handPayments.find((payment) => payment.type === 'ron');
  assert.ok(ronPayment);
  assert.equal(room.players[0].points, 39000 - ronPayment.amount);
  assert.equal(room.players[2].points, 40000 + ronPayment.amount);
  assert.equal(room.riichiPot, 1000);
  assert.equal(room.lastRiichiPotClaim, null);
  assert.equal(room.handPayments.some((payment) => payment.type === 'riichi-pot'), false);
  assert.deepEqual(
    room.handPayments.map(({ fromSeat, toSeat, amount, type }) => ({
      fromSeat,
      toSeat,
      amount,
      type,
    })),
    [
      { fromSeat: 0, toSeat: null, amount: 1000, type: 'riichi' },
      { fromSeat: 0, toSeat: 2, amount: ronPayment.amount, type: 'ron' },
    ]
  );
});

test('Asura returns the declaration stick when the discarder is the only remaining player', () => {
  const room = new MahjongRoom('riichi-last-player-test');
  room.gameMode = 'limitless-asura';
  room.phase = 'playing';
  room.currentTurn = 0;
  room.liveWall = [tile('sou', 9)];
  room.claimWindow = { riichiDeclaration: true, reason: 'discard' };
  room.riichiPot = 1000;
  room.handPayments = [
    { fromSeat: 0, toSeat: null, amount: 1000, type: 'riichi' },
  ];
  room.players.forEach((player) => {
    player.active = false;
    player.points = 40000;
    player.melds = [];
  });
  room.players[0].active = true;
  room.players[2].active = true;
  room.players[0].riichi = true;
  room.players[0].riichiStickOnTable = true;
  room.players[2].hand = [...twoSidedPhysicalHand];

  room.finishWins(
    [{ seat: 2, patterns: ['standard'] }],
    'ron',
    0,
    tile('man', 6)
  );

  const ronPayment = room.handPayments.find((payment) => payment.type === 'ron');
  assert.ok(ronPayment);
  assert.equal(room.players[0].riichi, false);
  assert.equal(room.players[0].riichiStickOnTable, false);
  assert.equal(room.players[0].points, 41000 - ronPayment.amount);
  assert.equal(room.riichiPot, 0);
  assert.equal(room.handPayments.some((payment) => payment.type === 'riichi'), false);
});

test('standard ron on a riichi declaration tile returns the declaration stick', () => {
  const room = new MahjongRoom('standard-riichi-ron-test');
  room.gameMode = 'standard';
  room.phase = 'playing';
  room.currentTurn = 0;
  room.liveWall = [tile('sou', 9)];
  room.claimWindow = { riichiDeclaration: true, reason: 'discard' };
  room.riichiPot = 1000;
  room.handPayments = [
    { fromSeat: 0, toSeat: null, amount: 1000, type: 'riichi' },
  ];
  room.players.forEach((player) => {
    player.active = true;
    player.points = 40000;
    player.melds = [];
  });
  room.players[0].riichi = true;
  room.players[0].riichiStickOnTable = true;
  room.players[2].hand = [...twoSidedPhysicalHand];

  room.finishWins(
    [{ seat: 2, patterns: ['standard'] }],
    'ron',
    0,
    tile('man', 6)
  );

  const ronPayment = room.handPayments.find((payment) => payment.type === 'ron');
  assert.ok(ronPayment);
  assert.equal(room.players[0].riichi, false);
  assert.equal(room.players[0].riichiStickOnTable, false);
  assert.equal(room.players[0].points, 41000 - ronPayment.amount);
  assert.equal(room.riichiPot, 0);
  assert.equal(room.handPayments.some((payment) => payment.type === 'riichi'), false);
});

test('wildcard selects the highest-value valid tile assignment', () => {
  const doraIndicator = tile('man', 2); // 3m is dora.
  const result = calculateHan(
    twoSidedPhysicalHand,
    [],
    scoringOptions({ wildcard, doraIndicators: [doraIndicator] })
  );

  // Both 3m and 6m complete the hand, but 3m is dora and is therefore best.
  assert.equal(result.wildcardTile.suit, 'man');
  assert.equal(result.wildcardTile.rank, 3);
  assert.equal(result.dora, 2); // physical 3m + wildcard 3m
  assert.equal(result.totalHan, 5);
});

test('wildcard can act as a sixth copy of a tile', () => {
  const handWithFiveOnes = hand([
    ['man', 1],
    ['man', 1, 1],
    ['man', 1, 2],
    ['man', 1, 3],
    ['man', 1, 4],
    ['man', 2],
    ['man', 3],
    ['pin', 1],
    ['pin', 2],
    ['pin', 3],
    ['sou', 1],
    ['sou', 2],
    ['sou', 3],
  ]);

  assert.equal(canWin(handWithFiveOnes, [], tile('man', 1, 4), wildcard), true);
});

test('Asura ready hands follow the 12-tile shape rules', () => {
  const k = (spec) =>
    hand(
      spec.split(' ').map((s, i) => {
        const suit = { m: 'man', p: 'pin', s: 'sou', w: 'wind', d: 'dragon' }[s[1]];
        return [suit, Number(s[0]), i % 5];
      })
    );
  const ready = (spec) => isTenpai(k(spec), [], wildcard);
  const allKeys = getWaitKeys(k('1m 2m 3m 4p 5p 6p 7s 8s 9s 1w 1w 1w'), [], wildcard);

  // Four melds & a pair.
  assert.equal(ready('1m 2m 3m 4p 5p 6p 1s 2s 7s 8s 1w 1w'), true); // 2 melds, 2 partial, pair
  assert.equal(ready('1m 2m 3m 4p 5p 6p 7s 8s 9s 5s 1w 1w'), true); // 3 melds, lone, pair
  assert.equal(ready('1m 2m 3m 4p 5p 6p 7s 8s 9s 1s 3s 1w'), true); // 3 melds, partial, lone
  assert.equal(ready('1m 2m 3m 4p 5p 6p 7s 8s 9s 1w 1w 1w'), true); // 4 melds
  assert.equal(allKeys.length, 35);
  assert.equal(ready('1m 4m 7m 2p 5p 8p 3s 6s 9s 1w 2w 3w'), false);

  // Seven pairs.
  assert.equal(ready('1m 1m 3m 3m 5p 5p 7p 7p 9s 9s 1w 2w'), true); // 5 pairs, 2 lone
  assert.equal(ready('1m 1m 3m 3m 5p 5p 7p 7p 9s 9s 1w 1w'), true); // 6 pairs
  assert.equal(ready('1m 1m 1m 1m 5p 5p 7p 7p 9s 9s 1w 2w'), false); // pairs must be distinct

  // Thirteen orphans.
  assert.equal(ready('1m 9m 1p 9p 1s 9s 1w 2w 3w 4w 1d 1d'), true); // 11 distinct, one pair
  assert.equal(ready('1m 9m 1p 9p 1s 9s 1w 2w 3w 4w 1d 2d'), true); // 12 distinct
  assert.equal(ready('1m 9m 1p 9p 1s 9s 1w 2w 3w 4w 1d 5m'), false);
});

test('wildcard itself is not counted as a red tile', () => {
  const wildcardAsMan3 = {
    id: 'wildcard-as-man-3',
    suit: 'man',
    rank: 3,
    copy: 5,
    wildcardAssignment: true,
  };
  const result = countDora(
    [wildcardAsMan3],
    [],
    null,
    [tile('man', 2)],
    []
  );
  assert.equal(result.dora, 1);
});
