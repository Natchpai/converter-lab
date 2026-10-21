'use strict';

/* ================= control page ================= */
// All control-page UI state lives in CTL, so names do not clash with the converter page.
const CTL = {
  bode: $('#bode'), bodeInfo: $('#bodeInfo'), side: $('#ctlSide'), design: $('#designBody'),
  hoverF: null, data: null, geo: null, plant: null, show: {},
};

function buildControlUI() {
  CTL.side.innerHTML = '<h2>Control</h2><p class="hint">Control settings will appear here.</p>';
  CTL.design.innerHTML = '<p class="hint">Compensator design will appear here.</p>';
  const legend = document.createElement('div');
  legend.className = 'bodeLegend'; legend.id = 'bodeLegend';
  CTL.bode.parentElement.before(legend);
  CTL.bode.addEventListener('pointermove', e => {
    if (!CTL.geo) return;
    const r = CTL.bode.getBoundingClientRect(), x = (e.clientX - r.left) * dpr;
    CTL.hoverF = x >= CTL.geo.ml && x <= CTL.geo.ml + CTL.geo.pw ? CTL.geo.fAt(x) : null;
    drawBode();
  });
  CTL.bode.addEventListener('pointerleave', () => { CTL.hoverF = null; drawBode(); });
  legend.addEventListener('change', e => {
    const id = e.target.dataset.curve; if (!id) return;
    CTL.show[id] = e.target.checked; drawBode();
  });
}

// Placeholder: the open-loop steady state until the closed-loop simulator exists.
function computeControl() {
  return computeRes(effParams(), 'steady', 'auto');
}

// Frequency response curves for the current settings.
function controlCurves(p) {
  const pl = plantAt(p, p.D);
  CTL.plant = pl;
  return [
    { id: 'plant', name: 'Plant Gvd = v̂o/d̂', short: 'Gvd', color: '--s1', H: pl.Gvd },
  ];
}

// Characteristic frequencies of the plant, for markers and readouts.
function plantMarks(p, pl) {
  const m = [];
  if (pl.kind === 'ccm') m.push({ f: pl.w0 / (2 * Math.PI), text: 'f0' });
  else m.push({ f: pl.wp / (2 * Math.PI), text: 'fp' });
  for (const z of pl.zeros) {
    const f = Math.hypot(z.re, z.im) / (2 * Math.PI);
    m.push({ f, text: z.re > 0 ? 'fRHP' : 'fESR' });
  }
  m.push({ f: p.fs / 2, text: 'fs/2' });
  return m;
}

function renderControl() {
  const met = RES.met, p = effParams();
  els.badge.textContent = met.mode;
  els.badge.className = 'badge ' + met.mode;
  els.headVals.textContent = `Vo=${fmtSI(met.vo.mean, 'V')}  IL=${fmtSI(met.iL.mean, 'A')}`;
  const defs = controlCurves(p), pl = CTL.plant;
  CTL.marks = plantMarks(p, pl);
  const fLow = Math.min(p.fs / 1e4, ...CTL.marks.map(m => m.f / 3));
  const fmin = 10 ** Math.floor(Math.log10(Math.max(fLow, 0.1)));
  for (const d of defs) if (!(d.id in CTL.show)) CTL.show[d.id] = true;
  CTL.data = bodeSample(fmin, p.fs, defs);
  $('#bodeLegend').innerHTML = defs.map(d =>
    `<label><input type="checkbox" data-curve="${d.id}" ${CTL.show[d.id] ? 'checked' : ''}><i style="background:var(${d.color})"></i>${d.name}</label>`).join('');
  drawBode();
}
function renderControlLive() { /* cursor-dependent control readouts go here */ }

function sizeBode() { sizeCanvas(CTL.bode, 400); }
function drawBode() {
  if (!CTL.data) return;
  for (const c of CTL.data.curves) c.hidden = !CTL.show[c.id];
  const p = effParams();
  CTL.geo = bodeDraw(CTL.bode, CTL.data, { markers: CTL.marks, shadeFrom: p.fs / 2, hoverF: CTL.hoverF });
  renderBodeInfo();
}

function renderBodeInfo() {
  const pl = CTL.plant; if (!pl) return;
  const lines = [];
  if (CTL.hoverF) {
    lines.push(`f = ${fmtHz(CTL.hoverF)}   ` + CTL.data.curves.filter(c => !c.hidden).map(c => {
      const v = bodeAt(CTL.data, c, CTL.hoverF);
      return `${c.short}: ${v.mag.toFixed(1)} dB, ${v.ph.toFixed(1)}°`;
    }).join('   '));
  } else lines.push('Move the pointer over the plot to read values.');
  const marks = CTL.marks.filter(m => m.text !== 'fs/2').map(m => `${m.text} = ${fmtHz(m.f)}`);
  if (pl.kind === 'ccm') marks.push(`Q = ${pl.Q.toPrecision(3)}`);
  lines.push((pl.kind === 'dcm' ? 'DCM reduced-order plant (ideal parts): ' : 'Averaged CCM plant: ') + marks.join(', '));
  CTL.bodeInfo.textContent = lines.join('\n');
}
