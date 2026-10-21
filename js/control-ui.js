'use strict';

/* ================= control page ================= */
// All control-page UI state lives in CTL, so names do not clash with the converter page.
const CTL = {
  bode: $('#bode'), bodeInfo: $('#bodeInfo'), side: $('#ctlSide'), design: $('#designBody'),
  hoverF: null, data: null, geo: null, L: null, notes: [], topoKey: null,
  show: { plant: true, gc: true, loop: true, cl: false, zcl: false },
  cfg: {
    mode: 'vmc', Vt: { buck: 5, boost: 24, bb: 12 }, Vref: VREF, Vm: 1, Dmax: 0.9, R1: 10e3,
    comp: { type: 'T3', K: 1, fi: 100, fz1: 1e3, fz2: 1e3, fp1: 20e3, fp2: 50e3 },
    fcT: 10e3, pmT: 60,
  },
  // transient test for the closed-loop switching simulation (step size per event, %)
  tr: { event: 'load', size: { load: 100, vin: 25, vref: 10, start: 0 }, back: true, nPer: 'auto' },
};

const CTL_SIDE = [
  { k: 'Vt',   label: 'Output target |V<sub>o</sub>*|', unit: 'V', min: 0.5, max: 400, log: true },
  { k: 'Vm',   label: 'PWM ramp amplitude V<sub>M</sub>', unit: 'V', min: 0.1, max: 10, log: true },
  { k: 'Dmax', label: 'Max duty D<sub>max</sub>', unit: '', min: 0.5, max: 0.98, step: 0.01 },
];
const CTL_COMP = {
  K:   { k: 'K',   unit: '',   min: 1e-3, max: 1e4, log: true, db: true },
  fi:  { k: 'fi',  unit: 'Hz', min: 0.1, max: 1e6, log: true },
  fz1: { k: 'fz1', unit: 'Hz', min: 0.1, max: 2e6, log: true },
  fz2: { k: 'fz2', unit: 'Hz', min: 0.1, max: 2e6, log: true },
  fp1: { k: 'fp1', unit: 'Hz', min: 0.1, max: 2e6, log: true },
  fp2: { k: 'fp2', unit: 'Hz', min: 0.1, max: 2e6, log: true },
};
const COMP_LABEL = {
  P:  { K: 'Proportional gain K<sub>p</sub>' },
  I:  { fi: 'Integrator f<sub>i</sub> (where |G<sub>c</sub>| = 1)' },
  PI: { K: 'Proportional gain K<sub>p</sub>', fz1: 'PI zero f<sub>z</sub> = K<sub>i</sub>/(2π·K<sub>p</sub>)' },
  T2: { K: 'Mid-band gain K', fz1: 'Zero f<sub>z</sub>', fp1: 'Pole f<sub>p</sub>' },
  T3: { K: 'Gain K (between the zeros)', fz1: 'Zero f<sub>z1</sub>', fz2: 'Zero f<sub>z2</sub>', fp1: 'Pole f<sub>p1</sub>', fp2: 'Pole f<sub>p2</sub>' },
};
const COMP_FORMULA = {
  P:  'G<sub>c</sub>(s) = K<sub>p</sub>',
  I:  'G<sub>c</sub>(s) = ω<sub>i</sub>/s',
  PI: 'G<sub>c</sub>(s) = K<sub>p</sub>·(1 + ω<sub>z</sub>/s)',
  T2: 'G<sub>c</sub>(s) = K·(1 + ω<sub>z</sub>/s) / (1 + s/ω<sub>p</sub>)',
  T3: 'G<sub>c</sub>(s) = K·ω<sub>z1</sub>/s · (1 + s/ω<sub>z1</sub>)(1 + s/ω<sub>z2</sub>) / ((1 + s/ω<sub>p1</sub>)(1 + s/ω<sub>p2</sub>))',
};
const CTL_TARGET = [
  { k: 'fcT', label: 'Target crossover f<sub>c</sub>', unit: 'Hz', min: 1, max: 5e5, log: true },
  { k: 'pmT', label: 'Target phase margin', unit: '°', min: 10, max: 85, step: 1 },
];
const CTL_TR = [{ k: 'size', label: 'Step size s', unit: '%', min: -50, max: 200, step: 5 }];
const CTL_OPAMP = [{ k: 'R1', label: 'Upper divider resistor R<sub>1</sub>', unit: 'Ω', min: 1e3, max: 1e6, log: true }];

