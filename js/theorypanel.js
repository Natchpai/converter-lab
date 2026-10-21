'use strict';

/* ================= theory panel ================= */
function eqRows(p, th) {
  const D = p.D, dcm = th.dcm, sync = p.sync, rows = [];
  const sub = (a, b) => `${a}<sub>${b}</sub>`;
  const Vo = sub('V', 'o'), Vin = sub('V', 'in'), dIL = 'Δ' + sub('I', 'L'), Ts = sub('T', 's');
  if (p.topo === 'buck') {
    rows.push(['CCM', `M = ${Vo}/${Vin} = D`, f3(th.Mccm), !dcm]);
    rows.push(['DCM', `M = 2 / (1 + √(1 + 4K/D²))`, f3(th.Mdcm), dcm]);
    rows.push(['CCM', `${sub('I', 'L')} = ${sub('I', 'o')} = ${Vo}/R`, fmtSI(th.Mccm * p.Vg / p.R, 'A'), !dcm]);
    rows.push(['CCM', `${dIL} = (${Vin} − ${Vo})·D·${Ts}/L`, fmtSI(th.dILccm, 'A'), !dcm]);
    rows.push(['CCM', `Δ${Vo} = ${dIL}/(8·${sub('f', 's')}·C)`, fmtSI(th.dVoccm, 'V'), !dcm]);
    rows.push(['DCM', `${sub('D', '2')} = D·(1 − M)/M`, f3(th.D2dcm), dcm]);
  } else if (p.topo === 'boost') {
    rows.push(['CCM', `M = ${Vo}/${Vin} = 1/(1 − D)`, f3(th.Mccm), !dcm]);
    rows.push(['DCM', `M = (1 + √(1 + 4D²/K)) / 2`, f3(th.Mdcm), dcm]);
    rows.push(['CCM', `${sub('I', 'L')} = ${sub('I', 'o')}/(1 − D)`, fmtSI(th.Mccm * p.Vg / p.R / (1 - D), 'A'), !dcm]);
    rows.push(['CCM', `${dIL} = ${Vin}·D·${Ts}/L`, fmtSI(th.dILccm, 'A'), !dcm]);
    rows.push(['CCM', `Δ${Vo} = ${sub('I', 'o')}·D·${Ts}/C`, fmtSI(th.dVoccm, 'V'), !dcm]);
    rows.push(['DCM', `${sub('D', '2')} = D/(M − 1)`, f3(th.D2dcm), dcm]);
  } else {
    rows.push(['CCM', `M = ${Vo}/${Vin} = −D/(1 − D)`, f3(-th.Mccm), !dcm]);
    rows.push(['DCM', `M = −D/√K`, f3(-th.Mdcm), dcm]);
    rows.push(['CCM', `${sub('I', 'L')} = |${sub('I', 'o')}|/(1 − D)`, fmtSI(th.Mccm * p.Vg / p.R / (1 - D), 'A'), !dcm]);
    rows.push(['CCM', `${dIL} = ${Vin}·D·${Ts}/L`, fmtSI(th.dILccm, 'A'), !dcm]);
    rows.push(['CCM', `Δ${Vo} = |${sub('I', 'o')}|·D·${Ts}/C`, fmtSI(th.dVoccm, 'V'), !dcm]);
    rows.push(['DCM', `${sub('D', '2')} = D/|M|`, f3(th.D2dcm), dcm]);
  }
  const kc = p.topo === 'buck' ? '1 − D' : p.topo === 'boost' ? 'D·(1 − D)²' : '(1 − D)²';
  rows.push(['mode', `K = 2L/(R·${Ts})`, f3(th.K), true]);
  rows.push(['mode', `${sub('K', 'crit')} = ${kc}`, f3(th.Kcrit), true]);
  rows.push(['mode', `DCM if K &lt; ${sub('K', 'crit')}${sync ? ' (not with sync FET)' : ''}`, th.K < th.Kcrit ? 'yes' : 'no', true]);
  rows.push(['mode', `${sub('L', 'crit')} = ${sub('K', 'crit')}·R·${Ts}/2`, fmtSI(th.Lcrit, 'H'), true]);
  rows.push(['mode', `${sub('R', 'crit')} = 2L/(${sub('K', 'crit')}·${Ts})`, fmtSI(th.Rcrit, 'Ω'), true]);
  return rows;
}

