import { PLAYER_ID, PLAYER_NAME } from './config.js';

const State = {
  WAITING: 'WAITING',
  RUNNING: 'RUNNING',
  ENDED: 'ENDED'
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randDie() {
  return 1 + Math.floor(Math.random() * 6);
}

export function createLocalGame(opts = {}) {
  const MIN_PLAYERS = opts.minPlayers ?? 2;
  const TURN_TIME_MS = opts.turnTimeMs ?? 5000;
  const BOT_COUNT = opts.botCount ?? 3;

  const listeners = {};
  const emit = (type, payload) => {
    (listeners[type] || []).forEach((fn) => fn(payload));
  };
  const on = (type, fn) => {
    listeners[type] = listeners[type] || [];
    listeners[type].push(fn);
  };

  const players = [];
  const addPlayer = (id, name, isBot = false) => {
    players.push({ id, name, isBot, hasRolled: false, score: 0 });
  };

  addPlayer(PLAYER_ID, PLAYER_NAME || 'You', false);
  for (let i = 0; i < BOT_COUNT; i++) {
    addPlayer(`bot-${i + 1}`, `Bot ${i + 1}`, true);
  }

  let state = State.WAITING;
  let turnOrder = [];
  let activeIndex = -1;
  let turnTimer = null;

  emit('WAITING_FOR_PLAYERS', { totalPlayers: players.length, minPlayers: MIN_PLAYERS });

  function start() {
    if (state !== State.WAITING) return;
    if (players.length < MIN_PLAYERS) {
      emit('ERROR', { code: 'NOT_ENOUGH_PLAYERS', message: `Need at least ${MIN_PLAYERS} players` });
      return;
    }
    state = State.RUNNING;
    turnOrder = shuffle(players.map((p) => p.id));
    activeIndex = 0;
    emit('GAME_START', {
      firstPlayerID: turnOrder[0],
      turnOrderIDs: turnOrder,
      totalPlayers: players.length
    });
    startTurn();
  }

  function getActive() {
    if (activeIndex < 0 || activeIndex >= turnOrder.length) return null;
    return players.find((p) => p.id === turnOrder[activeIndex]) || null;
  }

  function startTurn() {
    const active = getActive();
    if (!active) {
      endGame();
      return;
    }
    const deadlineMs = Date.now() + TURN_TIME_MS;
    clearTimeout(turnTimer);
    turnTimer = setTimeout(() => autoRoll(), TURN_TIME_MS);
    emit('TURN_START', {
      activePlayerID: active.id,
      activePlayerName: active.name,
      deadlineMs,
      totalPlayers: players.length
    });

    if (active.isBot) {
      const delay = Math.random() * 800 + 200;
      setTimeout(() => roll(active.id, true), delay);
    }
  }

  function roll(playerID, isAuto = false) {
    if (state !== State.RUNNING) return;
    const active = getActive();
    if (!active || active.id !== playerID || active.hasRolled) return;
    clearTimeout(turnTimer);
    const d1 = randDie();
    const d2 = randDie();
    const total = d1 + d2;
    active.hasRolled = true;
    active.score = total;
    const visualSeed = Math.floor(Math.random() * 1e9);
    emit('ROLL_RESULT', {
      activePlayerID: active.id,
      dice: [d1, d2],
      total,
      visualSeed,
      auto: isAuto
    });
    endTurn();
  }

  function autoRoll() {
    const active = getActive();
    if (active) roll(active.id, true);
  }

  function endTurn() {
    const nextId = turnOrder[activeIndex + 1] || null;
    emit('TURN_END', { nextPlayerID: nextId });
    activeIndex += 1;
    if (activeIndex >= turnOrder.length) {
      endGame();
    } else {
      startTurn();
    }
  }

  function endGame() {
    if (state === State.ENDED) return;
    clearTimeout(turnTimer);
    state = State.ENDED;
    const you = players.find((p) => p.id === PLAYER_ID);
    emit('GAME_ENDED', {
      youScore: you?.score || 0,
      totalPlayers: players.length
    });
  }

  return {
    on,
    start,
    roll: () => roll(PLAYER_ID, false)
  };
}
