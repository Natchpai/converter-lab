'use strict';

/* ================= frequency response from the switching simulation ================= */
// Like a network analyzer on the bench: inject a small sine into the closed loop, let it
// settle, then take the DFT of x (signal after the injection point), y (compensator output
// before it) and the output over whole cycles of the sine. The test frequency is fs/k, so a
// window of whole sine cycles is also whole switching periods and the ripple drops out of the
// DFT. A second run without the sine is subtracted (the simulator is deterministic), which
// removes what is left of the start-up transient.
// Loop gain T = −Y/X. Plant (as plotted): VMC Gvd = VM·V/X, PCMC Gvc = V/X, ACMC voltage loop
// Gvi = V/X (injection at iref), ACMC current loop Ri·I/X (injection at vc, voltage
// compensator held, so the current loop is measured alone).

const fraSnap = (fs, f) => { const k = Math.max(2, Math.round(fs / f)); return { k, f: fs / k }; };

function fraSetup(L, view) {
  const md = L.cfg.mode, ac = md === 'acmc', inner = ac && view === 'inner', Vm = L.cfg.Vm, Ri = L.cfg.Ri;
  // operating value and limits of the compensator output y, to keep the test signal linear
  const y0 = inner || md === 'vmc' ? L.D0 * Vm : md === 'pcmc' ? L.vc0 : Ri * L.IL0;
  const yHi = inner || md === 'vmc' ? 1.25 * Vm : L.cfg.vcMax;
  return {
    inner, at: ac && !inner ? 'iref' : 'vc', y0, yRoom: Math.min(y0, yHi - y0),
    T: inner ? L.Ti : L.T,
    P: inner ? L.plantKi : L.plantH,
    pOf: inner ? F => Cx.scale(Cx.div(F.I, F.X), Ri) : md === 'vmc' ? F => Cx.scale(Cx.div(F.V, F.X), Vm) : F => Cx.div(F.V, F.X),
  };
}

// One frequency point. opt: { view, N, cycles }. Returns the measured T and plant at f.
function fraPoint(L, f0, opt = {}) {
  const g = fraPointSteps(L, f0, opt);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
// Generator form for the page: yields every 40 switching periods.
function* fraPointSteps(L, f0, opt = {}) {
  const p = L.p, S = fraSetup(L, opt.view), { k, f } = fraSnap(p.fs, f0);
  const fcl = Math.min(isFinite(L.m.fc) ? L.m.fc : p.fs / 20, S.inner && isFinite(L.mi.fc) ? L.mi.fc : Infinity);
  // settle: at least 2 sine cycles and about 8 loop time constants (8·fs/fc periods)
  const settle = k * Math.max(2, Math.ceil(8 * p.fs / fcl / k)), meas = k * (opt.cycles || 2);
  const N = opt.N || Math.max(64, stepsPerPeriod(p, 0.5, 40, 2000)), pre = 60;
  // amplitude: x about 2 % of the operating y, but y must not swing into its limits
  const g1T = Cx.abs(Cx.add(Cx.of(1), S.T(f))), gT = Cx.abs(S.T(f));
  const amp = Math.min(0.02 * S.y0 * g1T, 0.25 * S.yRoom * g1T / Math.max(gT, 1e-9));
  const run = function* (a) {
    const sim = yield* simulateCLSteps(L, { event: 'none', size: 0, back: false, nPer: settle + meas, N, pre, noRec: true,
      yieldEvery: 40, inj: { f, amp: a, at: S.at, freeze: S.inner, k0: pre + settle } });
    return sim.fra;
  };
  const t0 = performance.now(), A = yield* run(amp), B = yield* run(0);
  const F = Object.fromEntries(['X', 'Y', 'V', 'I'].map(q => [q, Cx.sub(A[q], B[q])]));
  return { f, k, amp, T: Cx.scale(Cx.div(F.Y, F.X), -1), P: S.pOf(F), ms: performance.now() - t0, periods: 2 * (pre + settle + meas), N };
}

// Default test frequencies: n points from max(fc/20, fs/2000) to fs/2 (current loop: to fs/2
// as well, from fci/20), snapped to fs/k without repeats.
function fraFreqs(L, view, n = 15) {
  const p = L.p, inner = L.cfg.mode === 'acmc' && view === 'inner';
  const fc = inner ? L.mi.fc : L.m.fc, lo = Math.max((isFinite(fc) ? fc : p.fs / 20) / 20, p.fs / 2000, L.fmin), hi = Math.min(p.fs / 2, L.fmax);
  const out = [];
  for (const f of logspace(lo, hi, n)) { const s = fraSnap(p.fs, f); if (!out.some(o => o.k === s.k)) out.push(s); }
  return out.map(o => o.f);
}
