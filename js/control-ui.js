'use strict';

/* ================= control page ================= */
// All control-page UI state lives in CTL, so names do not clash with the converter page.
const CTL = {
  bode: $('#bode'), bodeInfo: $('#bodeInfo'), side: $('#ctlSide'), design: $('#designBody'),
  hoverF: null, data: null, geo: null, L: null, notes: [], topoKey: null,
  bodeView: 'outer',                      // ACMC: 'outer' voltage loop or 'inner' current loop
  fra: null, curKey: '',                  // last FRA run and the settings it belongs to
  show: { plant: true, gc: true, loop: true, cl: false, zcl: false },
  cfg: {
    mode: 'vmc', Vt: { buck: 5, boost: 24, bb: 12 }, Vref: VREF, Vm: 1, Dmax: 0.9, R1: 10e3,
    Ri: 0.5, mSe: 0.5, vcMax: 4, tb: 0,   // PCMC: sense gain (Ω), Se/Sf, compensator output limit (V), blanking/T
    comp: { type: 'T3', K: 1, fi: 100, fz1: 1e3, fz2: 1e3, fp1: 20e3, fp2: 50e3 },
    fcT: 10e3, pmT: 60,
    // ACMC current amplifier and its targets
    ci: { type: 'T2', K: 1, fi: 1e3, fz1: 4e3, fz2: 4e3, fp1: 60e3, fp2: 60e3 },
    fciT: 16e3, pmiT: 60,
  },
  // transient test for the closed-loop switching simulation (step size per event, %)
  tr: { event: 'load', size: { load: 100, vin: 25, vref: 10, start: 0 }, back: true, nPer: 'auto' },
};

const CTL_SIDE = {
  Vt:   { k: 'Vt',   label: 'Output target |V<sub>o</sub>*|', unit: 'V', min: 0.5, max: 400, log: true },
  Vm:   { k: 'Vm',   label: 'PWM ramp amplitude V<sub>M</sub>', unit: 'V', min: 0.1, max: 10, log: true },
  Ri:   { k: 'Ri',   label: 'Current sense gain R<sub>i</sub>', unit: 'Ω', min: 0.01, max: 10, log: true },
  mSe:  { k: 'mSe',  label: 'Slope compensation S<sub>e</sub>/S<sub>f</sub>', unit: '', min: 0, max: 2, step: 0.01 },
  tb:   { k: 'tb',   label: 'Blanking time t<sub>b</sub>/T (min on-time)', unit: '', min: 0, max: 0.3, step: 0.01 },
  Dmax: { k: 'Dmax', label: 'Max duty D<sub>max</sub>', unit: '', min: 0.5, max: 0.98, step: 0.01 },
};
const CTL_SIDE_KEYS = { vmc: ['Vt', 'Vm', 'Dmax'], pcmc: ['Vt', 'Ri', 'mSe', 'tb', 'Dmax'], acmc: ['Vt', 'Vm', 'Ri', 'Dmax'] };
const sideDefs = () => CTL_SIDE_KEYS[CTL.cfg.mode].map(k => CTL_SIDE[k]);
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
const CTL_TARGET_I = [
  { k: 'fciT', label: 'Target current-loop crossover f<sub>ci</sub>', unit: 'Hz', min: 10, max: 5e5, log: true },
  { k: 'pmiT', label: 'Target current-loop phase margin', unit: '°', min: 10, max: 85, step: 1 },
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
const ciGet = k => CTL.cfg.ci[k];
const ciSet = (k, v) => { CTL.cfg.ci[k] = v; };
function compDefs(c = CTL.cfg.comp) {
  return COMP_TYPES[c.type].keys.map(k => ({ ...CTL_COMP[k], label: COMP_LABEL[c.type][k] }));
}
function ctlCfg() { return { ...CTL.cfg, Vt: CTL.cfg.Vt[state.topo], comp: { ...CTL.cfg.comp }, ci: { ...CTL.cfg.ci } }; }
function ctlLoop() { CTL.L = buildLoop(effParams(), ctlCfg()); return CTL.L; }

// k-factor design for the current type and targets. 'suggest' also picks fc.
// ACMC: the current loop is designed first, then the voltage loop with the current loop closed.
function autoDesign(how) {
  const cfg = ctlCfg(), p = effParams(), pre = [];
  if (cfg.mode === 'acmc') {
    if (how === 'suggest') CTL.cfg.fciT = suggestFci(p);
    const Li = buildLoop(p, { ...cfg, fciT: CTL.cfg.fciT, ci: { type: 'P', K: 1 }, comp: { type: 'P', K: 1 } });
    const di = designComp(CTL.cfg.ci.type, Li.plantKi, CTL.cfg.fciT, CTL.cfg.pmiT, Li.fmin);
    Object.assign(CTL.cfg.ci, di.comp);
    cfg.ci = { ...CTL.cfg.ci }; cfg.fciT = CTL.cfg.fciT;
    pre.push(`Current loop: plant phase at f<sub>ci</sub> = ${di.phi.toFixed(1)}°.`, ...di.notes);
  }
  const L0 = buildLoop(p, { ...cfg, comp: { type: 'P', K: 1 } });
  if (cfg.mode === 'pcmc' && !L0.plant.ok) {
    CTL.notes = ['Auto design skipped: the converter has no steady state at this target (see the warnings).'];
    return;
  }
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
    CTL.notes = [...pre, `k-factor: plant phase at fc = ${d.phi.toFixed(1)}°, boost needed = ${(CTL.cfg.pmT - d.phi - 90).toFixed(1)}°.`, ...d.notes];
  }
  if (CTL.built) {
    syncRows('ct', CTL_TARGET, tgtGet); syncRows('cc', compDefs(), compGet);
    syncRows('cti', CTL_TARGET_I, tgtGet); syncRows('ci', compDefs(CTL.cfg.ci), ciGet);
  }
}

