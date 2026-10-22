'use strict';

/* ================= design page ================= */
const design = {
  specs: JSON.parse(JSON.stringify(SPEC_DEF)),
  comp: { ...COMP_DEF },
  sel: { buck: { L: null, C: null }, boost: { L: null, C: null }, bb: { L: null, C: null } },
  out: null,
};

/* ---------- design UI ---------- */
const fmtSpec = (f, v) => f.unit === '%' ? `${+v.toPrecision(4)} %` : f.unit === '' ? (+v).toFixed(3) : fmtSI(v, f.unit, 4);

function buildSpecUI() {
  const s = design.specs[state.topo];
  $('#specList').innerHTML = `<p class="hint">${TOPO_LABEL[state.topo]}, ${state.sync ? 'sync FET' : 'diode'} rectifier (change at the top).</p>` +
    SPEC_FIELDS.map(f => `<div class="frow"><label for="sp-${f.k}">${f.label}</label><input class="num" id="sp-${f.k}" type="text" inputmode="decimal" value="${fmtSpec(f, s[f.k])}"></div>`).join('');
  $('#specNote').innerHTML = (state.topo === 'bb' ? 'The inverting buck-boost gives V<sub>o</sub> = −|V<sub>o</sub>|. ' : '') +
    'Values accept SI prefixes, for example 200k, 47u, 50m. The design uses the component values, so losses are included.';
  SPEC_FIELDS.forEach(f => $('#sp-' + f.k).addEventListener('change', e => {
    const v = parseSI(e.target.value);
    if (isFinite(v) && v > 0) s[f.k] = v;
    e.target.value = fmtSpec(f, s[f.k]);
    requestDesign();
  }));
}

function buildCompUI() {
  const sync = state.sync;
  let h = '';
  for (const part of PARTS) {
    if ((part.only === 'sync' && !sync) || (part.only === 'async' && sync)) continue;
    const pres = PART_PRESETS[part.id];
    h += `<div class="part"><h4>${part.title}` + (pres ? `<select data-part="${part.id}" aria-label="${part.title} generic class"><option value="">Generic class…</option>` +
      pres.map((x, i) => `<option value="${i}">${x[0]}</option>`).join('') + `</select>` : '') + `</h4>`;
    for (const f of part.fields) {
      if ((f.only === 'sync' && !sync) || (f.only === 'async' && sync)) continue;
      h += `<div class="frow"><label for="cp-${f.k}">${f.label}</label><input class="num" id="cp-${f.k}" type="text" inputmode="decimal"></div>`;
      if (f.sel) h += `<div class="fsub" id="sub-${f.k}"></div>`;
    }
    if (part.id === 'Core') h += `<div class="fsub">P<sub>v</sub> = k·f<sup>α</sup>·B<sup>β</sup> in W/m³ (f in Hz, B peak in T). Type your datasheet fit.</div>`;
    h += '</div>';
  }
  $('#compList').innerHTML = h;
  document.querySelectorAll('#compList select[data-part]').forEach(sel => sel.addEventListener('change', () => {
    if (sel.value === '') return;
    Object.assign(design.comp, PART_PRESETS[sel.dataset.part][+sel.value][1]);
    syncCompUI(); requestDesign();
  }));
  document.querySelectorAll('#compList input.num').forEach(inp => inp.addEventListener('change', () => {
    const k = inp.id.slice(3), v = parseComp(k, inp.value);
    if (k === 'Lsel' || k === 'Csel') {
      design.sel[state.topo][k[0]] = inp.value.trim() === '' || !(v > 0) ? null : v;
    } else if (isFinite(v) && v >= 0) design.comp[k] = v;
    syncCompUI(); requestDesign();
  }));
  syncCompUI();
}

