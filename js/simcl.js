'use strict';

/* ================= closed-loop switching simulation ================= */
// Compensator in the time domain: integrator (with the PI zero as feedthrough) followed by
// first-order sections x' = ωp(u − x), y = (ωp/ωz)u + (1 − ωp/ωz)x. Each step uses the
// trapezoid (Tustin) rule with the input at the start and end of the step, so any step
// length h works (needed when a step is split at a switching instant).
function makeCompSim(cn, yMin, yMax) {
  const nz = cn.wz.length, np = cn.wp.length;
  const ff = cn.n === 1 && nz > np ? cn.wz[0] : 0;            // PI zero as feedthrough
  const secZ = ff ? cn.wz.slice(1) : cn.wz.slice(), secP = cn.wp.slice();
  const ns = secP.length, G = cn.G;
  const S = new Float64Array(4 + 2 * ns);                      // [xi, y, sat, yraw, xs..., vin...]
  const c = { yMin, yMax, S };
  const out = () => S[1];
  c.y = out;
  // Steady start: every stage passes y0 at DC (input 0 for n = 1).
  c.init = y0 => {
    S[0] = y0; S[1] = clamp(y0, yMin, yMax); S[2] = 0; S[3] = y0;
    for (let k = 0; k < ns; k++) { S[4 + k] = y0; S[4 + ns + k] = y0; }
  };
  c.step = (u0, u1, h) => {
    let v;
    if (cn.n === 1) {
      const sat = S[2], freeze = (sat > 0 && u0 > 0) || (sat < 0 && u0 < 0);   // anti-windup
      if (!freeze) S[0] += G * h * 0.5 * (u0 + u1);
      v = S[0] + (ff ? G / ff * u1 : 0);
    } else v = G * u1;
    for (let k = 0; k < ns; k++) {
      const wp = secP[k], wz = secZ[k], a = 0.5 * wp * h;
      const x1 = ((1 - a) * S[4 + k] + a * (S[4 + ns + k] + v)) / (1 + a);
      S[4 + k] = x1; S[4 + ns + k] = v;
      v = (wp / wz) * v + (1 - wp / wz) * x1;
    }
    S[3] = v; S[1] = clamp(v, yMin, yMax); S[2] = v > yMax ? 1 : v < yMin ? -1 : 0;
  };
  c.save = buf => { buf.set(S); };
  c.load = buf => { S.set(buf); };
  return c;
}

/* ---------- recording ---------- */
const CL_X = ['vc', 'ramp', 'vref', 'duty', 'iref'];
function makeRecCL(cap) {
  const r = makeRec(cap);
  r.seg = new Uint8Array(cap);
  r.x = Object.fromEntries(CL_X.map(k => [k, new Float32Array(cap)]));
  return r;
}
function pushCL(r, t, iL, vC, st, seg, vc, ramp, vref, iref) {
  if (r.n >= r.t.length) {
    const cap = r.t.length * 2 + 64;
    for (const k of ['t', 'iL', 'vC']) { const a = new Float64Array(cap); a.set(r[k]); r[k] = a; }
    for (const k of ['st', 'seg']) { const a = new Uint8Array(cap); a.set(r[k]); r[k] = a; }
    for (const k of CL_X) { const a = new Float32Array(cap); a.set(r.x[k]); r.x[k] = a; }
  }
  const i = r.n++;
  r.t[i] = t; r.iL[i] = iL; r.vC[i] = vC; r.st[i] = st; r.seg[i] = seg;
  r.x.vc[i] = vc; r.x.ramp[i] = ramp; r.x.vref[i] = vref; r.x.iref[i] = iref;
}

/* ---------- events ---------- */
// Test events on the Control page. size is in percent.
const CL_EVENTS = {
  load:  { name: 'Load step (R → R/(1+s))', def: 100 },
  vin:   { name: 'Input step (Vin → Vin·(1+s))', def: 25 },
  vref:  { name: 'Reference step (Vref → Vref·(1+s))', def: 10 },
  start: { name: 'Soft-start from zero', def: 0 },
};