// Modulator rows on the left; they depend on the control mode.
function buildSideRows() {
  const defs = sideDefs(), pc = CTL.cfg.mode === 'pcmc';
  $('#ctlSideRows').innerHTML = rowsHTML('cs', defs) + (pc
    ? '<div class="btnRow"><button class="btn" id="btnSeHalf" title="Se = Sf/2 keeps the current loop stable for any duty">S<sub>e</sub> = S<sub>f</sub>/2</button></div>' : '');
  bindRows('cs', defs, sideGet, sideSet, ctlChanged);
  syncRows('cs', defs, sideGet);
  if (pc) $('#btnSeHalf').addEventListener('click', () => { CTL.cfg.mSe = 0.5; syncRows('cs', defs, sideGet); ctlChanged('mSe', true); });
  // mode-dependent parts of the design panel
  const md = CTL.cfg.mode;
  $('#btnTextbook').hidden = md !== 'vmc';  // the textbook Type 3 placement is for the LC plant (VMC)
  $('#ciBlock').hidden = md !== 'acmc';
  $('#compTitle').innerHTML = md === 'acmc' ? 'Voltage loop: compensator G<sub>cv</sub>' : 'Compensator';
}

function buildCompRows() {
  const t = CTL.cfg.comp.type, defs = compDefs();
  const fm = CTL.cfg.mode === 'acmc' ? COMP_FORMULA[t].replace(/G<sub>c<\/sub>/, 'G<sub>cv</sub>') : COMP_FORMULA[t];
  $('#compRows').innerHTML = `<p class="note">${fm}</p>` + rowsHTML('cc', defs);
  bindRows('cc', defs, compGet, compSet, ctlChanged);
  syncRows('cc', defs, compGet);
}
// ACMC current amplifier rows (same forms as the compensator, input iref − Ri·iL).
function buildCiRows() {
  const t = CTL.cfg.ci.type, defs = compDefs(CTL.cfg.ci);
  $('#ciRows').innerHTML = `<p class="note">${COMP_FORMULA[t].replace(/G<sub>c<\/sub>/, 'G<sub>ci</sub>')}</p>` + rowsHTML('ci', defs);
  bindRows('ci', defs, ciGet, ciSet, ctlChanged);
  syncRows('ci', defs, ciGet);
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
        <button data-m="vmc" title="Voltage-mode control">VMC</button><button data-m="pcmc" title="Peak current-mode control with slope compensation">Peak CMC</button><button data-m="acmc" title="Average current-mode control: current amplifier inside, voltage loop outside">Avg CMC</button>
      </div>
      <div id="ctlSideRows"></div>
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
    <div id="ciBlock" hidden>
      <h3>Current loop: amplifier G<sub>ci</sub></h3>
      <div class="seg small" id="ciType" role="group" aria-label="Current amplifier type">
        ${Object.entries(COMP_TYPES).map(([k, v]) => `<button data-t="${k}">${v.name}</button>`).join('')}
      </div>
      <div id="ciRows"></div>
      ${rowsHTML('cti', CTL_TARGET_I)}
      <p class="note">Auto design (below) designs the current loop first, then the voltage loop with the current loop closed.</p>
    </div>
    <h3 id="compTitle">Compensator</h3>
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
    <div id="opampIBlock" hidden>
      <h3>Current amplifier circuit</h3>
      <div id="opampSvgI"></div>
      <div class="tblWrap"><table class="data" id="opampTblI"></table></div>
      <p class="note">Z<sub>f</sub>/Z<sub>in</sub> = G<sub>ci</sub>. With i<sub>ref</sub> on the + input the output is
        v<sub>c</sub> = G<sub>ci</sub>·(i<sub>ref</sub> − R<sub>i</sub>·i<sub>L</sub>) + i<sub>ref</sub>: the current loop is exact, the extra
        i<sub>ref</sub> is small where |G<sub>ci</sub>| ≫ 1 (the simulation uses G<sub>ci</sub>·(i<sub>ref</sub> − R<sub>i</sub>·i<sub>L</sub>)).</p>
    </div>
    <h3>What to look at</h3>
    <ul class="tips" id="ctlTips"></ul>`;
  bindRows('ct', CTL_TARGET, tgtGet, tgtSet, ctlChanged);
  bindRows('co', CTL_OPAMP, k => CTL.cfg[k], (k, v) => { CTL.cfg[k] = v; }, ctlChanged);
  bindRows('cti', CTL_TARGET_I, tgtGet, tgtSet, ctlChanged);
  syncRows('ct', CTL_TARGET, tgtGet); syncRows('cti', CTL_TARGET_I, tgtGet); syncRows('co', CTL_OPAMP, k => CTL.cfg[k]);
  const trGet = () => CTL.tr.size[CTL.tr.event], trSet = (k, v) => { CTL.tr.size[CTL.tr.event] = v; };
  bindRows('tr', CTL_TR, trGet, trSet, (k, final) => scheduleSim(final ? 0 : 250));
  syncRows('tr', CTL_TR, trGet);
  $('#trEvent').addEventListener('change', e => { CTL.tr.event = e.target.value; syncRows('tr', CTL_TR, trGet); updateTrUI(); requestCompute(); });
  $('#trBack').addEventListener('change', e => { CTL.tr.back = e.target.checked; requestCompute(); });
  $('#trLen').addEventListener('change', e => { CTL.tr.nPer = e.target.value; requestCompute(); });
  updateTrUI();
  buildSideRows();
  buildCompRows();
  buildCiRows();
  CTL.built = true;
  // new mode: VMC starts from Type 3 (LC double pole); PCMC and the ACMC voltage loop from
  // Type 2 (one dominant pole once the current loop is closed)
  $('#ctlMode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled || b.dataset.m === CTL.cfg.mode) return;
    CTL.cfg.mode = b.dataset.m;
    CTL.cfg.comp.type = CTL.cfg.mode === 'vmc' ? 'T3' : 'T2';
    // rows first: autoDesign syncs the rows of the new type
    buildSideRows(); buildCompRows(); autoDesign('suggest'); updateCtlSegs(); ctlChanged(null, true);
  });
  $('#ciType').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    CTL.cfg.ci.type = b.dataset.t;
    buildCiRows(); autoDesign(); updateCtlSegs(); ctlChanged(null, true);
  });
  $('#compType').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    CTL.cfg.comp.type = b.dataset.t;
    buildCompRows(); autoDesign(); updateCtlSegs(); ctlChanged(null, true);
  });
  $('#btnAuto').addEventListener('click', () => { autoDesign(); ctlChanged(null, true); });
  $('#btnSuggest').addEventListener('click', () => { autoDesign('suggest'); ctlChanged(null, true); });
  $('#btnTextbook').addEventListener('click', () => {
    CTL.cfg.comp.type = 'T3'; buildCompRows(); autoDesign('textbook'); updateCtlSegs(); ctlChanged(null, true);
  });

  const legend = document.createElement('div');
  legend.className = 'bodeLegend'; legend.id = 'bodeLegend';
  CTL.bode.parentElement.before(legend);
  legend.addEventListener('change', e => {
    const id = e.target.dataset.curve; if (!id) return;
    CTL.show[id] = e.target.checked; drawBode();
  });
  legend.addEventListener('click', e => {
    const b = e.target.closest('button[data-view]'); if (!b) return;
    CTL.bodeView = b.dataset.view; renderControl();
  });
  CTL.bode.addEventListener('pointerdown', e => {
    const h = hitHandle(e); if (!h) return;
    e.preventDefault();
    try { CTL.bode.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events in the UI test */ }
    const { y } = canvasXY(e);
    CTL.drag = { h, hc: CTL.hc, geo: CTL.geo, y0: y, v0: CTL.hc.cfg[h.key] };
  });
  CTL.bode.addEventListener('pointermove', e => {
    if (!CTL.geo) return;
    if (CTL.drag) { dragTo(e); return; }
    const { x } = canvasXY(e), h = hitHandle(e);
    CTL.bode.style.cursor = !h ? '' : h.kind === 'gain' ? 'ns-resize' : 'ew-resize';
    CTL.hoverF = x >= CTL.geo.ml && x <= CTL.geo.ml + CTL.geo.pw ? CTL.geo.fAt(x) : null;
    drawBode();
  });
  const endDrag = () => { if (!CTL.drag) return; const k = CTL.drag.h.key; CTL.drag = null; ctlChanged(k, true); };
  CTL.bode.addEventListener('pointerup', endDrag);
  CTL.bode.addEventListener('pointercancel', endDrag);
  CTL.bode.addEventListener('pointerleave', () => { if (!CTL.drag) { CTL.hoverF = null; drawBode(); } });
  buildFraBar();
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
  document.querySelectorAll('#ciType button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === CTL.cfg.ci.type)));
}

// Scope on the Control page: the closed-loop switching simulation with the test event.
function computeControl() {
  if (CTL.topoKey !== state.topo) {     // new topology: start from a fresh design
    CTL.topoKey = state.topo;
    syncRows('cs', sideDefs(), sideGet);
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
  CTL.curKey = fraKey();
  if (CTL.fra && CTL.fra.running && CTL.fra.key !== CTL.curKey) fraStop('Settings changed: measurement stopped.');
  els.badge.textContent = met.mode;
  els.badge.className = 'badge ' + met.mode;
  const pc = L.cfg.mode === 'pcmc', ac = L.cfg.mode === 'acmc', pl = L.plant, pct = x => isFinite(x) ? x.toFixed(0) + '°' : '–';
  els.headVals.textContent = `Vo=${fmtSI(met.vo.mean, 'V')}  D=${met.Dfinal.toFixed(3)}  fc=${fmtSI(m.fc, 'Hz')}  PM=${pct(m.pm)}`
    + (ac ? `  fci=${fmtSI(L.mi.fc, 'Hz')}  PMi=${pct(L.mi.pm)}` : '');

  const noOp = pc && !pl.ok;               // PCMC with no steady state: the plant gain is 0 or unknown
  const inner = ac && CTL.bodeView === 'inner';
  const defs = (inner ? [
    { id: 'plant', name: 'Current plant Ri·Gid/VM = Ri·îL/v̂c', short: 'RiGid/VM', color: '--s1', H: L.plantKi },
    { id: 'gc', name: 'Current amplifier Gci', short: 'Gci', color: '--s2', H: L.Gci, dash: true },
    { id: 'loop', name: 'Current loop Ti', short: 'Ti', color: '--s3', H: L.Ti, width: 2.6 },
    { id: 'cl', name: 'Closed current loop Ti/(1+Ti)', short: 'CLi', color: '--s4', H: f => { const t = L.Ti(f); return Cx.div(t, Cx.add(t, Cx.of(1))); } },
  ] : [
    { id: 'plant', name: L.plantName, short: L.plantShort, color: '--s1', H: L.plantH },
    { id: 'gc', name: ac ? 'Voltage compensator Gcv' : 'Compensator Gc', short: ac ? 'Gcv' : 'Gc', color: '--s2', H: L.Gc, dash: true },
    { id: 'loop', name: 'Loop gain T', short: 'T', color: '--s3', H: L.T, width: 2.6 },
    { id: 'cl', name: 'Closed loop v̂o/v̂ref', short: 'CL', color: '--s4', H: L.CL },
    { id: 'zcl', name: 'Closed-loop Zout (dBΩ)', short: 'Zout', color: '--s5', H: L.Zcl },
  ]).filter(d => d.H && (!noOp || d.id === 'gc'));
  // compensator whose zeros and poles get the drag handles
  CTL.hc = inner ? { cn: L.cni, G: L.Gci, cfg: CTL.cfg.ci, pre: 'ci', get: ciGet } : { cn: L.cn, G: L.Gc, cfg: CTL.cfg.comp, pre: 'cc', get: compGet };
  CTL.marks = [...L.marks, { f: p.fs / 2, text: 'fs/2' }];
  const mm = inner ? L.mi : m;
  CTL.hc.fg = isFinite(mm.fc) ? mm.fc : Math.sqrt(L.fmin * L.fmax);   // gain handle on Gc at the crossover
  if (isFinite(mm.fc)) CTL.marks.push({ f: mm.fc, text: inner ? 'fci' : 'fc' });
  CTL.data = bodeSample(L.fmin, L.fmax, defs);
  const viewSeg = ac ? `<span class="seg small" role="group" aria-label="Bode view">${[['outer', 'Voltage loop'], ['inner', 'Current loop']].map(([v, n]) =>
    `<button data-view="${v}" aria-pressed="${CTL.bodeView === v}">${n}</button>`).join('')}</span>` : '';
  $('#bodeLegend').innerHTML = viewSeg + defs.map(d =>
    `<label><input type="checkbox" data-curve="${d.id}" ${CTL.show[d.id] ? 'checked' : ''}><i class="${d.dash ? 'dash' : ''}" style="--c:var(${d.color});background:var(${d.color})"></i>${d.name}</label>`).join('');
  drawBode();

  // operating point
  const sl = x => fmtSI(x, 'V/s', 3);
  $('#ctlOp').innerHTML = kvHTML(pc ? [
    ['Duty D (switched model)', pl.D.toFixed(4)],
    ['Sensor gain H = V<sub>ref</sub>/V<sub>o</sub>*', L.H.toFixed(4)],
    ['v<sub>c</sub> at the operating point', noOp ? '–' : fmtSI(pl.vc0, 'V', 4)],
  ] : ac ? [
    ['Operating duty D<sub>0</sub>', L.D0.toFixed(4)],
    ['Sensor gain H = V<sub>ref</sub>/V<sub>o</sub>*', L.H.toFixed(4)],
    ['Modulator gain 1/V<sub>M</sub>', `${L.Fm.toPrecision(3)} /V`],
    ['i<sub>ref</sub> = R<sub>i</sub>·I<sub>L</sub> at the operating point', fmtSI(L.cfg.Ri * L.IL0, 'V', 4)],
  ] : [
    ['Operating duty D<sub>0</sub>', L.D0.toFixed(4)],
    ['Sensor gain H = V<sub>ref</sub>/V<sub>o</sub>*', L.H.toFixed(4)],
    ['Modulator gain 1/V<sub>M</sub>', `${L.Fm.toPrecision(3)} /V`],
  ]);
  // loop result
  const rows = noOp ? [['Loop gain', '– (no steady state)']] : [
    ['Crossover f<sub>c</sub>', fmtSI(m.fc, 'Hz')],
    ['Phase margin', isFinite(m.pm) ? m.pm.toFixed(1) + '°' : '–'],
    ['Gain margin', isFinite(m.gm) ? m.gm.toFixed(1) + ' dB' : '∞ (phase stays above −180°)'],
  ];
  for (const mk of L.marks) rows.push([mk.text.replace(/^f(.*)$/, 'f<sub>$1</sub>'), fmtSI(mk.f, 'Hz')]);
  if (pl.kind === 'ccm') rows.push(['Plant Q', pl.Q.toPrecision(3)]);
  if (L.poles) rows.push(['Closed-loop poles' + (ac ? ' (both loops)' : ''), polesText(L.poles)]);
  if (ac) rows.push(
    ['Current-loop crossover f<sub>ci</sub>', fmtSI(L.mi.fc, 'Hz')],
    ['Current-loop phase margin', isFinite(L.mi.pm) ? L.mi.pm.toFixed(1) + '°' : '–'],
    ['Current-loop gain margin', isFinite(L.mi.gm) ? L.mi.gm.toFixed(1) + ' dB' : '∞'],
    ['Amplified down-slope |G<sub>ci</sub>(fs)|·R<sub>i</sub>·|di<sub>L</sub>/dt|', sl(L.slope.Sf)],
    ['Ramp slope V<sub>M</sub>·fs', sl(L.slope.Se)],
    ['Slope ratio (Dixon: keep ≤ 1)', L.slope.ratio.toFixed(2)]);
  // slopes and poles need a steady state; without one only the averaged duty is shown
  if (pc && noOp) rows.push(['Averaged duty D<sub>0</sub>', L.D0.toFixed(4)]);
  else if (pc) rows.push(
    ['On slope S<sub>n</sub> = R<sub>i</sub>·di<sub>L</sub>/dt', sl(pl.Sn)],
    ['Off slope S<sub>f</sub> = R<sub>i</sub>·|di<sub>L</sub>/dt|', sl(pl.Sf)],
    ['Slope compensation S<sub>e</sub>', sl(pl.Se)],
    ['m<sub>c</sub> = 1 + S<sub>e</sub>/S<sub>n</sub>', pl.dcm ? '– (DCM)' : pl.mc.toFixed(3)],
    ['Q<sub>p</sub> = 1/(π(m<sub>c</sub>D′ − 0.5))', pl.dcm ? '– (DCM)' : pl.Qp > 0 ? pl.Qp.toFixed(2) : '– (m<sub>c</sub>D′ ≤ 0.5)'],
    ['Current-loop pole α = −(S<sub>f</sub> − S<sub>e</sub>)/(S<sub>n</sub> + S<sub>e</sub>)', pl.dcm ? '0 (DCM)' : pl.alpha.toFixed(4)],
    ['Same pole from the period map', pl.lamC.re.toFixed(4) + (Math.abs(pl.lamC.im) > 1e-9 ? ` ${pl.lamC.im >= 0 ? '+' : '−'} j${Math.abs(pl.lamC.im).toFixed(4)}` : '')],
    ['Averaged duty D<sub>0</sub> (for comparison)', L.D0.toFixed(4)]);
  $('#loopKv').innerHTML = kvHTML(rows);
  $('#loopOk').innerHTML = L.stable && !L.warn.length
    ? `<p class="okLine">Stable, PM ${m.pm.toFixed(0)}°${isFinite(m.gm) ? `, GM ${m.gm.toFixed(0)} dB` : ''}${ac ? `; current loop PM ${L.mi.pm.toFixed(0)}°` : ''}.</p>` : '';
  $('#loopWarn').innerHTML = L.warn.map(w => `<li>${w}</li>`).join('');
  $('#designNotes').innerHTML = CTL.notes.join(' ');
  renderStep(L);
  renderOpamp(L);
  $('#ctlTips').innerHTML = [...ctlTips(L), FRA_TIP].map(t => `<li>${t}</li>`).join('');
  fraUI();
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

function sizeBode() { sizeCanvas(CTL.bode, SHELL.matches ? Math.max(120, CTL.bode.parentElement.clientHeight) : 420); }
function drawBode() {
  if (!CTL.data || !CTL.L) return;
  for (const c of CTL.data.curves) c.hidden = !CTL.show[c.id];
  const L = CTL.L, handles = [];
  const hc = CTL.hc;
  if (CTL.show.gc && hc) {
    // zeros and poles in compNorm order are fz1, fz2 and fp1, fp2; the gain handle scales K (fi for I)
    const add = (f, kind, key) => handles.push({ f, db: Cx.db(hc.G(f)), kind, key, color: '--s2' });
    hc.cn.wz.forEach((w, i) => add(w / TWO_PI, 'zero', 'fz' + (i + 1)));
    hc.cn.wp.forEach((w, i) => add(w / TWO_PI, 'pole', 'fp' + (i + 1)));
    add(hc.fg, 'gain', hc.cfg.type === 'I' ? 'fi' : 'K');
  }
  CTL.geo = bodeDraw(CTL.bode, CTL.data, { markers: CTL.marks, shadeFrom: L.p.fs / 2, hoverF: CTL.hoverF, handles, dots: fraDots() });
  const g = CTL.geo;
  CTL.handles = handles.filter(h => h.f >= CTL.data.fmin && h.f <= CTL.data.fmax)
    .map(h => ({ ...h, x: g.X(h.f), y: clamp(g.YM(h.db), g.yM0, g.yM0 + g.hM) }));
  renderBodeInfo();
}

function renderBodeInfo() {
  if (!CTL.data) return;
  if (CTL.hoverF) {
    CTL.bodeInfo.textContent = `f = ${fmtHz(CTL.hoverF)}\n` + CTL.data.curves.filter(c => !c.hidden).map(c => {
      const v = bodeAt(CTL.data, c, CTL.hoverF);
      return `${c.short}: ${v.mag.toFixed(1)} dB, ${v.ph.toFixed(1)}°`;
    }).join('   ') + fraHoverText(CTL.hoverF);
  } else {
    CTL.bodeInfo.textContent = 'Move the pointer over the plot to read values. Drag ○ zeros and × poles sideways, the ◆ gain up or down.\n' + (CTL.L && CTL.L.fmax < CTL.L.p.fs
      ? 'The sampled-data plant is plotted up to fs/2.' : 'Shaded: above fs/2 (averaged model not valid).');
  }
}

/* ---------- op-amp circuit ---------- */
function renderOpamp(L) {
  const val = (x, u) => x == null ? null : fmtSI(x, u, 3);
  const table = (v, extra) => `<tr><th class="l">Part</th><th>Value</th></tr>` + [['R1', val(v.R1, 'Ω')], ['R2', val(v.R2, 'Ω')], ['C1', val(v.C1, 'F')], ['C2', val(v.C2, 'F')],
    ['R3', val(v.R3, 'Ω')], ['C3', val(v.C3, 'F')], ...extra].filter(r => r[1]).map(([n, x]) => `<tr><td class="l">${n}</td><td>${x}</td></tr>`).join('');
  $('#opampTbl').innerHTML = table(L.opamp, [['R<sub>bot</sub> (DC only)', val(L.Rbot, 'Ω')]]);
  $('#opampSvg').innerHTML = opampSVG(L.cfg.comp.type, L.opamp);
  const ac = !!L.opampI;
  $('#opampIBlock').hidden = !ac;
  if (ac) { $('#opampTblI').innerHTML = table(L.opampI, []); $('#opampSvgI').innerHTML = opampSVG(L.cfg.ci.type, L.opampI, 'i'); }
}

// kind 'v': voltage error amplifier (input vo, Rbot and Vref for DC); 'i': ACMC current
// amplifier (input Ri·iL, iref on the + input).
function opampSVG(t, v, kind = 'v') {
  const lbl = (x, y, name, value) => `<text x="${x}" y="${y}" text-anchor="middle">${name} <tspan class="val">${value}</tspan></text>`;
  const fv = (x, u) => fmtSI(x, u, 3);
  const w = pts => `<polyline class="wire" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
  const ci = kind === 'i';
  let s = `<svg viewBox="0 -6 560 276" role="img" aria-label="${ci ? 'Current amplifier' : 'Error amplifier'} circuit">`;
  // input: vo (or Ri·iL) -> R1 -> inverting node (x=290, y=150)
  s += (ci ? `<text x="4" y="134">R<tspan font-size="11" dy="3">i</tspan><tspan dy="-3">·i</tspan><tspan font-size="11" dy="3">L</tspan></text>`
    : `<text x="8" y="155">v<tspan font-size="11" dy="3">o</tspan></text>`) + `<circle class="node" cx="34" cy="150" r="3.5"/>`;
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
  const dest = ci ? 'to PWM' : { pcmc: 'to current comparator', acmc: 'to current amplifier' }[CTL.cfg.mode] || 'to PWM';
  s += `<text x="506" y="160">${ci || CTL.cfg.mode !== 'acmc' ? 'v<tspan font-size="11" dy="3">c</tspan>' : 'i<tspan font-size="11" dy="3">ref</tspan>'}</text><text x="506" y="182" class="val">${dest}</text>`;
  if (ci) {   // iref from the voltage amplifier on the + input
    s += w([[330, 195], [290, 195]]) + `<circle class="node" cx="290" cy="195" r="3.5"/>`;
    return s + `<text x="282" y="200" text-anchor="end">i<tspan font-size="11" dy="3">ref</tspan><tspan dy="-3"> from the voltage amplifier</tspan></text></svg>`;
  }
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
  if (L.cfg.mode === 'pcmc') return pcmcTips(L);
  if (L.cfg.mode === 'acmc') return acmcTips(L);
  t.push('T = G<sub>c</sub>·H·G<sub>vd</sub>/V<sub>M</sub>. f<sub>c</sub> is where |T| crosses 0 dB. PM = 180° + ∠T(f<sub>c</sub>). Aim for PM ≥ 45° (60° is typical).');
  t.push('The pole at the origin (integrator) makes |T| very large at low frequency, so the DC output error goes to zero.');
  if (pl.kind === 'ccm' && p.topo === 'buck' && !(p.rc > 0) && (type === 'T2' || type === 'PI'))
    t.push('Without capacitor ESR the LC double pole takes the phase to −180°. Type 2 or PI cannot add 90° on top of the integrator, so PM ≤ 0 above f0. Use Type 3, or select Non-ideal to get an ESR zero.');
  if (type === 'I') t.push('Type 1 has no phase boost. f<sub>c</sub> must stay far below f0, so the loop is slow.');
  if (type === 'T3') t.push('Type 3 puts two zeros near f0 to cancel the LC phase drop, and two poles at f<sub>ESR</sub> and fs/2 to stop the gain rising and to filter ripple.');
  if (p.topo !== 'buck' && pl.kind === 'ccm')
    t.push('Boost and buck-boost have a right-half-plane zero: gain goes up like a zero but phase goes down like a pole. It also moves with load and D. Keep f<sub>c</sub> below f<sub>RHP</sub>/5.');
  if (pl.kind === 'dcm') t.push('In DCM the plant has only one low-frequency pole, so PI or Type 2 is enough. The pole moves with R.');
  if (pl.kind === 'dcm' && p.topo !== 'buck') t.push('In DCM the RHP zero of boost and buck-boost moves up near fs, so this reduced-order model leaves it out and the loop can be faster than in CCM. Check the margins again if the load can push the converter into CCM.');
  t.push('Change R, L, C or V<sub>in</sub> on the left: the compensator stays fixed and the margins move. A real design must be stable over the whole range.');
  t.push('The op-amp realizes Z<sub>f</sub>/Z<sub>in</sub> = H·G<sub>c</sub>. R<sub>bot</sub> sits at the virtual ground, so it sets the DC output only, not the AC loop gain.');
  return t;
}

