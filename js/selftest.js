'use strict';

/* ================= self test (?selftest) ================= */
// Pure: runs in the page (?selftest) and in Node (tests/run.js).
function runSelfTests() {
  const base = { Vg: 12, D: 0.5, fs: 100e3, L: 100e-6, C: 470e-6, rc: 0, rL: 0, ron: 0, ron2: 0, Vf: 0 };
  const cases = [
    ['buck', 10, false, 'CCM'], ['buck', 100, false, 'DCM'],
    ['boost', 50, false, 'CCM'], ['boost', 500, false, 'DCM'],
    ['bb', 20, false, 'CCM'], ['bb', 200, false, 'DCM'],
    ['buck', 100, true, 'FCCM'], ['boost', 500, true, 'FCCM'], ['bb', 200, true, 'FCCM'],
  ];
  const out = [];
  let allPass = true;
  for (const [topo, R, sync, want] of cases) {
    const p = { ...base, topo, R, sync, T: 1 / base.fs };
    const t0 = performance.now();
    const res = computeRes(p, 'steady');
    const ms = performance.now() - t0;
    const th = res.th, met = res.met;
    const e = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);
    const eV = e(met.vo.mean, th.Vout), eI = e(met.iL.mean, th.IL), edI = e(met.iL.pp, th.dIL);
    const pass = eV < 0.02 && eI < 0.02 && edI < 0.02 && met.mode === want && res.ok;
    allPass = allPass && pass;
    out.push(`${pass ? 'PASS' : 'FAIL'} ${topo.padEnd(5)} R=${String(R).padEnd(4)} ${sync ? 'sync ' : 'async'} mode=${met.mode.padEnd(4)}(want ${want}) ` +
      `Vo ${met.vo.mean.toFixed(4)} vs ${th.Vout.toFixed(4)} (${(eV * 100).toFixed(3)}%)  IL err ${(eI * 100).toFixed(3)}%  dIL err ${(edI * 100).toFixed(3)}%  ${ms.toFixed(1)} ms`);
  }
  // non-ideal sanity: buck with losses
  const pn = { ...base, topo: 'buck', R: 10, sync: false, T: 1e-5, rc: 0.05, rL: 0.05, ron: 0.03, ron2: 0, Vf: 0.5 };
  const rn = computeRes(pn, 'steady');
  const nPass = rn.met.eta < 1 && rn.met.eta > 0.7 && rn.met.vo.mean < 6 && rn.met.vo.mean > 5;
  allPass = allPass && nPass;
  out.push(`${nPass ? 'PASS' : 'FAIL'} non-ideal buck: Vo=${rn.met.vo.mean.toFixed(4)} V, eta=${(rn.met.eta * 100).toFixed(2)} %`);
  // startup ends near steady state
  const rs = computeRes({ ...base, topo: 'boost', R: 50, sync: false, T: 1e-5 }, 'startup', 'auto');
  const sPass = Math.abs(rs.met.vo.mean - 24) / 24 < 0.03;
  allPass = allPass && sPass;
  out.push(`${sPass ? 'PASS' : 'FAIL'} startup boost: final Vo=${rs.met.vo.mean.toFixed(3)} V after ${rs.nPer} periods (N=${rs.N})`);
  // ringing: DCM idle node rings at 1/(2π√(L·Cn))
  {
    const p = { topo: 'buck', sync: false, Vg: 12, D: 0.3, fs: 100e3, L: 100e-6, C: 470e-6, R: 100, rc: 0.01, rL: 0.02, ron: 0.01, ron2: 0, Vf: 0.4, Vbd: 0.7, Cn: 1e-9, td: 0, T: 1e-5 };
    const r = computeRes(p, 'steady').rec, z = [];
    for (let i = 1; i < r.n; i++) if (r.st[i] === IDLE && r.st[i - 1] === IDLE && r.iL[i - 1] * r.iL[i] < 0) z.push(r.t[i - 1] + r.iL[i - 1] / (r.iL[i - 1] - r.iL[i]) * (r.t[i] - r.t[i - 1]));
    const f = (z.length - 1) / (2 * (z[z.length - 1] - z[0])), fx = 1 / (2 * Math.PI * Math.sqrt(p.L * p.Cn)), pass = z.length >= 3 && Math.abs(f / fx - 1) < 0.02;
    allPass = allPass && pass;
    out.push(`${pass ? 'PASS' : 'FAIL'} DCM ringing: ${fmtSI(f, 'Hz', 4)} vs 1/(2π√(L·Cn)) = ${fmtSI(fx, 'Hz', 4)}`);
  }
  // dead time and energy balance: body diode time = 2·td; Pin − Pout = sum of conduction terms
  for (const [topo, sync] of [['buck', false], ['buck', true], ['boost', false], ['boost', true], ['bb', false], ['bb', true]]) {
    const p = { topo, sync, Vg: 12, D: 0.5, fs: 200e3, L: 33e-6, C: 47e-6, R: 10, rc: 0.02, rL: 0.03, ron: 0.02, ron2: 0.02, Vf: sync ? 0 : 0.5, Vbd: 0.7, Cn: 0, td: sync ? 50e-9 : 0, T: 5e-6 };
    const res = computeRes(p, 'steady'), lb = lossBreakdown(res, { tr: 0, tf: 0, Cnode: 0, Qrr: 0, Qg: 0, Vdrv: 0, core: null });
    const bal = res.met.Pin - res.met.Pout, eB = Math.abs(lb.total / bal - 1);
    let tb = 0; const r = res.rec;
    for (let i = 0; i < r.n - 1; i++) if ((r.st[i] === BDR || r.st[i] === BDS) && r.st[i + 1] === r.st[i]) tb += r.t[i + 1] - r.t[i];
    const pass = eB < 1e-3 && (!sync || Math.abs(tb / (2 * p.td) - 1) < 0.02);
    allPass = allPass && pass;
    out.push(`${pass ? 'PASS' : 'FAIL'} energy ${topo.padEnd(5)} ${sync ? 'sync ' : 'async'}: losses ${fmtSI(lb.total, 'W', 4)} vs Pin−Pout ${fmtSI(bal, 'W', 4)}` + (sync ? `, body diode ${fmtSI(tb, 's', 3)} (2·td = 100 ns)` : ''));
  }
  // sync with dead time: the Q2 turn-on edge must be found; after its own body diode (BD-Q2) it is a ZVS edge
  {
    const s = SPEC_DEF.buck, comp = COMP_DEF, z = designSizing('buck', true, s, comp, { L: null, C: null }), Io = s.Io * 0.05;
    const sol = solveDuty(cornerParams('buck', true, s, comp, z.L, z.C, s.VinNom, Io), s.Vo, 0.9, 0.42);
    const r = sol.r.rec; let prev = -1;
    for (let i = 1; i < r.n; i++) if (r.st[i] === OFF && r.st[i - 1] !== OFF && Math.abs(r.t[i] - r.t[i - 1]) < 1e-9 * sol.r.T) { prev = r.st[i - 1]; break; }
    const node = lossBreakdown(sol.r, lossParams(comp, true)).items.find(x => x.k === 'node').P, pass = prev === BDR && node >= 0;
    allPass = allPass && pass;
    out.push(`${pass ? 'PASS' : 'FAIL'} Q2 turn-on edge found after ${prev >= 0 ? ST_NAME[prev] : 'none'} (ZVS), node loss ${fmtSI(node, 'W')} (S edge only)`);
  }
  // iGSE equals the Steinmetz equation for a sine flux
  {
    const c = { AL: 100e-9, Ae: 50e-6, Ve: 2e-6, Bsat: 0.4, k: 2.2, a: 1.4, b: 2.5 }, f = 100e3, T = 1 / f, L = 100e-6, n = 2000, rec = makeRec(n + 2);
    const N = Math.ceil(Math.sqrt(L / c.AL)), Bpk = 0.1, Ipk = Bpk * N * c.Ae / L;
    for (let i = 0; i <= n; i++) push(rec, i * T / n, Ipk * Math.sin(2 * Math.PI * i / n), 0, ON);
    const cl = coreLoss(rec, T, L, c), want = c.k * f ** c.a * Bpk ** c.b * c.Ve, pass = Math.abs(cl.P / want - 1) < 0.01;
    allPass = allPass && pass;
    out.push(`${pass ? 'PASS' : 'FAIL'} iGSE sine check: ${fmtSI(cl.P, 'W', 4)} vs Steinmetz ${fmtSI(want, 'W', 4)}`);
  }
  // design tool: hand-checked L for the default buck, then every topology in async and sync
  const zb = designSizing('buck', false, SPEC_DEF.buck, { ...COMP_DEF, ron: 0, ron2: 0, rL: 0, Vf: 0, rc: 0 }, { L: null, C: null });
  const Lhand = (14 - 5) * (5 / 14) / (200e3 * 0.3 * 2);
  const lPass = Math.abs(zb.Lreq / Lhand - 1) < 1e-6 && zb.Lsug === 27e-6;
  allPass = allPass && lPass;
  out.push(`${lPass ? 'PASS' : 'FAIL'} design buck L: ${fmtSI(zb.Lreq, 'H', 4)} (hand ${fmtSI(Lhand, 'H', 4)}), E12 ${fmtSI(zb.Lsug, 'H')}`);
  for (const topo of ['buck', 'boost', 'bb']) for (const sync of [false, true]) {
    const s = SPEC_DEF[topo], o = designRun(topo, sync, s, COMP_DEF, { L: null, C: null });
    const cs = o.corners;
    const vErr = Math.max(...cs.map(c => c.st ? Math.abs(Math.abs(c.st.Vo) / s.Vo - 1) : 1));
    const rip = Math.max(...cs.map(c => c.st ? 100 * c.st.dIL / Math.abs(c.st.IL) : 1e9));
    const dv = Math.max(...cs.map(c => c.st ? c.st.dVo : 1e9));
    const etas = cs.map(c => c.st ? c.st.loss.eta : NaN);
    const pass = !o.errs.length && cs.length === 3 && vErr < 1e-3 && rip <= s.rip * 1.05 && dv <= s.dVo * 1.05 && etas.every(e => e > 0.5 && e < 1);
    allPass = allPass && pass;
    out.push(`${pass ? 'PASS' : 'FAIL'} design ${topo.padEnd(5)} ${sync ? 'sync ' : 'async'}: L=${fmtSI(o.z.L, 'H')} C=${fmtSI(o.z.C, 'F')} ` +
      `D=${cs.map(c => c.D.toFixed(3)).join('/')} Vo err ${(vErr * 100).toFixed(4)}% ripple ${rip.toFixed(1)}% dVo ${fmtSI(dv, 'V')} ` +
      `η ${etas.map(e => (100 * e).toFixed(1)).join('/')}% ${o.ms.toFixed(0)} ms` +
      (o.errs.length ? ' ' + o.errs.join(' ') : ''));
  }
  if (typeof runControlTests === 'function') {
    const rc = runControlTests();
    allPass = allPass && rc.allPass;
    out.push(...rc.lines);
  }
  out.unshift(allPass ? 'SELF TEST: ALL PASS' : 'SELF TEST: FAILURES');
  return { allPass, lines: out };
}
function selfTest() {
  const r = runSelfTests();
  window.__selftest = r;
  console.log(r.lines.join('\n'));
  $('#selftest').textContent = r.lines.join('\n');
}
