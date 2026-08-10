/** Prevailing round winds (场风) — same four as standard riichi. */
export const ROUND_WINDS = ['东', '南', '西', '北'];
export const ROUND_WINDS_EN = ['East', 'South', 'West', 'North'];

/** Host-selectable match length: play through this final round wind. */
export const GAME_LENGTHS = {
  east: { id: 'east', label: 'East only', finalWindIndex: 0 },
  south: { id: 'south', label: 'East–South', finalWindIndex: 1 },
  west: { id: 'west', label: 'East–West', finalWindIndex: 2 },
  north: { id: 'north', label: 'East–North', finalWindIndex: 3 },
};

/**
 * @param {string} [id]
 * @returns {{ id: string, label: string, finalWindIndex: number }}
 */
export function parseGameLength(id) {
  return GAME_LENGTHS[id] ?? GAME_LENGTHS.south;
}

/**
 * @param {number} roundWindIndex 0=East … 3=North
 * @param {number} roundInWind 1…playerCount within the current round wind
 * @param {number} repeatCount honba / repeat counter (本場)
 */
export function formatRoundName(roundWindIndex, roundInWind, repeatCount) {
  const wind = ROUND_WINDS_EN[roundWindIndex] ?? 'East';
  let name = `${wind} ${roundInWind}`;
  if (repeatCount > 0) {
    name += `, ${repeatCount} repeat${repeatCount !== 1 ? 's' : ''}`;
  }
  return name;
}

/**
 * Compute dealer & round counters for the next hand.
 * Repeats +1 when dealer keeps (won or ready at exhaustive draw); else repeat → 0 and dealer advances.
 * When the dealer seat would leave the final wind of the chosen game length, `gameOver` is set.
 * @param {{ roundWindIndex: number, roundInWind: number, repeatCount: number, dealerIndex: number }} current
 * @param {{ dealerKeeps: boolean }} result
 * @param {number} [playerCount]
 * @param {number} [finalWindIndex] last round wind to play (0=east … 3=north)
 */
export function computeNextRoundState(
  current,
  { dealerKeeps },
  playerCount = 5,
  finalWindIndex = 3
) {
  const { roundWindIndex, roundInWind, repeatCount, dealerIndex } = current;

  if (dealerKeeps) {
    return {
      nextDealer: dealerIndex,
      nextRoundWindIndex: roundWindIndex,
      nextRoundInWind: roundInWind,
      nextRepeatCount: repeatCount + 1,
      gameOver: false,
    };
  }

  let nextRoundInWind = roundInWind + 1;
  let nextRoundWindIndex = roundWindIndex;
  if (nextRoundInWind > playerCount) {
    nextRoundInWind = 1;
    nextRoundWindIndex = roundWindIndex + 1;
    if (nextRoundWindIndex > finalWindIndex) {
      return {
        nextDealer: (dealerIndex + 1) % playerCount,
        nextRoundWindIndex: roundWindIndex,
        nextRoundInWind: roundInWind,
        nextRepeatCount: 0,
        gameOver: true,
        gameOverReason: 'length',
      };
    }
  }

  return {
    nextDealer: (dealerIndex + 1) % playerCount,
    nextRoundWindIndex,
    nextRoundInWind,
    nextRepeatCount: 0,
    gameOver: false,
  };
}

export function roundSnapshot(roundWindIndex, roundInWind, repeatCount) {
  return {
    windIndex: roundWindIndex,
    inWind: roundInWind,
    repeatCount,
    name: formatRoundName(roundWindIndex, roundInWind, repeatCount),
  };
}
