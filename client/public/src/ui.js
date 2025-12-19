const els = {
  currentPlayer: document.getElementById('currentPlayer'),
  timer: document.getElementById('timer'),
  playerCount: document.getElementById('playerCount'),
  rollBtn: document.getElementById('rollBtn'),
  yourScore: document.getElementById('yourScore'),
  status: document.getElementById('status')
};

let countdownInterval = null;

export function setCurrentPlayer(name) {
  els.currentPlayer.textContent = name || 'Waiting...';
}

export function setPlayerCount(n) {
  els.playerCount.textContent = n ?? 0;
}

export function setScore(score) {
  els.yourScore.textContent = score ?? 0;
}

export function setStatus(text, type) {
  els.status.textContent = text || '';
  if (type === 'important') {
    els.status.classList.add('status-important');
  } else {
    els.status.classList.remove('status-important');
  }
}

export function setRollEnabled(enabled, label) {
  els.rollBtn.disabled = !enabled;
  els.rollBtn.textContent = label || (enabled ? 'Roll' : 'Waiting');
}

export function onRollClick(handler) {
  els.rollBtn.addEventListener('click', handler);
}

export function startCountdown(deadlineMs) {
  clearInterval(countdownInterval);
  if (!deadlineMs) {
    els.timer.textContent = '--';
    return;
  }
  const tick = () => {
    const remaining = Math.max(0, deadlineMs - Date.now());
    els.timer.textContent = `${(remaining / 1000).toFixed(1)}s`;
  };
  tick();
  countdownInterval = setInterval(tick, 100);
}

export function stopCountdown() {
  clearInterval(countdownInterval);
  els.timer.textContent = '--';
}
