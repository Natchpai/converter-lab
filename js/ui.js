'use strict';

/* ================= UI construction ================= */
function sliderPos(d, v) { return d.log ? Math.round(1000 * Math.log(v / d.min) / Math.log(d.max / d.min)) : v; }
function sliderVal(d, s) { return d.log ? +(d.min * Math.pow(d.max / d.min, s / 1000)).toPrecision(3) : +s; }
function fmtParam(d, v) { return d.unit ? fmtSI(v, d.unit, 3) : v.toFixed(3); }

function buildParams(list, host) {
  host.innerHTML = list.map(d => `
    <div class="prow" id="row-${d.k}">
      <div class="top"><label for="sl-${d.k}">${d.label}</label><input class="num" id="nb-${d.k}" type="text" inputmode="decimal" aria-label="${d.k} value"></div>
      <input type="range" id="sl-${d.k}" ${d.log ? 'min="0" max="1000" step="1"' : `min="${d.min}" max="${d.max}" step="${d.step}"`}>
    </div>`).join('');
  for (const d of list) {
    const sl = $('#sl-' + d.k), nb = $('#nb-' + d.k);
    sl.addEventListener('input', () => { state.applyNote = ''; state.p[d.k] = sliderVal(d, sl.value); nb.value = fmtParam(d, state.p[d.k]); paramChanged(); });
    nb.addEventListener('change', () => {
      let v = parseSI(nb.value);
      if (isFinite(v)) state.p[d.k] = clamp(v, d.min, d.max);
      syncParam(d.k); requestCompute();
    });
  }
}
// Circuit parameter moved. The Control page reruns its closed-loop simulation after a short
// pause (it takes ~100-200 ms); the Bode plot follows right away.
function paramChanged() {
  if (state.page === 'control') { requestControlRender(); scheduleSim(200); } else requestCompute();
}
function syncParam(k) {
  const d = PDEF[k];
  $('#sl-' + k).value = sliderPos(d, state.p[k]);
  $('#nb-' + k).value = fmtParam(d, state.p[k]);
}
function syncAllParams() { for (const k in PDEF) syncParam(k); }

function updateNonIdealUI() {
  $('#nonIdealHint').style.display = state.nonideal ? 'none' : '';
  for (const d of NONIDEAL) {
    const row = $('#row-' + d.k);
    const hidden = (d.only === 'sync' && !state.sync) || (d.only === 'async' && state.sync);
    row.style.display = hidden ? 'none' : '';
    row.classList.toggle('dis', !state.nonideal);
    $('#sl-' + d.k).disabled = !state.nonideal; $('#nb-' + d.k).disabled = !state.nonideal;
  }
}

const SCALES = []; for (let e = -3; e <= 2; e++) for (const m of [1, 2, 5]) SCALES.push(m * 10 ** e);
function buildChannels() {
  els.chanRow.innerHTML = state.ch.map((c, i) => `
    <div class="ch ${c.on ? '' : 'off'}" style="--c:${chColor(i)}" id="ch${i}">
      <div class="h">CH${i + 1}<label><input type="checkbox" class="on" ${c.on ? 'checked' : ''}> on</label></div>
      <select class="sig" aria-label="CH${i + 1} signal">${(state.page === 'control' ? [...SIGNALS, ...CL_SIGNALS] : SIGNALS).map(s => `<option value="${s.k}" ${s.k === c.sig ? 'selected' : ''} title="${s.d}">${s.n}: ${s.d}</option>`).join('')}</select>
      <div class="r2"><select class="scale" aria-label="CH${i + 1} scale"></select>
        <select class="cpl" aria-label="CH${i + 1} coupling"><option value="dc">DC</option><option value="ac" ${c.ac ? 'selected' : ''}>AC</option></select></div>
      <div class="pos">Position <input type="range" class="posr" min="-4" max="4" step="0.1" value="${c.pos}" aria-label="CH${i + 1} position"></div>
    </div>`).join('');
  state.ch.forEach((c, i) => {
    const root = $('#ch' + i);
    fillScale(i);
    root.querySelector('.on').addEventListener('change', e => { c.on = e.target.checked; root.classList.toggle('off', !c.on); renderLive(); });
    root.querySelector('.sig').addEventListener('change', e => { c.sig = e.target.value; c.scale = 'auto'; fillScale(i); renderLive(); });
    root.querySelector('.scale').addEventListener('change', e => { c.scale = e.target.value; renderLive(); });
    root.querySelector('.cpl').addEventListener('change', e => { c.ac = e.target.value === 'ac'; renderLive(); });
    root.querySelector('.posr').addEventListener('input', e => { c.pos = +e.target.value; renderLive(); });
  });
  updateChannelUI();
}
function fillScale(i) {
  const c = state.ch[i], u = SIG[c.sig].u, sel = $('#ch' + i + ' .scale');
  sel.innerHTML = `<option value="auto">Auto</option>` + SCALES.map(s => `<option value="${s}" ${String(s) === String(c.scale) ? 'selected' : ''}>${fmtSI(s, u)}/div</option>`).join('');
  if (c.scale === 'auto') sel.value = 'auto';
}
function updateChannelUI() {
  const ov = state.layout === 'overlay';
  state.ch.forEach((c, i) => {
    const root = $('#ch' + i);
    root.querySelector('.scale').disabled = !ov;
    root.querySelector('.posr').disabled = !ov;
  });
}