function syncCompUI() {
  const sel = design.sel[state.topo], z = design.out && design.out.topo === state.topo ? design.out.z : null;
  document.querySelectorAll('#compList input.num').forEach(inp => {
    const k = inp.id.slice(3);
    if (k === 'Lsel' || k === 'Csel') {
      const v = sel[k[0]];
      const u = FIELD[k].unit;
      inp.value = v > 0 ? fmtSI(v, u, 3) : '';
      const sug = z ? z[k[0] + 'sug'] : NaN;
      inp.placeholder = isFinite(sug) ? `auto ${fmtSI(sug, u, 3)}` : 'auto';
      inp.classList.toggle('auto', !(v > 0));
      const sub = document.getElementById('sub-' + k);
      if (sub) sub.textContent = z && isFinite(z[k[0] + 'req'])
        ? `needs ≥ ${fmtSI(z[k[0] + 'req'], u)} · E12 ${fmtSI(sug, u)}${v > 0 ? ' · clear to use E12' : ''}` : '';
    } else inp.value = fmtComp(k, design.comp[k]);
  });
}

const chip = (cls, txt) => `<span class="chip ${cls}">${txt}</span>`;
function renderDesign() {
  const o = design.out; if (!o) return;
  const z = o.z, s = o.s, u = o.topo;
  $('#dErr').innerHTML = o.errs.map(e => `<div>⚠ ${e}</div>`).join('');
  $('#dStatus').textContent = `computed in ${o.ms.toFixed(0)} ms`;
  syncCompUI();
  const cs = o.corners, okc = cs.filter(c => c.st);
  // sizing
  const srows = [];
  if (isFinite(z.Lreq)) {
    srows.push(['L needed', fmtSI(z.Lreq, 'H'), `worst at V<sub>in</sub> = ${fmtSI(z.LreqVin, 'V')}`]);
    srows.push(['L used', fmtSI(z.L, 'H'), design.sel[u].L > 0 ? 'your value' : 'next E12 value']);
    srows.push(['C needed', fmtSI(z.Creq, 'F'), `worst at V<sub>in</sub> = ${fmtSI(z.CreqVin, 'V')}`]);
    srows.push(['C used', fmtSI(z.C, 'F'), design.sel[u].C > 0 ? 'your value' : 'next E12 value']);
    srows.push(['ESR limit for ΔV<sub>o</sub>', fmtSI(z.esrMax, 'Ω'),
      `yours ${fmtSI(o.comp.rc, 'Ω')} ${chip(o.comp.rc < z.esrMax * 0.5 ? 'ok' : o.comp.rc < z.esrMax ? 'warn' : 'bad', o.comp.rc < z.esrMax ? 'OK' : 'too high')}`]);
    srows.push(['D range (with drops)', `${z.Dmin.toFixed(3)} to ${z.Dhi.toFixed(3)}`, `D max allowed ${s.Dmax}`]);
    srows.push([o.sync ? 'Negative i<sub>L</sub> (FCCM) below' : 'DCM below I<sub>o</sub> =', fmtSI(z.IoCrit, 'A'),
      `${(100 * z.IoCrit / s.Io).toFixed(0)} % of I<sub>o,max</sub>, worst at V<sub>in</sub> = ${fmtSI(z.IoCritVin, 'V')}`]);
    if (okc.length) srows.push(['Input capacitor RMS current', fmtSI(Math.max(...okc.map(c => c.st.CinRms)), 'A'), 'size C<sub>in</sub> for this (not modeled)']);
  }
  $('#dSizeTbl').innerHTML = `<tr><th class="l">Quantity</th><th>Value</th><th class="l">Note</th></tr>` +
    srows.map(r => `<tr><td class="l">${r[0]}</td><td>${r[1]}</td><td class="l">${r[2]}</td></tr>`).join('');
  // corners
  if (cs.length) {
    const v = (f) => cs.map(c => `<td>${c.st ? f(c) : '–'}</td>`).join('');
    const ripOk = c => { const pct = 100 * c.st.dIL / Math.abs(c.st.IL); return `${pct.toFixed(1)} % ${chip(pct <= s.rip * 1.05 ? 'ok' : 'warn', pct <= s.rip * 1.05 ? '≤ target' : 'above')}`; };
    const dvOk = c => `${fmtSI(c.st.dVo, 'V')} ${chip(c.st.dVo <= s.dVo * 1.05 ? 'ok' : 'warn', c.st.dVo <= s.dVo * 1.05 ? '≤ target' : 'above')}`;
    const rows = [
      ['D (solved)', c => c.D.toFixed(4)],
      ['Mode', c => c.st.mode],
      ['V<sub>o</sub>', c => fmtSI(c.st.Vo, 'V', 4)],
      ['I<sub>L</sub> avg', c => fmtSI(c.st.IL, 'A')],
      ['Δi<sub>L</sub> p-p', c => fmtSI(c.st.dIL, 'A')],
      ['Δi<sub>L</sub> / I<sub>L</sub>', ripOk],
      ['i<sub>L</sub> peak', c => fmtSI(c.st.ILpk, 'A')],
      ['ΔV<sub>o</sub> p-p', dvOk],
      ['I<sub>in</sub> avg', c => fmtSI(c.st.Iin, 'A')],
      ['Total loss', c => fmtSI(c.st.loss.total, 'W')],
      ['η <small>(all losses)</small>', c => (100 * c.st.loss.eta).toFixed(2) + ' %'],
    ];
    $('#dCornerTbl').innerHTML = `<tr><th class="l"></th>${cs.map((c, i) => `<th>V<sub>in</sub> ${['min', 'nom', 'max'][i]} = ${fmtSI(c.Vin, 'V')}</th>`).join('')}</tr>` +
      rows.map(([n, f]) => `<tr><td class="l">${n}</td>${v(f)}</tr>`).join('');
  } else $('#dCornerTbl').innerHTML = '';
  // ratings
  const rr = ratingRows(o);
  $('#dRateTbl').innerHTML = rr.length ? `<tr><th class="l">Part</th><th class="l">Stress (worst corner)</th><th>Value</th><th>Rating</th><th>Use</th><th class="l">Check</th></tr>` +
    rr.map(r => `<tr><td class="l">${r.part}</td><td class="l">${r.what}</td><td>${fmtSI(r.stress, r.u)}</td><td>${r.rating > 0 ? fmtSI(r.rating, r.u) : '–'}</td>` +
      `<td>${isFinite(r.use) ? (100 * r.use).toFixed(0) + ' %' : '–'}</td><td class="l">${chip(r.cls, r.txt)}</td></tr>`).join('') +
    `<tr><td class="l" colspan="6"><small>Limit: ${s.derate} % of rating (green). Amber is above the derating limit, red is above the rating.</small></td></tr>` : '';
  renderDesignEq(o);
  $('#dTips').innerHTML = designTips(o).map(t => `<li>${t}</li>`).join('');
}

