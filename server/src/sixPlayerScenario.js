// Scripted 6-player scenario with dynamic disconnect/reconnect to verify appended turn order.
// Usage:
//   MAX_PLAYERS=6 TURN_TIME_MS=8000 npm run sim6 -- ws://localhost:3001
// Behavior:
// - 6 bots join.
// - Target bot (p2) drops right before its turn, stays out for 2 completed turns, then reconnects and should be appended to the end.
// - p4 intentionally times out (auto-roll) to keep the session running while p2 is away.
// - Others roll normally.

const WebSocket = require('ws');

const WS_URL = process.argv[2] || 'ws://localhost:3001';
const TURN_TIME_MS = parseInt(process.env.TURN_TIME_MS || '8000', 10);

const TARGET = 'p2';
const RECONNECT_AFTER_TURNS = 2; // how many completed turns while target is offline before reconnect

const PLAN = {
  p1: { action: 'roll', delay: 600 },
  p2: { action: 'roll', delay: 800 }, // normal plan after reconnect
  p3: { action: 'roll', delay: 900 },
  p4: { action: 'timeout' }, // extend session
  p5: { action: 'roll', delay: 900 },
  p6: { action: 'roll', delay: 900 }
};

const bots = {};
let targetOffline = false;
let turnsWhileOffline = 0;
let reconnectScheduled = false;

function log(id, msg) {
  console.log(`[${id}] ${msg}`);
}

function connectBot(id, name) {
  const ws = new WebSocket(WS_URL);
  const bot = (bots[id] = bots[id] || { id, name, hasDisconnectedOnce: false });
  bot.ws = ws;

  ws.on('open', () => {
    log(id, 'connected');
    ws.send(JSON.stringify({ type: 'HELLO', playerID: id, playerName: name }));
  });

  ws.on('close', () => {
    log(id, 'connection closed');
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      log(id, `bad JSON: ${data}`);
      return;
    }
    handleMessage(bot, msg);
  });
}

function handleMessage(bot, msg) {
  const { id, ws } = bot;

  // Global tracking for target while offline
  if (msg.type === 'TURN_END' && targetOffline) {
    turnsWhileOffline += 1;
    log('sim', `turnsWhileOffline=${turnsWhileOffline}`);
    if (!reconnectScheduled && turnsWhileOffline >= RECONNECT_AFTER_TURNS) {
      reconnectScheduled = true;
      setTimeout(() => {
        log('sim', `reconnecting ${TARGET} after ${turnsWhileOffline} turns offline...`);
        connectBot(TARGET, `Re_${TARGET}`);
      }, 300);
    }
  }

  switch (msg.type) {
    case 'PING':
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PONG' }));
      return;
    case 'WELCOME':
    case 'WAITING_FOR_PLAYERS':
    case 'GAME_START':
      log(id, `${msg.type.toLowerCase()}: ${JSON.stringify(msg)}`);
      return;
    case 'TURN_START':
      handleTurnStart(bot, msg);
      return;
    case 'ROLL_RESULT':
      if (msg.activePlayerID === id) {
        log(id, `rolled ${msg.dice.join('+')}=${msg.total} (auto=${msg.auto})`);
      }
      return;
    case 'TURN_END':
      log(id, `turn_end -> nextPlayer=${msg.nextPlayerID || 'none'}`);
      return;
    case 'GAME_ENDED':
      log(id, `game_ended score=${msg.youScore} of ${msg.totalPlayers}`);
      return;
    case 'ERROR':
      log(id, `error ${msg.code || ''} ${msg.message || ''}`);
      return;
    default:
      return;
  }
}

function handleTurnStart(bot, msg) {
  const { id, ws } = bot;
  if (msg.activePlayerID !== id) return;

  // If this is the target and we haven't disconnected yet, drop right before taking the turn.
  if (id === TARGET && !bot.hasDisconnectedOnce) {
    bot.hasDisconnectedOnce = true;
    targetOffline = true;
    turnsWhileOffline = 0;
    reconnectScheduled = false;
    log(id, `dropping connection before taking turn to force append later (TURN_TIME_MS=${TURN_TIME_MS})`);
    setTimeout(() => ws.close(), 200);
    return;
  }

  const plan = PLAN[id] || { action: 'roll', delay: 800 };

  if (plan.action === 'roll') {
    const delay = plan.delay || 600;
    log(id, `my turn -> rolling in ${delay}ms`);
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ROLL_REQUEST', playerID: id }));
      }
    }, delay);
    return;
  }

  if (plan.action === 'timeout') {
    log(id, `my turn -> intentionally waiting for auto-roll (TURN_TIME_MS=${TURN_TIME_MS})`);
    return; // server will auto-roll after TURN_TIME_MS
  }
}

// Kick off
['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].forEach((id, idx) => {
  setTimeout(() => connectBot(id, `Bot ${id.toUpperCase()}`), idx * 250);
});

log('sim', `Connecting 6 bots to ${WS_URL}. Target=${TARGET} will drop before its turn, stay offline for ${RECONNECT_AFTER_TURNS} turns, then reconnect to be appended.`);