function buildTimeControls() {
  const opts = ['<option value="auto">Auto</option>'];
  for (let e = -8; e <= -1; e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; opts.push(`<option value="${v}">${fmtSI(v, 's')}</option>`); }
  $('#tdivSel').innerHTML = opts.join('');
  $('#winSel').innerHTML = ['auto', 20, 50, 100, 200, 500, 1000, 2000, 5000].map(v => `<option value="${v}">${v === 'auto' ? 'Auto' : v + ' periods'}</option>`).join('');
  $('#tdivSel').addEventListener('change', e => { state.tdiv = e.target.value; renderLive(); });
  $('#hposRange').addEventListener('input', e => { state.hpos = +e.target.value; renderLive(); });
  $('#winSel').addEventListener('change', e => { state.win = e.target.value; requestCompute(); });
}

function updateSegs() {
  document.querySelectorAll('.seg[data-group]').forEach(g => {
    const grp = g.dataset.group;
    let cur = state[grp]; if (typeof cur === 'boolean') cur = cur ? '1' : '0';
    g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === cur)));
  });
  $('#winWrap').style.display = state.view === 'startup' ? '' : 'none';
  $('#theoryChk').disabled = state.view !== 'steady';
}
document.querySelectorAll('.seg[data-group]').forEach(g => {
  g.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const grp = g.dataset.group, v = b.dataset.v;
    if (grp === 'page') { setPage(v); return; }
    if (grp === 'nonideal' || grp === 'sync') state[grp] = v === '1'; else state[grp] = v;
    if (grp === 'nonideal' && state.nonideal) $('#secNonIdeal').open = true;
    if (grp === 'view') { state.hpos = v === 'steady' ? 0.1 : 0; $('#hposRange').value = state.hpos; state.tdiv = 'auto'; $('#tdivSel').value = 'auto'; }
    if (grp === 'topo' || grp === 'sync') { buildSchem(); buildSpecUI(); buildCompUI(); requestDesign(); }
    if (grp === 'layout') { updateChannelUI(); updateSegs(); renderLive(); return; }
    if (grp === 'scopeBg') { applyScopeBg(); return; }
    updateSegs(); updateNonIdealUI(); requestCompute();
  });
});

// Pages: Design and Losses have their own panels; Converter and Control share the scope.
// Each scope page keeps its channels and time base (state.simPage is the one loaded in state.ch).
const PAGES = ['design', 'converter', 'losses', 'control'];
const onSimPage = () => state.page === 'converter' || state.page === 'control';
function setPage(pg, noCompute) {
  if (!PAGES.includes(pg)) return;
  state.page = pg;
  document.body.dataset.page = pg;
  const sim = pg === 'converter' || pg === 'control';
  document.querySelectorAll('.simOpt button').forEach(b => { b.disabled = !sim; });
  if (pg === 'control') document.querySelectorAll('.convOpt button').forEach(b => { b.disabled = true; });
  updateSegs(); applySide(); markGuide();
  if (pg === 'design') { if (designDirty) requestDesign(); return; }
  if (pg === 'losses') { sizeCanvas(effCv, 320); drawEff(); requestLosses(); return; }
  if (pg !== state.simPage) {
    const old = state.pages[state.simPage];
    old.tdiv = state.tdiv; old.hpos = state.hpos;
    const cur = state.pages[pg];
    state.ch = cur.ch; state.tdiv = cur.tdiv; state.hpos = cur.hpos;
    $('#tdivSel').value = state.tdiv; $('#hposRange').value = state.hpos;
    state.simPage = pg;
  }
  buildChannels(); updateNonIdealUI(); showTab(savedTab()); setScopeSplit(scopeSplit()); setColSplit(colSplit());
  if (!noCompute) requestCompute();
}