// Run the closed-loop converter. L from buildLoop(). opt: { event, size, back, nPer, N, pre },
// optional x0 = [iL, vC] and vc0 to start from a given state (used by the period map),
// noRec (no waveform recording), inj (frequency response, see fra.js).
// Turn-off rule: VMC   vc ≤ VM·(t − tclk)/T            (trailing-edge PWM)
//                PCMC  vc ≤ Ri·iL + Se·(t − tclk)       (peak current with slope compensation),
//                      ignored for the blanking time cfg.tb·T after the clock (min on-time)
//                ACMC  as VMC, with vc = Gci·(iref − Ri·iL) and iref = Gcv·(vref − H·|vo|)
function simulateCL(L, opt) {
  const g = simulateCLSteps(L, opt);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
// Same run as a generator: with opt.yieldEvery it pauses every that many periods, so the page
// can split a long run (FRA) into short slices.
function* simulateCLSteps(L, opt) {
  const p = L.p, T = 1 / p.fs, cfg = L.cfg, Vm = cfg.Vm, H = L.H;
  const pc = cfg.mode === 'pcmc', ac = cfg.mode === 'acmc', Ri = cfg.Ri, Se = L.Se || 0;
  const s = opt.size / 100, ev = opt.event;
  const nPer = opt.nPer, N = opt.N, h = T / N;
  const pre = ev === 'start' ? 0 : opt.pre;
  // models: 0 = nominal, 1 = after the event
  const p2 = ev === 'load' ? { ...p, R: p.R / (1 + s) } : ev === 'vin' ? { ...p, Vg: p.Vg * (1 + s) } : p;
  const models = [makeModel(p), makeModel(p2)];
  const kEv = ev === 'start' ? 0 : Math.round(nPer * 0.2), kBack = opt.back && ev !== 'start' ? Math.round(nPer * 0.6) : Infinity;
  const tss = 0.4 * nPer * T;                                          // soft-start ramp time
  const vrefAt = t => {
    const tr = t - pre * T;                                            // time from record start
    if (ev === 'start') return cfg.Vref * clamp(tr / tss, 0, 1);
    if (ev === 'vref' && tr >= kEv * T - 1e-15 && tr < kBack * T - 1e-15) return cfg.Vref * (1 + s);
    return cfg.Vref;
  };
  const segAt = k => (ev === 'load' || ev === 'vin') && k >= pre + kEv && k < pre + kBack ? 1 : 0;

  // ACMC: comp is the voltage compensator (output iref, limited to vcMax like the PCMC peak
  // current), compI the current amplifier (output vc to the PWM)
  const comp = opt.vcLim ? makeCompSim(L.cn, -opt.vcLim, opt.vcLim) : makeCompSim(L.cn, 0, pc || ac ? cfg.vcMax : 1.25 * Vm);
  const compI = ac ? makeCompSim(L.cni, 0, 1.25 * Vm) : null;
  const snap = new Float64Array(comp.S.length), snapI = ac ? new Float64Array(compI.S.length) : null;
  // FRA injection: a sine added at the modulator input (inj.at 'vc') or, in ACMC, to the
  // current reference ('iref'); inj.freeze holds the voltage compensator (current loop alone).
  // x = signal after the injection point, y = compensator output before it.
  const inj = opt.inj, injVc = !!inj && inj.at === 'vc', injIr = !!inj && inj.at === 'iref';
  const wI = inj ? TWO_PI * inj.f : 0, vinj = t => inj.amp * Math.sin(wI * t), freeze = !!inj && !!inj.freeze;
  const vcBase = ac ? () => compI.y() : () => comp.y();
  const vcNow = injVc ? t => vcBase() + vinj(t) : () => vcBase();
  const irAt = injIr ? t => comp.y() + vinj(t) : () => comp.y();       // iref seen by the current amp
  // advance the compensators over hh; u0, e0 = inputs at the step start, (a1, b1) = state at the end
  const advance = (hh, t1, st1, u0, e0, a1, b1) => {
    if (!freeze) comp.step(u0, u(t1, st1, a1, b1), hh);
    if (ac) compI.step(e0, irAt(t1) - Ri * a1, hh);
  };
  // DFT sums (trapezoid on the step grid) of x, y, |vo| and iL over the periods k ≥ inj.k0
  const fra = inj ? { X: Cx.of(0), Y: Cx.of(0), V: Cx.of(0), I: Cx.of(0) } : null;
  const xOf = t => injVc ? vcNow(t) : irAt(t), yOf = () => injVc ? vcBase() : comp.y();
  const acc = (tA, tB, s0, s1) => {               // s = [x, y, vo, iL] at tA and tB
    const h = tB - tA, cA = Math.cos(wI * tA), sA = Math.sin(wI * tA), cB = Math.cos(wI * tB), sB = Math.sin(wI * tB);
    const keys = ['X', 'Y', 'V', 'I'];
    for (let q = 0; q < 4; q++) {
      const z = fra[keys[q]];
      z.re += 0.5 * h * (s0[q] * cA + s1[q] * cB);
      z.im -= 0.5 * h * (s0[q] * sA + s1[q] * sB);
    }
  };
  let u = null;                                     // error input of the voltage loop, set per period
  let iL, vC;
  if (opt.x0) { [iL, vC] = opt.x0; comp.init(opt.vc0); }
  else if (ev === 'start') { iL = 0; vC = 0; comp.init(0); if (ac) compI.init(0); }
  else {
    const m0 = makeModel({ ...p, D: L.D0 }), th = theory({ ...p, D: L.D0 });
    const Is = Math.max(Math.abs(th.IL) + th.dIL, 1e-3), Vs = Math.max(th.Vo, p.Vg, 1e-3);
    const sol = solveSteady(m0, [th.iL0, th.Vo], Math.max(N, 200), Is, Vs);
    [iL, vC] = sol.x;
    comp.init(pc ? L.vc0 : ac ? Ri * L.IL0 : L.D0 * Vm);
    if (ac) compI.init(L.D0 * Vm);
  }
  const rec = makeRecCL(opt.noRec ? 64 : (nPer + 2) * (N + 6) + 64);
  const duty = new Float64Array(pre + nPer);
  const sync = p.sync, tPre = pre * T;
  let st = ON;

  for (let k = 0; k < pre + nPer; k++) {
    const seg = segAt(k), m = models[seg], tclk = k * T, tMax = tclk + cfg.Dmax * T;
    const tB = tclk + (pc ? cfg.tb || 0 : 0) * T;                     // end of leading-edge blanking
    const recOn = !opt.noRec && k >= pre, i0 = rec.n, meas = !!inj && k >= inj.k0;
    const ramp = pc ? (t, i) => Ri * i + Se * (t - tclk) : t => Vm * (t - tclk) / T;
    u = (t, sst, a, b) => vrefAt(t) - H * m.vout(sst, a, b);
    const push = tt => pushCL(rec, tt - tPre, iL, vC, st, seg, vcNow(tt), ramp(tt, iL), vrefAt(tt), ac ? comp.y() : 0);
    // clock edge: S turns on (VMC: unless vc is below the ramp start; PCMC: it may turn off at once)
    st = pc || vcNow(tclk) > 0 ? ON : (st === ON ? OFF : st);
    if (st !== ON && !sync && iL <= 0) { iL = 0; st = m.offRises(vC) ? OFF : IDLE; }
    let dk = st === ON ? NaN : 0;
    if (recOn) push(tclk);
    for (let j = 0; j < N; j++) {
      let t = tclk + j * h, rem = h;
      while (rem > 1e-18 * T) {
        if (st === IDLE && m.offRises(vC)) { st = OFF; if (recOn) push(t); }
        // while blanked, end the step at tB so the comparator starts exactly there
        const blank = st === ON && t < tB - 1e-12 * T, hs = blank && t + rem > tB ? tB - t : rem;
        const u0 = u(t, st, iL, vC), vc0 = vcNow(t), e0 = ac ? irAt(t) - Ri * iL : 0;
        const s0 = meas ? [xOf(t), yOf(), m.vout(st, iL, vC), iL] : null;
        comp.save(snap); if (ac) compI.save(snapI);
        m.step(st, iL, vC, hs);
        let iL1 = m.ni, vC1 = m.nv;
        advance(hs, t + hs, st, u0, e0, iL1, vC1);
        let h1 = hs, next = st;
        if (st === ON) {
          const g0 = ramp(t, iL) - vc0, g1 = ramp(t + hs, iL1) - vcNow(t + hs);
          let tc = Infinity;
          if (g1 >= 0 && !blank) tc = t + hs * clamp(g0 < 0 ? g0 / (g0 - g1) : 0, 0, 1);
          tc = Math.min(tc, tMax);
          if (tc < t + hs) { h1 = tc - t; next = OFF; }
        } else if (st === OFF && !sync && iL1 < 0) {
          h1 = hs * clamp(iL > 0 ? iL / (iL - iL1) : 0, 0, 1); next = IDLE;
        }
        if (h1 < hs) {                                 // redo the part before the event
          comp.load(snap); if (ac) compI.load(snapI);
          if (h1 > 0) {
            m.step(st, iL, vC, h1); iL1 = m.ni; vC1 = m.nv;
            advance(h1, t + h1, st, u0, e0, iL1, vC1);
          } else { iL1 = iL; vC1 = vC; }
          if (next === IDLE) iL1 = 0;
        }
        iL = iL1; vC = vC1;
        if (meas && h1 > 0) acc(t, t + h1, s0, [xOf(t + h1), yOf(), m.vout(st, iL, vC), iL]);
        t += h1; rem -= h1;
        if (recOn) push(t);
        if (next !== st) {
          if (st === ON) dk = (t - tclk) / T;
          if (next === OFF && !sync && iL <= 0) { iL = 0; next = m.offRises(vC) ? OFF : IDLE; }
          st = next;
          if (recOn) push(t);
        }
      }
    }
    if (isNaN(dk)) dk = cfg.Dmax;                      // never crossed: on until the clock (Dmax ≥ 1 case)
    duty[k] = dk;
    if (recOn) rec.x.duty.fill(dk, i0, rec.n);
    // the next clock edge starts from ON in the state machine above
    if (st === ON) st = OFF;
    if (opt.yieldEvery && (k + 1) % opt.yieldEvery === 0) yield k + 1;
  }
  return { rec, models, nPer, N, T, tEnd: nPer * T, kEv, kBack, duty: duty.subarray(pre), pre, fra };
}

/* ---------- result object for the scope ---------- */
function computeResCL(L, opt) {
  const sim = simulateCL(L, opt);
  const r = sim.rec, H = L.H;
  const res = {
    p: L.p, m: sim.models[0], models: sim.models, T: sim.T, steady: false, cache: {}, thCache: {},
    rec: r, tEnd: sim.tEnd, nPer: sim.nPer, N: sim.N, ok: true, note: '', cl: true, L, opt, sim,
  };
  const evs = [];
  if (opt.event !== 'start') {
    evs.push({ t: sim.kEv * sim.T, text: CL_EVENTS[opt.event].name.split(' (')[0] });
    if (isFinite(sim.kBack)) evs.push({ t: sim.kBack * sim.T, text: 'step back' });
  }
  res.events = evs;
  res.sigArray = key => {
    const a = new Float64Array(r.n);
    if (key in r.x) { a.set(r.x[key].subarray(0, r.n)); return a; }
    if (key === 'vfb' || key === 'verr') {
      for (let i = 0; i < r.n; i++) {
        const fb = H * sim.models[r.seg[i]].vout(r.st[i], r.iL[i], r.vC[i]);
        a[i] = key === 'vfb' ? fb : r.x.vref[i] - fb;
      }
      return a;
    }
    if (key === 'isense') { for (let i = 0; i < r.n; i++) a[i] = L.cfg.Ri * r.iL[i]; return a; }
    if (key === 'voavg') {
      const vo = sigArr(res, 'vo'), avg = periodAverages(r, vo, sim.T, sim.nPer);
      for (let i = 0; i < r.n; i++) a[i] = avg[clamp(Math.floor(r.t[i] / sim.T * (1 - 1e-12)), 0, sim.nPer - 1)];
      return a;
    }
    for (let i = 0; i < r.n; i++) a[i] = sim.models[r.seg[i]].sig(key, r.st[i], r.iL[i], r.vC[i]);
    return a;
  };
  res.met = clMetrics(res);
  return res;
}

// Mean of a recorded signal over each switching period.
function periodAverages(r, a, T, nPer) {
  const out = new Float64Array(nPer);
  let i = 0;
  for (let k = 0; k < nPer; k++) {
    const t1 = (k + 1) * T;
    let area = 0;
    while (i < r.n - 1 && r.t[i + 1] <= t1 + 1e-9 * T) { area += 0.5 * (a[i] + a[i + 1]) * (r.t[i + 1] - r.t[i]); i++; }
    out[k] = area / T;
  }
  return out;
}

// Step-response numbers from the per-period average of |vo|.
function clMetrics(res) {
  const r = res.rec, sim = res.sim, T = sim.T, nPer = sim.nPer, L = res.L, Vt = L.cfg.Vt;
  const vom = new Float64Array(r.n);
  for (let i = 0; i < r.n; i++) vom[i] = sim.models[r.seg[i]].vout(r.st[i], r.iL[i], r.vC[i]);
  const avg = periodAverages(r, vom, T, nPer);
  const mean = (a, b) => { let s = 0; for (let k = a; k < b; k++) s += avg[k]; return s / Math.max(1, b - a); };
  const segs = [];
  const bounds = [0];
  if (res.opt.event !== 'start') { bounds.push(sim.kEv); if (isFinite(sim.kBack)) bounds.push(sim.kBack); }
  bounds.push(nPer);
  for (let j = 1; j < bounds.length; j++) {
    const a = bounds[j - 1], b = bounds[j];
    const fin = mean(Math.max(a, b - Math.max(2, Math.round((b - a) * 0.1))), b);
    let hi = -Infinity, lo = Infinity, last = a - 1;
    for (let k = a; k < b; k++) { if (avg[k] > hi) hi = avg[k]; if (avg[k] < lo) lo = avg[k]; }
    // settled: back within 10 % of the peak deviation (and at least ±0.1 % of Vo*)
    const band = Math.max(0.001 * Vt, 0.1 * Math.max(hi - fin, fin - lo));
    for (let k = a; k < b; k++) if (Math.abs(avg[k] - fin) > band) last = k;
    segs.push({ t0: a * T, final: fin, over: hi - fin, under: fin - lo, band, settle: (last + 1 - a) * T, settled: last < b - 2 });
  }
  const lastP = [Math.max(0, res.tEnd - T), res.tEnd];
  const vo = statsArr(r, sigArr(res, 'vo'), ...lastP), iL = statsArr(r, sigArr(res, 'iL'), ...lastP);
  let idle = 0; for (let i = 0; i < r.n - 1; i++) if (r.t[i] >= lastP[0] && r.st[i] === IDLE && r.st[i + 1] === IDLE) idle += r.t[i + 1] - r.t[i];
  const mode = res.p.sync ? (iL.min < 0 ? 'FCCM' : 'CCM') : idle > 1e-3 * T ? 'DCM' : 'CCM';
  return { vo, iL, avg, segs, mode, Dfinal: sim.duty[nPer - 1], err: segs[segs.length - 1].final - (res.opt.event === 'vref' && !isFinite(sim.kBack) ? Vt * (1 + res.opt.size / 100) : Vt) };
}

// Steps per period and window length for the closed-loop run. About 100k steps keeps a run
// near 100-200 ms in the browser; switching instants are interpolated, so ~40-300 steps
// per period are enough.
function clSizes(L, nPerOpt) {
  const p = L.p, fc = isFinite(L.m.fc) ? L.m.fc : p.fs / 20, pre = 60;
  let nPer = nPerOpt === 'auto' ? clamp(Math.round(20 * p.fs / fc), 60, 3000) : +nPerOpt;
  const Nacc = stepsPerPeriod(p, 0.5, 40, 2000);
  const N = Math.max(clamp(Math.floor(100000 / (nPer + pre)), 40, 300), Nacc);
  if (N * nPer > 400000) nPer = Math.max(20, Math.floor(400000 / N));
  return { nPer, N, pre };
}

/* ---------- period-map (sampled-data) models ---------- */
// Linearize a one-period map Fn(x, u) -> [iL1, vC1, y_1, y_2, ...] at (x, u):
// x_{k+1} = Φ·x_k + Γ·u_k and y_j,k = C_j·x_k + D_j·u_k. Then G_j(z) = C_j(zI − Φ)⁻¹Γ + D_j
// at z = e^{jωTs}. It holds in CCM and DCM and needs no averaging assumptions.
// G = transfer function of the first output (vo_avg); Gout[j] for every output.
function linearizePeriod(Fn, x, u, hI, hV, hu, T) {
  const y0 = Fn(x, u), yI = Fn([x[0] + hI, x[1]], u), yV = Fn([x[0], x[1] + hV], u), yU = Fn(x, u + hu);
  const Phi = [[(yI[0] - y0[0]) / hI, (yV[0] - y0[0]) / hV], [(yI[1] - y0[1]) / hI, (yV[1] - y0[1]) / hV]];
  const Gam = [(yU[0] - y0[0]) / hu, (yU[1] - y0[1]) / hu];
  const tr = Phi[0][0] + Phi[1][1], det = Phi[0][0] * Phi[1][1] - Phi[0][1] * Phi[1][0];
  const eig = quadRoots(1, -tr, det);
  const Gof = j => {
    const C = [(yI[j] - y0[j]) / hI, (yV[j] - y0[j]) / hV], Dd = (yU[j] - y0[j]) / hu;
    return f => {
      const z = Cx.exp({ re: 0, im: TWO_PI * f * T });
      const a = Cx.sub(z, Cx.of(Phi[0][0])), b = Cx.sub(z, Cx.of(Phi[1][1]));
      const dt = Cx.sub(Cx.mul(a, b), Cx.of(Phi[0][1] * Phi[1][0]));
      const x0 = Cx.div(Cx.add(Cx.scale(b, Gam[0]), Cx.of(Phi[0][1] * Gam[1])), dt);
      const x1 = Cx.div(Cx.add(Cx.of(Phi[1][0] * Gam[0]), Cx.scale(a, Gam[1])), dt);
      return Cx.add(Cx.add(Cx.scale(x0, C[0]), Cx.scale(x1, C[1])), Cx.of(Dd));
    };
  };
  const Gout = y0.slice(2).map((_, j) => Gof(j + 2));
  return { Phi, Gam, x, u, eig, G: Gout[0], Gout, vo: y0[2], y: y0.slice(2) };
}

// VMC: input = duty, one period by simulate() (the ON time is exactly d·T).
// Outputs: period average of |vo| (G = Gvd) and of iL (Gout[1] = Gid).
function periodMapVMC(p, D, N = 1000) {
  const T = 1 / p.fs;
  const F = (x, d) => {
    const m = makeModel({ ...p, D: d }), rec = makeRec(N + 64);
    const y = simulate(m, x, 1, N, rec);
    const a = new Float64Array(rec.n);
    for (let i = 0; i < rec.n; i++) a[i] = m.vout(rec.st[i], rec.iL[i], rec.vC[i]);
    return [y[0], y[1], statsArr(rec, a, 0, T).mean, statsArr(rec, rec.iL, 0, T).mean];
  };
  const th = theory({ ...p, D, T });
  const Is = Math.max(Math.abs(th.IL) + th.dIL, 1e-3), Vs = Math.max(th.Vo, p.Vg, 1e-3);
  const x = solveSteady(makeModel({ ...p, D }), [th.iL0, th.Vo], N, Is, Vs).x;
  return linearizePeriod(F, x, D, 1e-6 * Is, 1e-6 * Vs, 1e-6, T);
}

// PCMC: input = vc held over the period, one period by the closed-loop stepper with a frozen
// compensator.
function pcmcPeriodFn(p, cfg, Se, N) {
  const T = 1 / p.fs;
  const Lp = { p, cfg: { ...cfg, mode: 'pcmc' }, H: 0, cn: { G: 0, n: 1, wz: [], wp: [] }, Se };
  return (x, vc) => {
    const sim = simulateCL(Lp, { event: 'none', size: 0, back: false, nPer: 1, N, pre: 0, x0: x, vc0: vc, vcLim: 1e9 });
    const r = sim.rec, m = sim.models[0], a = new Float64Array(r.n);
    for (let i = 0; i < r.n; i++) a[i] = m.vout(r.st[i], r.iL[i], r.vC[i]);
    return [r.iL[r.n - 1], r.vC[r.n - 1], periodAverages(r, a, T, 1)[0], sim.duty[0]];
  };
}

function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < 3; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) { let v = M[r][3]; for (let k = r + 1; k < 3; k++) v -= M[r][k] * x[k]; x[r] = v / M[r][r]; }
  return x;
}