function renderDesignEq(o) {
  const z = o.z, s = o.s, sub = (a, b) => `${a}<sub>${b}</sub>`;
  if (!isFinite(z.Lreq)) { $('#dEqTbl').innerHTML = ''; return; }
  const Vo = sub('V', 'o'), Vin = sub('V', 'in'), fs = sub('f', 's'), dIL = 'Δ' + sub('i', 'L'), Io = sub('I', 'o');
  const rows = [];
  const dr = `${z.Dmin.toFixed(3)} to ${z.Dhi.toFixed(3)}`;
  if (o.topo === 'buck') {
    rows.push([`D = ${Vo}/${Vin} <small>(value with drops)</small>`, dr]);
    rows.push([`${dIL} = (${Vin} − ${Vo})·D/(${fs}·L), largest at ${sub('V', 'in,max')}`, '']);
    rows.push([`L ≥ (${sub('V', 'in,max')} − ${Vo})·${sub('D', 'min')}/(${fs}·r·${Io})`, fmtSI(z.Lreq, 'H')]);
    rows.push([`C ≥ ${dIL}/(8·${fs}·(Δ${Vo} − ESR·${dIL}))`, fmtSI(z.Creq, 'F')]);
    rows.push([`ESR ≤ Δ${Vo}/${dIL}`, fmtSI(z.esrMax, 'Ω')]);
    rows.push([`${sub('I', 'o,crit')} = ${dIL}/2 = ${Vo}(1 − D)/(2·L·${fs})`, fmtSI(z.IoCrit, 'A')]);
    rows.push([`${sub('I', 'Cin,rms')} ≈ ${Io}·√(D(1 − D))`, '']);
  } else if (o.topo === 'boost') {
    rows.push([`D = 1 − ${Vin}/${Vo} <small>(value with drops)</small>`, dr]);
    rows.push([`${sub('I', 'L')} = ${Io}/(1 − D)`, '']);
    rows.push([`L ≥ ${Vin}·D/(${fs}·r·${sub('I', 'L')}) = ${Vo}·D(1 − D)²/(${fs}·r·${Io}), peak at D = 1/3`, fmtSI(z.Lreq, 'H')]);
    rows.push([`C ≥ ${Io}·D/(${fs}·(Δ${Vo} − ESR·${sub('I', 'pk')}))`, fmtSI(z.Creq, 'F')]);
    rows.push([`ESR ≤ Δ${Vo}/${sub('I', 'pk')}`, fmtSI(z.esrMax, 'Ω')]);
    rows.push([`${sub('I', 'o,crit')} = ${Vo}·D(1 − D)²/(2·L·${fs})`, fmtSI(z.IoCrit, 'A')]);
    rows.push([`S and D block ${Vo} (+${sub('V', 'f')})`, fmtSI(s.Vo, 'V')]);
  } else {
    rows.push([`D = |${Vo}|/(${Vin} + |${Vo}|) <small>(value with drops)</small>`, dr]);
    rows.push([`${sub('I', 'L')} = ${Io}/(1 − D)`, '']);
    rows.push([`L ≥ ${Vin}·D/(${fs}·r·${sub('I', 'L')}), largest at ${sub('V', 'in,max')}`, fmtSI(z.Lreq, 'H')]);
    rows.push([`C ≥ ${Io}·D/(${fs}·(Δ${Vo} − ESR·${sub('I', 'pk')}))`, fmtSI(z.Creq, 'F')]);
    rows.push([`ESR ≤ Δ${Vo}/${sub('I', 'pk')}`, fmtSI(z.esrMax, 'Ω')]);
    rows.push([`${sub('I', 'o,crit')} = |${Vo}|(1 − D)²/(2·L·${fs})`, fmtSI(z.IoCrit, 'A')]);
    rows.push([`S and D block ${Vin} + |${Vo}|`, fmtSI(s.VinMax + s.Vo, 'V')]);
  }
  rows.push([`Switch RMS: √(D·(${sub('I', 'L')}² + ${dIL}²/12)); diode/Q2 uses (1 − D)`, '']);
  rows.push([`r = Δ${sub('i', 'L')}/${sub('I', 'L')} target`, `${s.rip} %`]);
  $('#dEqTbl').innerHTML = rows.map(([f, v]) => `<tr><td>${f}</td><td>${v}</td></tr>`).join('');
}