/* ---------- first-visit guide: shown until "Got it", the Guide button shows it again ---------- */
function markGuide() { document.querySelectorAll('#guide [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === state.page)); }
function showGuide(on) {
  $('#guide').hidden = !on;
  $('#guideBtn').setAttribute('aria-expanded', String(on));
  markGuide();
}
$('#guide').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) setPage(b.dataset.go); });
$('#guideOk').addEventListener('click', () => { showGuide(false); saveNum('dcdc-guide', 1); });
$('#guideBtn').addEventListener('click', () => showGuide($('#guide').hidden));
showGuide(loadNum('dcdc-guide', 0) !== 1);

/* ---------- channel settings: folded behind a button in the app shell ---------- */
function setChanOpen(on, save) {
  $('.scopeWrap').classList.toggle('showCh', on);
  $('#chanBtn').setAttribute('aria-expanded', String(on));
  if (save) try { localStorage.setItem('dcdc-ch', on ? '1' : '0'); } catch (e) { /* storage blocked */ }
}
$('#chanBtn').addEventListener('click', () => setChanOpen(!$('.scopeWrap').classList.contains('showCh'), true));
try { setChanOpen(localStorage.getItem('dcdc-ch') === '1'); } catch (e) { /* storage blocked */ }

/* ---------- drag handles between panels (app shell): scope height, sidebar width, bottom row ---------- */
function loadNum(key, def) {
  let v = NaN;
  try { v = parseFloat(localStorage.getItem(key)); } catch (e) { /* storage blocked */ }
  return isFinite(v) ? v : def;
}
function saveNum(key, v) { try { localStorage.setItem(key, String(v)); } catch (e) { /* storage blocked */ } }
function dropKey(key) { try { localStorage.removeItem(key); } catch (e) { /* storage blocked */ } }
// o.start() measures the panels when a drag starts, o.value(ctx, pos) turns the position of the
// handle's left/top edge into a value, o.set(v, save) applies and returns the clamped value,
// o.get() the current one.
function bindSplitter(el, o) {
  let drag = null;
  const edge = e => ({ clientX: e.clientX - drag.dx, clientY: e.clientY - drag.dy });
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const r = el.getBoundingClientRect();
    drag = { ctx: o.start(), v: o.get(), moved: false, dx: e.clientX - r.left, dy: e.clientY - r.top };
    el.classList.add('drag');
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* synthetic event */ }
    e.preventDefault();
  });
  const end = () => { if (!drag) return; if (drag.moved) o.set(drag.v, true); drag = null; el.classList.remove('drag'); };
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!(e.buttons & 1)) { end(); return; }
    drag.v = o.set(o.value(drag.ctx, edge(e))); drag.moved = true;
  });
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener('dblclick', o.reset);
  el.addEventListener('keydown', e => {
    const d = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    if (d) { e.preventDefault(); o.set(o.get() + d * o.step, true); }
    else if (e.key === 'Home') { e.preventDefault(); o.reset(); }
  });
}
const bottomLeft = () => $(state.page === 'control' ? '#bodePanel' : '.schem');