/* ---------- parameter rows (same look as the circuit parameters) ---------- */
function fmtCtl(d, v) {
  if (d.unit === '°') return v.toFixed(0) + '°';
  if (d.unit === '%') return v.toFixed(0) + ' %';
  if (d.unit) return fmtSI(v, d.unit, 3);
  return Math.abs(v) >= 1e3 || Math.abs(v) < 1e-2 ? v.toPrecision(3) : v.toFixed(3);
}
function rowsHTML(pre, defs) {
  return defs.map(d => `
    <div class="prow" id="${pre}-row-${d.k}">
      <div class="top"><label for="${pre}-sl-${d.k}">${d.label}<span class="db" id="${pre}-db-${d.k}"></span></label><input class="num" id="${pre}-nb-${d.k}" type="text" inputmode="decimal" aria-label="${d.k} value"></div>
      <input type="range" id="${pre}-sl-${d.k}" ${d.log ? 'min="0" max="1000" step="1"' : `min="${d.min}" max="${d.max}" step="${d.step}"`}>
    </div>`).join('');
}
// onInput(key, final): final = false while a slider is dragged, true on release or typed value.
function bindRows(pre, defs, get, set, onInput) {
  for (const d of defs) {
    const sl = $(`#${pre}-sl-${d.k}`), nb = $(`#${pre}-nb-${d.k}`);
    sl.addEventListener('input', () => { set(d.k, sliderVal(d, sl.value)); syncRows(pre, [d], get); onInput(d.k, false); });
    sl.addEventListener('change', () => onInput(d.k, true));
    nb.addEventListener('change', () => {
      const v = parseSI(nb.value);
      if (isFinite(v)) set(d.k, clamp(v, d.min, d.max));
      syncRows(pre, [d], get); onInput(d.k, true);
    });
  }
}
function syncRows(pre, defs, get) {
  for (const d of defs) {
    const v = get(d.k);
    $(`#${pre}-sl-${d.k}`).value = sliderPos(d, v);
    $(`#${pre}-nb-${d.k}`).value = fmtCtl(d, v);
    if (d.db) $(`#${pre}-db-${d.k}`).textContent = ` ${(20 * Math.log10(v)).toFixed(1)} dB`;
  }
}

/* ---------- control settings ---------- */
const sideGet = k => k === 'Vt' ? CTL.cfg.Vt[state.topo] : CTL.cfg[k];
const sideSet = (k, v) => { if (k === 'Vt') CTL.cfg.Vt[state.topo] = v; else CTL.cfg[k] = v; };
const compGet = k => CTL.cfg.comp[k];
const compSet = (k, v) => { CTL.cfg.comp[k] = v; };
const tgtGet = k => CTL.cfg[k];
const tgtSet = (k, v) => { CTL.cfg[k] = v; };
function compDefs() {
  const t = CTL.cfg.comp.type;
  return COMP_TYPES[t].keys.map(k => ({ ...CTL_COMP[k], label: COMP_LABEL[t][k] }));
}
function ctlCfg() { return { ...CTL.cfg, Vt: CTL.cfg.Vt[state.topo], comp: { ...CTL.cfg.comp } }; }
function ctlLoop() { CTL.L = buildLoop(effParams(), ctlCfg()); return CTL.L; }