function designTips(o) {
  const t = [], z = o.z, s = o.s;
  if (o.topo === 'buck') {
    t.push('Buck: the ripple current is largest at Vin max, so L is sized there. The output capacitor only sees the triangle ripple, so C stays small.');
    t.push('The input current is pulsed. The input capacitor carries about Io·√(D(1 − D)) RMS, which is highest near D = 0.5.');
  } else if (o.topo === 'boost') {
    t.push('Boost: the L requirement Vo·D(1 − D)²/(fs·r·Io) peaks at D = 1/3. If D = 1/3 is inside the Vin range, that point sets L.');
    t.push('The output capacitor takes the pulsed diode current. C is sized at Vin min, where D is largest. Check its ripple current rating carefully.');
  } else {
    t.push('Inverting buck-boost: S and D both block Vin + |Vo|, so pick voltage ratings above Vin max + |Vo| with margin.');
    t.push('Both input and output currents are pulsed. Both capacitors need good ripple current ratings.');
  }
  t.push('L and C round up to the next E12 value, so the real ripple ends below the target. Type your own value in "L used" or "C used" to try a stock part.');
  if (isFinite(z.IoCrit)) t.push(o.sync
    ? `With the sync FET the converter stays in CCM at any load. Below ${fmtSI(z.IoCrit, 'A')} the inductor current goes negative (FCCM) and circulates energy.`
    : `Below Io = ${fmtSI(z.IoCrit, 'A')} the converter enters DCM. Vo then depends on the load, and the control loop gain changes.`);
  t.push('Voltage derating of about 80 % is common. Use more margin for electrolytic capacitors at high temperature and for ringing on the switch node.');
  t.push('Efficiency includes conduction, switching, node capacitance, Qrr, gate drive and core loss. The Losses page shows the breakdown and the efficiency curve.');
  t.push('Use "Apply to simulation" to see the waveforms of any corner on the scope.');
  return t;
}

