'use strict';

/* ================= control loop ================= */
// Voltage-mode loop: vc = Gc(s)·(Vref − H·|vo|), d = vc/Vm, H = Vref/Vo*.
// Loop gain T = Gc · H · Gvd / Vm. Pure: used by the UI, the closed-loop sim and the tests.
const VREF = 2.5;

// Characteristic frequencies of the plant (Hz), for markers and readouts.
function plantMarks(p, pl) {
  const m = [];
  if (pl.kind === 'ccm') m.push({ f: pl.w0 / TWO_PI, text: 'f0' });
  else m.push({ f: pl.wp / TWO_PI, text: 'fp' });
  for (const z of pl.zeros) m.push({ f: Math.hypot(z.re, z.im) / TWO_PI, text: z.re > 0 ? 'fRHP' : 'fESR', rhp: z.re > 0 });
  return m;
}

function buildLoop(p, cfg) {
  const L = { cfg, warn: [] };
  const d0 = solveD0(p, cfg.Vt);
  L.D0 = d0.D; L.Vmax = d0.Vmax; L.reach = d0.ok;
  L.p = { ...p, D: L.D0 };
  L.plant = plantAt(L.p, L.D0);
  L.H = cfg.Vref / cfg.Vt; L.Fm = 1 / cfg.Vm;
  L.cn = compNorm(cfg.comp);
  const k = L.H * L.Fm, pl = L.plant;
  L.plantK = f => Cx.scale(pl.Gvd(f), k);
  L.Gc = f => compEval(L.cn, f);
  L.T = f => Cx.mul(L.Gc(f), L.plantK(f));
  L.CL = f => { const t = L.T(f); return Cx.scale(Cx.div(t, Cx.add(t, Cx.of(1))), 1 / L.H); };
  L.Zol = pl.Zout;
  L.Zcl = f => Cx.div(pl.Zout(f), Cx.add(Cx.of(1), L.T(f)));

  L.marks = plantMarks(L.p, pl);
  const fLow = Math.min(p.fs / 1e4, ...L.marks.map(m => m.f / 3));
  L.fmin = 10 ** Math.floor(Math.log10(Math.max(fLow, 0.1)));
  L.fmax = p.fs;
  L.m = loopMargins(L.T, L.fmin, L.fmax);

  // closed-loop poles: den_c·den_p + k·num_c·num_p = 0
  const cp = compPoly(L.cn);
  const chr = polyAdd(polyMul(cp.den, pl.poly.den), polyMul(cp.num, pl.poly.num).map(v => v * k));
  L.poles = polyRoots(chr, TWO_PI * p.fs / 10);
  L.stable = L.poles.every(r => r.re < -1e-9 * TWO_PI * p.fs);

  L.opamp = opampValues(cfg.comp, L.H, cfg.R1);
  L.Rbot = cfg.R1 * cfg.Vref / Math.max(cfg.Vt - cfg.Vref, 1e-9);

  // warnings for the reader
  const fc = L.m.fc, rhp = L.marks.find(m => m.rhp);
  if (!L.reach) L.warn.push(`Target ${fmtSI(cfg.Vt, 'V')} is not reachable (max about ${fmtSI(L.Vmax, 'V')} with these parts).`);
  if (L.D0 > cfg.Dmax) L.warn.push(`The needed duty ${L.D0.toFixed(3)} is above Dmax = ${cfg.Dmax}.`);
  if (!L.stable) L.warn.push('Closed loop is UNSTABLE (a closed-loop pole is in the right half plane).');
  else if (L.m.pm < 30) L.warn.push(`Phase margin ${L.m.pm.toFixed(0)}° is low: expect ringing on steps.`);
  if (!isFinite(fc)) L.warn.push('|T| does not cross 0 dB below fs: the loop gain is too high (or too low) for this model.');
  if (L.m.cross.length > 1) L.warn.push(`|T| crosses 0 dB ${L.m.cross.length} times (${L.m.cross.map(c => fmtSI(c.f, 'Hz')).join(', ')}). A resonance peak lifts the loop gain above 1.`);
  if (L.m.conditional) L.warn.push('Conditionally stable: the phase passes −180° below fc. Lower gain can make it unstable.');
  if (fc > p.fs / 5) L.warn.push(`fc = ${fmtSI(fc, 'Hz')} is above fs/5. The averaged model is not accurate there and ripple disturbs the PWM.`);
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
  return +f.toPrecision(2);
}
