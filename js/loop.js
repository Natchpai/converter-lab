'use strict';

/* ================= control loop ================= */
// Voltage-mode loop: vc = Gc(s)·(Vref − H·|vo|), d = vc/Vm, H = Vref/Vo*, T = Gc·H·Gvd/Vm.
// Peak current mode: vc sets the peak of Ri·iL (+ slope compensation), T = Gc·H·Gvc with
// Gvc = v̂o/v̂c from the period map.
// Average current mode: iref = Gcv·(Vref − H·|vo|), vc = Gci·(iref − Ri·iL), d = vc/Vm.
// Inner loop Ti = Gci·Ri·Gid/Vm; the voltage loop sees Gvi = (Gci·Gvd/Vm)/(1 + Ti), T = Gcv·H·Gvi.
// Pure: used by the UI, the closed-loop sim and the tests.
const VREF = 2.5;

// Characteristic frequencies of the plant (Hz), for markers and readouts.
function plantMarks(p, pl) {
  const m = [];
  if (pl.kind === 'ccm') m.push({ f: pl.w0 / TWO_PI, text: 'f0' });
  else if (pl.kind === 'dcm') m.push({ f: pl.wp / TWO_PI, text: 'fp' });
  else if (pl.ok !== false && isFinite(pl.fp)) m.push({ f: pl.fp, text: 'fp' });   // PCMC: only at a steady state
  for (const z of pl.zeros) m.push({ f: Math.hypot(z.re, z.im) / TWO_PI, text: z.re > 0 ? 'fRHP' : 'fESR', rhp: z.re > 0 });
  return m;
}