function tipsFor(res) {
  const p = res.p, th = res.th, mode = res.met.mode, t = [];
  if (mode === 'CCM' || mode === 'FCCM' || mode === 'BCM') {
    t.push('Volt-second balance: put a channel on vL. The area above zero (ON) equals the area below zero (OFF), so the mean of vL is about 0.');
  }
  t.push('Charge balance: the mean of iC is 0 in steady state. Check the Mean column for iC.');
  if (p.topo === 'buck') {
    t.push('iin is pulsed: it equals iL while S is ON and is 0 while S is OFF. The input side needs a good capacitor.');
    t.push('The average of iL equals the load current Io. iC is the AC part of iL, so the output ripple is small.');
  } else if (p.topo === 'boost') {
    t.push('iin = iL is continuous, but iD is pulsed. The output capacitor takes the full pulse, so ΔVo is larger than in a buck.');
    t.push('IL = Io/(1 − D): the inductor current grows fast when D moves toward 1.');
  } else {
    t.push('The output is negative. Both iin and iD are pulsed, and IL = Iin + |Io|.');
    t.push('The switch must block Vin + |Vo|. Check the max of vS.');
  }
  if (mode === 'DCM') {
    t.push(`DCM: iL falls to zero at (D + D2)·Ts = ${fmtSI((p.D + th.D2) * p.T, 's')} and stays there. In the IDLE interval vL = 0 and both switches are off.`);
    t.push('In DCM Vo depends on R, L and fs, not only on D. Change R and watch Vo move.');
  }
  if (mode === 'BCM') t.push('Boundary mode: iL just touches zero at the end of the period. A small change in R or L moves it to CCM or DCM.');
  if (p.sync) {
    t.push('Sync FET Q2 conducts in both directions, so DCM cannot happen. At light load iL goes below zero (forced CCM, FCCM) and Vo stays near the CCM value.');
    if (mode === 'FCCM') t.push('iL is negative in part of the cycle. Look at iin: part of the energy goes back to the source.');
  } else if (mode === 'CCM') {
    t.push(`Try: raise R above Rcrit = ${fmtSI(th.Rcrit, 'Ω')} or lower L below Lcrit = ${fmtSI(th.Lcrit, 'H')} to enter DCM.`);
  }
  if (state.nonideal) {
    t.push(`Losses: η = Pout/Pin = ${(res.met.eta * 100).toFixed(1)} %. ESR makes small steps on vo at each switch edge (step = ESR × change in iC).`);
    if (!p.sync) t.push('The diode drop Vf lowers Vo and costs efficiency. Switch to Sync to compare.');
  }
  if (!res.steady) {
    t.push('Startup: vo rises with an LC response. Light damping gives overshoot and ringing before it settles.');
    t.push('Look at the first peak of iL: with no soft-start the inrush current is many times the steady value. Pick a smaller Time/div and move Position to zoom in.');
    if (p.topo === 'boost' && !p.sync) t.push('In a boost, the diode charges C to about Vin before switching has any effect.');
  }
  return t;
}