let designTimer = 0, designDirty = true;
function requestDesign() {
  designDirty = true;
  requestLosses();
  if (state.page !== 'design') return;
  clearTimeout(designTimer);
  $('#dStatus').textContent = 'computing…';
  designTimer = setTimeout(() => {
    design.out = designRun(state.topo, state.sync, design.specs[state.topo], design.comp, design.sel[state.topo]);
    designDirty = false;
    renderDesign();
  }, 120);
}

/* ---------- apply, save, load, print ---------- */
$('#dApply').addEventListener('click', () => {
  const o = design.out, c = o && o.corners[+$('#dCorner').value];
  if (!c || !c.ok) { $('#dErr').innerHTML = '<div>⚠ Fix the problems above before applying.</div>'; return; }
  const p = c.p, notes = [];
  const set = (k, v) => { const d = PDEF[k], cv = clamp(v, d.min, d.max); if (cv !== v) notes.push(`${k} limited to ${fmtParam(d, cv)}`); state.p[k] = cv; };
  set('Vg', p.Vg); set('D', c.D); set('fs', p.fs); set('L', p.L); set('C', p.C); set('R', p.R);
  set('rc', p.rc); set('rL', p.rL); set('ron', p.ron);
  if (o.sync) { set('ron2', p.ron2); set('td', p.td); } else set('Vf', p.Vf);
  set('Vbd', p.Vbd); set('Cn', p.Cn);
  state.topo = o.topo; state.sync = o.sync; state.nonideal = true; state.view = 'steady';
  setPage('converter', true);
  state.tdiv = 'auto'; $('#tdivSel').value = 'auto'; state.hpos = 0.1; $('#hposRange').value = 0.1;
  state.applyNote = `Applied design corner Vin = ${fmtSI(p.Vg, 'V')}, Io = ${fmtSI(o.s.Io, 'A')}.` + (notes.length ? ' Limited by slider range: ' + notes.join(', ') + '.' : '');
  buildSchem(); syncAllParams(); updateSegs(); updateNonIdealUI();
  requestCompute();
});

function designJSON() {
  return {
    app: 'dcdc-converter-lab', version: 1, saved: new Date().toISOString(),
    topo: state.topo, sync: state.sync, specs: design.specs, comp: design.comp, sel: design.sel,
    sim: { nonideal: state.nonideal, p: state.p },
  };
}
function applyDesignJSON(j) {
  if (!j || j.app !== 'dcdc-converter-lab') throw new Error('this is not a DC-DC Converter Lab design file');
  const num = v => typeof v === 'number' && isFinite(v);
  if (['buck', 'boost', 'bb'].includes(j.topo)) state.topo = j.topo;
  if (typeof j.sync === 'boolean') state.sync = j.sync;
  for (const t of ['buck', 'boost', 'bb']) {
    const src = j.specs && j.specs[t];
    if (src) for (const k in SPEC_DEF[t]) if (num(src[k]) && src[k] > 0) design.specs[t][k] = src[k];
    const ss = j.sel && j.sel[t];
    if (ss) for (const k of ['L', 'C']) design.sel[t][k] = num(ss[k]) && ss[k] > 0 ? ss[k] : null;
  }
  if (j.comp) for (const k in COMP_DEF) if (num(j.comp[k]) && j.comp[k] >= 0) design.comp[k] = j.comp[k];
  if (j.sim) {
    if (typeof j.sim.nonideal === 'boolean') state.nonideal = j.sim.nonideal;
    if (j.sim.p) for (const k in PDEF) if (num(j.sim.p[k])) state.p[k] = clamp(j.sim.p[k], PDEF[k].min, PDEF[k].max);
  }
  buildSchem(); syncAllParams(); updateSegs(); updateNonIdealUI(); buildSpecUI(); buildCompUI();
  requestCompute(); requestDesign();
}
$('#dSave').addEventListener('click', () => download(new Blob([JSON.stringify(designJSON(), null, 2)], { type: 'application/json' }), `dcdc-design-${state.topo}.json`));
$('#dLoadBtn').addEventListener('click', () => $('#dLoad').click());
$('#dLoad').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { applyDesignJSON(JSON.parse(await f.text())); }
  catch (err) { $('#dErr').innerHTML = `<div>⚠ Could not load the file: ${String(err.message).replace(/</g, '&lt;')}</div>`; }
  e.target.value = '';
});