// Steady state of the PCMC converter with |vo| = Vt: Newton on (iL0, vC0, vc).
function pcmcOperatingPoint(p, cfg, Se, D0, N) {
  const T = 1 / p.fs, Fn = pcmcPeriodFn(p, cfg, Se, N), Vt = cfg.Vt;
  const q = { ...p, D: D0 }, m = makeModel(q), th = theory(q);
  const Is = Math.max(Math.abs(th.IL) + th.dIL, 1e-3), Vs = Math.max(th.Vo, p.Vg, 1e-3);
  const x = solveSteady(m, [th.iL0, th.Vo], N, Is, Vs).x, rec = makeRec(N + 64);
  simulate(m, x, 1, N, rec);
  let ipk = -Infinity;
  for (let i = 0; i < rec.n; i++) if (rec.st[i] === ON) ipk = Math.max(ipk, rec.iL[i]);
  let z = [x[0], x[1], cfg.Ri * ipk + Se * D0 * T];
  const sc = [Is, Vs, Math.max(cfg.Ri * Is, 1e-6)];
  const res = zz => { const F = Fn([zz[0], zz[1]], zz[2]); return [F[0] - zz[0], F[1] - zz[1], F[2] - Vt, F[3]]; };
  // scaled residual; Newton keeps the best finite point, so a target with no steady state
  // (unreachable Vo*, duty limit) still gives a finite linearization (flagged ok = false)
  const nrm = rr => Math.max(Math.abs(rr[0]) / Is, Math.abs(rr[1]) / Vs, Math.abs(rr[2]) / Vt);
  let r = res(z), ok = false, best = { z, r, e: nrm(r) };
  for (let it = 0; it < 25; it++) {
    const e = nrm(r);
    if (!isFinite(e)) break;
    if (e < best.e || !isFinite(best.e)) best = { z, r, e };
    if (e < 1e-9) { ok = true; break; }
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let j = 0; j < 3; j++) {
      const h = 1e-6 * sc[j], zp = z.slice(); zp[j] += h;
      const rp = res(zp);
      for (let i = 0; i < 3; i++) J[i][j] = (rp[i] - r[i]) / h;
    }
    const dz = solve3(J, r.slice(0, 3));
    const lim = Math.max(1, ...dz.map((d, j) => Math.abs(d) / (0.3 * sc[j])));
    z = z.map((v, j) => v - dz[j] / lim);
    if (!p.sync && z[0] < 0) z[0] = 0;
    r = res(z);
  }
  if (!ok && nrm(r) < 1e-9) ok = true;
  if (!ok && nrm(r) < best.e) best = { z, r, e: nrm(r) };
  if (!ok) { z = best.z; r = best.r; }
  return { x: [z[0], z[1]], vc: z[2], D: r[3], ok, err: best.e };
}

