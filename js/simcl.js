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
const CL_X = ['vc', 'ramp', 'vref', 'duty'];
function makeRecCL(cap) {
  const r = makeRec(cap);
  r.seg = new Uint8Array(cap);
  r.x = Object.fromEntries(CL_X.map(k => [k, new Float32Array(cap)]));
  return r;
}
function pushCL(r, t, iL, vC, st, seg, vc, ramp, vref) {
  if (r.n >= r.t.length) {
    const cap = r.t.length * 2 + 64;
    for (const k of ['t', 'iL', 'vC']) { const a = new Float64Array(cap); a.set(r[k]); r[k] = a; }
    for (const k of ['st', 'seg']) { const a = new Uint8Array(cap); a.set(r[k]); r[k] = a; }
    for (const k of CL_X) { const a = new Float32Array(cap); a.set(r.x[k]); r.x[k] = a; }
  }
  const i = r.n++;
  r.t[i] = t; r.iL[i] = iL; r.vC[i] = vC; r.st[i] = st; r.seg[i] = seg;
  r.x.vc[i] = vc; r.x.ramp[i] = ramp; r.x.vref[i] = vref;
}

/* ---------- events ---------- */
// Test events on the Control page. size is in percent.
const CL_EVENTS = {
  load:  { name: 'Load step (R → R/(1+s))', def: 100 },
  vin:   { name: 'Input step (Vin → Vin·(1+s))', def: 25 },
  vref:  { name: 'Reference step (Vref → Vref·(1+s))', def: 10 },
  start: { name: 'Soft-start from zero', def: 0 },
};

