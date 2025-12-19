require('dotenv').config();

const toInt = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
};

module.exports = {
  PORT: toInt(process.env.PORT, 3000),
  MIN_PLAYERS: toInt(process.env.MIN_PLAYERS, 2),
  MAX_PLAYERS: toInt(process.env.MAX_PLAYERS, 4),
  TURN_TIME_MS: toInt(process.env.TURN_TIME_MS, 5000),
  POST_GAME_WAIT_MS: toInt(process.env.POST_GAME_WAIT_MS, 6000),
  SESSION_ID: process.env.SESSION_ID || 'default'
};