// scope height: share of the two rows, per page
const SPLIT_DEF = { converter: 1.3 / 2.3, control: 0.5 };
const scopeSplit = () => loadNum('dcdc-split-' + state.page, SPLIT_DEF[state.page] || SPLIT_DEF.converter);
function setScopeSplit(f, save) {
  f = clamp(f, 0.25, 0.8);
  const m = $('#page-sim');
  m.style.setProperty('--top', f.toFixed(3) + 'fr');
  m.style.setProperty('--bot', (1 - f).toFixed(3) + 'fr');
  $('#scopeSplit').setAttribute('aria-valuenow', String(Math.round(f * 100)));
  if (save) saveNum('dcdc-split-' + state.page, f.toFixed(3));
  return f;
}
function resetScopeSplit() { dropKey('dcdc-split-' + state.page); setScopeSplit(scopeSplit()); }
bindSplitter($('#scopeSplit'), {
  start: () => { const t = $('.scopeWrap').getBoundingClientRect(); return { y0: t.top, h: t.height + bottomLeft().getBoundingClientRect().height }; },
  value: (c, e) => (e.clientY - c.y0) / c.h,
  get: scopeSplit, set: setScopeSplit, reset: resetScopeSplit, step: 0.03,
});

// bottom row: share of the left panel (schematic or Bode) next to the inspector, per page
const COLS_DEF = { converter: 1.2 / 2.2, control: 1.4 / 2.4 };
const colSplit = () => loadNum('dcdc-cols-' + state.page, COLS_DEF[state.page] || COLS_DEF.converter);
function setColSplit(f, save) {
  f = clamp(f, 0.25, 0.75);
  const m = $('#page-sim');
  m.style.setProperty('--cl', f.toFixed(3) + 'fr');
  m.style.setProperty('--cr', (1 - f).toFixed(3) + 'fr');
  $('#colSplit').setAttribute('aria-valuenow', String(Math.round(f * 100)));
  if (save) saveNum('dcdc-cols-' + state.page, f.toFixed(3));
  return f;
}
function resetColSplit() { dropKey('dcdc-cols-' + state.page); setColSplit(colSplit()); }
bindSplitter($('#colSplit'), {
  start: () => { const l = bottomLeft().getBoundingClientRect(); return { x0: l.left, w: l.width + $('#inspector').getBoundingClientRect().width }; },
  value: (c, e) => (e.clientX - c.x0) / c.w,
  get: colSplit, set: setColSplit, reset: resetColSplit, step: 0.03,
});

// sidebar width in px, one per layout (Converter and Control share theirs)
const SIDE_DEF = { 'page-sim': 320, 'page-design': 340, 'page-losses': 320 };
const sideWidth = m => loadNum('dcdc-side-' + m.id, SIDE_DEF[m.id]);
function setSideWidth(m, w, save) {
  w = Math.round(clamp(w, 240, Math.max(240, Math.min(560, 0.45 * (m.clientWidth || 1e4)))));
  m.style.setProperty('--side', w + 'px');
  m.querySelector('.vside').setAttribute('aria-valuenow', String(w));
  if (save) saveNum('dcdc-side-' + m.id, w);
  return w;
}
document.querySelectorAll('.vside').forEach(el => {
  const m = el.parentElement;
  const reset = () => { dropKey('dcdc-side-' + m.id); setSideWidth(m, sideWidth(m)); };
  bindSplitter(el, {
    start: () => m.getBoundingClientRect().left + parseFloat(getComputedStyle(m).paddingLeft),
    value: (x0, e) => e.clientX - x0,
    get: () => parseFloat(m.style.getPropertyValue('--side')) || sideWidth(m),
    set: (w, save) => setSideWidth(m, w, save), reset, step: 16,
  });
});
// The width cap depends on the page width, so apply it again for the visible layout.
function applySide() {
  document.querySelectorAll('.vside').forEach(el => { const m = el.parentElement; if (m.clientWidth) setSideWidth(m, sideWidth(m)); });
}
function applySplits() {
  document.querySelectorAll('.vside').forEach(el => setSideWidth(el.parentElement, sideWidth(el.parentElement)));
  applySide(); setScopeSplit(scopeSplit()); setColSplit(colSplit());
}
window.addEventListener('resize', applySide);

