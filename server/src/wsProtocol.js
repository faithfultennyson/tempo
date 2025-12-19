const WebSocket = require('ws');

function safeSend(ws, message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function send(ws, type, payload = {}) {
  safeSend(ws, { type, ...payload });
}

function broadcast(session, type, payload = {}, targetPlayerID = null) {
  for (const player of session.players.values()) {
    if (targetPlayerID && player.id !== targetPlayerID) continue;
    safeSend(player.ws, { type, ...payload });
  }
}

function sendError(ws, code, message) {
  send(ws, 'ERROR', { code, message });
}

module.exports = {
  send,
  broadcast,
  sendError
};