// k-factor design for the current type and targets. 'suggest' also picks fc.
function autoDesign(how) {
  const cfg = ctlCfg(), p = effParams();
  const L0 = buildLoop(p, { ...cfg, comp: { type: 'P', K: 1 } });
  if (how === 'suggest') CTL.cfg.fcT = suggestFc(L0);
  const fc = CTL.cfg.fcT, type = CTL.cfg.comp.type;
  if (how === 'textbook') {
    // classic VMC Type 3: both zeros at f0, poles at fESR (or fs/2) and fs/2
    const f0 = L0.plant.kind === 'ccm' ? L0.plant.w0 / TWO_PI : L0.plant.wp / TWO_PI;
    const esr = L0.marks.find(m => m.text === 'fESR');
    const c = { type: 'T3', K: 1, fz1: f0, fz2: f0, fp1: esr && esr.f < p.fs / 2 ? esr.f : p.fs / 2, fp2: p.fs / 2 };
    c.K = 1 / (Cx.abs(compEval(compNorm(c), fc)) * Cx.abs(L0.plantK(fc)));
    Object.assign(CTL.cfg.comp, c);
    CTL.notes = [`Textbook Type 3: zeros at f0 = ${fmtSI(f0, 'Hz')}, poles at ${fmtSI(c.fp1, 'Hz')} and fs/2, gain set for fc = ${fmtSI(fc, 'Hz')}. PM is whatever this placement gives.`];
  } else {
    const d = designComp(type, L0.plantK, fc, CTL.cfg.pmT, L0.fmin);
    Object.assign(CTL.cfg.comp, d.comp);
    CTL.notes = [`k-factor: plant phase at fc = ${d.phi.toFixed(1)}°, boost needed = ${(CTL.cfg.pmT - d.phi - 90).toFixed(1)}°.`, ...d.notes];
  }
  if (CTL.built) { syncRows('ct', CTL_TARGET, tgtGet); syncRows('cc', compDefs(), compGet); }
}

function buildCompRows() {
  const t = CTL.cfg.comp.type, defs = compDefs();
  $('#compRows').innerHTML = `<p class="note">${COMP_FORMULA[t]}</p>` + rowsHTML('cc', defs);
  bindRows('cc', defs, compGet, compSet, ctlChanged);
  syncRows('cc', defs, compGet);
}

// A control setting changed: redraw the Bode plot now, and rerun the switching simulation
// (~100-200 ms) after a short pause while a slider is still moving.
function ctlChanged(key, final) {
  requestControlRender();
  scheduleSim(final ? 0 : 250);
}
let simTimer = 0;
function scheduleSim(ms) {
  clearTimeout(simTimer);
  simTimer = setTimeout(() => { if (state.page === 'control') requestCompute(); }, ms);
}
let pendingCtl = false;
function requestControlRender() {
  if (pendingCtl) return; pendingCtl = true;
  requestAnimationFrame(() => { pendingCtl = false; if (RES && state.page === 'control') renderControl(); });
}