function buildLoop(p, cfg) {
  const L = { cfg, warn: [] };
  const d0 = solveD0(p, cfg.Vt);
  L.D0 = d0.D; L.Vmax = d0.Vmax; L.reach = d0.ok;
  L.p = { ...p, D: L.D0 };
  const pc = cfg.mode === 'pcmc', ac = cfg.mode === 'acmc';
  L.plant = pc ? pcmcPlant(L.p, cfg, L.D0) : ac ? acmcPlant(L.p, L.D0) : plantAt(L.p, L.D0);
  L.plantName = pc ? 'Plant Gvc = v̂o/v̂c (sampled-data)' : ac ? 'Outer plant Gvi = v̂o/v̂iref (current loop closed)' : 'Plant Gvd = v̂o/d̂';
  L.plantShort = pc ? 'Gvc' : ac ? 'Gvi' : 'Gvd';
  L.H = cfg.Vref / cfg.Vt; L.Fm = pc ? 1 : 1 / cfg.Vm;
  if (pc) { L.Se = L.plant.Se; L.vc0 = L.plant.vc0; L.vcMax = cfg.vcMax; }
  L.cn = compNorm(cfg.comp);
  const k = L.H * L.Fm, pl = L.plant;
  if (ac) {
    L.cni = compNorm(cfg.ci); L.IL0 = pl.IL;
    L.Gci = f => compEval(L.cni, f);
    L.plantKi = f => Cx.scale(pl.Gid(f), cfg.Ri * L.Fm);
    L.Ti = f => Cx.mul(L.Gci(f), L.plantKi(f));
    L.Gvi = f => Cx.div(Cx.scale(Cx.mul(L.Gci(f), pl.Gvd(f)), L.Fm), Cx.add(Cx.of(1), L.Ti(f)));
    L.plantH = L.Gvi;
    L.plantK = f => Cx.scale(L.Gvi(f), L.H);
  } else {
    L.plantH = pl.Gvd;
    L.plantK = f => Cx.scale(pl.Gvd(f), k);
  }
  L.Gc = f => compEval(L.cn, f);
  L.T = f => Cx.mul(L.Gc(f), L.plantK(f));
  L.CL = f => { const t = L.T(f); return Cx.scale(Cx.div(t, Cx.add(t, Cx.of(1))), 1 / L.H); };
  L.Zol = pl.Zout;
  L.Zcl = pl.Zout && !ac ? f => Cx.div(pl.Zout(f), Cx.add(Cx.of(1), L.T(f))) : null;

  L.marks = plantMarks(L.p, pl);
  const fLow = Math.min(p.fs / 1e4, ...L.marks.map(m => m.f / 3));
  L.fmin = 10 ** Math.floor(Math.log10(Math.max(fLow, 0.1)));
  L.fmax = pc || pl.kind === 'pmap' ? p.fs / 2 : p.fs;   // a sampled-data model repeats above fs/2
  L.m = loopMargins(L.T, L.fmin, L.fmax);
  if (ac) L.mi = loopMargins(L.Ti, L.fmin, L.fmax);
  const okM = mm => isFinite(mm.pm) && mm.pm > 0 && mm.gm > 0 && !mm.conditional;

  if (ac && pl.poly) {
    // d = Fm·Gci·(Gcv·(−H·vo) − Ri·iL) with vo = Nv/Dp·d, iL = Ni/Dp·d:
    // Dci·Dcv·Dp + Fm·Nci·(H·Ncv·Nv + Ri·Ni·Dcv) = 0
    const ci = compPoly(L.cni), cv = compPoly(L.cn);
    const fb = polyAdd(polyMul(cv.num, pl.poly.num).map(v => v * L.H), polyMul(pl.polyI.num, cv.den).map(v => v * cfg.Ri));
    const chr = polyAdd(polyMul(polyMul(ci.den, cv.den), pl.poly.den), polyMul(ci.num, fb).map(v => v * L.Fm));
    L.poles = polyRoots(chr, TWO_PI * p.fs / 10);
    L.stable = L.poles.every(r => r.re < -1e-9 * TWO_PI * p.fs);
  } else if (ac) {
    L.poles = null;                         // period-map plant: judge from the margins of both loops
    L.stable = okM(L.m) && okM(L.mi);
  } else if (pl.poly) {
    // closed-loop poles: den_c·den_p + k·num_c·num_p = 0
    const cp = compPoly(L.cn);
    const chr = polyAdd(polyMul(cp.den, pl.poly.den), polyMul(cp.num, pl.poly.num).map(v => v * k));
    L.poles = polyRoots(chr, TWO_PI * p.fs / 10);
    L.stable = L.poles.every(r => r.re < -1e-9 * TWO_PI * p.fs);
  } else {
    // sampled-data plant: judge from the margins and the current-loop pole
    L.poles = null;
    L.stable = okM(L.m) && Cx.abs(pl.lamC) < 1;
  }

  // ACMC slope check. The ripple of Ri·iL passes the current amplifier (gain about |Gci(fs)|)
  // and is compared with the ramp. Dixon's rule: the amplified down-slope must not exceed the
  // ramp slope VM·fs. Above it the switching sim shows period-2 ripple instability (from
  // ratio 1.2-2.4 in the tests) that the averaged model cannot predict.
  if (ac) {
    const af = ccmAffine(L.p), sl = ilSlopes(af, slopePoint(L.p, af, L.D0, cfg.Vt));
    const Ka = Cx.abs(L.Gci(p.fs)) * cfg.Ri, Seq = cfg.Vm * p.fs;
    L.slope = { Ka, Sn: Ka * sl.on, Sf: Ka * sl.off, Se: Seq, ratio: Ka * sl.off / Seq, dcm: pl.kind === 'pmap' };
  }

  L.opamp = opampValues(cfg.comp, L.H, cfg.R1);
  L.Rbot = cfg.R1 * cfg.Vref / Math.max(cfg.Vt - cfg.Vref, 1e-9);

  // warnings for the reader
  const fc = L.m.fc, rhp = L.marks.find(m => m.rhp);
  if (!L.reach) L.warn.push(`Target ${fmtSI(cfg.Vt, 'V')} is not reachable (max about ${fmtSI(L.Vmax, 'V')} with these parts).`);
  if (L.D0 > cfg.Dmax) L.warn.push(`The needed duty ${L.D0.toFixed(3)} is above Dmax = ${cfg.Dmax}.`);
  if (pc && L.D0 < (cfg.tb || 0)) L.warn.push(`The needed duty ${L.D0.toFixed(3)} is below the blanking time t<sub>b</sub>/T = ${cfg.tb}: the minimum on-time sets the duty and V<sub>o</sub> goes above the target.`);
  if (pc && Cx.abs(pl.lamC) >= 1) L.warn.push(`Subharmonic oscillation: the current-loop pole α = ${pl.lamC.re.toFixed(2)} is outside the unit circle (|α| ≥ 1). Raise Se: it must be above (Sf − Sn)/2; Se = Sf/2 works for any D.`);
  else if (pc && pl.Qp > 2) L.warn.push(`Qp = ${pl.Qp.toFixed(1)}: the double pole at fs/2 is sharp, close to subharmonic oscillation. Add slope compensation.`);
  if (pc && !pl.ok) L.warn.push('The peak-current operating point did not converge (duty limit or no steady state).');
  else if (pc && pl.vc0 > 0.8 * cfg.vcMax) L.warn.push(`v<sub>c</sub> = ${fmtSI(pl.vc0, 'V')} at the operating point is close to its limit ${fmtSI(cfg.vcMax, 'V')}: the current limit will act on steps. Lower R<sub>i</sub>.`);
  if (ac) {
    const mi = L.mi, s = L.slope;
    if (!isFinite(mi.fc)) L.warn.push('|T<sub>i</sub>| of the current loop does not cross 0 dB: change the current-amplifier gain.');
    else if (!okM(mi)) L.warn.push(`Current loop has no margin (PM<sub>i</sub> ${isFinite(mi.pm) ? mi.pm.toFixed(0) + '°' : '–'}).`);
    else if (mi.pm < 30) L.warn.push(`Current-loop phase margin ${mi.pm.toFixed(0)}° is low.`);
    if (mi.fc > p.fs / 3) L.warn.push(`Current-loop crossover ${fmtSI(mi.fc, 'Hz')} is above fs/3: the averaged model is not accurate there.`);
    if (isFinite(fc) && fc > mi.fc / 2) L.warn.push(`The voltage loop (f<sub>c</sub> ${fmtSI(fc, 'Hz')}) should be well below the current loop (${fmtSI(mi.fc, 'Hz')}).`);
    if (s.ratio > 1) L.warn.push(`Slope rule (Dixon): the amplified down-slope |G<sub>ci</sub>(fs)|·R<sub>i</sub>·di<sub>L</sub>/dt = ${fmtSI(s.Sf, 'V/s')} is above the ramp slope V<sub>M</sub>·fs = ${fmtSI(s.Se, 'V/s')} (×${s.ratio.toFixed(2)}). Expect period-2 ripple instability in the switching simulation (the averaged model cannot show it). Lower the current-amplifier gain at fs or raise V<sub>M</sub>.`);
  }
  if (!L.stable) L.warn.push(pl.poly ? 'Closed loop is UNSTABLE (a closed-loop pole is in the right half plane).' : 'Closed loop is UNSTABLE or has no margin (judged from the margins of the sampled-data loop).');
  else if (L.m.pm < 30) L.warn.push(`Phase margin ${L.m.pm.toFixed(0)}° is low: expect ringing on steps.`);
  if (!isFinite(fc)) L.warn.push('|T| does not cross 0 dB below fs: the loop gain is too high (or too low) for this model.');
  if (L.m.cross.length > 1) L.warn.push(`|T| crosses 0 dB ${L.m.cross.length} times (${L.m.cross.map(c => fmtSI(c.f, 'Hz')).join(', ')}). A resonance peak lifts the loop gain above 1.`);
  if (L.m.conditional) L.warn.push('Conditionally stable: the phase passes −180° below fc. Lower gain can make it unstable.');
  if (fc > p.fs / 5 && !ac) L.warn.push(`fc = ${fmtSI(fc, 'Hz')} is above fs/5. The averaged model is not accurate there and ripple disturbs the PWM.`);
  if (rhp && fc > rhp.f / 5) L.warn.push(`fc is above fRHP/5 = ${fmtSI(rhp.f / 5, 'Hz')}. The RHP zero adds phase lag; keep fc lower.`);
  if (pl.kind === 'dcm') L.warn.push('DCM: the plant is the reduced-order model with ideal parts (one pole).');
  if (!L.opamp.ok) L.warn.push('Op-amp values: ' + L.opamp.note);
  return L;
}

// A sensible crossover target: fs/10, and below fRHP/5 when the plant has an RHP zero.
function suggestFc(L) {
  let f = L.p.fs / 10;
  const rhp = L.marks.find(m => m.rhp);
  if (rhp) f = Math.min(f, rhp.f / 5);
  if (L.plant.kind === 'dcm') f = Math.min(f, L.p.fs / 10);
  if (L.cfg.mode === 'acmc') f = Math.min(f, L.cfg.fciT / 4);       // outer loop well below the inner one
  return +f.toPrecision(2);
}
// Current-loop crossover target for ACMC: fs/6.
const suggestFci = p => +(p.fs / 6).toPrecision(2);
