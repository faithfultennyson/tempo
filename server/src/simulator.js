/* Simple simulator to test the server without a browser.
   Usage:
     node src/simulator.js            # uses PORT from config and 3 bots
     SIM_PLAYERS=4 SIM_PORT=4000 node src/simulator.js
*/

const WebSocket = require('ws');
const config = require('./config');

const PLAYER_COUNT = parseInt(process.env.SIM_PLAYERS || '3', 10);
const PORT = parseInt(process.env.SIM_PORT || config.PORT, 10);
const WS_URL = `ws://localhost:${PORT}`;

function log(id, msg) {
  console.log(`[bot-${id}] ${msg}`);
}

for (let i = 0; i < PLAYER_COUNT; i++) {
  spawnBot(i + 1);
}

function spawnBot(index) {
  const playerID = `bot-${index}`;
  const playerName = `Bot ${index}`;
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'HELLO', playerID, playerName }));
    log(playerID, 'HELLO sent');
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      log(playerID, `Bad JSON: ${data}`);
      return;
    }
    handleMessage(ws, playerID, msg);
  });

  ws.on('close', () => {
    log(playerID, 'connection closed');
  });
}

function handleMessage(ws, playerID, msg) {
  switch (msg.type) {
    case 'PING':
      ws.send(JSON.stringify({ type: 'PONG' }));
      break;
    case 'TURN_START':
      if (msg.activePlayerID === playerID) {
        const delay = Math.random() * 1000 + 200; // roll shortly after turn begins
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'ROLL_REQUEST', playerID }));
        }, delay);
      }
      break;
    case 'ROLL_RESULT':
      if (msg.activePlayerID === playerID) {
        log(playerID, `rolled ${msg.dice.join('+')}=${msg.total} (auto:${msg.auto ? 'yes' : 'no'})`);
      }
      break;
    case 'GAME_ENDED':
      log(playerID, `final score ${msg.youScore} of ${msg.totalPlayers} players`);
      break;
    case 'ERROR':
      log(playerID, `error ${msg.code}: ${msg.message}`);
      break;
    default:
      break;
  }
}