function renderTheory() {
  const res = RES, th = res.th, met = res.met, p = res.p;
  els.badge.textContent = met.mode;
  els.badge.className = 'badge ' + met.mode;
  els.headVals.textContent = `Vo=${fmtSI(met.vo.mean, 'V')}  IL=${fmtSI(met.iL.mean, 'A')}  ΔiL=${fmtSI(met.iL.pp, 'A')}  ΔVo=${fmtSI(met.vo.pp, 'V')}`;
  const simH = res.steady ? 'Simulation' : 'Sim (last period)';
  const rows = [
    ['Operating mode', th.mode, met.mode],
    ['V<sub>o</sub> (avg)', fmtSI(th.Vout, 'V'), fmtSI(met.vo.mean, 'V')],
    ['M = V<sub>o</sub>/V<sub>in</sub>', f3(th.Mout), f3(met.M)],
    ['I<sub>L</sub> (avg)', fmtSI(th.IL, 'A'), fmtSI(met.iL.mean, 'A')],
    ['Δi<sub>L</sub> (p-p)', fmtSI(th.dIL, 'A'), fmtSI(met.iL.pp, 'A')],
    ['i<sub>L</sub> min / max', `${fmtSI(th.Imin, 'A')} / ${fmtSI(th.Ipk, 'A')}`, `${fmtSI(met.iL.min, 'A')} / ${fmtSI(met.iL.max, 'A')}`],
    ['Δv<sub>o</sub> (p-p)', fmtSI(th.dVo, 'V'), fmtSI(met.vo.pp, 'V')],
    ['I<sub>in</sub> (avg)', fmtSI(th.Iin, 'A'), fmtSI(met.iin.mean, 'A')],
    ['P<sub>out</sub>', fmtSI(th.Vo * th.Vo / p.R, 'W'), fmtSI(met.Pout, 'W')],
    ['Efficiency η', '100 %', isFinite(met.eta) ? (met.eta * 100).toFixed(2) + ' %' : '–'],
  ];
  if (th.dcm) rows.splice(6, 0, ['D<sub>2</sub> (diode on time)', f3(th.D2), f3(Math.max(0, 1 - p.D - met.idleFrac))]);
  els.cmpTbl.innerHTML = `<tr><th class="l">Quantity</th><th>Theory (ideal)</th><th>${simH}</th></tr>` +
    rows.map(r => `<tr><td class="l">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
  const w = [];
  if (!res.ok) w.push('Steady state did not fully converge. Values are approximate.');
  if (res.note) w.push(res.note);
  if (state.applyNote) w.push(state.applyNote);
  if (!res.steady && th.dcm) w.push('Theory column shows the final steady state.');
  els.simWarn.textContent = w.join(' ');
  els.eqTbl.innerHTML = eqRows(p, th).map(([tag, f, v, act]) =>
    `<tr class="${act ? '' : 'dim'}"><td class="tag">${tag}</td><td>${f}</td><td>${v}</td></tr>`).join('');
  els.tips.innerHTML = tipsFor(res).map(s => `<li>${s}</li>`).join('');
}

/* ================= mode map ================= */
const MM = { ml: 52, mr: 20, mt: 10, mb: 34, Kmin: -3, Kmax: 2 };
function drawModeMap() {
  const cv = els.mm, ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  const cs = getComputedStyle(document.documentElement);
  const ink = cs.getPropertyValue('--ink').trim(), muted = cs.getPropertyValue('--muted').trim(), line = cs.getPropertyValue('--line').trim();
  const dcmFill = cs.getPropertyValue('--mm-dcm').trim(), curve = cs.getPropertyValue('--mm-curve').trim();
  const ml = MM.ml * dpr, mr = MM.mr * dpr, mt = MM.mt * dpr, mb = MM.mb * dpr, pw = W - ml - mr, ph = H - mt - mb;
  const X = D => ml + D * pw;
  const Y = K => mt + (1 - (Math.log10(K) - MM.Kmin) / (MM.Kmax - MM.Kmin)) * ph;
  ctx.clearRect(0, 0, W, H);
  const p = effParams(), th = RES.th;
  const kc = D => p.topo === 'buck' ? 1 - D : p.topo === 'boost' ? D * (1 - D) ** 2 : (1 - D) ** 2;
  // DCM region
  ctx.beginPath(); ctx.moveTo(X(0), Y(10 ** MM.Kmin));
  for (let i = 0; i <= 200; i++) { const D = i / 200; ctx.lineTo(X(D), Y(clamp(kc(D), 10 ** MM.Kmin, 10 ** MM.Kmax))); }
  ctx.lineTo(X(1), Y(10 ** MM.Kmin)); ctx.closePath();
  ctx.fillStyle = dcmFill; ctx.fill();
  // grid
  ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.font = `${12 * dpr}px ui-monospace, Consolas, monospace`; ctx.fillStyle = muted;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let e = MM.Kmin; e <= MM.Kmax; e++) {
    const y = Math.round(Y(10 ** e)) + 0.5; ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(W - mr, y); ctx.stroke();
    ctx.fillText(e === 0 ? '1' : `1e${e}`, ml - 4 * dpr, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let d = 0; d <= 4; d++) {
    const x = Math.round(X(d / 4)) + 0.5; ctx.beginPath(); ctx.moveTo(x, mt); ctx.lineTo(x, H - mb); ctx.stroke();
    ctx.textAlign = d === 4 ? 'right' : 'center';
    ctx.fillText((d / 4).toFixed(2), d === 4 ? W - 2 * dpr : x, H - mb + 4 * dpr);
  }
  ctx.textAlign = 'center';
  ctx.fillText('D', X(0.5), H - mb + 18 * dpr);
  ctx.save(); ctx.translate(12 * dpr, mt + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('K', 0, -4 * dpr); ctx.restore();
  // curve
  ctx.strokeStyle = curve; ctx.lineWidth = 2 * dpr; ctx.beginPath();
  for (let i = 1; i < 200; i++) { const D = i / 200, y = Y(clamp(kc(D), 10 ** MM.Kmin, 10 ** MM.Kmax)); i === 1 ? ctx.moveTo(X(D), y) : ctx.lineTo(X(D), y); }
  ctx.stroke();
  ctx.font = `bold ${13 * dpr}px system-ui, sans-serif`; ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('CCM (K > Kcrit)', X(0.55), Y(30));
  ctx.fillText(p.sync ? 'DCM region (not reached with sync FET)' : 'DCM (K < Kcrit)', X(0.04), Y(0.004));
  // operating point
  const K = clamp(th.K, 10 ** MM.Kmin, 10 ** MM.Kmax);
  const col = cs.getPropertyValue('--' + RES.met.mode.toLowerCase()).trim() || ink;
  ctx.fillStyle = col; ctx.strokeStyle = ink; ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.arc(X(p.D), Y(K), 6 * dpr, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  ctx.fillStyle = ink; ctx.font = `${13 * dpr}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = p.D > 0.7 ? 'right' : 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText(`K=${th.K.toPrecision(3)}`, X(p.D) + (p.D > 0.7 ? -9 : 9) * dpr, Y(K) - 4 * dpr);
}
