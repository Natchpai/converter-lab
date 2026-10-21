'use strict';

/* ================= UI test (index.html?uitest) ================= */
// Clicks through the Control page like a user and checks that every step leaves a sane page:
// no uncaught error, a slider row for every compensator parameter, no NaN in the readouts and
// finite Bode curves. Each step computes and renders at once, so no timers are needed.
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
  step('ACMC Bode current loop', () => click('#bodeLegend [data-view="inner"]'));
  for (const v of ['boost', 'bb', 'buck']) step(`ACMC topology ${v}`, () => click(`[data-group="topo"] [data-v="${v}"]`));
  step('ACMC DCM example', () => click('[data-preset="dcm"]'));
  step('ACMC Bode voltage loop', () => click('#bodeLegend [data-view="outer"]'));
  step('ACMC reset', () => click('[data-preset="reset"]'));
  step('mode PCMC from ACMC', () => click('#ctlMode [data-m="pcmc"]'));
  step('mode ACMC again', () => click('#ctlMode [data-m="acmc"]'));
  step('mode VMC', () => click('#ctlMode [data-m="vmc"]'));
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
  window.removeEventListener('error', onErr);
  out.unshift(allPass ? 'UI TEST: ALL PASS' : 'UI TEST: FAILURES');
  return { allPass, lines: out };
}
function uiTest() {
  const r = runUiTests();
  window.__uitest = r;
  console.log(r.lines.join('\n'));
  $('#selftest').textContent = r.lines.join('\n');
}
