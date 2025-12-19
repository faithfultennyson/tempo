const SessionState = {
  WAITING: 'WAITING',
  RUNNING: 'RUNNING',
  ENDED: 'ENDED'
};

function createSession(config) {
  return {
    state: SessionState.WAITING,
    players: new Map(),
    turnOrder: [],
    activeIndex: -1,
    deadline: null,
    turnTimer: null,
    startedAt: null,
    endedAt: null,
    config
  };
}

function resetSession(session) {
  clearTimeout(session.turnTimer);
  session.state = SessionState.WAITING;
  session.players = new Map();
  session.turnOrder = [];
  session.activeIndex = -1;
  session.deadline = null;
  session.turnTimer = null;
  session.startedAt = null;
  session.endedAt = null;
}

function createPlayer(id, name, ws) {
  return {
    id,
    name,
    ws,
    isConnected: true,
    hasRolled: false,
    hasBeenSkipped: false,
    secondChanceUsed: false,
    score: 0,
    lastSeenAt: Date.now()
  };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function connectedCount(session) {
  let count = 0;
  for (const p of session.players.values()) {
    if (p.isConnected) count++;
  }
  return count;
}

function registerHello(session, config, { playerID, playerName }, ws) {
  const nameTrimmed = (playerName || '').trim();
  if (!playerID || !nameTrimmed) {
    return { ok: false, error: 'INVALID_ID_OR_NAME' };
  }

  const existing = session.players.get(playerID);

  if (session.state === SessionState.ENDED) {
    return { ok: false, error: 'SESSION_ENDED' };
  }

  if (!existing) {
    if (session.state !== SessionState.WAITING) {
      return { ok: false, error: 'SESSION_RUNNING_NO_NEW_JOINS' };
    }
    if (session.players.size >= config.MAX_PLAYERS) {
      return { ok: false, error: 'SESSION_FULL' };
    }
    const player = createPlayer(playerID, nameTrimmed, ws);
    session.players.set(playerID, player);
    return { ok: true, player, isNew: true, reconnected: false, appendedToEnd: false };
  }

  // Reconnect flow
  const recon = evaluateReconnect(session, existing);
  if (!recon.ok) {
    return { ok: false, error: recon.reason };
  }

  existing.name = nameTrimmed || existing.name;
  existing.ws = ws;
  existing.isConnected = true;
  existing.lastSeenAt = Date.now();

  if (recon.appendToEnd) {
    session.turnOrder = session.turnOrder.filter((id) => id !== existing.id);
    session.turnOrder.push(existing.id);
    existing.hasRolled = false;
    existing.secondChanceUsed = true;
    existing.hasBeenSkipped = true;
  }

  return { ok: true, player: existing, isNew: false, reconnected: true, appendedToEnd: !!recon.appendToEnd };
}

function evaluateReconnect(session, player) {
  const state = session.state;
  if (state === SessionState.ENDED) {
    return { ok: false, reason: 'SESSION_ENDED' };
  }
  if (player.secondChanceUsed && !player.isConnected) {
    return { ok: false, reason: 'SECOND_CHANCE_EXHAUSTED' };
  }
  if (state === SessionState.WAITING) {
    return { ok: true };
  }

  // RUNNING rules
  // Cannot reconnect during last player's active turn
  const isLastTurnActive = session.activeIndex === session.turnOrder.length - 1;
  if (isLastTurnActive) {
    return { ok: false, reason: 'LAST_TURN_ACTIVE' };
  }

  if (player.hasBeenSkipped && !player.secondChanceUsed) {
    return { ok: true, appendToEnd: true };
  }

  return { ok: true };
}

function markHeartbeat(player) {
  player.lastSeenAt = Date.now();
}

function markDisconnected(session, playerID) {
  const player = session.players.get(playerID);
  if (!player) return;
  player.isConnected = false;
  player.ws = null;
  player.lastSeenAt = Date.now();
}

function readyToStart(session) {
  return session.state === SessionState.WAITING && connectedCount(session) >= session.config.MIN_PLAYERS;
}

function buildTurnOrder(session) {
  const connectedIds = Array.from(session.players.values())
    .filter((p) => p.isConnected)
    .map((p) => p.id);
  session.turnOrder = shuffle(connectedIds);
  session.activeIndex = 0;
}

function getActivePlayer(session) {
  if (session.activeIndex < 0 || session.activeIndex >= session.turnOrder.length) return null;
  const id = session.turnOrder[session.activeIndex];
  return session.players.get(id) || null;
}

function advanceToNext(session) {
  for (let i = session.activeIndex + 1; i < session.turnOrder.length; i++) {
    const p = session.players.get(session.turnOrder[i]);
    if (p && !p.hasRolled) {
      session.activeIndex = i;
      return true;
    }
  }
  return false;
}

function remainingTurns(session) {
  return session.turnOrder.filter((id) => {
    const p = session.players.get(id);
    return p && !p.hasRolled;
  });
}

module.exports = {
  SessionState,
  createSession,
  registerHello,
  markHeartbeat,
  markDisconnected,
  readyToStart,
  buildTurnOrder,
  getActivePlayer,
  advanceToNext,
  remainingTurns,
  connectedCount,
  resetSession
};