function pcmcTips(L) {
  const t = [], pl = L.plant, p = L.p;
  t.push('Peak current mode: the switch turns on at each clock and turns off when R<sub>i</sub>·i<sub>L</sub> + S<sub>e</sub>·t reaches v<sub>c</sub>. Put <b>vc</b> and <b>ramp</b> on the scope to see the crossing.');
  t.push('The inner current loop removes the LC double pole: G<sub>vc</sub> looks like one pole set by the load and C (plus the ESR zero). A Type 2 compensator is enough. T = G<sub>c</sub>·H·G<sub>vc</sub>.');
  t.push('Without slope compensation the current loop is unstable for D > 0.5 (subharmonic oscillation): an error in i<sub>L</sub> is multiplied by α = −(S<sub>f</sub> − S<sub>e</sub>)/(S<sub>n</sub> + S<sub>e</sub>) each period. On a buck, set S<sub>e</sub> = 0 and V<sub>o</sub>* above V<sub>in</sub>/2, then watch i<sub>L</sub> alternate.');
  t.push('Q<sub>p</sub> describes the double pole at fs/2 of the sampled current loop. Q<sub>p</sub> near 1 or below is well damped; a large Q<sub>p</sub> gives a peak at fs/2 in G<sub>vc</sub>.');
  t.push('The plant curve comes from the switching model itself (one switching period linearized), so it includes the fs/2 effects. It stops at fs/2 because a sampled system repeats above it.');
  if (pl.dcm) t.push('In DCM i<sub>L</sub> starts from zero every period, so an error in i<sub>L</sub> is gone after one period (current-loop pole at 0). There is no subharmonic oscillation, and m<sub>c</sub>, Q<sub>p</sub> do not apply.');
  if (p.topo !== 'buck' && pl.zeros.some(z => z.re > 0)) t.push('The RHP zero of boost and buck-boost is still there in current mode. Keep f<sub>c</sub> below f<sub>RHP</sub>/5.');
  t.push('Blanking t<sub>b</sub> hides the current spike at turn-on: the comparator is ignored for t<sub>b</sub> after each clock. It also sets a minimum on-time. When the needed duty is below it, the controller skips pulses: a pulse is left out when the min on-time alone would pass v<sub>c</sub>.');
  t.push(`v<sub>c</sub> is limited to ${fmtSI(L.cfg.vcMax, 'V')}, so the peak current is limited to about ${fmtSI(L.cfg.vcMax / L.cfg.Ri, 'A')} (cycle-by-cycle current limit). Try the soft-start event.`);
  return t;
}

