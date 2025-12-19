export const WS_URL = (() => {
  const params = new URLSearchParams(location.search);
  const explicit = params.get('ws');
  if (explicit) return explicit;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsPort = params.get('wsPort');
  const host = location.hostname || 'localhost';
  const defaultLocalPort = '3000';
  const port =
    wsPort ||
    (host === 'localhost' || host === '127.0.0.1' ? defaultLocalPort : location.port || defaultLocalPort);

  // If the page is opened from file:// or a static dev server on a different port,
  // default back to localhost:3000 where the Node server runs.
  if (!location.hostname || location.protocol === 'file:') {
    return `ws://localhost:${port}`;
  }
  return `${proto}://${host}:${port}`;
})();

export const PLAYER_ID = (() => {
  const params = new URLSearchParams(location.search);
  const id = params.get('playerID') || params.get('playerId');
  if (id) return id;
  return `anon-${Math.random().toString(36).slice(2, 8)}`;
})();

export const PLAYER_NAME = (() => {
  const params = new URLSearchParams(location.search);
  const name = params.get('playerName');
  if (name) return name;
  return 'Guest';
})();

export const HEARTBEAT_INTERVAL_MS = 3000;

export const VISUAL_CONFIG = {
  gravity: -18,
  restitution: 0.25,
  friction: 0.96,
  stopThreshold: 0.15,
  // Size of the board / collision area (world units). Keep in sync with server tableSize (10).
  boardSize: 10,
  // Margin to add to computed required fit (8% by default)
  uiScaleMargin: 0.08,
  // How many tiles to extend in +X/-X and +Z/-Z directions for visual-only tiling.
  // For example tileSpreadX = 2 means tiles at -2,-1,0,1,2 (5 across total).
  tileSpreadX: 2,
  tileSpreadY: 3
};
