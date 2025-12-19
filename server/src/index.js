const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const {
  SessionState,
  createSession,
  registerHello,
  readyToStart,
  markHeartbeat,
  markDisconnected,
  getActivePlayer,
  connectedCount,
  advanceToNext,
  resetSession
} = require('./sessionManager');
const { startSession, handleRollRequest, skipActive, startTurn, finishTurn, endGame } = require('./gameLogic');
const { send, broadcast, sendError } = require('./wsProtocol');
const DicePhysicsSimulation = require('./physics/DicePhysicsSimulation');

const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 9000;
const PHYSICS_HZ = 60;
const STATE_HZ = 20;
const STATE_INTERVAL_MS = Math.floor(1000 / STATE_HZ);

const session = createSession(config);
const dicePhysics = new DicePhysicsSimulation();
let physicsInterval = null;
let stateInterval = null;
let lastStepTime = Date.now();
let rollingPlayerID = null;

function getNextPendingPlayer() {
  for (let i = session.activeIndex + 1; i < session.turnOrder.length; i++) {
    const player = session.players.get(session.turnOrder[i]);
    if (player && !player.hasRolled) return player;
  }
  return null;
}

function formatTurnOrder() {
  if (!session.turnOrder.length) return 'waiting';
  return session.turnOrder
    .map((id, idx) => {
      const p = session.players.get(id);
      const label = p ? `${p.id}/${p.name}` : id;
      if (idx === session.activeIndex) return `${label}*`;
      if (p && p.hasRolled) return `${label} (done)`;
      return label;
    })
    .join(' -> ');
}

function logTurnSnapshot(reason) {
  const active = getActivePlayer(session);
  const next = getNextPendingPlayer();
  console.log(
    `[Turn] ${reason} | state=${session.state} | active=${active ? `${active.id}/${active.name}` : 'none'} | next=${next ? `${next.id}/${next.name}` : 'none'} | order=${formatTurnOrder()}`
  );
}

function resetPhysicsLoops() {
  clearInterval(physicsInterval);
  clearInterval(stateInterval);
  physicsInterval = null;
  stateInterval = null;
  rollingPlayerID = null;
  dicePhysics.cleanup();
  lastStepTime = Date.now();
  session.pendingRoll = null;
}

// Minimal HTTP server (health + optional static from client/public if present)
const clientPublic = path.join(__dirname, '..', '..', 'client', 'public');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/matchmake')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessionId: config.SESSION_ID, port: config.PORT }));
    return;
  }

  if (fs.existsSync(clientPublic)) {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(clientPublic, reqPath);
    if (filePath.startsWith(clientPublic) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mime =
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.obj': 'text/plain',
          '.mtl': 'text/plain',
          '.wav': 'audio/wav'
        }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Dice server running');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.playerID = null;

  ws.on('message', (data) => {
    handleMessage(ws, data.toString());
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });
});

function handleMessage(ws, data) {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch (err) {
    sendError(ws, 'BAD_JSON', 'Invalid JSON');
    return;
  }

  const { type } = msg;
  if (!type) {
    sendError(ws, 'NO_TYPE', 'Message type missing');
    return;
  }

  if (type === 'PONG') {
    if (ws.playerID) {
      const player = session.players.get(ws.playerID);
      if (player) markHeartbeat(player);
    }
    return;
  }

  if (type === 'HELLO') {
    handleHello(ws, msg);
    return;
  }

  if (!ws.playerID) {
    sendError(ws, 'AUTH_REQUIRED', 'Send HELLO first');
    return;
  }

  const player = session.players.get(ws.playerID);
  if (player) markHeartbeat(player);

  switch (type) {
    case 'ROLL_REQUEST': {
      const result = handleRollRequest(session, ws.playerID, sendAll);
      if (!result.ok) {
        sendError(ws, result.error, 'Cannot roll now');
      } else if (result.pendingRoll) {
        startDiceRoll(result.pendingRoll);
      }
      break;
    }
    default:
      sendError(ws, 'UNKNOWN_TYPE', `Unknown message type ${type}`);
  }
}