function acmcTips(L) {
  const t = [], p = L.p;
  t.push('Average current mode: the voltage loop sets a current reference i<sub>ref</sub>; the current amplifier G<sub>ci</sub> compares it with R<sub>i</sub>·i<sub>L</sub> and drives the PWM. Put <b>iref</b> and <b>Ri·iL</b> on the scope: the average of R<sub>i</sub>·i<sub>L</sub> follows i<sub>ref</sub>.');
  t.push('Design the current loop first (Bode view "Current loop": T<sub>i</sub> = G<sub>ci</sub>·R<sub>i</sub>·G<sub>id</sub>/V<sub>M</sub>, f<sub>ci</sub> near fs/6), then the voltage loop with the current loop closed. The outer plant G<sub>vi</sub> then looks like one pole, so Type 2 or PI is enough.');
  t.push('The current amplifier passes the inductor ripple to the PWM. Dixon\'s rule: the amplified down-slope |G<sub>ci</sub>(fs)|·R<sub>i</sub>·di<sub>L</sub>/dt must stay below the ramp slope V<sub>M</sub>·fs. Raise the current-amplifier gain K until the slope ratio passes about 1.5 and watch the duty alternate period by period in the switching simulation.');
  t.push('Unlike peak current mode, the integrator in G<sub>ci</sub> makes the average current exact, so there is no peak-to-average error and no slope compensation is needed below the slope limit.');
  if (L.plant.kind === 'pmap') t.push('In DCM the averaged model has no inductor-current state, so both G<sub>vd</sub> and G<sub>id</sub> here come from the switching model (one period linearized). They are plotted up to fs/2.');
  if (p.topo !== 'buck' && L.marks.some(m => m.rhp)) t.push('The RHP zero of boost and buck-boost is in G<sub>vd</sub>, not in G<sub>id</sub>: the current loop can be fast, but the voltage loop must stay below f<sub>RHP</sub>/5.');
  t.push(`i<sub>ref</sub> is limited to ${fmtSI(L.cfg.vcMax, 'V')}, so the average inductor current is limited to about ${fmtSI(L.cfg.vcMax / L.cfg.Ri, 'A')}.`);
  return t;
}