$('#dPrint').addEventListener('click', () => {
  const o = design.out; if (!o) return;
  const s = o.s, c = o.comp;
  const tr = rows => rows.map(r => `<tr>${r.map(x => `<td>${x}</td>`).join('')}</tr>`).join('');
  const comp = [
    ['S', `Ron ${fmtSI(c.ron, 'Ω')}, ${fmtSI(c.swV, 'V')}, ${fmtSI(c.swI, 'A')} RMS`],
    o.sync ? ['Q2', `Ron ${fmtSI(c.ron2, 'Ω')}, ${fmtSI(c.q2V, 'V')}, ${fmtSI(c.q2I, 'A')} RMS`] : ['D', `Vf ${fmtSI(c.Vf, 'V')}, VR ${fmtSI(c.dV, 'V')}, IF(AV) ${fmtSI(c.dI, 'A')}`],
    ['L', `${fmtSI(o.z.L, 'H')}, DCR ${fmtSI(c.rL, 'Ω')}, Isat ${fmtSI(c.Isat, 'A')}, Irms ${fmtSI(c.IrmsL, 'A')}`],
    ['C', `${fmtSI(o.z.C, 'F')}, ESR ${fmtSI(c.rc, 'Ω')}, ${fmtSI(c.cV, 'V')}, ripple ${fmtSI(c.cI, 'A')} RMS`],
    ['S switching', `tr ${fmtSI(c.tr, 's')}, tf ${fmtSI(c.tf, 's')}, Coss ${fmtSI(c.CossS, 'F')}, Qg ${fmtSI(c.QgS, 'C')}`],
    o.sync ? ['Q2 switching', `Coss ${fmtSI(c.CossQ2, 'F')}, Qg ${fmtSI(c.QgQ2, 'C')}, body diode Qrr ${fmtSI(c.QrrQ2, 'C')}, dead time ${fmtSI(c.td, 's')}`]
           : ['D switching', `Qrr ${fmtSI(c.QrrD, 'C')}, Cj ${fmtSI(c.CjD, 'F')}`],
    ['Core', `AL ${fmtComp('AL', c.AL)}, Ae ${fmtComp('Ae', c.Ae)}, Ve ${fmtComp('Ve', c.Ve)}, Bsat ${fmtSI(c.Bsat, 'T')}, k ${c.kc}, α ${c.ac}, β ${c.bc}`],
  ];
  $('#printArea').innerHTML =
    `<h1>DC-DC converter design summary</h1><p>${TOPO_LABEL[o.topo]}, ${o.sync ? 'synchronous' : 'diode'} rectifier. ${new Date().toLocaleString()}. Made with DC-DC Converter Lab; efficiency includes conduction, switching, Qrr, gate drive and core loss.</p>` +
    `<h2>Specification</h2><table>${tr(SPEC_FIELDS.map(f => [f.label, fmtSpec(f, s[f.k])]))}</table>` +
    `<h2>Components</h2><table>${tr(comp)}</table>` +
    (o.errs.length ? `<h2>Problems</h2><ul>${o.errs.map(e => `<li>${e}</li>`).join('')}</ul>` : '') +
    `<h2>Sizing</h2><table>${$('#dSizeTbl').innerHTML}</table>` +
    `<h2 class="newPage">Operating points</h2><table>${$('#dCornerTbl').innerHTML}</table>` +
    `<h2>Stress vs rating</h2><table>${$('#dRateTbl').innerHTML}</table>` +
    `<h2>Design equations</h2><table>${$('#dEqTbl').innerHTML}</table>`;
  // a header row in <thead> is repeated on every printed page the table runs onto
  for (const t of $('#printArea').querySelectorAll('table')) {
    const r = t.rows[0];
    if (r && r.querySelector('th')) t.createTHead().appendChild(r);
  }
  window.print();
});
