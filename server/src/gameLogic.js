const { SessionState, buildTurnOrder, getActivePlayer, advanceToNext } = require('./sessionManager');

function describeTurnOrder(session) {
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

function nextPendingPlayer(session) {
  for (let i = session.activeIndex + 1; i < session.turnOrder.length; i++) {
    const pid = session.turnOrder[i];
    const p = session.players.get(pid);
    if (p && !p.hasRolled) return p;
  }
  return null;
}

function logFlow(label, session) {
  const active = getActivePlayer(session);
  const next = nextPendingPlayer(session);
  console.log(
    `[Flow] ${label} | state=${session.state} | active=${active ? `${active.id}/${active.name}` : 'none'} | next=${next ? `${next.id}/${next.name}` : 'none'} | order=${describeTurnOrder(session)}`
  );
}

function startSession(session, broadcast, onRollStart) {
  session.state = SessionState.RUNNING;
  session.startedAt = Date.now();
  buildTurnOrder(session);
  logFlow('GAME_START turn order ready', session);
  const firstPlayerID = session.turnOrder[0] || null;
  broadcast('GAME_START', {
    firstPlayerID,
    turnOrderIDs: session.turnOrder
  });
  if (firstPlayerID) {
    startTurn(session, broadcast, onRollStart);
  } else {
    endGame(session, broadcast);
  }
}

function startTurn(session, broadcast, onRollStart) {
  clearTimeout(session.turnTimer);
  const active = getActivePlayer(session);
  if (!active) {
    endGame(session, broadcast);
    return;
  }
  if (!active.isConnected) {
    // Skip immediately if the active player is offline; finishTurn will decide whether to continue or end.
    skipActive(session, broadcast, onRollStart);
    return;
  }
  session.deadline = Date.now() + session.config.TURN_TIME_MS;
  session.turnTimer = setTimeout(() => {
    const res = autoRoll(session, broadcast);
    if (res && res.pendingRoll && onRollStart) {
      onRollStart(res.pendingRoll);
    }
  }, session.config.TURN_TIME_MS);
  broadcast('TURN_START', {
    activePlayerID: active.id,
    activePlayerName: active.name,
    deadlineMs: session.deadline,
    totalPlayers: session.turnOrder.length
  });
  logFlow('TURN_START', session);
}

function autoRoll(session, broadcast) {
  const active = getActivePlayer(session);
  if (!active || active.hasRolled || !active.isConnected) return;
  return performRoll(session, active, broadcast, true);
}

function handleRollRequest(session, playerID, broadcast) {
  const active = getActivePlayer(session);
  if (!active) return { ok: false, error: 'NO_ACTIVE_PLAYER' };
  if (active.id !== playerID) return { ok: false, error: 'NOT_YOUR_TURN' };
  if (active.hasRolled) return { ok: false, error: 'ALREADY_ROLLED' };

  return performRoll(session, active, broadcast, false);
}

function performRoll(session, active, broadcast, isAuto) {
  clearTimeout(session.turnTimer);
  const visualSeed = Math.floor(Math.random() * 1e9);
  active.hasRolled = true; // prevent duplicate requests this turn
  session.pendingRoll = {
    playerID: active.id,
    isAuto,
    visualSeed,
    requestedAt: Date.now()
  };

  broadcast('ROLL_STARTED', {
    activePlayerID: active.id,
    timestamp: Date.now()
  });

  return { ok: true, pendingRoll: session.pendingRoll };
}

function skipActive(session, broadcast, onRollStart) {
  const active = getActivePlayer(session);
  if (!active) return;
  clearTimeout(session.turnTimer);
  active.hasBeenSkipped = true;
  active.hasRolled = true;
  finishTurn(session, broadcast, onRollStart);
}

function finishTurn(session, broadcast, onRollStart) {
  const previousActive = getActivePlayer(session);
  const hadNext = advanceToNext(session);
  const nextPlayer = hadNext ? getActivePlayer(session) : null;
  broadcast('TURN_END', { nextPlayerID: nextPlayer ? nextPlayer.id : null });
  logFlow(
    hadNext
      ? `TURN_END ${previousActive ? previousActive.id : 'none'} -> ${nextPlayer ? nextPlayer.id : 'none'}`
      : `TURN_END ${previousActive ? previousActive.id : 'none'} (game wrapping)`,
    session
  );
  if (hadNext) {
    startTurn(session, broadcast, onRollStart);
  } else {
    endGame(session, broadcast);
  }
}

function endGame(session, broadcast) {
  clearTimeout(session.turnTimer);
  if (session.state === SessionState.ENDED) return;
  session.state = SessionState.ENDED;
  session.endedAt = Date.now();
  logFlow('GAME_ENDED', session);
  for (const player of session.players.values()) {
    broadcast(
      'GAME_ENDED',
      {
        youScore: player.score || 0,
        totalPlayers: session.turnOrder.length
      },
      player.id
    );
  }
}

module.exports = {
  startSession,
  startTurn,
  handleRollRequest,
  skipActive,
  finishTurn,
  endGame
};