/* ---------- inspector tabs (Converter and Control pages) ---------- */
const TABS = { converter: ['theory', 'meas', 'eq', 'map', 'tips'], control: ['loop', 'meas', 'amp', 'notes'] };
function savedTab() {
  try { return localStorage.getItem('dcdc-tab-' + state.page) || ''; } catch (e) { return ''; }
}
function showTab(t, save) {
  const list = TABS[state.page]; if (!list) return;
  if (!list.includes(t)) t = list[0];
  document.querySelectorAll('#inspTabs [data-tab]').forEach(b => {
    const on = b.dataset.tab === t;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('#inspector [data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
  if (save) try { localStorage.setItem('dcdc-tab-' + state.page, t); } catch (e) { /* storage blocked */ }
}
$('#inspTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab, true);
});
$('#inspTabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const list = TABS[state.page], i = list.indexOf(document.activeElement.dataset.tab);
  if (i < 0) return;
  const t = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
  showTab(t, true);
  $(`#inspTabs [data-tab="${t}"]`).focus();
});

document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.preset;
  if (k === 'reset') { resetParams(); }
  else {
    const p = effParams(), th = theory(p);
    const K = th.Kcrit * (k === 'ccm' ? 4 : k === 'bcm' ? 1 : 0.2);
    state.p.R = +clamp(2 * p.L / (K * p.T), PDEF.R.min, PDEF.R.max).toPrecision(4);
  }
  syncAllParams(); requestCompute();
}));

$('#theoryChk').addEventListener('change', e => { state.theory = e.target.checked; renderLive(); });
$('#shadeChk').addEventListener('change', e => { state.shade = e.target.checked; renderLive(); });

/* ---------- scope pointer interaction ---------- */
let dragging = null;
function fracFromEvent(e) { const r = els.scope.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); }
els.scope.addEventListener('pointerdown', e => {
  const f = fracFromEvent(e), w = els.scope.getBoundingClientRect().width;
  const d1 = Math.abs(f - state.c1) * w, d2 = Math.abs(f - state.c2) * w;
  dragging = d2 < 14 && d2 < d1 ? 'c2' : 'c1';
  state[dragging] = f;
  els.scope.setPointerCapture(e.pointerId);
  renderLive();
});
els.scope.addEventListener('pointermove', e => { if (!dragging) return; state[dragging] = fracFromEvent(e); renderLive(); });
const endDrag = () => { dragging = null; };
els.scope.addEventListener('pointerup', endDrag);
els.scope.addEventListener('pointercancel', endDrag);

els.mm.addEventListener('click', e => {
  const r = els.mm.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const pw = r.width - MM.ml - MM.mr, ph = r.height - MM.mt - MM.mb;
  const D = clamp((x - MM.ml) / pw, PDEF.D.min, PDEF.D.max);
  const K = 10 ** (MM.Kmin + (1 - clamp((y - MM.mt) / ph, 0, 1)) * (MM.Kmax - MM.Kmin));
  state.p.D = +D.toFixed(3);
  state.p.R = +clamp(2 * state.p.L * state.p.fs / K, PDEF.R.min, PDEF.R.max).toPrecision(3);
  syncAllParams(); requestCompute();
});

/* ---------- play animation ---------- */
let lastTs = 0;
function playLoop(ts) {
  if (!state.playing) return;
  const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0; lastTs = ts;
  state.c1 = (state.c1 + dt / 6) % 1;
  renderLive();
  requestAnimationFrame(playLoop);
}
$('#playBtn').addEventListener('click', () => {
  state.playing = !state.playing;
  $('#playBtn').textContent = state.playing ? 'Pause' : 'Play';
  if (state.playing) { lastTs = 0; requestAnimationFrame(playLoop); }
});

