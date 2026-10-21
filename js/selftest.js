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
