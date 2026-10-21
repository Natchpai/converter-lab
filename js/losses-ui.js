'use strict';

/* ================= losses page ================= */
const lossState = { src: 'design', corner: 1, load: 100, eff: null, effKey: '', effRun: 0, hover: -1 };
const EFF_LOADS = [5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const VIN_NAMES = ['V<sub>in</sub> min', 'V<sub>in</sub> nom', 'V<sub>in</sub> max'];

// The operating point the breakdown is about: a design corner at a load, or the Converter page state.
function lossPoint() {
  const topo = state.topo, sync = state.sync, comp = design.comp;
  if (lossState.src === 'sim') {
    const p = effParams(), res = computeRes(p, 'steady');   // RES may be stale or from the Control page
    return { res, lb: lossBreakdown(res, lossParams(comp, sync)),
      label: `Converter page: V<sub>in</sub> = ${fmtSI(p.Vg, 'V')}, D = ${p.D.toFixed(3)}, R = ${fmtSI(p.R, 'Ω')}, ${res.met.mode}.` +
        (state.nonideal ? '' : ' The Ideal model has no conduction loss; switch to Non-ideal for real numbers.') };
  }
  const s = design.specs[topo], z = designSizing(topo, sync, s, comp, design.sel[topo]);
  if (z.errs.length || !isFinite(z.L) || !isFinite(z.C)) return { err: 'Fix the problems on the Design page first.' };
  const Vin = [s.VinMin, s.VinNom, s.VinMax][lossState.corner], Io = s.Io * lossState.load / 100;
  const p = cornerParams(topo, sync, s, comp, z.L, z.C, Vin, Io), Dlim = Math.min(s.Dmax, PDEF.D.max);
  const sol = solveDuty(p, s.Vo, Dlim, clamp(opPoint(topo, Vin, s.Vo, Io, comp, sync).D, 0.02, Dlim));
  if (!sol.ok) return { err: `Vo cannot be reached at this point: ${sol.why}.` };
  return { res: sol.r, lb: lossBreakdown(sol.r, lossParams(comp, sync)),
    label: `Design ${TOPO_LABEL[topo]}: V<sub>in</sub> = ${fmtSI(Vin, 'V')}, I<sub>o</sub> = ${fmtSI(Io, 'A')} (${+lossState.load.toPrecision(3)} % of max), ` +
      `D = ${sol.D.toFixed(4)}, ${sol.r.met.mode}, L = ${fmtSI(z.L, 'H')}, C = ${fmtSI(z.C, 'F')}.` };
}

function renderLosses() {
  const t0 = performance.now(), o = lossPoint();
  $('#lCornerWrap').style.display = $('#lLoadWrap').style.display = lossState.src === 'design' ? '' : 'none';
  $('#lWarn').textContent = o.err || '';
  if (o.err) { ['#lSum', '#lBars', '#lTbl', '#lCoreTbl', '#lTips'].forEach(id => { $(id).innerHTML = ''; }); return; }
  const lb = o.lb, items = [...lb.items].sort((a, b) => b.P - a.P), max = Math.max(items[0].P, 1e-15);
  $('#lSum').innerHTML = [['P<sub>out</sub>', fmtSI(lb.Pout, 'W')], ['Total loss', fmtSI(lb.total, 'W')],
    ['P<sub>in</sub>', fmtSI(lb.Pout + lb.total, 'W')], ['Efficiency', (100 * lb.eta).toFixed(2) + ' %']]
    .map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('') + `<p class="hint" style="flex-basis:100%;margin:0">${o.label}</p>`;
  $('#lBars').innerHTML = items.map(x => `<div class="lbar" role="listitem" title="${x.name}: ${fmtSI(x.P, 'W')}">` +
    `<span>${x.name}</span><div class="ltrack"><div class="lfill" style="width:${(100 * x.P / max).toFixed(2)}%"></div></div>` +
    `<span class="lval">${fmtSI(x.P, 'W')} · ${(100 * x.P / lb.total).toFixed(1)} %</span></div>`).join('');
  $('#lTbl').innerHTML = `<tr><th class="l">Loss</th><th class="l">Formula</th><th>Value</th><th>Share</th></tr>` +
    lb.items.map(x => `<tr><td class="l">${x.name}</td><td class="l">${x.f}</td><td>${fmtSI(x.P, 'W')}</td><td>${(100 * x.P / lb.total).toFixed(1)} %</td></tr>`).join('') +
    `<tr><td class="l"><b>Total</b></td><td class="l"></td><td><b>${fmtSI(lb.total, 'W')}</b></td><td>100 %</td></tr>`;
  const c = lb.core;
  if (c) {
    const use = c.Bpk / c.Bsat, d = design.specs[state.topo].derate / 100;
    const cls = use <= d ? 'ok' : use <= 1 ? 'warn' : 'bad';
    $('#lCoreTbl').innerHTML = `<tr><th class="l">Quantity</th><th>Value</th><th class="l">Note</th></tr>` + [
      ['Turns N = ⌈√(L/A<sub>L</sub>)⌉', String(c.N), `A<sub>L</sub>·N² = ${fmtSI(c.Lact, 'H')} (designed L ${fmtSI(o.res.p.L, 'H')})`],
      ['Flux swing ΔB (p-p)', fmtSI(c.dB, 'T'), 'sets the core loss'],
      ['Peak flux B<sub>pk</sub> = L·i<sub>L,pk</sub>/(N·A<sub>e</sub>)', fmtSI(c.Bpk, 'T'),
        `${(100 * use).toFixed(0)} % of B<sub>sat</sub> = ${fmtSI(c.Bsat, 'T')} ${chip(cls, { ok: 'OK', warn: 'above derating', bad: 'saturates' }[cls])}`],
      ['Loss density P<sub>v</sub> (iGSE)', fmtSI(c.Pv, 'W/m³'), ''],
      ['Core loss P<sub>v</sub>·V<sub>e</sub>', fmtSI(c.P, 'W'), ''],
    ].map(r => `<tr><td class="l">${r[0]}</td><td>${r[1]}</td><td class="l">${r[2]}</td></tr>`).join('');
  } else $('#lCoreTbl').innerHTML = '<tr><td class="l">Enter A<sub>L</sub>, A<sub>e</sub>, V<sub>e</sub> and the Steinmetz data on the Design page.</td></tr>';
  $('#lTips').innerHTML = lossTips(o).map(t => `<li>${t}</li>`).join('');
  $('#lStatus').textContent = `computed in ${(performance.now() - t0).toFixed(0)} ms`;
}

function lossTips(o) {
  const t = [], sync = state.sync, lb = o.lb;
  t.push('Conduction losses grow with I², so they lead at full load. Switching, node capacitance, gate and core losses barely change with load, so they lead at light load. That is why efficiency falls at light load.');
  t.push('S switching: voltage and current overlap for about t<sub>r</sub> at turn-on and t<sub>f</sub> at turn-off. Faster edges cut this loss but raise ringing and EMI.');
  t.push('Node capacitance: each hard turn-on dumps ½·C·ΔV² into the switch. In DCM the node rings, so the loss depends on where the ringing sits at turn-on (valley switching uses this).');
  t.push(sync ? 'Dead time: the Q2 body diode conducts for about 2·t<sub>d</sub> per cycle, and its charge Q<sub>rr</sub> is lost when S turns on. Shorter dead time helps until shoot-through becomes a risk.'
    : 'Diode conduction V<sub>f</sub>·I<sub>D</sub> is often the largest loss at low output voltage. A sync FET replaces it with R<sub>on</sub>·I². Try Sync at the top.');
  t.push('Core loss uses iGSE, which handles the triangular flux of a converter. It depends on the flux swing ΔB (the ripple), not on the DC current. Saturation depends on B<sub>pk</sub>, which includes the DC current.');
  t.push('Gate drive loss Q<sub>g</sub>·V<sub>drv</sub>·f<sub>s</sub> comes from the driver supply, not the power path, but it counts against system efficiency.');
  if (sync) t.push('At light load iL goes negative before S turns on. Then the S body diode conducts first and S turns on at almost zero voltage (ZVS): the Q<sub>rr</sub> and node losses disappear. ' +
    'This makes a step in the efficiency curve where iL<sub>min</sub> crosses zero. Q<sub>rr</sub> is taken as constant here; in real parts it falls at low current, so the step is softer.');
  if (o.res.met.mode === 'DCM') t.push('This point is in DCM: the peak current is high compared with I<sub>o</sub>, so RMS losses are higher than CCM would give at the same load.');
  return t;
}

const effKey = () => JSON.stringify([state.topo, state.sync, design.specs[state.topo], design.comp, design.sel[state.topo]]);
async function runEff() {
  const key = effKey();
  if (lossState.eff && lossState.effKey === key && !lossState.eff.partial) { drawEff(); return; }
  const run = ++lossState.effRun;
  const topo = state.topo, sync = state.sync, s = { ...design.specs[topo] }, comp = { ...design.comp };
  const z = designSizing(topo, sync, s, comp, design.sel[topo]);
  if (z.errs.length || !isFinite(z.L) || !isFinite(z.C)) { lossState.eff = null; $('#eStatus').textContent = 'fix the design first'; drawEff(); renderEffTable(); return; }
  const Dlim = Math.min(s.Dmax, PDEF.D.max), vins = [s.VinMin, s.VinNom, s.VinMax];
  const series = vins.map(Vin => ({ Vin, pts: [] })), total = vins.length * EFF_LOADS.length, t0 = performance.now();
  lossState.eff = { series, Io: s.Io, partial: true };
  let done = 0;
  for (let si = 0; si < vins.length; si++) for (const pct of EFF_LOADS) {
    await new Promise(r => setTimeout(r, 0));
    if (run !== lossState.effRun) return;          // a newer request replaced this run
    const Vin = vins[si], Io = s.Io * pct / 100;
    const sol = solveDuty(cornerParams(topo, sync, s, comp, z.L, z.C, Vin, Io), s.Vo, Dlim, clamp(opPoint(topo, Vin, s.Vo, Io, comp, sync).D, 0.02, Dlim));
    const lb = sol.ok ? lossBreakdown(sol.r, lossParams(comp, sync)) : null;
    series[si].pts.push({ pct, Io, eta: lb ? lb.eta : NaN, Ploss: lb ? lb.total : NaN, mode: sol.ok ? sol.r.met.mode : '–' });
    $('#eStatus').textContent = `computing ${++done}/${total}…`;
    if (done % 4 === 0) drawEff();
  }
  lossState.eff = { series, Io: s.Io };
  lossState.effKey = key;
  $('#eStatus').textContent = `${total} points in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  drawEff(); renderEffTable();
}

function renderEffTable() {
  const e = lossState.eff;
  if (!e) { $('#effTbl').innerHTML = ''; $('#effLegend').innerHTML = ''; return; }
  $('#effLegend').innerHTML = e.series.map((s, i) => `<span><i class="sw" style="background:var(--s${i + 1})"></i>${VIN_NAMES[i]} = ${fmtSI(s.Vin, 'V')}</span>`).join('');
  $('#effTbl').innerHTML = `<tr><th>Load</th><th>I<sub>o</sub></th>${e.series.map((s, i) => `<th>η at ${VIN_NAMES[i]}</th>`).join('')}<th class="l">Mode (nom)</th></tr>` +
    EFF_LOADS.map((pct, j) => `<tr><td>${pct} %</td><td>${fmtSI(e.Io * pct / 100, 'A')}</td>` +
      e.series.map(s => `<td>${s.pts[j] && isFinite(s.pts[j].eta) ? (100 * s.pts[j].eta).toFixed(2) + ' %' : '–'}</td>`).join('') +
      `<td class="l">${e.series[1].pts[j] ? e.series[1].pts[j].mode : ''}</td></tr>`).join('');
}

function drawEff() {
  const cv = $('#effChart'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  if (W < 20) return;
  const cs = getComputedStyle(document.documentElement), tok = n => cs.getPropertyValue(n).trim();
  const ink = tok('--ink'), muted = tok('--muted'), line = tok('--line'), surf = tok('--panel');
  const col = [tok('--s1'), tok('--s2'), tok('--s3')];
  ctx.clearRect(0, 0, W, H);
  const e = lossState.eff, font = px => `${px * dpr}px system-ui, sans-serif`;
  if (!e) { ctx.fillStyle = muted; ctx.font = font(14); ctx.fillText('No data yet', 20 * dpr, 30 * dpr); return; }
  const ml = 50 * dpr, mr = 96 * dpr, mt = 12 * dpr, mb = 40 * dpr, pw = W - ml - mr, ph = H - mt - mb;
  const all = e.series.flatMap(s => s.pts.map(p => p.eta * 100)).filter(isFinite);
  let lo = all.length ? Math.min(...all) : 80, hi = all.length ? Math.max(...all) : 100;
  const step = nice125ceil(Math.max(hi - lo, 1) / 5);
  lo = Math.max(0, Math.floor((lo - step * 0.3) / step) * step); hi = Math.min(100, Math.ceil((hi + step * 0.3) / step) * step);
  if (hi <= lo) hi = lo + step;
  const X = io => ml + io / e.Io * pw, Y = v => mt + (1 - (v - lo) / (hi - lo)) * ph;
  // recessive grid and axis labels
  ctx.lineWidth = 1; ctx.strokeStyle = line; ctx.fillStyle = muted; ctx.font = font(12);
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = lo; v <= hi + 1e-9; v += step) { const y = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke(); ctx.fillText(`${+v.toFixed(2)} %`, ml - 6 * dpr, y); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let q = 0; q <= 4; q++) ctx.fillText(fmtSI(e.Io * q / 4, 'A'), X(e.Io * q / 4), mt + ph + 6 * dpr);
  ctx.fillText('Load current I<sub>o</sub>'.replace(/<\/?sub>/g, ''), ml + pw / 2, mt + ph + 22 * dpr);
  // series: 2px lines, markers with a 2px surface ring
  const ends = [];
  e.series.forEach((s, i) => {
    const pts = s.pts.filter(p => isFinite(p.eta)); if (!pts.length) return;
    ctx.strokeStyle = col[i]; ctx.lineWidth = 2 * dpr; ctx.lineJoin = 'round'; ctx.beginPath();
    pts.forEach((p, j) => { const x = X(p.Io), y = Y(p.eta * 100); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    for (const p of pts) { ctx.beginPath(); ctx.arc(X(p.Io), Y(p.eta * 100), 4 * dpr, 0, 2 * Math.PI); ctx.fillStyle = col[i]; ctx.fill(); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = surf; ctx.stroke(); }
    const last = pts[pts.length - 1]; ends.push({ i, y: Y(last.eta * 100), x: X(last.Io), txt: `${['min', 'nom', 'max'][i]} ${fmtSI(s.Vin, 'V')}` });
  });
  // direct labels at the line ends, nudged apart; text in ink, swatch carries the color
  ends.sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 16 * dpr) ends[k].y = ends[k - 1].y + 16 * dpr;
  ctx.font = font(12); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const l of ends) {
    ctx.fillStyle = col[l.i]; ctx.fillRect(l.x + 8 * dpr, l.y - 1.5 * dpr, 10 * dpr, 3 * dpr);
    ctx.fillStyle = ink; ctx.fillText(l.txt, l.x + 22 * dpr, l.y);
  }
  // hover: crosshair at the nearest load point and a tooltip
  const j = lossState.hover;
  if (j >= 0 && e.series[0].pts[j]) {
    const p0 = e.series[0].pts[j], x = X(p0.Io);
    ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, mt); ctx.lineTo(Math.round(x) + 0.5, mt + ph); ctx.stroke(); ctx.setLineDash([]);
    const rows = [`Io ${fmtSI(p0.Io, 'A')} (${p0.pct} %)`, ...e.series.map((s, i) => s.pts[j] && isFinite(s.pts[j].eta)
      ? `${['Vin min', 'Vin nom', 'Vin max'][i]}: ${(100 * s.pts[j].eta).toFixed(2)} %, loss ${fmtSI(s.pts[j].Ploss, 'W')}` : '')];
    ctx.font = font(12);
    const bw = Math.max(...rows.map(r => ctx.measureText(r).width)) + 30 * dpr, bh = rows.length * 18 * dpr + 10 * dpr;
    let bx = x + 12 * dpr; if (bx + bw > W) bx = x - 12 * dpr - bw;
    const by = mt + 6 * dpr;
    ctx.fillStyle = surf; ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    rows.forEach((r, k) => {
      const ry = by + 14 * dpr + k * 18 * dpr;
      if (k > 0) { ctx.fillStyle = col[k - 1]; ctx.fillRect(bx + 8 * dpr, ry - 1.5 * dpr, 12 * dpr, 3 * dpr); }
      ctx.fillStyle = k ? ink : muted; ctx.fillText(r, bx + (k ? 26 : 8) * dpr, ry);
    });
    for (let i = 0; i < e.series.length; i++) {
      const p = e.series[i].pts[j]; if (!p || !isFinite(p.eta)) continue;
      ctx.beginPath(); ctx.arc(x, Y(p.eta * 100), 6 * dpr, 0, 2 * Math.PI); ctx.fillStyle = col[i]; ctx.fill(); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = surf; ctx.stroke();
    }
  }
}
const effCv = $('#effChart');
effCv.addEventListener('pointermove', ev => {
  const e = lossState.eff; if (!e) return;
  const r = effCv.getBoundingClientRect(), x = (ev.clientX - r.left) * dpr, pw = effCv.width - 146 * dpr;
  const io = (x - 50 * dpr) / pw * e.Io;
  let best = -1, bd = Infinity;
  EFF_LOADS.forEach((pct, j) => { const d = Math.abs(e.Io * pct / 100 - io); if (d < bd) { bd = d; best = j; } });
  if (best !== lossState.hover) { lossState.hover = best; drawEff(); }
});
effCv.addEventListener('pointerleave', () => { lossState.hover = -1; drawEff(); });
new ResizeObserver(() => { if (state.page === 'losses') { sizeCanvas(effCv, 320); drawEff(); } }).observe(effCv.parentElement);

$('#lSrc').addEventListener('change', e => { lossState.src = e.target.value; renderLosses(); });
$('#lCorner').addEventListener('change', e => { lossState.corner = +e.target.value; renderLosses(); });
$('#lLoad').addEventListener('change', e => {
  const v = parseFloat(e.target.value);
  if (v > 0 && v <= 200) lossState.load = v;
  e.target.value = `${+lossState.load.toPrecision(3)} %`;
  renderLosses();
});
let lossTimer = 0;
function requestLosses() {
  if (state.page !== 'losses') return;
  clearTimeout(lossTimer);
  lossTimer = setTimeout(() => { renderLosses(); runEff(); }, 150);
}