/* ---------- sizing ---------- */
function sizeCanvas(cv, cssH) {
  dpr = window.devicePixelRatio || 1;
  const w = cv.parentElement.clientWidth;
  cv.style.height = cssH + 'px';
  cv.width = Math.max(10, Math.round(w * dpr));
  cv.height = Math.round(cssH * dpr);
}
// Draw right away after resizing: setting canvas.width clears it, and waiting for the
// next animation frame would show one blank frame.
// App shell (css/app.css): on a large window the screen gets its height from the layout.
const SHELL = window.matchMedia('screen and (min-width: 1100px) and (min-height: 600px)');
function resize() {
  const w = els.screen.clientWidth;
  sizeCanvas(els.scope, SHELL.matches ? Math.max(120, els.screen.clientHeight) : Math.round(clamp(w * 0.56, 260, 560)));
  if (RES && onSimPage()) renderLiveNow();
  drawPageCanvas(true);
}
new ResizeObserver(() => resize()).observe(els.screen);
new ResizeObserver(() => drawPageCanvas(true)).observe(els.mm.parentElement);
new ResizeObserver(() => drawPageCanvas(true)).observe($('#bodeWrap'));
SHELL.addEventListener('change', () => resize());
// The canvas of the side panel on the current page (mode map or Bode plot).
function drawPageCanvas(resized) {
  if (!RES || !onSimPage()) return;
  if (state.page === 'control') { if (resized) sizeBode(); drawBode(); }
  else { if (resized) sizeCanvas(els.mm, 210); drawModeMap(); }
}
/* ---------- light / night theme ---------- */
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
function curTheme() { return document.documentElement.dataset.theme || (darkMQ.matches ? 'dark' : 'light'); }
function updateThemeSeg() {
  const t = curTheme();
  document.querySelectorAll('#themeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === t)));
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('dcdc-theme', t); } catch (e) { /* storage blocked: theme still applies for this visit */ }
  updateThemeSeg();
  drawPageCanvas();
}
try { const t = localStorage.getItem('dcdc-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
{ const t = new URLSearchParams(location.search).get('theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; }
document.querySelectorAll('#themeSeg button').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.t)));
darkMQ.addEventListener('change', () => { updateThemeSeg(); drawPageCanvas(); });
updateThemeSeg();

/* ---------- scope screen: dark (default) or light ---------- */
function applyScopeBg() {
  els.screen.classList.toggle('light', state.scopeBg === 'light');
  try { localStorage.setItem('dcdc-scope-bg', state.scopeBg); } catch (e) { /* storage blocked: applies for this visit */ }
  updateSegs();
  state.ch.forEach((c, i) => { const el = $('#ch' + i); if (el) el.style.setProperty('--c', chColor(i)); });
  renderLive();
}
try { if (localStorage.getItem('dcdc-scope-bg') === 'light') state.scopeBg = 'light'; } catch (e) { /* ignore */ }
els.screen.classList.toggle('light', state.scopeBg === 'light');

/* ---------- render scheduling ---------- */
let pendingCompute = false, pendingRender = false;
function requestCompute() {
  if (pendingCompute) return; pendingCompute = true;
  requestAnimationFrame(() => { pendingCompute = false; compute(); renderAll(); });
}
function renderLive() {
  if (pendingRender) return; pendingRender = true;
  requestAnimationFrame(() => { pendingRender = false; if (RES && onSimPage()) renderLiveNow(); });
}
function renderLiveNow() {
  renderScope(); renderReadout();
  if (state.page === 'control') renderControlLive(); else renderSchem();
}
function renderAll() {
  if (!RES || !onSimPage()) return;
  renderScope(); renderReadout();
  if (state.page === 'control') { renderControl(); drawBode(); }
  else { renderSchem(); renderTheory(); drawModeMap(); }
}

/* ---------- export: scope CSV and PNG ---------- */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
// Enabled channels as CSV text (every sample, thinned to about 50k rows).
function scopeCSV(res) {
  const keys = [...new Set(state.ch.filter(c => c.on).map(c => c.sig))];
  if (!keys.length) keys.push('iL');
  const r = res.rec, arrs = keys.map(k => sigArr(res, k));
  const stride = Math.max(1, Math.ceil(r.n / 50000));
  const lines = ['t (s),' + keys.map(k => `${SIG[k].n}${SIG[k].u ? ` (${SIG[k].u})` : ''}`).join(',')];
  for (let i = 0; i < r.n; i += stride) lines.push(r.t[i].toPrecision(8) + ',' + arrs.map(a => a[i].toPrecision(7)).join(','));
  return lines.join('\n');
}
const exportName = () => `dcdc-${state.topo}-${state.page === 'control' ? 'control' : state.view}`;
$('#csvBtn').addEventListener('click', () => { if (RES) download(new Blob([scopeCSV(RES)], { type: 'text/csv' }), exportName() + '.csv'); });
$('#pngBtn').addEventListener('click', () => els.scope.toBlob(b => { if (b) download(b, exportName() + '.png'); }));
