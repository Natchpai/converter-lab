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
  return { allPass, lines: out };
}
