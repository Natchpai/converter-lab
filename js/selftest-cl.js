'use strict';

/* ================= control self tests ================= */
// Pure: called from runSelfTests(), so they run in ?selftest and in Node.
function runControlTests() {
  const out = [];
  let allPass = true;
  const check = (pass, text) => { allPass = allPass && pass; out.push(`${pass ? 'PASS' : 'FAIL'} ${text}`); };
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
  const pc = x => (x * 100).toFixed(3) + '%';
  const base = { Vg: 12, D: 0.5, fs: 100e3, L: 100e-6, C: 470e-6, R: 10, rc: 0, rL: 0, ron: 0, ron2: 0, Vf: 0, sync: false, T: 1e-5 };
  const lossy = { rc: 0.05, rL: 0.05, ron: 0.03, ron2: 0, Vf: 0.5 };
  const fLow = 1e-3;   // "DC" for the transfer functions

  // Mean vo of the switched model in steady state at duty D (N chosen so D·N is an integer).
  const voSteady = (p, D, N = 2000) => {
    const q = { ...p, D }, m = makeModel(q), th = theory(q);
    const Is = Math.max(Math.abs(th.IL) + th.dIL, 1e-3), Vs = Math.max(th.Vo, q.Vg, 1e-3);
    const sol = solveSteady(m, [th.iL0, th.Vo], N, Is, Vs);
    const rec = makeRec(N + 64);
    simulate(m, sol.x, 1, N, rec);
    const a = new Float64Array(rec.n);
    for (let i = 0; i < rec.n; i++) a[i] = m.vout(rec.st[i], rec.iL[i], rec.vC[i]);
    return statsArr(rec, a, 0, q.T).mean;
  };

  // ---- averaged CCM plant vs closed forms (ideal parts)
  {
    const p = { ...base, topo: 'buck' }, pl = averagedPlant(p, 0.5);
    const g0 = Cx.abs(pl.Gvd(fLow)), f0 = pl.w0 / (2 * Math.PI), f0x = 1 / (2 * Math.PI * Math.sqrt(p.L * p.C));
    check(rel(g0, p.Vg) < 1e-6 && rel(f0, f0x) < 1e-9 && pl.zeros.length === 0,
      `plant ideal buck: Gvd(0)=${g0.toFixed(4)} (Vg), f0=${f0.toFixed(2)} Hz vs ${f0x.toFixed(2)} Hz, zeros=${pl.zeros.length}`);
  }
  {
    const p = { ...base, topo: 'boost', R: 50 }, D = 0.5, pl = averagedPlant(p, D);
    const g0 = Cx.abs(pl.Gvd(fLow)), gx = p.Vg / (1 - D) ** 2;
    const f0 = pl.w0 / (2 * Math.PI), f0x = (1 - D) / (2 * Math.PI * Math.sqrt(p.L * p.C));
    const rhp = pl.zeros.filter(z => z.re > 0).map(z => z.re)[0], rhpx = p.R * (1 - D) ** 2 / p.L;
    check(rel(g0, gx) < 1e-6 && rel(f0, f0x) < 1e-9 && rel(rhp, rhpx) < 1e-9,
      `plant ideal boost: Gvd(0)=${g0.toFixed(3)} vs ${gx}, f0 err ${pc(rel(f0, f0x))}, RHP zero ${(rhp / 2 / Math.PI).toFixed(1)} Hz vs ${(rhpx / 2 / Math.PI).toFixed(1)} Hz`);
  }
  {
    const p = { ...base, topo: 'bb', R: 20 }, D = 0.5, pl = averagedPlant(p, D);
    const g0 = Cx.abs(pl.Gvd(fLow)), gx = p.Vg / (1 - D) ** 2;
    const rhp = pl.zeros.filter(z => z.re > 0).map(z => z.re)[0], rhpx = p.R * (1 - D) ** 2 / (D * p.L);
    check(rel(g0, gx) < 1e-6 && rel(rhp, rhpx) < 1e-9,
      `plant ideal buck-boost: Gvd(0)=${g0.toFixed(3)} vs ${gx}, RHP zero ${(rhp / 2 / Math.PI).toFixed(1)} Hz vs ${(rhpx / 2 / Math.PI).toFixed(1)} Hz`);
  }
  {
    const p = { ...base, ...lossy, topo: 'buck' }, pl = averagedPlant(p, 0.5);
    const z = pl.zeros.map(z => -z.re)[0], zx = 1 / (p.rc * p.C);
    check(pl.zeros.length === 1 && rel(z, zx) < 1e-9, `plant non-ideal buck: ESR zero ${(z / 2 / Math.PI).toFixed(2)} Hz vs 1/(2π·rc·C) = ${(zx / 2 / Math.PI).toFixed(2)} Hz`);
  }
  // ---- Gvd(0) vs a finite difference of the switched model's steady state
  for (const [topo, R] of [['buck', 10], ['boost', 50], ['bb', 20]]) {
    const p = { ...base, ...lossy, topo, R }, D = 0.5, dD = 0.01;
    const fd = (voSteady(p, D + dD) - voSteady(p, D - dD)) / (2 * dD);
    const g0 = averagedPlant(p, D).Gvd(fLow).re;
    check(rel(g0, fd) < 0.02, `plant non-ideal ${topo}: Gvd(0)=${g0.toFixed(3)} vs switched dVo/dD=${fd.toFixed(3)} (${pc(rel(g0, fd))})`);
  }
  // ---- DCM reduced order: Gd0 = dVo/dD of the DCM formula
  for (const [topo, R] of [['buck', 100], ['boost', 500], ['bb', 200]]) {
    const p = { ...base, topo, R }, D = 0.5, dD = 1e-5;
    const th = theory({ ...p, D });
    const pl = dcmPlant(p, D, th);
    const fd = (theory({ ...p, D: D + dD }).Mdcm - theory({ ...p, D: D - dD }).Mdcm) * p.Vg / (2 * dD);
    check(th.dcm && rel(pl.Gd0, fd) < 1e-5, `plant DCM ${topo}: Gd0=${pl.Gd0.toFixed(4)} vs dVo/dD=${fd.toFixed(4)}, fp=${(pl.wp / 2 / Math.PI).toFixed(2)} Hz`);
  }
  // ---- D0 for a target output voltage
  {
    const a = solveD0({ ...base, topo: 'buck' }, 5), b = solveD0({ ...base, topo: 'boost', R: 50 }, 24);
    const c = solveD0({ ...base, ...lossy, topo: 'boost', R: 50 }, 400);
    check(a.ok && Math.abs(a.D - 5 / 12) < 1e-9 && b.ok && Math.abs(b.D - 0.5) < 1e-9 && !c.ok,
      `D0: buck 5 V -> ${a.D.toFixed(6)}, boost 24 V -> ${b.D.toFixed(6)}, lossy boost 400 V unreachable (max ${c.Vmax.toFixed(1)} V)`);
  }
  // ---- polynomial roots
  {
    const a = polyMul(polyMul([1, 1], [2, 1]), [5, 2, 1]);                 // (s+1)(s+2)(s²+2s+5)
    const b = polyMul([1e4, 1], [2e5, 1]);                                   // (s+1e4)(s+2e5)
    const want = [[-1, 0], [-2, 0], [-1, 2], [-1, -2]], want2 = [[-1e4, 0], [-2e5, 0]];
    const near = (rs, ws) => ws.every(([re, im]) => rs.some(r => Math.hypot(r.re - re, r.im - im) < 1e-7 * Math.max(1, Math.hypot(re, im))));
    check(near(polyRoots(a, 1), want) && near(polyRoots(b, 1e5), want2), 'polyRoots: (s+1)(s+2)(s²+2s+5) and (s+1e4)(s+2e5)');
  }
  // ---- k-factor design hits the target fc and PM
  const cfgOf = (comp, Vt) => ({ mode: 'vmc', Vt, Vref: VREF, Vm: 1, Dmax: 0.9, comp, R1: 10e3 });
  const designCase = (name, p, Vt, type, fc, pm) => {
    const L0 = buildLoop(p, cfgOf({ type: 'P', K: 1 }, Vt));
    const d = designComp(type, L0.plantK, fc, pm, L0.fmin);
    const L = buildLoop(p, cfgOf(d.comp, Vt));
    const expectPm = type === 'P' ? 180 + d.phi : type === 'I' ? 90 + d.phi : pm;
    const ok = rel(L.m.fc, fc) < 0.01 && Math.abs(L.m.pm - expectPm) < 0.5 && L.stable === (L.m.pm > 0);
    check(ok, `design ${name} ${COMP_TYPES[type].name}: fc ${fmtSI(L.m.fc, 'Hz')} (want ${fmtSI(fc, 'Hz')}), PM ${L.m.pm.toFixed(2)}° (want ${expectPm.toFixed(2)}°), GM ${L.m.gm.toFixed(1)} dB, ${L.stable ? 'stable' : 'unstable'}`);
    return { L, d };
  };
  const pB = { ...base, ...lossy, topo: 'buck' };
  designCase('buck', pB, 5, 'T3', 10e3, 60);
  designCase('buck', pB, 5, 'T2', 10e3, 45);
  designCase('DCM buck', { ...base, topo: 'buck', R: 100 }, 7, 'PI', 300, 60);
  designCase('buck', pB, 5, 'I', 100, 60);
  designCase('boost', { ...base, ...lossy, topo: 'boost', R: 50 }, 24, 'T3', 2e3, 55);
  designCase('buck-boost', { ...base, ...lossy, topo: 'bb', R: 20 }, 12, 'T3', 2e3, 55);
  designCase('DCM boost', { ...base, topo: 'boost', R: 500 }, 30, 'T2', 2e3, 60);
  // ideal buck (no ESR zero) above f0: Type 2 cannot add 90°, so PM < 0 and the poles agree
  {
    const p = { ...base, topo: 'buck' }, L0 = buildLoop(p, cfgOf({ type: 'P', K: 1 }, 5));
    const d = designComp('T2', L0.plantK, 10e3, 60, L0.fmin), L = buildLoop(p, cfgOf(d.comp, 5));
    check(!L.stable && L.m.pm < 0 && d.notes.length > 0, `stability: ideal buck Type 2 at 10 kHz -> PM ${L.m.pm.toFixed(1)}°, ${L.stable ? 'stable' : 'unstable'} (want unstable)`);
  }
  // PI below a resonance that lifts |T| above 0 dB: extra crossover, unstable, warned
  {
    const L0 = buildLoop(pB, cfgOf({ type: 'P', K: 1 }, 5));
    const d = designComp('PI', L0.plantK, 300, 60, L0.fmin), L = buildLoop(pB, cfgOf(d.comp, 5));
    check(!L.stable && L.m.cross.length > 1 && L.warn.some(w => /crosses 0 dB/.test(w)), `stability: buck PI at 300 Hz -> ${L.m.cross.length} crossovers, last ${fmtSI(L.m.fc, 'Hz')}, ${L.stable ? 'stable' : 'unstable'} (want unstable + warning)`);
  }
  // ---- op-amp part values realize H·Gc
  for (const type of ['P', 'I', 'PI', 'T2', 'T3']) {
    const L0 = buildLoop(pB, cfgOf({ type: 'P', K: 1 }, 5));
    const d = designComp(type, L0.plantK, type === 'PI' || type === 'I' ? 300 : 10e3, 50, L0.fmin);
    const H = VREF / 5, v = opampValues(d.comp, H, 10e3), cn = compNorm(d.comp);
    let worst = 0;
    for (const f of [10, 300, 3e3, 3e4, 3e5]) {
      const want = Cx.scale(compEval(cn, f), H), got = opampEval(v, f);
      worst = Math.max(worst, Cx.abs(Cx.sub(got, want)) / Cx.abs(want));
    }
    check(v.ok && worst < 1e-9, `op-amp ${COMP_TYPES[type].name}: Zf/Zin vs H·Gc worst error ${worst.toExponential(1)}`);
  }
  // ---- time-domain compensator (Tustin) vs analytic step responses
  {
    const wz = TWO_PI * 1e3, wp = TWO_PI * 20e3, h = 1 / (200 * wp);
    const c = makeCompSim({ G: 1, n: 0, wz: [wz], wp: [wp] }, -1e9, 1e9);
    c.init(0);
    let t = 0, err = 0;
    for (let k = 0; k < 2000; k++) {
      c.step(1, 1, h); t += h;
      // the trapezoid sees the step as a ramp over the first step: compare with t − h/2
      if (t > 10 * h) err = Math.max(err, Math.abs(c.y() - (wp / wz + (1 - wp / wz) * (1 - Math.exp(-wp * (t - h / 2))))));
    }
    const ci = makeCompSim({ G: 2, n: 1, wz: [], wp: [] }, -1e9, 1e9);
    ci.init(0); for (let k = 0; k < 100; k++) ci.step(1, 1, 1e-6);
    check(err < 1e-4 * (wp / wz) && Math.abs(ci.y() - 2e-4) < 1e-15, `compensator sim: lead section step error ${(err / (wp / wz)).toExponential(1)} (rel), integrator ramp exact`);
  }
  // ---- closed-loop sim with a frozen integrator at D0 = open-loop steady state
  {
    const L = buildLoop(pB, cfgOf({ type: 'T3', K: 1, fz1: 1e3, fz2: 1e3, fp1: 2e4, fp2: 5e4 }, 5));
    const Lf = { ...L, cn: { G: 0, n: 1, wz: [], wp: [] } };
    const res = computeResCL(Lf, { event: 'load', size: 0, back: false, nPer: 40, N: 400, pre: 60 });
    const ol = computeRes({ ...L.p, D: L.D0 }, 'steady');
    const e = rel(res.met.vo.mean, ol.met.vo.mean);
    check(e < 2e-4 && Math.abs(res.met.Dfinal - L.D0) < 1e-9, `closed-loop sim, frozen vc: Vo ${res.met.vo.mean.toFixed(5)} vs open loop ${ol.met.vo.mean.toFixed(5)} (${pc(e)}), duty ${res.met.Dfinal.toFixed(6)} vs D0 ${L.D0.toFixed(6)}`);
  }
  // ---- VMC closed loop: load step and step back settle to Vo*, final duty near D0
  const clCase = (name, p, Vt, fc, pm) => {
    const L0 = buildLoop(p, cfgOf({ type: 'P', K: 1 }, Vt));
    const d = designComp('T3', L0.plantK, fc, pm, L0.fmin);
    const L = buildLoop(p, cfgOf(d.comp, Vt));
    const sz = clSizes(L, 'auto');
    const t0 = performance.now();
    const res = computeResCL(L, { event: 'load', size: 100, back: true, ...sz });
    const ms = performance.now() - t0, mt = res.met, sA = mt.segs[1], sB = mt.segs[2];
    const ok = rel(sA.final, Vt) < 0.005 && rel(sB.final, Vt) < 0.005 && sA.settled && sB.settled && rel(mt.Dfinal, L.D0) < 0.01;
    check(ok, `closed loop ${name}: load x2 -> Vo ${sA.final.toFixed(4)} V (dip ${fmtSI(sA.under, 'V')}, settle ${fmtSI(sA.settle, 's')}), back -> ${sB.final.toFixed(4)} V, D ${mt.Dfinal.toFixed(4)} vs D0 ${L.D0.toFixed(4)}, ${sz.nPer}x${sz.N} steps ${ms.toFixed(0)} ms`);
  };
  clCase('buck', pB, 5, 10e3, 60);
  // the transient must not depend on the step size (regression: period-average boundaries)
  {
    const pb = { ...base, ...lossy, topo: 'boost', R: 50 }, L0 = buildLoop(pb, cfgOf({ type: 'P', K: 1 }, 24));
    const L = buildLoop(pb, cfgOf(designComp('T3', L0.plantK, 2e3, 55, L0.fmin).comp, 24));
    const dip = N => computeResCL(L, { event: 'load', size: 100, back: false, nPer: 400, N, pre: 60 }).met.segs[1].under;
    const a = dip(50), b = dip(400);
    check(rel(a, b) < 0.02, `closed loop step-size check: boost dip ${fmtSI(a, 'V')} at N=50 vs ${fmtSI(b, 'V')} at N=400`);
  }
  clCase('boost', { ...base, ...lossy, topo: 'boost', R: 50 }, 24, 2e3, 55);
  clCase('buck-boost', { ...base, ...lossy, topo: 'bb', R: 20 }, 12, 2e3, 55);
  // ---- soft-start from zero reaches the target without a large overshoot
  {
    const L0 = buildLoop(pB, cfgOf({ type: 'P', K: 1 }, 5));
    const L = buildLoop(pB, cfgOf(designComp('T3', L0.plantK, 10e3, 60, L0.fmin).comp, 5));
    const res = computeResCL(L, { event: 'start', size: 0, back: false, nPer: 600, N: 200, pre: 0 });
    const sg = res.met.segs[0];
    check(rel(sg.final, 5) < 0.005 && sg.over < 0.05 * 5, `soft-start buck: final ${sg.final.toFixed(4)} V, overshoot ${fmtSI(sg.over, 'V')}`);
  }
  // ---- period-map model vs averaged model (CCM) and vs DCM reduced order
  for (const [topo, R, Vt] of [['buck', 10, 5], ['boost', 50, 24]]) {
    const p = { ...base, ...lossy, topo, R }, D = solveD0(p, Vt).D;
    const pm = periodMapVMC(p, D), av = averagedPlant({ ...p, D }, D);
    let worst = 0;
    for (const f of [10, 100, 1e3, 3e3, 5e3]) worst = Math.max(worst, Math.abs(Cx.db(pm.G(f)) - Cx.db(av.Gvd(f))));
    check(worst < 0.5, `period map ${topo} CCM: |G| vs averaged Gvd worst ${worst.toFixed(3)} dB up to fs/20`);
  }
  for (const [topo, R] of [['buck', 100], ['boost', 500], ['bb', 200]]) {
    const p = { ...base, topo, R }, th = theory({ ...p, D: 0.5 }), pm = periodMapVMC(p, 0.5);
    const lam = Math.max(...pm.eig.map(z => z.re)), wp = -Math.log(lam) * p.fs, wx = dcmPlant(p, 0.5, th).wp;
    check(rel(wp, wx) < 0.05, `period map ${topo} DCM: slow pole ${(wp / TWO_PI).toFixed(2)} Hz vs reduced order ${(wx / TWO_PI).toFixed(2)} Hz (${pc(rel(wp, wx))})`);
  }

  // ---- peak current mode
  const pcCfg = (comp, Vt, mSe) => ({ ...cfgOf(comp, Vt), mode: 'pcmc', Ri: 0.5, mSe, vcMax: 4 });
  const pcDesign = (p, Vt, mSe, fc, pm) => {
    const L0 = buildLoop(p, pcCfg({ type: 'P', K: 1 }, Vt, mSe));
    return buildLoop(p, pcCfg(designComp('T2', L0.plantK, fc, pm, L0.fmin).comp, Vt, mSe));
  };
  // current-loop pole of the period map vs the analytic α = −(Sf − Se)/(Sn + Se)
  for (const [name, p, Vt] of [['buck', { ...base, topo: 'buck' }, 5], ['boost', { ...base, topo: 'boost', R: 50 }, 24], ['buck-boost', { ...base, topo: 'bb', R: 20 }, 12]]) {
    const pl = buildLoop(p, pcCfg({ type: 'P', K: 1 }, Vt, 0.5)).plant;
    check(pl.ok && rel(pl.lamC.re, pl.alpha) < 0.02 && Math.abs(pl.lamC.im) < 1e-9,
      `PCMC ${name} Se = Sf/2: current-loop pole ${pl.lamC.re.toFixed(4)} (period map) vs α ${pl.alpha.toFixed(4)}, D ${pl.D.toFixed(4)}, Qp ${pl.Qp.toFixed(2)}`);
  }
  // vc -> vo DC gain of the period map vs the steady state moved by a small step in Vo*
  {
    const p = { ...base, ...lossy, topo: 'buck' }, Vt = 5, dV = 0.01, cf = pcCfg({ type: 'P', K: 1 }, Vt, 0.5);
    const pl = buildLoop(p, cf).plant, N = clamp(stepsPerPeriod(p, 0.3, 400, 4000), 400, 4000);
    const vcAt = v => pcmcOperatingPoint(p, { ...cf, Vt: v }, pl.Se, solveD0(p, v).D, N).vc;
    const fd = 2 * dV / (vcAt(Vt + dV) - vcAt(Vt - dV)), g0 = pl.Gvd(fLow).re;
    check(rel(g0, fd) < 0.02, `PCMC buck: Gvc(0) ${g0.toFixed(3)} (period map) vs dVo/dvc ${fd.toFixed(3)} of the switched steady state (${pc(rel(g0, fd))})`);
  }
  // closed loop with an auto-designed Type 2: load step and step back settle to Vo*
  for (const [name, p, Vt, fc] of [['buck', pB, 5, 10e3], ['boost', { ...base, ...lossy, topo: 'boost', R: 50 }, 24, 2e3]]) {
    const L = pcDesign(p, Vt, 0.5, fc, 60), sz = clSizes(L, 'auto');
    const t0 = performance.now();
    const mt = computeResCL(L, { event: 'load', size: 100, back: true, ...sz }).met, ms = performance.now() - t0;
    const sA = mt.segs[1], sB = mt.segs[2];
    const ok = L.stable && rel(L.m.fc, fc) < 0.01 && Math.abs(L.m.pm - 60) < 0.5 && rel(sA.final, Vt) < 0.005 && rel(sB.final, Vt) < 0.005 && sA.settled && sB.settled;
    check(ok, `PCMC closed loop ${name} Type 2: fc ${fmtSI(L.m.fc, 'Hz')}, PM ${L.m.pm.toFixed(1)}°, load x2 -> ${sA.final.toFixed(4)} V (dip ${fmtSI(sA.under, 'V')}), back -> ${sB.final.toFixed(4)} V, ${sz.nPer}x${sz.N} steps ${ms.toFixed(0)} ms`);
  }
  // subharmonic oscillation: buck at D ≈ 0.67, same compensator, Se = 0 vs Se = Sf/2
  {
    const p = { ...base, topo: 'buck' }, Vt = 8, comp = pcDesign(p, Vt, 0.5, 2e3, 60).cfg.comp;
    const alt = mSe => {
      const L = buildLoop(p, pcCfg(comp, Vt, mSe));
      const sim = simulateCL(L, { event: 'load', size: 20, back: false, nPer: 200, N: 200, pre: 60 });
      const r = sim.rec, T = sim.T, edge = [];
      for (let k = 0, i = 0; k < sim.nPer; k++) { while (i < r.n - 1 && r.t[i] < k * T - 1e-9 * T) i++; edge.push(r.iL[i]); }
      let a = 0;
      for (let k = sim.nPer - 20; k < sim.nPer; k++) a = Math.max(a, Math.abs(edge[k] - edge[k - 1]));
      return { a: a / theory({ ...p, D: L.plant.D }).dIL, L };
    };
    const u = alt(0), s = alt(0.5);
    check(u.a > 0.05 && s.a < 0.005 && Cx.abs(u.L.plant.lamC) > 1 && !u.L.stable && u.L.warn.some(w => /Subharmonic/.test(w)) && s.L.stable,
      `PCMC subharmonic, buck D ${s.L.plant.D.toFixed(3)}: iL change between clock edges ${(u.a * 100).toFixed(1)} % of ΔiL at Se = 0 (α ${u.L.plant.alpha.toFixed(2)}), ${(s.a * 100).toFixed(4)} % at Se = Sf/2`);
  }
  // DCM: iL starts from 0 each period, so the current-loop pole is 0; slopes at the real Vo
  {
    const p = { ...base, topo: 'buck', R: 100 }, Vt = 7, pl = buildLoop(p, pcCfg({ type: 'P', K: 1 }, Vt, 0.5)).plant;
    const sfx = 0.5 * Vt / p.L;                                    // ideal buck: Sf = Ri·Vo/L
    const L = pcDesign(p, Vt, 0.5, 2e3, 60), mt = computeResCL(L, { event: 'load', size: 100, back: true, ...clSizes(L, 'auto') }).met;
    const ok = pl.ok && pl.dcm && Cx.abs(pl.lamC) < 1e-6 && rel(pl.Sf, sfx) < 0.01 && mt.mode === 'DCM'
      && rel(mt.segs[1].final, Vt) < 0.005 && rel(mt.segs[2].final, Vt) < 0.005 && mt.segs[1].settled && mt.segs[2].settled;
    check(ok, `PCMC DCM buck: pole ${pl.lamC.re.toExponential(1)} (want 0), Sf ${fmtSI(pl.Sf, 'V/s')} vs Ri·Vo/L ${fmtSI(sfx, 'V/s')}, Type 2 load x2 -> ${mt.segs[1].final.toFixed(4)} V, back -> ${mt.segs[2].final.toFixed(4)} V (${mt.mode})`);
    const Lb = buildLoop({ ...base, topo: 'boost', R: 500 }, pcCfg({ type: 'P', K: 1 }, 30, 0.5));
    check(Lb.plant.dcm && !Lb.marks.some(m => m.rhp), `PCMC DCM boost: markers ${Lb.marks.map(m => m.text).join(', ')} (no CCM RHP zero)`);
  }
  // no steady state (target above the reachable output): finite plant, flagged and warned
  {
    const L = buildLoop({ ...base, ...lossy, topo: 'boost', R: 50 }, pcCfg({ type: 'T2', K: 1, fz1: 1e3, fp1: 5e4 }, 400, 0.5));
    const fin = [10, 100, 1e3, 1e4, 4e4].every(f => { const g = L.plant.Gvd(f); return isFinite(g.re) && isFinite(g.im); });
    check(!L.plant.ok && fin && isFinite(L.plant.vc0) && L.warn.some(w => /did not converge/.test(w)),
      `PCMC lossy boost 400 V: ok=${L.plant.ok}, Gvc finite=${fin}, vc ${fmtSI(L.plant.vc0, 'V')}, D ${L.plant.D.toFixed(3)}, warned`);
  }
  // input step and soft-start with Type 2
  {
    const L = pcDesign(pB, 5, 0.5, 10e3, 60), sz = clSizes(L, 'auto');
    const v = computeResCL(L, { event: 'vin', size: 25, back: true, ...sz }).met;
    const st = computeResCL(L, { event: 'start', size: 0, back: false, nPer: 600, N: 200, pre: 0 }).met.segs[0];
    const ok = v.segs.slice(1).every(g => rel(g.final, 5) < 0.005 && g.settled) && rel(st.final, 5) < 0.005 && st.over < 0.05 * 5;
    check(ok, `PCMC buck Type 2: Vin +25 % -> ${v.segs[1].final.toFixed(4)} V (peak ${fmtSI(v.segs[1].over, 'V')}), back -> ${v.segs[2].final.toFixed(4)} V; soft-start -> ${st.final.toFixed(4)} V, overshoot ${fmtSI(st.over, 'V')}`);
  }
  // leading-edge blanking: no effect below D0; above it pulses of the min on-time are skipped
  {
    const comp = pcDesign(pB, 5, 0.5, 10e3, 60).cfg.comp;
    const run = (Vt, tb) => {
      const L = buildLoop(pB, { ...pcCfg(comp, Vt, 0.5), tb });
      const res = computeResCL(L, { event: 'load', size: 50, back: true, nPer: 300, N: 200, pre: 60 });
      return { L, mt: res.met, duty: res.sim.duty };
    };
    const a = run(5, 0), b = run(5, 0.05);
    const same = rel(b.mt.segs[2].final, a.mt.segs[2].final) < 1e-6 && Math.abs(b.mt.Dfinal - a.mt.Dfinal) < 1e-6;
    check(same, `PCMC blanking tb = 0.05 < D0: Vo ${b.mt.segs[2].final.toFixed(6)} V vs ${a.mt.segs[2].final.toFixed(6)} V at tb = 0, D ${b.mt.Dfinal.toFixed(6)} vs ${a.mt.Dfinal.toFixed(6)}`);
    const c = run(1, 0.15), fin = c.mt.segs[c.mt.segs.length - 1].final, ds = Array.from(c.duty.slice(-100));
    const nSkip = ds.filter(d => d === 0).length, dOn = Math.min(...ds.filter(d => d > 0));
    check(nSkip > 0 && dOn >= 0.15 - 1e-9 && rel(fin, 1) < 0.02 && c.L.warn.some(w => /skips pulses/.test(w)),
      `PCMC blanking tb = 0.15, Vo* = 1 V (D0 ${c.L.D0.toFixed(3)}): ${nSkip} of the last 100 pulses skipped, shortest pulse ${dOn.toFixed(4)} (min on-time), Vo ${fin.toFixed(4)} V`);
    // sync rectifier: a skipped pulse leaves Q2 on, iL goes negative (FCCM); Vo must still hold
    const pS = { ...pB, sync: true, Vf: 0, ron2: 0.03 }, compS = pcDesign(pS, 5, 0.5, 10e3, 60).cfg.comp;
    const LS = buildLoop(pS, { ...pcCfg(compS, 1, 0.5), tb: 0.15 }), rS = computeResCL(LS, { event: 'load', size: 50, back: true, nPer: 300, N: 200, pre: 60 });
    const dS = Array.from(rS.sim.duty.slice(-100)), finS = rS.met.segs.map(g => g.final), kS = dS.filter(d => d === 0).length;
    check(kS > 0 && Math.min(...dS.filter(d => d > 0)) >= 0.15 - 1e-9 && finS.every(v => rel(v, 1) < 0.02),
      `PCMC blanking sync tb = 0.15, Vo* = 1 V: ${kS} of 100 pulses skipped, Vo ${finS.map(v => v.toFixed(4)).join(' / ')} V (before / load step / back), ${rS.met.mode}`);
    // no steady state (plant gain 0): k-factor design keeps a finite gain
    const dz = designComp('T2', () => Cx.of(0), 1e3, 60, 10);
    check(dz.comp.K === 1 && isFinite(dz.comp.fz1), `k-factor with a zero plant gain: K kept at ${dz.comp.K} (${dz.notes.slice(-1)[0]})`);
  }

  // ---- average current mode
  const acCfg = (ci, comp, Vt) => ({ ...cfgOf(comp, Vt), mode: 'acmc', Ri: 0.5, vcMax: 4, ci, fciT: 16e3 });
  // current loop first, then the voltage loop with the current loop closed
  const acDesign = (p, Vt, fci, fcv, ti = 'T2', tv = 'T2') => {
    const Li = buildLoop(p, acCfg({ type: 'P', K: 1 }, { type: 'P', K: 1 }, Vt));
    const ci = designComp(ti, Li.plantKi, fci, 60, Li.fmin).comp;
    const Lv = buildLoop(p, acCfg(ci, { type: 'P', K: 1 }, Vt));
    return buildLoop(p, acCfg(ci, designComp(tv, Lv.plantK, fcv, 60, Lv.fmin).comp, Vt));
  };
  // Gid of the one-period map (used in DCM) vs the averaged Gid (CCM)
  for (const [topo, R, Vt] of [['buck', 10, 5], ['boost', 50, 24]]) {
    const p = { ...base, ...lossy, topo, R }, D = solveD0(p, Vt).D;
    const pm = periodMapVMC(p, D), av = averagedPlant({ ...p, D }, D);
    let worst = 0;
    for (const f of [10, 100, 1e3, 3e3, 5e3]) worst = Math.max(worst, Math.abs(Cx.db(pm.Gout[1](f)) - Cx.db(av.Gid(f))));
    check(worst < 0.5, `period map ${topo} CCM: |Gid| vs averaged Gid worst ${worst.toFixed(3)} dB up to fs/20`);
  }
  // both loops hit their targets; low-frequency outer plant = Gvd/(Ri·Gid); poles agree with margins
  for (const [name, p, Vt, fcv] of [['buck', pB, 5, 4e3], ['boost', { ...base, ...lossy, topo: 'boost', R: 50 }, 24, 2e3]]) {
    const L = acDesign(p, Vt, 16e3, fcv);
    const lo = rel(Cx.abs(L.Gvi(fLow)), Cx.abs(Cx.div(L.plant.Gvd(fLow), Cx.scale(L.plant.Gid(fLow), 0.5))));
    const ok = rel(L.mi.fc, 16e3) < 0.01 && Math.abs(L.mi.pm - 60) < 0.5 && rel(L.m.fc, fcv) < 0.01 && Math.abs(L.m.pm - 60) < 0.5 && lo < 1e-3 && L.stable;
    // raise the voltage-loop gain past its gain margin: the two-loop poles must go unstable
    const Lx = buildLoop(p, { ...L.cfg, comp: { ...L.cfg.comp, K: L.cfg.comp.K * 10 ** (L.m.gm / 20) * 1.5 } });
    check(ok && !Lx.stable && Lx.poles.some(r => r.re > 0),
      `ACMC ${name}: current loop fc ${fmtSI(L.mi.fc, 'Hz')} PM ${L.mi.pm.toFixed(2)}°, voltage loop fc ${fmtSI(L.m.fc, 'Hz')} PM ${L.m.pm.toFixed(2)}° GM ${L.m.gm.toFixed(1)} dB; Gvi(0) vs Gvd/(Ri·Gid) ${pc(lo)}; gain ×1.5 past GM -> ${Lx.stable ? 'stable' : 'RHP poles'}`);
  }
  // closed loop: load step and step back settle, average Ri·iL follows iref
  for (const [name, p, Vt, fcv] of [['buck', pB, 5, 4e3], ['boost', { ...base, ...lossy, topo: 'boost', R: 50 }, 24, 2e3], ['DCM buck', { ...base, topo: 'buck', R: 100 }, 7, 2e3]]) {
    const L = acDesign(p, Vt, 16e3, fcv), sz = clSizes(L, 'auto');
    const t0 = performance.now();
    const res = computeResCL(L, { event: 'load', size: 100, back: true, ...sz }), ms = performance.now() - t0, mt = res.met;
    const tA = res.tEnd - 10 * res.T, iS = statsArr(res.rec, res.sigArray('isense'), tA, res.tEnd).mean, iR = statsArr(res.rec, res.sigArray('iref'), tA, res.tEnd).mean;
    const sA = mt.segs[1], sB = mt.segs[2];
    const ok = rel(sA.final, Vt) < 0.005 && rel(sB.final, Vt) < 0.005 && sA.settled && sB.settled && rel(iS, iR) < 0.005 && rel(mt.Dfinal, L.D0) < 0.01;
    check(ok, `ACMC closed loop ${name} (${L.plant.kind}): load x2 -> ${sA.final.toFixed(4)} V (dip ${fmtSI(sA.under, 'V')}), back -> ${sB.final.toFixed(4)} V, Ri·iL ${fmtSI(iS, 'V', 4)} vs iref ${fmtSI(iR, 'V', 4)}, ${sz.nPer}x${sz.N} steps ${ms.toFixed(0)} ms`);
  }
  // closed-loop Zout vs the switching sim: a 5 % load step (R -> R/1.05, Δio = Vt·0.05/R).
  // Model: Δvo(t) = −Δio·z(t), z = step response of Zcl = (2/π)∫ Re Zcl(jω)·sin(ωt)/ω dω up to fs/2,
  // averaged over each period like the per-period average of the simulated vo.
  const zclStep = (L, name) => {
    const p = L.p, T = 1 / p.fs, n = 20000, dw = TWO_PI * p.fs / 2 / n, reZ = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) reZ[i] = L.Zcl(Math.max(i, 1e-6) * dw / TWO_PI).re;
    const z = t => { let a = 0.5 * reZ[0] * t; for (let i = 1; i <= n; i++) a += (i === n ? 0.5 : 1) * reZ[i] * Math.sin(i * dw * t) / (i * dw); return a * dw * 2 / Math.PI; };
    const nPer = 200, sim = computeResCL(L, { event: 'load', size: 5, back: false, nPer, N: 200, pre: 60 }), avg = sim.met.avg, kEv = sim.sim.kEv;
    let base = 0; for (let k = kEv - 10; k < kEv; k++) base += avg[k] / 10;
    const dIo = L.cfg.Vt * 0.05 / p.R;
    let dipS = 0, dipM = 0, err = 0;
    for (let k = kEv; k < nPer; k++) {
      const ds = avg[k] - base, t0 = (k - kEv) * T;
      const dm = -dIo * (z(t0 + 0.125 * T) + z(t0 + 0.375 * T) + z(t0 + 0.625 * T) + z(t0 + 0.875 * T)) / 4;
      dipS = Math.min(dipS, ds); dipM = Math.min(dipM, dm); err = Math.max(err, Math.abs(ds - dm));
    }
    const eDip = rel(dipS, dipM), eW = err / Math.abs(dipM);
    check(eDip < 0.1 && eW < 0.15, `${name} closed-loop Zout: 5 % load step dip ${fmtSI(-dipS, 'V')} (switching sim) vs ${fmtSI(-dipM, 'V')} from Zcl (${pc(eDip)}), worst gap ${pc(eW)} of the dip`);
  };
  {
    const Lv0 = buildLoop(pB, cfgOf({ type: 'P', K: 1 }, 5));
    // fc well below fs/10: at fc = fs/10 the averaged model gives a dip about 16-22 % smaller than the switching sim
    zclStep(buildLoop(pB, cfgOf(designComp('T3', Lv0.plantK, 3e3, 60, Lv0.fmin).comp, 5)), 'VMC buck Type 3 fc 3 kHz');
    const LA = acDesign(pB, 5, 16e3, 4e3);
    zclStep(LA, 'ACMC buck fc 4 kHz');
    // ideal buck: with the current loop closed (integrator in Gci) the converter is a current source into R, so Zoi(0) = R
    const Li = acDesign({ ...base, topo: 'buck' }, 5, 16e3, 2e3), z0 = Cx.abs(Li.Zoi(fLow));
    // current amplifier op-amp: Zf/Zin = Gci
    let wo = 0;
    for (const f of [100, 1e3, 1e4, 5e4]) wo = Math.max(wo, rel(Cx.abs(opampEval(LA.opampI, f)), Cx.abs(LA.Gci(f))));
    check(rel(z0, 10) < 1e-3 && wo < 1e-6, `ACMC ideal buck Zoi(0) ${fmtSI(z0, 'Ω', 5)} vs R = 10 Ω; current-amp op-amp Zf/Zin vs Gci worst ${pc(wo)}`);
  }
  // slope rule: buck at D = 0.67, current-amp gain at fs set for slope ratio 0.8 and 2.0
  {
    const p = { ...base, topo: 'buck' }, L0 = acDesign(p, 8, 16e3, 2e3), g0 = L0.slope.ratio;
    const alt = ratio => {
      const L = buildLoop(p, { ...L0.cfg, ci: { ...L0.cfg.ci, K: L0.cfg.ci.K * ratio / g0 } });
      const sim = simulateCL(L, { event: 'load', size: 10, back: false, nPer: 300, N: 300, pre: 60 });
      let a = 0; for (let k = sim.nPer - 20; k < sim.nPer; k++) a = Math.max(a, Math.abs(sim.duty[k] - sim.duty[k - 1]));
      return { a, warned: L.warn.some(w => /Slope rule/.test(w)), r: L.slope.ratio };
    };
    const lo = alt(0.8), hi = alt(2);
    check(lo.a < 1e-6 && !lo.warned && hi.a > 0.05 && hi.warned,
      `ACMC slope rule, buck D 0.667: ratio ${lo.r.toFixed(2)} -> duty change between periods ${lo.a.toExponential(1)}, ratio ${hi.r.toFixed(2)} -> ${hi.a.toFixed(3)} (period-2) and warned`);
  }

  // ---- FRA on the switching simulation vs the models
  const fraCase = (name, L, view, freqs, dbMax, degMax, extra) => {
    const S = fraSetup(L, view);
    let wDb = 0, wDeg = 0, ms = 0, cons = 0;
    for (const f of freqs) {
      const r = fraPoint(L, f, { view });
      ms += r.ms;
      wDb = Math.max(wDb, Math.abs(Cx.db(r.T) - Cx.db(S.T(r.f))), Math.abs(Cx.db(r.P) - Cx.db(S.P(r.f))));
      wDeg = Math.max(wDeg, Math.abs(wrap180(Cx.deg(r.T) - Cx.deg(S.T(r.f)))), Math.abs(wrap180(Cx.deg(r.P) - Cx.deg(S.P(r.f)))));
      if (extra) cons = Math.max(cons, extra(r));
    }
    const ok = wDb < dbMax && wDeg < degMax && (!extra || cons < 0.01);
    check(ok, `FRA ${name}: ${freqs.length} points ${freqs.map(f => fmtSI(f, 'Hz', 2)).join(', ')}: worst ${wDb.toFixed(2)} dB, ${wDeg.toFixed(1)}° vs the model (limit ${dbMax} dB, ${degMax}°)${extra ? `, T vs Gc·H·plant/VM ${pc(cons)}` : ''}, ${ms.toFixed(0)} ms`);
  };
  {
    const L0 = buildLoop(pB, cfgOf({ type: 'P', K: 1 }, 5));
    const L = buildLoop(pB, cfgOf(designComp('T3', L0.plantK, 10e3, 60, L0.fmin).comp, 5));
    // the compensator is known exactly, so the measured T must equal Gc·H·(measured Gvd)/VM
    const tCons = r => Cx.abs(Cx.sub(Cx.div(r.T, Cx.scale(Cx.mul(L.Gc(r.f), r.P), L.H * L.Fm)), Cx.of(1)));
    fraCase('VMC buck CCM', L, 'outer', [1e3, 3e3, 6e3, 1e4], 1, 5, tCons);
    const pD = { ...base, topo: 'buck', R: 100 }, LD0 = buildLoop(pD, cfgOf({ type: 'P', K: 1 }, 7));
    fraCase('VMC buck DCM', buildLoop(pD, cfgOf(designComp('PI', LD0.plantK, 1e3, 60, LD0.fmin).comp, 7)), 'outer', [1e3, 4e3, 8e3], 2, 5);
    fraCase('PCMC buck', pcDesign(pB, 5, 0.5, 10e3, 60), 'outer', [1e3, 4e3, 1e4], 0.5, 3);
    const LA = acDesign(pB, 5, 16e3, 4e3);
    fraCase('ACMC buck voltage loop', LA, 'outer', [1e3, 4e3, 8e3], 1, 5);
    fraCase('ACMC buck current loop', LA, 'inner', [2e3, 8e3, 1.6e4], 1.5, 5);
  }
  return { allPass, lines: out };
}
