'use strict';

/* ================= UI test (index.html?uitest) ================= */
// Clicks through the Control page like a user and checks that every step leaves a sane page:
// no uncaught error, a slider row for every compensator parameter, no NaN in the readouts and
// finite Bode curves. Each step computes and renders at once, so no timers are needed.
// Then the Converter (dead time, ringing, CSV), Design and Losses pages; the efficiency
// curve runs in time slices, so uiTest() checks it after the synchronous steps.
function runUiTests() {
  const out = [], errors = [];
  let allPass = true;
  const onErr = e => errors.push(e.message || String(e.error || e));
  window.addEventListener('error', onErr);
  const click = sel => { const b = $(sel); if (!b) throw new Error('no element ' + sel); b.click(); };
  const step = (name, act) => {
    errors.length = 0;
    const bad = [];
    try { act(); compute(); renderAll(); } catch (e) { bad.push('threw: ' + e.message); }
    bad.push(...errors.map(m => 'error: ' + m));
    if (state.page === 'control') {
      for (const k of COMP_TYPES[CTL.cfg.comp.type].keys) if (!$('#cc-sl-' + k)) bad.push(`no row for ${k}`);
      if (CTL.cfg.mode === 'acmc') for (const k of COMP_TYPES[CTL.cfg.ci.type].keys) if (!$('#ci-sl-' + k)) bad.push(`no current-amp row for ${k}`);
      if ($('#ciBlock').hidden !== (CTL.cfg.mode !== 'acmc')) bad.push('current-loop block shown in the wrong mode');
      for (const id of ['#ctlOp', '#loopKv', '#stepKv']) if (/NaN/.test($(id).textContent)) bad.push(`NaN in ${id}`);
      for (const c of (CTL.data ? CTL.data.curves : [])) {
        let n = 0; for (let i = 0; i < c.mag.length; i++) if (!isFinite(c.mag[i]) || !isFinite(c.ph[i])) n++;
        if (n) bad.push(`${c.short}: ${n} non-finite points`);
      }
    }
    const noNaN = ids => { for (const id of ids) if (/NaN/.test($(id).textContent)) bad.push(`NaN in ${id}`); };
    if (state.page === 'converter') noNaN(['#measTbl', '#cmpTbl', '#headVals', '#schemInfo']);
    if (state.page === 'design') noNaN(['#dSizeTbl', '#dCornerTbl', '#dRateTbl']);
    if (state.page === 'losses') noNaN(['#lSum', '#lTbl', '#lCoreTbl']);
    const pass = !bad.length;
    allPass = allPass && pass;
    const types = CTL.cfg.mode === 'acmc' ? `${CTL.cfg.ci.type}/${CTL.cfg.comp.type}` : CTL.cfg.comp.type;
    out.push(`${pass ? 'PASS' : 'FAIL'} ${name} [${CTL.cfg.mode} ${types}]${pass ? '' : ': ' + bad.join('; ')}`);
  };
  const types = ['P', 'I', 'PI', 'T2', 'T3', 'I', 'P'];
  step('page Control', () => click('[data-group="page"] [data-v="control"]'));
  for (const t of types) step(`VMC type ${t}`, () => click(`#compType [data-t="${t}"]`));
  step('Textbook Type 3', () => { click('#compType [data-t="T2"]'); click('#btnTextbook'); });
  step('mode PCMC', () => click('#ctlMode [data-m="pcmc"]'));
  for (const t of types) step(`PCMC type ${t}`, () => click(`#compType [data-t="${t}"]`));
  step('PCMC Se = Sf/2', () => click('#btnSeHalf'));
  step('PCMC auto design', () => click('#btnAuto'));
  for (const v of ['boost', 'bb', 'buck']) step(`PCMC topology ${v}`, () => click(`[data-group="topo"] [data-v="${v}"]`));
  step('PCMC DCM example', () => click('[data-preset="dcm"]'));
  step('PCMC non-ideal', () => click('[data-group="nonideal"] [data-v="1"]'));
  step('PCMC reset', () => click('[data-preset="reset"]'));
  // buck, Vin = 12 V: 20 V cannot be reached, the page must still show finite numbers
  step('PCMC unreachable Vo* = 20 V', () => { sideSet('Vt', 20); syncRows('cs', sideDefs(), sideGet); });
  step('PCMC Vo* back to 5 V', () => { sideSet('Vt', 5); syncRows('cs', sideDefs(), sideGet); });
  step('mode ACMC', () => click('#ctlMode [data-m="acmc"]'));
  for (const t of types) step(`ACMC current amp ${t}`, () => click(`#ciType [data-t="${t}"]`));
  step('ACMC current amp T2', () => click('#ciType [data-t="T2"]'));
  for (const t of types) step(`ACMC voltage comp ${t}`, () => click(`#compType [data-t="${t}"]`));
  step('ACMC voltage comp T2', () => click('#compType [data-t="T2"]'));
  step('ACMC current-amp circuit and Zout', () => {
    renderAll();
    if ($('#opampIBlock').hidden || /NaN/.test($('#opampTblI').textContent) || !/R2/.test($('#opampTblI').textContent)) throw new Error('no current-amp values');
    if (!CTL.data.curves.some(c => c.short === 'Zout')) throw new Error('no closed-loop Zout curve');
  });
  step('ACMC Bode current loop', () => click('#bodeLegend [data-view="inner"]'));
  step('ACMC drag current-amp zero', () => {
    renderAll();
    const h = CTL.handles.find(x => x.kind === 'zero'), ci0 = CTL.cfg.ci.fz1, cv0 = CTL.cfg.comp.fz1;
    const r = CTL.bode.getBoundingClientRect(), at = (x, y) => ({ clientX: r.left + x / dpr, clientY: r.top + y / dpr, pointerId: 1, bubbles: true });
    CTL.bode.dispatchEvent(new PointerEvent('pointerdown', at(h.x, h.y)));
    CTL.bode.dispatchEvent(new PointerEvent('pointermove', at(h.x - 30 * dpr, h.y)));
    CTL.bode.dispatchEvent(new PointerEvent('pointerup', at(h.x - 30 * dpr, h.y)));
    if (!(CTL.cfg.ci.fz1 < ci0) || CTL.cfg.comp.fz1 !== cv0) throw new Error(`Gci fz ${ci0} -> ${CTL.cfg.ci.fz1}, Gcv fz ${cv0} -> ${CTL.cfg.comp.fz1}`);
  });
  for (const v of ['boost', 'bb', 'buck']) step(`ACMC topology ${v}`, () => click(`[data-group="topo"] [data-v="${v}"]`));
  step('ACMC DCM example', () => click('[data-preset="dcm"]'));
  step('ACMC Bode voltage loop', () => click('#bodeLegend [data-view="outer"]'));
  step('ACMC reset', () => click('[data-preset="reset"]'));
  step('mode PCMC from ACMC', () => click('#ctlMode [data-m="pcmc"]'));
  step('mode ACMC again', () => click('#ctlMode [data-m="acmc"]'));
  step('mode VMC', () => { click('#ctlMode [data-m="vmc"]'); renderAll(); if (!$('#opampIBlock').hidden) throw new Error('current-amp circuit shown in VMC'); });
  // drag with synthetic pointer events: the first pole to the right, then the gain up 6 dB
  const drag = (h, dx, dy) => {
    const r = CTL.bode.getBoundingClientRect(), at = (x, y) => ({ clientX: r.left + x / dpr, clientY: r.top + y / dpr, pointerId: 1, bubbles: true });
    CTL.bode.dispatchEvent(new PointerEvent('pointerdown', at(h.x, h.y)));
    CTL.bode.dispatchEvent(new PointerEvent('pointermove', at(h.x + dx, h.y + dy)));
    CTL.bode.dispatchEvent(new PointerEvent('pointerup', at(h.x + dx, h.y + dy)));
  };
  step('drag a pole on the Bode plot', () => {
    renderAll();
    const h = CTL.handles.find(x => x.kind === 'pole'), f0 = CTL.cfg.comp[h.key], g = CTL.geo;
    drag(h, 40 * dpr, 0);
    const want = g.fAt(h.x + 40 * dpr);
    if (Math.abs(CTL.cfg.comp[h.key] / want - 1) > 1e-3 || CTL.cfg.comp[h.key] <= f0) throw new Error(`${h.key} ${f0} -> ${CTL.cfg.comp[h.key]}, want ${want}`);
    if (Math.abs(parseSI($('#cc-nb-' + h.key).value) / CTL.cfg.comp[h.key] - 1) > 0.01) throw new Error('row not synced');
  });
  step('drag the gain on the Bode plot', () => {
    renderAll();
    const h = CTL.handles.find(x => x.kind === 'gain'), k0 = CTL.cfg.comp.K, g = CTL.geo;
    const dy = g.YM(6) - g.YM(0);                              // 6 dB up (screen y points down)
    drag(h, 0, dy);
    if (Math.abs(20 * Math.log10(CTL.cfg.comp.K / k0) - 6) > 0.05) throw new Error(`K ${k0} -> ${CTL.cfg.comp.K}`);
  });
  step('FRA 8 points (VMC)', () => {
    $('#fraN').value = '8'; click('#fraRun');
    while (CTL.fra.running) CTL.fra.step(1e9);
    const d = fraDots();
    if (CTL.fra.pts.length !== CTL.fra.total || d.length !== 2 * CTL.fra.total || d.some(x => !isFinite(x.mag) || !isFinite(x.ph))) throw new Error(`FRA gave ${CTL.fra.pts.length}/${CTL.fra.total} points, ${d.length} dots`);
  });
  step('FRA stale after a change', () => {
    click('#compType [data-t="T2"]'); compute(); renderAll();
    if (fraDots().length) throw new Error('old FRA points still drawn');
  });
  step('page Converter', () => click('[data-group="page"] [data-v="converter"]'));
  step('Converter sync with dead time', () => {
    click('[data-group="sync"] [data-v="1"]'); compute();
    if (!Array.from(RES.rec.st.subarray(0, RES.rec.n)).includes(BDR)) throw new Error('no body-diode interval');
  });
  step('Converter DCM with node ringing', () => {
    click('[data-group="sync"] [data-v="0"]'); click('[data-preset="dcm"]'); compute();
    const r = RES.rec; let z = 0;
    for (let i = 1; i < r.n; i++) if (r.st[i] === IDLE && r.st[i - 1] === IDLE && r.iL[i - 1] * r.iL[i] < 0) z++;
    if (!RES.m.ring || z < 3) throw new Error(`ring ${RES.m.ring}, ${z} zero crossings of iL while IDLE`);
  });
  step('scope screen light, then dark', () => {
    // median brightness over a grid of points: the background dominates
    const px = () => {
      const cv = els.scope, d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, v = [];
      for (let y = 5; y < cv.height; y += 23) for (let x = 5; x < cv.width; x += 31) { const k = 4 * (y * cv.width + x); v.push((d[k] + d[k + 1] + d[k + 2]) / 3); }
      v.sort((p, q) => p - q); return [Math.round(v[v.length >> 1])];
    };
    click('[data-group="scopeBg"] [data-v="light"]'); renderScope();
    const a = px();
    if (state.scopeBg !== 'light' || !els.screen.classList.contains('light') || Math.min(...a) < 200) throw new Error(`light: pixel ${a}`);
    click('[data-group="scopeBg"] [data-v="dark"]'); renderScope();
    const b = px();
    if (state.scopeBg !== 'dark' || els.screen.classList.contains('light') || Math.max(...b) > 60) throw new Error(`dark: pixel ${b}`);
  });
  step('CSV export text', () => {
    const t = scopeCSV(RES), n = t.split('\n').length;
    if (n < 100 || /NaN/.test(t)) throw new Error(`${n} lines`);
  });
  const designNow = () => { clearTimeout(designTimer); design.out = designRun(state.topo, state.sync, design.specs[state.topo], design.comp, design.sel[state.topo]); designDirty = false; renderDesign(); };
  const designOk = () => { const o = design.out; if (o.errs.length || o.corners.length !== 3 || o.corners.some(c => !c.ok)) throw new Error(o.errs.join(' ') || 'corner failed'); };
  step('page Design', () => { click('[data-group="page"] [data-v="design"]'); designNow(); designOk(); });
  step('Design Io = 1 A', () => {
    const inp = $('#sp-Io'); inp.value = '1'; inp.dispatchEvent(new Event('change'));
    designNow(); designOk();
    if (design.specs.buck.Io !== 1) throw new Error('spec not taken');
  });
  step('Design sync with a generic Q2 class', () => {
    click('[data-group="sync"] [data-v="1"]');
    const sel = $('#compList select[data-part="Q2"]'); sel.value = '1'; sel.dispatchEvent(new Event('change'));
    designNow(); designOk();
  });
  step('Design apply corner Vin max', () => {
    $('#dCorner').value = '2'; click('#dApply'); compute(); renderAll();
    if (state.page !== 'converter' || state.p.Vg !== design.specs.buck.VinMax) throw new Error(`page ${state.page}, Vg ${state.p.Vg}`);
    if (Math.abs(RES.met.vo.mean / design.specs.buck.Vo - 1) > 2e-3) throw new Error(`Vo ${RES.met.vo.mean}`);
    if (!/Applied design corner/.test($('#simWarn').textContent)) throw new Error('no apply note');
  });
  // downloads are caught here (no file dialog in the test); PNG comes back async, checked in uiTest()
  uiDownloads.length = 0; uiDownload0 = download; download = (b, n) => uiDownloads.push({ b, n });
  step('Scope CSV and PNG buttons', () => {
    click('#csvBtn'); click('#pngBtn');
    const c = uiDownloads.find(d => /\.csv$/.test(d.n));
    if (!c || c.b.type !== 'text/csv' || c.b.size < 1000) throw new Error('no CSV download');
  });
  step('Panel handles', () => {
    const m = $('#page-sim'), f0 = scopeSplit(), c0 = colSplit(), w0 = sideWidth(m);
    setScopeSplit(0.7);
    if (m.style.getPropertyValue('--top') !== '0.700fr' || m.style.getPropertyValue('--bot') !== '0.300fr') throw new Error('rows not set');
    if (setScopeSplit(0.95) !== 0.8) throw new Error('no clamp at 0.8');
    setColSplit(0.6);
    if (m.style.getPropertyValue('--cl') !== '0.600fr' || m.style.getPropertyValue('--cr') !== '0.400fr') throw new Error('columns not set');
    if (setColSplit(0.9) !== 0.75) throw new Error('no clamp at 0.75');
    if (setSideWidth(m, 100) !== 240 || m.style.getPropertyValue('--side') !== '240px') throw new Error('sidebar not clamped at 240 px');
    setScopeSplit(f0); setColSplit(c0); setSideWidth(m, w0);
  });
  step('Design save and load JSON', () => {
    click('[data-group="page"] [data-v="design"]');
    click('#dSave');
    if (!uiDownloads.some(d => /^dcdc-design-buck\.json$/.test(d.n) && d.b.type === 'application/json')) throw new Error('no JSON download');
    const j = JSON.parse(JSON.stringify(designJSON())), io = design.specs.buck.Io, ron = design.comp.ron, vg = state.p.Vg;
    design.specs.buck.Io = 1.7; design.comp.ron = 0.1; design.sel.buck.L = 47e-6; state.p.Vg = 20;
    applyDesignJSON(j);
    if (design.specs.buck.Io !== io || design.comp.ron !== ron || design.sel.buck.L !== null || state.p.Vg !== vg) throw new Error('values not restored');
    let threw = false; try { applyDesignJSON({ app: 'other' }); } catch (e) { threw = true; }
    if (!threw) throw new Error('a foreign file was accepted');
    clearTimeout(designTimer); design.out = designRun(state.topo, state.sync, design.specs.buck, design.comp, design.sel.buck); designDirty = false; renderDesign();
  });
  step('Design print summary', () => {
    const pr = window.print; let n = 0;
    window.print = () => { n++; };
    try { click('#dPrint'); } finally { window.print = pr; }
    const a = $('#printArea');
    if (n !== 1 || !/design summary/.test(a.textContent) || a.querySelectorAll('table').length < 5 || /NaN/.test(a.textContent)) throw new Error(`print ${n}, ${a.querySelectorAll('table').length} tables`);
  });
  step('page Losses', () => {
    click('[data-group="page"] [data-v="losses"]'); clearTimeout(lossTimer); renderLosses();
    if ($('#lWarn').textContent || !/%/.test($('#lSum').textContent)) throw new Error($('#lWarn').textContent || 'no summary');
  });
  step('Losses load 20 %', () => {
    const inp = $('#lLoad'); inp.value = '20'; inp.dispatchEvent(new Event('change'));
    if (lossState.load !== 20 || $('#lWarn').textContent) throw new Error($('#lWarn').textContent || `load ${lossState.load}`);
  });
  step('Losses source Converter page', () => {
    const sel = $('#lSrc'); sel.value = 'sim'; sel.dispatchEvent(new Event('change'));
    if ($('#lWarn').textContent || !/Converter page/.test($('#lSum').textContent)) throw new Error($('#lWarn').textContent || 'wrong source');
  });
  window.removeEventListener('error', onErr);
  out.unshift(allPass ? 'UI TEST: ALL PASS' : 'UI TEST: FAILURES');
  return { allPass, lines: out };
}
const uiDownloads = [];
let uiDownload0 = null;
async function uiTest() {
  const r = runUiTests();
  const add = (pass, text) => { r.allPass = r.allPass && pass; r.lines.push(`${pass ? 'PASS' : 'FAIL'} ${text}`); };
  try {
    for (let i = 0; i < 60 && !uiDownloads.some(d => /\.png$/.test(d.n)); i++) await new Promise(res => setTimeout(res, 50));   // toBlob is async
    const png = uiDownloads.find(d => /\.png$/.test(d.n)), js = uiDownloads.find(d => /\.json$/.test(d.n));
    const j = js ? JSON.parse(await js.b.text()) : null;
    add(!!png && png.b.type === 'image/png' && png.b.size > 1000 && !!j && j.app === 'dcdc-converter-lab' && j.specs && j.comp,
      `downloads: PNG ${png ? png.b.size + ' bytes' : 'missing'}, design JSON ${j ? 'parses' : 'missing'}`);
  } catch (err) { add(false, 'downloads: threw ' + err.message); }
  if (uiDownload0) download = uiDownload0;
  try {
    clearTimeout(lossTimer); lossState.src = 'design'; lossState.effKey = '';
    await runEff();
    const e = lossState.eff, want = 3 * EFF_LOADS.length;
    const n = e ? e.series.reduce((a, x) => a + x.pts.filter(p => isFinite(p.eta) && p.eta > 0 && p.eta < 1).length, 0) : 0;
    const pass = !!e && !e.partial && n === want;
    r.allPass = r.allPass && pass;
    r.lines.push(`${pass ? 'PASS' : 'FAIL'} efficiency vs load: ${n}/${want} points`);
  } catch (err) { r.allPass = false; r.lines.push('FAIL efficiency vs load: threw ' + err.message); }
  try {
    // hover at 50 % load picks that point; leaving clears it
    const cv = $('#effChart'), rc = cv.getBoundingClientRect(), pw = cv.width - 146 * dpr, j = EFF_LOADS.indexOf(50);
    const x = rc.left + (50 * dpr + 0.5 * pw) / dpr, y = rc.top + rc.height / 2;
    cv.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
    const h1 = lossState.hover;
    cv.dispatchEvent(new PointerEvent('pointerleave', { clientX: x, clientY: y }));
    add(h1 === j && lossState.hover === -1, `efficiency hover: point ${h1} at 50 % load (want ${j}), ${lossState.hover} after leaving`);
  } catch (err) { add(false, 'efficiency hover: threw ' + err.message); }
  r.lines[0] = r.allPass ? 'UI TEST: ALL PASS' : 'UI TEST: FAILURES';
  window.__uitest = r;
  console.log(r.lines.join('\n'));
  $('#selftest').textContent = r.lines.join('\n');
}