function buildControlUI() {
  CTL.side.innerHTML = `
    <h2>Control</h2>
    <div class="ctlBlock">
      <div class="seg small" id="ctlMode" role="group" aria-label="Control mode">
        <button data-m="vmc" title="Voltage-mode control">VMC</button><button data-m="pcmc" disabled title="Peak current-mode control (next phase)">Peak CMC</button><button data-m="acmc" disabled title="Average current-mode control (next phase)">Avg CMC</button>
      </div>
      ${rowsHTML('cs', CTL_SIDE)}
      <div class="kv" id="ctlOp"></div>
    </div>
    <h2>Transient test</h2>
    <div class="ctlBlock">
      <label class="ctlInline trEv">Event <select id="trEvent">${Object.entries(CL_EVENTS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></label>
      ${rowsHTML('tr', CTL_TR)}
      <label class="ctlInline"><input type="checkbox" id="trBack" checked> Step back later</label>
      <label class="ctlInline" style="margin-left:12px">Length <select id="trLen">${['auto', 100, 200, 500, 1000, 2000, 3000].map(v => `<option value="${v}">${v === 'auto' ? 'Auto' : v + ' periods'}</option>`).join('')}</select></label>
    </div>`;
  CTL.design.innerHTML = `
    <h3>Compensator</h3>
    <div class="seg small" id="compType" role="group" aria-label="Compensator type">
      ${Object.entries(COMP_TYPES).map(([k, v]) => `<button data-t="${k}">${v.name}</button>`).join('')}
    </div>
    <div id="compRows"></div>
    <h3>Design helper</h3>
    ${rowsHTML('ct', CTL_TARGET)}
    <div class="btnRow">
      <button class="btn primary" id="btnAuto" title="Venable k-factor: place zeros and poles for the target fc and PM">Auto design (k-factor)</button>
      <button class="btn" id="btnSuggest" title="fs/10, and below fRHP/5 when there is an RHP zero">Suggest f<sub>c</sub></button>
      <button class="btn" id="btnTextbook" title="Type 3 zeros at f0, poles at fESR and fs/2">Textbook Type 3</button>
    </div>
    <p class="note" id="designNotes"></p>
    <h3>Loop result</h3>
    <div id="loopOk"></div>
    <div class="kv" id="loopKv"></div>
    <ul class="warnList" id="loopWarn"></ul>
    <h3>Step response (switching simulation)</h3>
    <div class="kv" id="stepKv"></div>
    <h3>Error amplifier circuit</h3>
    ${rowsHTML('co', CTL_OPAMP)}
    <div id="opampSvg"></div>
    <div class="tblWrap"><table class="data" id="opampTbl"></table></div>
    <h3>What to look at</h3>
    <ul class="tips" id="ctlTips"></ul>`;
  bindRows('cs', CTL_SIDE, sideGet, sideSet, ctlChanged);
  bindRows('ct', CTL_TARGET, tgtGet, tgtSet, ctlChanged);
  bindRows('co', CTL_OPAMP, k => CTL.cfg[k], (k, v) => { CTL.cfg[k] = v; }, ctlChanged);
  syncRows('ct', CTL_TARGET, tgtGet); syncRows('co', CTL_OPAMP, k => CTL.cfg[k]);
  const trGet = () => CTL.tr.size[CTL.tr.event], trSet = (k, v) => { CTL.tr.size[CTL.tr.event] = v; };
  bindRows('tr', CTL_TR, trGet, trSet, (k, final) => scheduleSim(final ? 0 : 250));
  syncRows('tr', CTL_TR, trGet);
  $('#trEvent').addEventListener('change', e => { CTL.tr.event = e.target.value; syncRows('tr', CTL_TR, trGet); updateTrUI(); requestCompute(); });
  $('#trBack').addEventListener('change', e => { CTL.tr.back = e.target.checked; requestCompute(); });
  $('#trLen').addEventListener('change', e => { CTL.tr.nPer = e.target.value; requestCompute(); });
  updateTrUI();
  buildCompRows();
  CTL.built = true;
  $('#compType').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    CTL.cfg.comp.type = b.dataset.t;
    autoDesign(); buildCompRows(); updateCtlSegs(); ctlChanged(null, true);
  });
  $('#btnAuto').addEventListener('click', () => { autoDesign(); ctlChanged(null, true); });
  $('#btnSuggest').addEventListener('click', () => { autoDesign('suggest'); ctlChanged(null, true); });
  $('#btnTextbook').addEventListener('click', () => {
    CTL.cfg.comp.type = 'T3'; autoDesign('textbook'); buildCompRows(); updateCtlSegs(); ctlChanged(null, true);
  });

  const legend = document.createElement('div');
  legend.className = 'bodeLegend'; legend.id = 'bodeLegend';
  CTL.bode.parentElement.before(legend);
  legend.addEventListener('change', e => {
    const id = e.target.dataset.curve; if (!id) return;
    CTL.show[id] = e.target.checked; drawBode();
  });
  CTL.bode.addEventListener('pointermove', e => {
    if (!CTL.geo) return;
    const r = CTL.bode.getBoundingClientRect(), x = (e.clientX - r.left) * dpr;
    CTL.hoverF = x >= CTL.geo.ml && x <= CTL.geo.ml + CTL.geo.pw ? CTL.geo.fAt(x) : null;
    drawBode();
  });
  CTL.bode.addEventListener('pointerleave', () => { CTL.hoverF = null; drawBode(); });
  updateCtlSegs();
}
function updateTrUI() {
  const start = CTL.tr.event === 'start';
  $('#tr-row-size').classList.toggle('dis', start);
  $('#tr-sl-size').disabled = start; $('#tr-nb-size').disabled = start;
  $('#trBack').disabled = start;
}
function updateCtlSegs() {
  document.querySelectorAll('#ctlMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === CTL.cfg.mode)));
  document.querySelectorAll('#compType button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === CTL.cfg.comp.type)));
}

// Scope on the Control page: the closed-loop switching simulation with the test event.
function computeControl() {
  if (CTL.topoKey !== state.topo) {     // new topology: start from a fresh design
    CTL.topoKey = state.topo;
    syncRows('cs', CTL_SIDE, sideGet);
    autoDesign('suggest');
  }
  const L = ctlLoop();
  const opt = { event: CTL.tr.event, size: CTL.tr.size[CTL.tr.event], back: CTL.tr.back, ...clSizes(L, CTL.tr.nPer) };
  const t0 = performance.now();
  const res = computeResCL(L, opt);
  res.ms = performance.now() - t0;
  return res;
}

/* ---------- render ---------- */
function renderControl() {
  const L = ctlLoop(), p = L.p, met = RES.met, m = L.m;
  els.badge.textContent = met.mode;
  els.badge.className = 'badge ' + met.mode;
  els.headVals.textContent = `Vo=${fmtSI(met.vo.mean, 'V')}  D=${met.Dfinal.toFixed(3)}  fc=${fmtSI(m.fc, 'Hz')}  PM=${isFinite(m.pm) ? m.pm.toFixed(0) + '°' : '–'}`;

  const defs = [
    { id: 'plant', name: 'Plant Gvd = v̂o/d̂', short: 'Gvd', color: '--s1', H: L.plant.Gvd },
    { id: 'gc', name: 'Compensator Gc', short: 'Gc', color: '--s2', H: L.Gc, dash: true },
    { id: 'loop', name: 'Loop gain T', short: 'T', color: '--s3', H: L.T, width: 2.6 },
    { id: 'cl', name: 'Closed loop v̂o/v̂ref', short: 'CL', color: '--s4', H: L.CL },
    { id: 'zcl', name: 'Closed-loop Zout (dBΩ)', short: 'Zout', color: '--s5', H: L.Zcl },
  ];
  CTL.marks = [...L.marks, { f: p.fs / 2, text: 'fs/2' }];
  if (isFinite(m.fc)) CTL.marks.push({ f: m.fc, text: 'fc' });
  CTL.data = bodeSample(L.fmin, L.fmax, defs);
  $('#bodeLegend').innerHTML = defs.map(d =>
    `<label><input type="checkbox" data-curve="${d.id}" ${CTL.show[d.id] ? 'checked' : ''}><i class="${d.dash ? 'dash' : ''}" style="--c:var(${d.color});background:var(${d.color})"></i>${d.name}</label>`).join('');
  drawBode();

  // operating point
  $('#ctlOp').innerHTML = kvHTML([
    ['Operating duty D<sub>0</sub>', L.D0.toFixed(4)],
    ['Sensor gain H = V<sub>ref</sub>/V<sub>o</sub>*', L.H.toFixed(4)],
    ['Modulator gain 1/V<sub>M</sub>', `${L.Fm.toPrecision(3)} /V`],
  ]);
  // loop result
  const pl = L.plant, rows = [
    ['Crossover f<sub>c</sub>', fmtSI(m.fc, 'Hz')],
    ['Phase margin', isFinite(m.pm) ? m.pm.toFixed(1) + '°' : '–'],
    ['Gain margin', isFinite(m.gm) ? m.gm.toFixed(1) + ' dB' : '∞ (phase stays above −180°)'],
  ];
  for (const mk of L.marks) rows.push([mk.text.replace(/^f(.*)$/, 'f<sub>$1</sub>'), fmtSI(mk.f, 'Hz')]);
  if (pl.kind === 'ccm') rows.push(['Plant Q', pl.Q.toPrecision(3)]);
  rows.push(['Closed-loop poles', polesText(L.poles)]);
  $('#loopKv').innerHTML = kvHTML(rows);
  $('#loopOk').innerHTML = L.stable && !L.warn.length
    ? `<p class="okLine">Stable, PM ${m.pm.toFixed(0)}°${isFinite(m.gm) ? `, GM ${m.gm.toFixed(0)} dB` : ''}.</p>` : '';
  $('#loopWarn').innerHTML = L.warn.map(w => `<li>${w}</li>`).join('');
  $('#designNotes').innerHTML = CTL.notes.join(' ');
  renderStep(L);
  renderOpamp(L);
  $('#ctlTips').innerHTML = ctlTips(L).map(t => `<li>${t}</li>`).join('');
}
function renderControlLive() { /* cursor-dependent control readouts go here */ }

// Step-response numbers of the last closed-loop run.
function renderStep(L) {
  const r = RES;
  if (!r || !r.cl) { $('#stepKv').innerHTML = ''; return; }
  const mt = r.met, sg = mt.segs, ev = r.opt.event, rows = [];
  const dv = x => fmtSI(x, 'V');
  const seg = (name, g) => {
    rows.push([`${name}: final V<sub>o</sub>`, dv(g.final)]);
    rows.push([`${name}: overshoot / dip`, `${dv(g.over)} / ${dv(g.under)}`]);
    rows.push([`${name}: settling (±${fmtSI(g.band, 'V', 2)})`, g.settled ? fmtSI(g.settle, 's') : 'not settled in the window']);
  };
  if (ev === 'start') seg('Soft-start', sg[0]);
  else {
    rows.push(['Before the event: V<sub>o</sub>', dv(sg[0].final)]);
    seg(CL_EVENTS[ev].name.split(' (')[0], sg[1]);
    if (sg[2]) seg('Step back', sg[2]);
  }
  rows.push(['Final error V<sub>o</sub> − V<sub>o</sub>*', dv(mt.err)]);
  rows.push(['Final duty (switching) / D<sub>0</sub> (averaged)', `${mt.Dfinal.toFixed(4)} / ${L.D0.toFixed(4)}`]);
  rows.push(['Simulation', `${r.nPer} periods × ${r.N} steps, ${(r.ms || 0).toFixed(0)} ms`]);
  $('#stepKv').innerHTML = kvHTML(rows);
}

function kvHTML(rows) { return rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join(''); }

// "1.2 kHz ζ=0.45, 3.4 kHz" — complex pairs once, with damping ratio.
function polesText(poles) {
  const out = [];
  for (const r of poles.slice().sort((a, b) => Math.hypot(a.re, a.im) - Math.hypot(b.re, b.im))) {
    if (r.im < -1e-9 * Math.abs(r.re)) continue;
    const wn = Math.hypot(r.re, r.im), z = -r.re / wn;
    const f = fmtSI(wn / TWO_PI, 'Hz');
    out.push(Math.abs(r.im) > 1e-9 * wn ? `${f} ζ=${z.toFixed(2)}` : `${f}${r.re > 0 ? ' (RHP)' : ''}`);
  }
  return out.join(', ') || '–';
}

function sizeBode() { sizeCanvas(CTL.bode, 420); }
function drawBode() {
  if (!CTL.data || !CTL.L) return;
  for (const c of CTL.data.curves) c.hidden = !CTL.show[c.id];
  const L = CTL.L, handles = [];
  if (CTL.show.gc) {
    for (const w of L.cn.wz) handles.push({ f: w / TWO_PI, db: Cx.db(L.Gc(w / TWO_PI)), kind: 'zero', color: '--s2' });
    for (const w of L.cn.wp) handles.push({ f: w / TWO_PI, db: Cx.db(L.Gc(w / TWO_PI)), kind: 'pole', color: '--s2' });
  }
  CTL.geo = bodeDraw(CTL.bode, CTL.data, { markers: CTL.marks, shadeFrom: L.p.fs / 2, hoverF: CTL.hoverF, handles });
  renderBodeInfo();
}

function renderBodeInfo() {
  if (!CTL.data) return;
  if (CTL.hoverF) {
    CTL.bodeInfo.textContent = `f = ${fmtHz(CTL.hoverF)}\n` + CTL.data.curves.filter(c => !c.hidden).map(c => {
      const v = bodeAt(CTL.data, c, CTL.hoverF);
      return `${c.short}: ${v.mag.toFixed(1)} dB, ${v.ph.toFixed(1)}°`;
    }).join('   ');
  } else {
    CTL.bodeInfo.textContent = 'Move the pointer over the plot to read values.\n○ = compensator zero, × = compensator pole. Shaded: above fs/2 (averaged model not valid).';
  }
}

/* ---------- op-amp circuit ---------- */
function renderOpamp(L) {
  const v = L.opamp, t = L.cfg.comp.type;
  const val = (x, u) => x == null ? null : fmtSI(x, u, 3);
  const parts = [['R1', val(v.R1, 'Ω')], ['R2', val(v.R2, 'Ω')], ['C1', val(v.C1, 'F')], ['C2', val(v.C2, 'F')],
    ['R3', val(v.R3, 'Ω')], ['C3', val(v.C3, 'F')], ['R<sub>bot</sub> (DC only)', val(L.Rbot, 'Ω')]].filter(r => r[1]);
  $('#opampTbl').innerHTML = `<tr><th class="l">Part</th><th>Value</th></tr>` + parts.map(([n, x]) => `<tr><td class="l">${n}</td><td>${x}</td></tr>`).join('');
  $('#opampSvg').innerHTML = opampSVG(t, v);
}

function opampSVG(t, v) {
  const lbl = (x, y, name, value) => `<text x="${x}" y="${y}" text-anchor="middle">${name} <tspan class="val">${value}</tspan></text>`;
  const fv = (x, u) => fmtSI(x, u, 3);
  const w = pts => `<polyline class="wire" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
  let s = `<svg viewBox="0 -6 560 276" role="img" aria-label="Error amplifier circuit">`;
  // input: vo -> R1 -> inverting node (x=290, y=150)
  s += `<text x="8" y="155">v<tspan font-size="11" dy="3">o</tspan></text><circle class="node" cx="34" cy="150" r="3.5"/>`;
  s += svgComp('R', 60, 150, 200, 150) + w([[34, 150], [60, 150]]) + w([[200, 150], [290, 150]]);
  s += lbl(130, 176, 'R1', fv(v.R1, 'Ω'));
  if (t === 'T3') {
    s += w([[46, 150], [46, 100], [60, 100]]) + svgComp('R', 60, 100, 125, 100) + svgComp('C', 125, 100, 200, 100) + w([[200, 100], [214, 100], [214, 150]]);
    s += `<circle class="node" cx="46" cy="150" r="3"/><circle class="node" cx="214" cy="150" r="3"/>`;
    s += lbl(92, 88, 'R3', fv(v.R3, 'Ω')) + lbl(162, 80, 'C3', fv(v.C3, 'F'));
  }
  // op-amp
  s += `<path d="M330 120 L330 210 L410 165 Z" class="wire"/><text x="336" y="145">−</text><text x="336" y="196">+</text>`;
  s += w([[290, 150], [330, 150]]) + `<circle class="node" cx="290" cy="150" r="3.5"/>`;
  // feedback from inverting node to output node (x=470)
  const top = t === 'P' || t === 'I' || t === 'PI' ? 60 : 30;
  s += w([[290, 150], [290, top]]) + w([[470, 165], [470, top]]);
  if (t === 'P') s += svgComp('R', 290, 60, 470, 60) + lbl(380, 48, 'R2', fv(v.R2, 'Ω'));
  else if (t === 'I') s += svgComp('C', 290, 60, 470, 60) + lbl(380, 40, 'C1', fv(v.C1, 'F'));
  else {
    const yb = t === 'PI' ? 60 : 72;
    s += svgComp('R', 290, yb, 380, yb) + svgComp('C', 380, yb, 470, yb);
    s += lbl(335, yb - 12, 'R2', fv(v.R2, 'Ω')) + lbl(425, yb + 32, 'C1', fv(v.C1, 'F'));
    if (t !== 'PI') {
      s += svgComp('C', 290, 30, 470, 30) + lbl(380, 12, 'C2', fv(v.C2, 'F'));
    }
  }
  s += w([[410, 165], [500, 165]]) + `<circle class="node" cx="470" cy="165" r="3.5"/>`;
  s += `<text x="506" y="160">v<tspan font-size="11" dy="3">c</tspan></text><text x="506" y="182" class="val">to PWM</text>`;
  // DC parts: Rbot from the inverting node to ground, Vref on the + input
  s += w([[260, 150], [260, 180]]) + svgComp('R', 260, 180, 260, 250) + `<circle class="node" cx="260" cy="150" r="3"/>`;
  s += `<text x="248" y="222" text-anchor="end">R<tspan font-size="11" dy="3">bot</tspan></text>`;
  s += w([[330, 195], [310, 195], [310, 215]]) + `<circle class="src" cx="310" cy="232" r="0"/>`;
  s += `<g class="src"><line x1="300" y1="215" x2="320" y2="215"/><line x1="304" y1="222" x2="316" y2="222"/></g>`;
  s += w([[310, 222], [310, 250]]) + `<text x="326" y="226">V<tspan font-size="11" dy="3">ref</tspan> ${fmtSI(CTL.cfg.Vref, 'V')}</text>`;
  s += w([[240, 250], [330, 250]]) + w([[285, 250], [285, 258]]) + `<g class="src"><line x1="275" y1="258" x2="295" y2="258"/><line x1="279" y1="263" x2="291" y2="263"/></g>`;
  return s + '</svg>';
}

/* ---------- tips ---------- */
function ctlTips(L) {
  const t = [], type = L.cfg.comp.type, p = L.p, pl = L.plant;
  t.push('T = G<sub>c</sub>·H·G<sub>vd</sub>/V<sub>M</sub>. f<sub>c</sub> is where |T| crosses 0 dB. PM = 180° + ∠T(f<sub>c</sub>). Aim for PM ≥ 45° (60° is typical).');
  t.push('The pole at the origin (integrator) makes |T| very large at low frequency, so the DC output error goes to zero.');
  if (pl.kind === 'ccm' && p.topo === 'buck' && !(p.rc > 0) && (type === 'T2' || type === 'PI'))
    t.push('Without capacitor ESR the LC double pole takes the phase to −180°. Type 2 or PI cannot add 90° on top of the integrator, so PM ≤ 0 above f0. Use Type 3, or select Non-ideal to get an ESR zero.');
  if (type === 'I') t.push('Type 1 has no phase boost. f<sub>c</sub> must stay far below f0, so the loop is slow.');
  if (type === 'T3') t.push('Type 3 puts two zeros near f0 to cancel the LC phase drop, and two poles at f<sub>ESR</sub> and fs/2 to stop the gain rising and to filter ripple.');
  if (p.topo !== 'buck' && pl.kind === 'ccm')
    t.push('Boost and buck-boost have a right-half-plane zero: gain goes up like a zero but phase goes down like a pole. It also moves with load and D. Keep f<sub>c</sub> below f<sub>RHP</sub>/5.');
  if (pl.kind === 'dcm') t.push('In DCM the plant has only one low-frequency pole, so PI or Type 2 is enough. The pole moves with R.');
  t.push('Change R, L, C or V<sub>in</sub> on the left: the compensator stays fixed and the margins move. A real design must be stable over the whole range.');
  t.push('The op-amp realizes Z<sub>f</sub>/Z<sub>in</sub> = H·G<sub>c</sub>. R<sub>bot</sub> sits at the virtual ground, so it sets the DC output only, not the AC loop gain.');
  return t;
}
