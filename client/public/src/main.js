import { PLAYER_ID, PLAYER_NAME } from './config.js';
import { connect, on, sendRollRequest } from './net.js';
import DiceInterpolator from './DiceInterpolator.js';
import { createDiceSim } from './diceSim.js';
import {
  setCurrentPlayer,
  setPlayerCount,
  setScore,
  setStatus,
  setRollEnabled,
  onRollClick,
  startCountdown,
  stopCountdown
} from './ui.js';

const canvas = document.getElementById('gameCanvas');
const sim = createDiceSim(canvas);
const interpolators = new Map();

let yourScore = 0;
let gameEnded = false;

onRollClick(() => {
  sendRollRequest();
  setRollEnabled(false, 'Rolling...');
});

on('status', (state) => {
  if (state === 'connected') {
    setStatus('Connected. Waiting for server state.');
  } else if (state === 'disconnected') {
    setStatus('Reconnecting...');
  } else if (state === 'error') {
    setStatus('Connection error');
  }
});

on('welcome', (msg) => {
  setStatus('Connected. Waiting for players.');
  setPlayerCount(msg.totalPlayers || 0);
  setRollEnabled(false, 'Waiting');
});

on('waiting', (msg) => {
  setPlayerCount(msg.totalPlayers || 0);
  setCurrentPlayer('Waiting...');
  stopCountdown();
  setRollEnabled(false, 'Waiting');
  setStatus(`Waiting for players (${msg.totalPlayers}/${msg.minPlayers}).`);
});

on('gameStart', (msg) => {
  gameEnded = false;
  setStatus('Game started');
  setRollEnabled(false, 'Waiting');
  setPlayerCount(msg.turnOrderIDs ? msg.turnOrderIDs.length : msg.totalPlayers || 0);
});

on('turnStart', (msg) => {
  if (gameEnded) return;
  resetInterpolation();
  const isYou = msg.activePlayerID === PLAYER_ID;
  setCurrentPlayer(msg.activePlayerName || 'Player');
  startCountdown(msg.deadlineMs);
  setRollEnabled(isYou, isYou ? 'Roll' : 'Waiting');
  setStatus(isYou ? 'Your turn' : `Waiting for ${msg.activePlayerName || 'opponent'}`, isYou ? 'important' : null);
});

on('rollStarted', (msg) => {
  if (gameEnded) return;
  resetInterpolation();
  const isYou = msg.activePlayerID === PLAYER_ID;
  setRollEnabled(false, isYou ? 'Rolling...' : 'Waiting');
});

on('stateUpdate', (frame) => {
  if (gameEnded || !frame || !Array.isArray(frame.dice)) return;
  const timestamp = frame.timestamp || Date.now();
  frame.dice.forEach((dieState) => {
    const interp = getInterpolator(dieState.id);
    interp.addState(dieState, timestamp);
  });
});

on('rollResult', (msg) => {
  if (gameEnded) return;
  applyFinalResults(msg.results || []);
  if (msg.activePlayerID === PLAYER_ID && typeof msg.total === 'number') {
    yourScore = msg.total;
    setScore(yourScore);
  }
});

on('turnEnd', () => {
  stopCountdown();
  setRollEnabled(false, 'Waiting');
});

// Let the next player know they're up soon (without enabling Roll yet).
on('turnEnd', (msg) => {
  if (gameEnded || !msg) return;
  if (msg.nextPlayerID === PLAYER_ID) {
    setStatus('You are next', 'important');
    setRollEnabled(false, 'You are next');
  }
});

on('gameEnded', (msg) => {
  gameEnded = true;
  yourScore = msg.youScore ?? yourScore;
  setScore(yourScore);
  setStatus('Game ended');
  stopCountdown();
  setRollEnabled(false, 'Ended');
});

on('error', (msg) => {
  setStatus(`Error: ${msg.code || msg.message}`);
});

window.addEventListener('resize', () => sim.resize());

setCurrentPlayer('Waiting...');
setScore(0);
setPlayerCount(0);
setStatus('Connecting...');
setRollEnabled(false, 'Connecting...');

connect();
requestAnimationFrame(tick);

function tick() {
  requestAnimationFrame(tick);
  renderInterpolated();
}

function getInterpolator(dieId) {
  if (!interpolators.has(dieId)) {
    interpolators.set(dieId, new DiceInterpolator(dieId));
  }
  return interpolators.get(dieId);
}

function resetInterpolation() {
  interpolators.clear();
  sim.setAuthoritativeTransforms([]);
}

function renderInterpolated() {
  const now = Date.now();
  const dice = [];
  interpolators.forEach((interp) => {
    const state = interp.isSettled ? interp.currentState : interp.update(now);
    dice.push({
      position: [state.position.x, state.position.y, state.position.z],
      quaternion: [state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w]
    });
  });
  sim.setAuthoritativeTransforms(dice);
}

function applyFinalResults(results) {
  results.forEach((res) => {
    const interp = getInterpolator(res.id);
    interp.setSettled({
      position: res.position,
      rotation: res.rotation
    });
  });
  renderInterpolated();
}
