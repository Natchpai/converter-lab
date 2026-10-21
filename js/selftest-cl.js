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
  return { allPass, lines: out };
}