function handleHello(ws, msg) {
  if (session.state === SessionState.ENDED) {
    resetPhysicsLoops();
    resetSession(session);
  }

  const playerID = msg.playerID || msg.playerId || null;
  const playerName = msg.playerName || '';
  const reg = registerHello(session, config, { playerID, playerName }, ws);
  if (!reg.ok) {
    sendError(ws, reg.error, 'Join rejected');
    return;
  }

  ws.playerID = reg.player.id;

  if (reg.isNew) {
    console.log(
      `[Join] ${reg.player.id}/${reg.player.name} joined. Connected=${connectedCount(session)} of ${config.MAX_PLAYERS}.`
    );
  } else if (reg.reconnected) {
    const moveNote = reg.appendedToEnd ? ' (moved to end of turn order)' : '';
    console.log(
      `[Reconnect] ${reg.player.id}/${reg.player.name} reconnected${moveNote}. Connected=${connectedCount(session)} of ${config.MAX_PLAYERS}.`
    );
  }
  logTurnSnapshot('HELLO processed');

  send(ws, 'WELCOME', {
    playerID: reg.player.id,
    playerNameTrimmed: reg.player.name,
    totalPlayers: session.players.size,
    minPlayers: config.MIN_PLAYERS,
    maxPlayers: config.MAX_PLAYERS,
    gameState: session.state
  });

  if (session.state === SessionState.ENDED) {
    resetPhysicsLoops();
    resetSession(session);
    session.players.set(reg.player.id, reg.player);
  }

  if (session.state === SessionState.WAITING) {
    sendAll('WAITING_FOR_PLAYERS', {
      totalPlayers: connectedCount(session),
      minPlayers: config.MIN_PLAYERS
    });
    if (readyToStart(session)) {
      startSession(session, sendAll, startDiceRoll);
    }
    return;
  }

  if (session.state === SessionState.RUNNING) {
    const active = getActivePlayer(session);
    if (active) {
      send(ws, 'TURN_START', {
        activePlayerID: active.id,
        activePlayerName: active.name,
        deadlineMs: session.deadline,
        totalPlayers: session.turnOrder.length
      });
      logTurnSnapshot('HELLO -> sent TURN_START to rejoiner');
    }
    return;
  }
}

function handleDisconnect(ws) {
  const playerID = ws.playerID;
  if (!playerID) return;

  const player = session.players.get(playerID);
  const activeBefore = getActivePlayer(session);
  const wasActive = session.state === SessionState.RUNNING && activeBefore && activeBefore.id === playerID;

  markDisconnected(session, playerID);
  console.log(
    `[Disconnect] ${playerID}/${(player && player.name) || 'unknown'} disconnected. wasActive=${wasActive} | connected=${connectedCount(session)}`
  );
  // If active player disconnects mid-turn, skip per rules
  if (wasActive) {
    resetPhysicsLoops();
    skipActive(session, sendAll, startDiceRoll);
    logTurnSnapshot('active disconnected -> skipped');
  } else {
    logTurnSnapshot('player disconnected');
  }
}

function sendAll(type, payload, targetPlayerID = null) {
  broadcast(session, type, payload, targetPlayerID);
}

function startDiceRoll(pendingRoll) {
  if (!pendingRoll || !pendingRoll.playerID) return;
  resetPhysicsLoops();
  rollingPlayerID = pendingRoll.playerID;
  dicePhysics.rollDice(2);
  lastStepTime = Date.now();

  // Run a few warmup steps so gravity is already acting before the first broadcast
  for (let i = 0; i < 3; i++) {
    dicePhysics.step(1 / 60);
  }

  // Send initial state with dice already in motion
  sendAll('STATE_UPDATE', {
    timestamp: Date.now(),
    dice: dicePhysics.getDiceState()
  });

  physicsInterval = setInterval(() => {
    const now = Date.now();
    const deltaTime = (now - lastStepTime) / 1000;
    lastStepTime = now;
    dicePhysics.step(deltaTime);
    if (dicePhysics.checkSettlement()) {
      handleDiceSettled(pendingRoll);
    }
  }, Math.floor(1000 / PHYSICS_HZ));

  stateInterval = setInterval(() => {
    if (!dicePhysics.isRolling) return;
    const state = dicePhysics.getDiceState();
    sendAll('STATE_UPDATE', {
      timestamp: Date.now(),
      dice: state
    });
  }, STATE_INTERVAL_MS);
}

function handleDiceSettled(pendingRoll) {
  clearInterval(physicsInterval);
  clearInterval(stateInterval);
  physicsInterval = null;
  stateInterval = null;
  dicePhysics.isRolling = false;
  rollingPlayerID = null;
  session.pendingRoll = null;

  const results = dicePhysics.getFinalResults();
  const values = results.map((r) => r.value);
  const total = values.reduce((sum, v) => sum + v, 0);
  const active = getActivePlayer(session);
  if (active && active.id === pendingRoll.playerID) {
    active.score = total;
  }

  sendAll('ROLL_RESULT', {
    activePlayerID: pendingRoll.playerID,
    results,
    dice: values,
    total,
    auto: pendingRoll.isAuto || false,
    timestamp: Date.now()
  });

  setTimeout(() => finishTurn(session, sendAll, startDiceRoll), 200);
}

// Heartbeat: send PING and prune stale connections
setInterval(() => {
  sendAll('PING', {});
}, HEARTBEAT_INTERVAL_MS);

setInterval(() => {
  const now = Date.now();
  for (const player of session.players.values()) {
    if (!player.isConnected) continue;
    if (now - player.lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
      markDisconnected(session, player.id);
      console.log(`[Timeout] ${player.id}/${player.name} marked disconnected after heartbeat timeout.`);
      const active = getActivePlayer(session);
      if (session.state === SessionState.RUNNING && active && active.id === player.id) {
        skipActive(session, sendAll, startDiceRoll);
        logTurnSnapshot('active timed out -> skipped');
      } else {
        logTurnSnapshot('player timed out');
      }
    }
  }
}, HEARTBEAT_INTERVAL_MS);

server.listen(config.PORT, () => {
  console.log(`Server listening on ${config.PORT}`);
});
