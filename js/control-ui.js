'use strict';

/* ================= control page ================= */
// All control-page UI state lives in CTL, so names do not clash with the converter page.
const CTL = {
  bode: $('#bode'), bodeInfo: $('#bodeInfo'), side: $('#ctlSide'), design: $('#designBody'),
};

function buildControlUI() {
  CTL.side.innerHTML = '<h2>Control</h2><p class="hint">Control settings will appear here.</p>';
  CTL.design.innerHTML = '<p class="hint">Compensator design will appear here.</p>';
}

// Placeholder: the open-loop steady state until the closed-loop simulator exists.
function computeControl() {
  return computeRes(effParams(), 'steady', 'auto');
}

function renderControl() {
  const met = RES.met;
  els.badge.textContent = met.mode;
  els.badge.className = 'badge ' + met.mode;
  els.headVals.textContent = `Vo=${fmtSI(met.vo.mean, 'V')}  IL=${fmtSI(met.iL.mean, 'A')}`;
}
function renderControlLive() { /* cursor-dependent control readouts go here */ }

function sizeBode() { sizeCanvas(CTL.bode, 380); }
function drawBode() {
  const cv = CTL.bode, ctx = cv.getContext('2d');
  const cs = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = cs.getPropertyValue('--muted').trim();
  ctx.font = `${14 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Bode plot', cv.width / 2, cv.height / 2);
}