// Run the closed-loop VMC converter. L from buildLoop(). opt: { event, size, back, nPer, N, pre }.
function simulateCL(L, opt) {
  const p = L.p, T = 1 / p.fs, cfg = L.cfg, Vm = cfg.Vm, H = L.H;
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

  const comp = makeCompSim(L.cn, 0, 1.25 * Vm);
  const snap = new Float64Array(comp.S.length);
  let iL, vC;
  if (ev === 'start') { iL = 0; vC = 0; comp.init(0); }
  else {
    const m0 = makeModel({ ...p, D: L.D0 }), th = theory({ ...p, D: L.D0 });
    const Is = Math.max(Math.abs(th.IL) + th.dIL, 1e-3), Vs = Math.max(th.Vo, p.Vg, 1e-3);
    const sol = solveSteady(m0, [th.iL0, th.Vo], Math.max(N, 200), Is, Vs);
    [iL, vC] = sol.x;
    comp.init(L.D0 * Vm);
  }
  const rec = makeRecCL((nPer + 2) * (N + 6) + 64);
  const duty = new Float64Array(pre + nPer);
  const sync = p.sync, tPre = pre * T;
  let st = ON;

  for (let k = 0; k < pre + nPer; k++) {
    const seg = segAt(k), m = models[seg], tclk = k * T, tMax = tclk + cfg.Dmax * T;
    const recOn = k >= pre, i0 = rec.n;
    const ramp = t => Vm * (t - tclk) / T;
    const u = (t, sst, a, b) => vrefAt(t) - H * m.vout(sst, a, b);
    // clock edge: S turns on unless vc is already below the ramp start
    st = comp.y() > 0 ? ON : (st === ON ? OFF : st);
    if (st !== ON && !sync && iL <= 0) { iL = 0; st = m.offRises(vC) ? OFF : IDLE; }
    let dk = st === ON ? NaN : 0;
    if (recOn) pushCL(rec, tclk - tPre, iL, vC, st, seg, comp.y(), 0, vrefAt(tclk));
    for (let j = 0; j < N; j++) {
      let t = tclk + j * h, rem = h;
      while (rem > 1e-18 * T) {
        if (st === IDLE && m.offRises(vC)) { st = OFF; if (recOn) pushCL(rec, t - tPre, iL, vC, st, seg, comp.y(), ramp(t), vrefAt(t)); }
        const u0 = u(t, st, iL, vC), vc0 = comp.y();
        comp.save(snap);
        m.step(st, iL, vC, rem);
        let iL1 = m.ni, vC1 = m.nv;
        comp.step(u0, u(t + rem, st, iL1, vC1), rem);
        let h1 = rem, next = st;
        if (st === ON) {
          const g0 = ramp(t) - vc0, g1 = ramp(t + rem) - comp.y();
          let tc = Infinity;
          if (g1 >= 0) tc = t + rem * clamp(g0 < 0 ? g0 / (g0 - g1) : 0, 0, 1);
          tc = Math.min(tc, tMax);
          if (tc < t + rem) { h1 = tc - t; next = OFF; }
        } else if (st === OFF && !sync && iL1 < 0) {
          h1 = rem * clamp(iL > 0 ? iL / (iL - iL1) : 0, 0, 1); next = IDLE;
        }
        if (h1 < rem) {                                // redo the part before the event
          comp.load(snap);
          if (h1 > 0) {
            m.step(st, iL, vC, h1); iL1 = m.ni; vC1 = m.nv;
            comp.step(u0, u(t + h1, st, iL1, vC1), h1);
          } else { iL1 = iL; vC1 = vC; }
          if (next === IDLE) iL1 = 0;
        }
        iL = iL1; vC = vC1; t += h1; rem -= h1;
        if (recOn) pushCL(rec, t - tPre, iL, vC, st, seg, comp.y(), ramp(t), vrefAt(t));
        if (next !== st) {
          if (st === ON) dk = (t - tclk) / T;
          if (next === OFF && !sync && iL <= 0) { iL = 0; next = m.offRises(vC) ? OFF : IDLE; }
          st = next;
          if (recOn) pushCL(rec, t - tPre, iL, vC, st, seg, comp.y(), ramp(t), vrefAt(t));
        }
      }
    }
    if (isNaN(dk)) dk = cfg.Dmax;                      // never crossed: on until the clock (Dmax ≥ 1 case)
    duty[k] = dk;
    if (recOn) rec.x.duty.fill(dk, i0, rec.n);
    // the next clock edge starts from ON in the state machine above
    if (st === ON) st = OFF;
  }
  return { rec, models, nPer, N, T, tEnd: nPer * T, kEv, kBack, duty: duty.subarray(pre), pre };
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

/* ---------- period-map (sampled-data) model, VMC ---------- */
// Linearize one switching period of the switched model: x_{k+1} = Φ·x_k + Γ·d_k and
// vo_avg,k = C·x_k + Dd·d_k (vo averaged over period k). Then G(z) = C(zI − Φ)⁻¹Γ + Dd at
// z = e^{jωTs}. It holds in CCM and DCM and needs no averaging assumptions.
function periodMapVMC(p, D, N = 1000) {
  const T = 1 / p.fs;
  const F = (x, d) => {
    const m = makeModel({ ...p, D: d }), rec = makeRec(N + 64);
    const y = simulate(m, x, 1, N, rec);
    const a = new Float64Array(rec.n);
    for (let i = 0; i < rec.n; i++) a[i] = m.vout(rec.st[i], rec.iL[i], rec.vC[i]);
    return [y[0], y[1], statsArr(rec, a, 0, T).mean];
  };
  const th = theory({ ...p, D, T });
  const Is = Math.max(Math.abs(th.IL) + th.dIL, 1e-3), Vs = Math.max(th.Vo, p.Vg, 1e-3);
  const x = solveSteady(makeModel({ ...p, D }), [th.iL0, th.Vo], N, Is, Vs).x;
  const hI = 1e-6 * Is, hV = 1e-6 * Vs, hd = 1e-6;
  const y0 = F(x, D), yI = F([x[0] + hI, x[1]], D), yV = F([x[0], x[1] + hV], D), yD = F(x, D + hd);
  const Phi = [[(yI[0] - y0[0]) / hI, (yV[0] - y0[0]) / hV], [(yI[1] - y0[1]) / hI, (yV[1] - y0[1]) / hV]];
  const Gam = [(yD[0] - y0[0]) / hd, (yD[1] - y0[1]) / hd];
  const C = [(yI[2] - y0[2]) / hI, (yV[2] - y0[2]) / hV], Dd = (yD[2] - y0[2]) / hd;
  const tr = Phi[0][0] + Phi[1][1], det = Phi[0][0] * Phi[1][1] - Phi[0][1] * Phi[1][0];
  const eig = quadRoots(1, -tr, det);
  const G = f => {
    const z = Cx.exp({ re: 0, im: TWO_PI * f * T });
    const a = Cx.sub(z, Cx.of(Phi[0][0])), b = Cx.sub(z, Cx.of(Phi[1][1]));
    const dt = Cx.sub(Cx.mul(a, b), Cx.of(Phi[0][1] * Phi[1][0]));
    const x0 = Cx.div(Cx.add(Cx.scale(b, Gam[0]), Cx.of(Phi[0][1] * Gam[1])), dt);
    const x1 = Cx.div(Cx.add(Cx.of(Phi[1][0] * Gam[0]), Cx.scale(a, Gam[1])), dt);
    return Cx.add(Cx.add(Cx.scale(x0, C[0]), Cx.scale(x1, C[1])), Cx.of(Dd));
  };
  return { Phi, Gam, C, Dd, x, eig, G };
}
