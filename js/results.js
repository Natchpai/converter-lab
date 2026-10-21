'use strict';

/* ================= compute results ================= */
function computeRes(p, view, win) {
  const m = makeModel(p), th = theory(p), T = p.T;
  const res = { p, m, th, T, steady: view === 'steady', cache: {}, thCache: {}, note: '' };
  const Is = Math.max(Math.abs(th.IL) + th.dIL, 1e-3), Vs = Math.max(th.Vo, p.Vg, 1e-3);
  if (res.steady) {
    const N = stepsPerPeriod(p, 0.3, 1000, 20000);
    const sol = solveSteady(m, [th.iL0, th.Vo], N, Is, Vs);
    const rec = makeRec(N + 64);
    simulate(m, sol.x, 1, N, rec);
    res.rec = rec; res.tEnd = T; res.ok = sol.ok; res.N = N;
    res.thModel = makeModel({ ...p, rc: 0, rL: 0, ron: 0, ron2: 0, Vf: 0 });
    res.thRec = theoryRec(p, th, 1000);
    res.metWin = [0, T];
  } else {
    let nPer = win === 'auto' ? autoWindow(p, th) : +win;
    let N = Math.max(stepsPerPeriod(p, 0.5, 40, 4000), Math.min(200, Math.floor(300000 / nPer)));
    if (N * nPer > 400000) { nPer = Math.max(5, Math.floor(400000 / N)); res.note = 'Startup window was shortened to keep the simulation fast.'; }
    const rec = makeRec(nPer * (N + 8) + 64);
    simulate(m, [0, 0], nPer, N, rec);
    res.rec = rec; res.tEnd = nPer * T; res.nPer = nPer; res.ok = true; res.N = N;
    res.metWin = [res.tEnd - T, res.tEnd];
  }
  res.met = metrics(res);
  return res;
}

function sigArr(res, key) {
  if (res.sigArray) { if (!res.cache[key]) res.cache[key] = res.sigArray(key); return res.cache[key]; }
  if (!res.cache[key]) {
    const r = res.rec, a = new Float64Array(r.n);
    for (let i = 0; i < r.n; i++) a[i] = res.m.sig(key, r.st[i], r.iL[i], r.vC[i]);
    res.cache[key] = a;
  }
  return res.cache[key];
}
function thSigArr(res, key) {
  if (!res.thCache[key]) {
    const r = res.thRec, a = new Float64Array(r.n);
    for (let i = 0; i < r.n; i++) a[i] = res.thModel.sig(key, r.st[i], r.iL[i], r.vC[i]);
    res.thCache[key] = a;
  }
  return res.thCache[key];
}
function idxRange(r, ta, tb) {
  const eps = 1e-12 * (r.t[r.n - 1] || 1);
  const i0 = clamp(lowerBound(r.t, r.n, ta - eps), 0, r.n - 1);
  const i1 = clamp(lowerBound(r.t, r.n, tb - eps), 0, r.n - 1);
  return [i0, Math.max(i0, i1)];
}
// Time-weighted statistics of an array over [ta, tb].
function statsArr(r, a, ta, tb) {
  const [i0, i1] = idxRange(r, ta, tb);
  let area = 0, sq = 0, mn = Infinity, mx = -Infinity;
  for (let i = i0; i <= i1; i++) { const v = a[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  for (let i = i0; i < i1; i++) {
    const dt = r.t[i + 1] - r.t[i];
    area += 0.5 * (a[i] + a[i + 1]) * dt;
    sq += 0.5 * (a[i] * a[i] + a[i + 1] * a[i + 1]) * dt;
  }
  const span = r.t[i1] - r.t[i0];
  const mean = span > 0 ? area / span : a[i0], ms = span > 0 ? sq / span : a[i0] * a[i0];
  return { mean, ms, rms: Math.sqrt(Math.max(ms, 0)), min: mn, max: mx, pp: mx - mn };
}
const stats = (res, key, ta, tb) => statsArr(res.rec, sigArr(res, key), ta, tb);

function metrics(res) {
  const [ta, tb] = res.metWin, p = res.p, th = res.th;
  const vo = stats(res, 'vo', ta, tb), iL = stats(res, 'iL', ta, tb), iin = stats(res, 'iin', ta, tb);
  const Pout = vo.ms / p.R, Pin = p.Vg * iin.mean;
  const r = res.rec, [i0, i1] = idxRange(r, ta, tb);
  let idle = 0;
  for (let i = i0; i < i1; i++) if (r.st[i] === IDLE && r.st[i + 1] === IDLE) idle += r.t[i + 1] - r.t[i];
  const idleFrac = idle / (tb - ta);
  let mode;
  if (p.sync) mode = iL.min < -1e-6 * Math.max(1e-3, Math.abs(iL.max)) ? 'FCCM' : 'CCM';
  else mode = idleFrac > 1e-3 ? 'DCM' : 'CCM';
  if (Math.abs(th.K - th.Kcrit) / th.Kcrit < 0.03) mode = 'BCM';
  return { vo, iL, iin, Pout, Pin, eta: Pin > 0 ? Pout / Pin : NaN, idleFrac, mode, M: vo.mean / p.Vg };
}

// Interpolated state at time t (wraps in steady state).
function stateAt(res, t) {
  const r = res.rec;
  if (res.steady) t = ((t % res.T) + res.T) % res.T;
  t = clamp(t, r.t[0], r.t[r.n - 1]);
  let i = upperBound(r.t, r.n, t) - 1;
  if (i < 0) i = 0;
  if (i >= r.n - 1) return { st: r.st[r.n - 1], iL: r.iL[r.n - 1], vC: r.vC[r.n - 1] };
  const t0 = r.t[i], t1 = r.t[i + 1];
  if (t1 > t0 && r.st[i] === r.st[i + 1]) {
    const f = (t - t0) / (t1 - t0);
    return { st: r.st[i], iL: r.iL[i] + f * (r.iL[i + 1] - r.iL[i]), vC: r.vC[i] + f * (r.vC[i + 1] - r.vC[i]) };
  }
  return { st: r.st[i], iL: r.iL[i], vC: r.vC[i] };
}
function valueAt(res, key, t) {
  if (res.sigArray) {   // closed loop: interpolate the recorded signal
    const r = res.rec, a = sigArr(res, key);
    t = clamp(t, r.t[0], r.t[r.n - 1]);
    const i = clamp(upperBound(r.t, r.n, t) - 1, 0, r.n - 2), dt = r.t[i + 1] - r.t[i];
    return dt > 0 ? a[i] + (a[i + 1] - a[i]) * (t - r.t[i]) / dt : a[i + 1];
  }
  const s = stateAt(res, t); return res.m.sig(key, s.st, s.iL, s.vC);
}