const PCMC_CACHE = new Map();
// Peak current-mode plant v̂o/v̂c from the period map, plus the classic slope numbers:
// Sn, Sf = sensed on/off slopes, mc = 1 + Se/Sn, Qp = 1/(π(mc·D' − 0.5)),
// current-loop sampled pole α = −(Sf − Se)/(Sn + Se) (|α| ≥ 1: subharmonic oscillation).
function pcmcPlant(p, cfg, D0) {
  const key = JSON.stringify([p, cfg.Vt, cfg.Ri, cfg.mSe, cfg.Dmax, cfg.tb || 0, D0]);
  if (PCMC_CACHE.has(key)) return PCMC_CACHE.get(key);
  const T = 1 / p.fs, af = ccmAffine(p), sl = ilSlopes(af, slopePoint(p, af, D0, cfg.Vt));
  const Sn = cfg.Ri * sl.on, Sf = cfg.Ri * sl.off, Se = cfg.mSe * Sf;
  const N = clamp(stepsPerPeriod(p, 0.3, 400, 4000), 400, 4000);
  const op = pcmcOperatingPoint(p, cfg, Se, D0, N);
  const Fn = pcmcPeriodFn(p, cfg, Se, N);
  const th = theory({ ...p, D: op.D });
  const Is = Math.max(Math.abs(th.IL) + th.dIL, 1e-3), Vs = Math.max(cfg.Vt, p.Vg, 1e-3);
  const lin = linearizePeriod(Fn, op.x, op.vc, 1e-6 * Is, 1e-6 * Vs, 1e-6 * Math.max(op.vc, 1e-3), T);
  const avg = averagedPlant(p, D0, af);
  const Dp = 1 - op.D, mc = 1 + Se / Sn;
  const lamC = lin.eig.slice().sort((a, b) => a.re - b.re)[0];        // current-loop pole
  const lamV = lin.eig.slice().sort((a, b) => b.re - a.re)[0];        // slow output pole
  // DCM: iL starts from 0 at every clock, so an iL error dies in one period (pole at 0) and
  // mc, Qp do not apply. The CCM RHP zero is not there either; the ESR zero is.
  const dcm = op.ok && !p.sync && op.x[0] <= 1e-6 * Is;
  const out = {
    kind: 'pcmc', D: op.D, Vo: lin.vo, IL: avg.IL, Gvd: lin.G, poly: null, dcm,
    zeros: dcm ? avg.zeros.filter(z => z.re < 0) : avg.zeros,
    Sn, Sf, Se, mc: dcm ? NaN : mc, Qp: dcm ? NaN : 1 / (Math.PI * (mc * Dp - 0.5)), alpha: dcm ? 0 : -(Sf - Se) / (Sn + Se),
    eig: lin.eig, lamC, fp: lamV.re > 0 && lamV.re < 1 ? -Math.log(lamV.re) / (TWO_PI * T) : NaN,
    vc0: op.vc, x0: op.x, ok: op.ok, Zout: null, lin,
  };
  if (PCMC_CACHE.size > 30) PCMC_CACHE.clear();
  PCMC_CACHE.set(key, out);
  return out;
}

const ACMC_CACHE = new Map();
// Average current mode needs Gvd and Gid = îL/d̂. CCM: averaged model. DCM: the reduced-order
// model has no inductor-current state, so both come from the one-period map (duty input,
// period averages of |vo| and iL).
function acmcPlant(p, D) {
  const th = theory({ ...p, D });
  if (p.sync || !th.dcm) return averagedPlant(p, D);
  const key = JSON.stringify([p, D]);
  if (ACMC_CACHE.has(key)) return ACMC_CACHE.get(key);
  const pm = periodMapVMC(p, D), lam = Math.max(...pm.eig.map(z => z.re));
  const out = {
    kind: 'pmap', D, Vo: pm.vo, IL: pm.y[1], Gvd: pm.G, Gid: pm.Gout[1], poly: null, polyI: null,
    zeros: p.rc > 0 ? [Cx.of(-1 / (p.rc * p.C))] : [], Zout: null, eig: pm.eig,
    fp: lam > 0 && lam < 1 ? -Math.log(lam) * p.fs / TWO_PI : NaN,
  };
  if (ACMC_CACHE.size > 30) ACMC_CACHE.clear();
  ACMC_CACHE.set(key, out);
  return out;
}