/* ---------- FRA: frequency response measured on the switching simulation ---------- */
const FRA_TIP = '<b>Measure with FRA</b> (under the Bode plot) injects a small sine into the switching simulation at each test frequency, like a network analyzer on the bench, and draws the measured T and plant as squares. Below about fs/5 they sit on the curves. Above it the averaged curves are no longer exact. In VMC CCM the measured gain is a few tenths of a dB lower even at low frequency; the likely cause is the ripple on v<sub>c</sub> at the PWM comparator, which the averaged model leaves out.';
const fraKey = () => JSON.stringify([effParams(), ctlCfg(), CTL.bodeView]);

function buildFraBar() {
  const bar = document.createElement('div');
  bar.className = 'fraBar'; bar.id = 'fraBar';
  bar.innerHTML = `<button class="btn" id="fraRun" title="Inject a small sine into the switching simulation at each frequency and measure T and the plant">Measure with FRA</button>
    <label class="ctlInline">Points <select id="fraN">${[8, 15, 25].map(n => `<option value="${n}"${n === 15 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
    <button class="btn" id="fraCancel" hidden>Cancel</button><span class="fraMsg" id="fraMsg"></span>`;
  CTL.bodeInfo.after(bar);
  $('#fraRun').addEventListener('click', fraStart);
  $('#fraCancel').addEventListener('click', () => fraStop('Cancelled.'));
}

// Runs one test frequency after the other in slices of about 30 ms, so the page stays live.
// run.step(ms) does one slice; the UI test calls it directly.
function fraStart() {
  fraStop();
  const L = ctlLoop(), view = CTL.bodeView, freqs = fraFreqs(L, view, +$('#fraN').value);
  const run = CTL.fra = { key: fraKey(), view, pts: [], running: true, total: freqs.length, t0: performance.now(), msg: '' };
  let gen = null, i = 0;
  run.step = (ms = 30) => {
    const t0 = performance.now();
    while (run.running && performance.now() - t0 < ms) {
      if (!gen) {
        if (i >= freqs.length) { run.running = false; run.t1 = performance.now(); break; }
        gen = fraPointSteps(L, freqs[i], { view });
      }
      const r = gen.next();
      if (r.done) { run.pts.push(r.value); gen = null; i++; drawBode(); }
    }
    fraUI();
  };
  const tick = () => { if (CTL.fra === run && run.running) { run.step(); setTimeout(tick, 0); } };
  fraUI(); setTimeout(tick, 0);
}
function fraStop(msg) {
  if (CTL.fra && CTL.fra.running) { CTL.fra.running = false; CTL.fra.t1 = performance.now(); CTL.fra.msg = msg || ''; }
  fraUI();
}
function fraUI() {
  const f = CTL.fra, el = $('#fraMsg');
  if (!el) return;
  $('#fraCancel').hidden = !(f && f.running); $('#fraRun').disabled = !!(f && f.running);
  if (!f) { el.textContent = 'Not measured yet.'; return; }
  const n = f.pts.length;
  if (f.running) el.textContent = `Measuring point ${n + 1} of ${f.total}…`;
  else if (f.key !== CTL.curKey) el.textContent = n ? 'Settings changed since the measurement: run it again.' : f.msg;
  else el.textContent = (f.msg ? f.msg + ' ' : '') + `${n} points measured in ${((f.t1 - f.t0) / 1000).toFixed(1)} s (squares).`;
}
// Measured points of the shown loop as squares on the matching curves (phase unwrapped to them).
function fraDots() {
  const f = CTL.fra, out = [];
  if (!f || f.key !== CTL.curKey || !CTL.data) return out;
  for (const pt of f.pts) for (const [id, H] of [['loop', pt.T], ['plant', pt.P]]) {
    const c = CTL.data.curves.find(c => c.id === id && !c.hidden); if (!c) continue;
    let ph = Cx.deg(H); const ref = bodeAt(CTL.data, c, pt.f).ph;
    ph += 360 * Math.round((ref - ph) / 360);
    out.push({ f: pt.f, mag: Cx.db(H), ph, color: c.color });
  }
  return out;
}
function fraHoverText(fh) {
  const f = CTL.fra;
  if (!f || f.key !== CTL.curKey || !f.pts.length) return '';
  const pt = f.pts.reduce((a, b) => Math.abs(Math.log(b.f / fh)) < Math.abs(Math.log(a.f / fh)) ? b : a);
  if (Math.abs(Math.log(pt.f / fh)) > 0.05) return '';
  return `\nFRA at ${fmtHz(pt.f)}: T ${Cx.db(pt.T).toFixed(1)} dB, ${Cx.deg(pt.T).toFixed(1)}°   plant ${Cx.db(pt.P).toFixed(1)} dB, ${Cx.deg(pt.P).toFixed(1)}°`;
}

/* ---------- drag zeros, poles and gain on the Bode plot ---------- */
function canvasXY(e) {
  const r = CTL.bode.getBoundingClientRect();
  return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
}
// Nearest handle within 12 CSS px.
function hitHandle(e) {
  if (!CTL.handles || !CTL.handles.length) return null;
  const { x, y } = canvasXY(e);
  let best = null, bd = 12 * dpr;
  for (const h of CTL.handles) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } }
  return best;
}
// Zero or pole: frequency under the pointer. Gain: K (or fi) times the dB moved since the
// drag started, read on the axis of that moment (the plot rescales while K changes).
function dragTo(e) {
  const d = CTL.drag, { x, y } = canvasXY(e), def = CTL_COMP[d.h.key];
  const v = d.h.kind === 'gain' ? d.v0 * 10 ** ((d.geo.dbAt(y) - d.geo.dbAt(d.y0)) / 20) : d.geo.fAt(x);
  d.hc.cfg[d.h.key] = +clamp(v, def.min, def.max).toPrecision(4);
  syncRows(d.hc.pre, compDefs(d.hc.cfg), d.hc.get);
  ctlChanged(d.h.key, false);
}
