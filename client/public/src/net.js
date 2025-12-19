import { WS_URL, PLAYER_ID, PLAYER_NAME } from './config.js';

const listeners = {};
let ws = null;
let reconnectTimer = null;

function on(event, handler) {
  listeners[event] = listeners[event] || [];
  listeners[event].push(handler);
}

function emit(event, payload) {
  (listeners[event] || []).forEach((fn) => fn(payload));
}

export function connect() {
  clearTimeout(reconnectTimer);
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    emit('status', 'connected');
    ws.send(JSON.stringify({ type: 'HELLO', playerID: PLAYER_ID, playerName: PLAYER_NAME }));
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    handleMessage(msg);
  });

  ws.addEventListener('close', () => {
    emit('status', 'disconnected');
    reconnectTimer = setTimeout(() => connect(), 1200);
  });

  ws.addEventListener('error', (err) => {
    emit('status', 'error');
    emit('error', { code: 'WS_ERROR', message: err.message || 'WebSocket error' });
  });
}

export function sendRollRequest() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ROLL_REQUEST', playerID: PLAYER_ID }));
  }
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'PING':
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
      break;
    case 'WELCOME':
      emit('welcome', msg);
      break;
    case 'WAITING_FOR_PLAYERS':
      emit('waiting', msg);
      break;
    case 'GAME_START':
      emit('gameStart', msg);
      break;
    case 'TURN_START':
      emit('turnStart', msg);
      break;
    case 'ROLL_STARTED':
      emit('rollStarted', msg);
      break;
    case 'ROLL_RESULT':
      emit('rollResult', msg);
      break;
    case 'TURN_END':
      emit('turnEnd', msg);
      break;
    case 'GAME_ENDED':
      emit('gameEnded', msg);
      break;
    case 'STATE_UPDATE':
      emit('stateUpdate', msg);
      break;
    case 'ERROR':
      emit('error', msg);
      break;
    default:
      break;
  }
}

export { on, PLAYER_ID, PLAYER_NAME };
