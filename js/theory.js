'use strict';

/* ================= analytic theory ================= */
function theory(p) {
  const { topo, Vg, D, L, R, C, sync } = p, T = p.T;
  const K = 2 * L / (R * T);
  const Kcrit = topo === 'buck' ? 1 - D : topo === 'boost' ? D * (1 - D) ** 2 : (1 - D) ** 2;
  const Mccm = topo === 'buck' ? D : topo === 'boost' ? 1 / (1 - D) : D / (1 - D);
  const Mdcm = topo === 'buck' ? 2 / (1 + Math.sqrt(1 + 4 * K / (D * D)))
             : topo === 'boost' ? (1 + Math.sqrt(1 + 4 * D * D / K)) / 2 : D / Math.sqrt(K);
  const vOn = M => (topo === 'buck' ? Vg - M * Vg : Vg);           // |vL| during ON
  const D2dcm = topo === 'buck' ? D * (1 - Mdcm) / Mdcm : topo === 'boost' ? D / (Mdcm - 1) : D / Mdcm;
  const dILccm = vOn(Mccm) * D * T / L;
  const Ioccm = Mccm * Vg / R;
  const dVoccm = topo === 'buck' ? dILccm / (8 * p.fs * C) : Ioccm * D * T / C;
  const dcm = !sync && K < Kcrit;
  const th = { K, Kcrit, Mccm, Mdcm, D2dcm, dILccm, dVoccm, dcm };
  th.Lcrit = Kcrit * R * T / 2;
  th.Rcrit = 2 * L / (Kcrit * T);
  if (!dcm) {
    th.M = Mccm; th.Vo = Mccm * Vg; th.Io = th.Vo / R;
    th.IL = topo === 'buck' ? th.Io : th.Io / (1 - D);
    th.dIL = dILccm; th.Imin = th.IL - th.dIL / 2; th.Ipk = th.IL + th.dIL / 2; th.D2 = 1 - D;
  } else {
    th.M = Mdcm; th.Vo = Mdcm * Vg; th.Io = th.Vo / R;
    th.Ipk = vOn(Mdcm) * D * T / L; th.D2 = D2dcm; th.Imin = 0; th.dIL = th.Ipk;
    th.IL = th.Ipk * (D + D2dcm) / 2;
  }
  th.iL0 = th.Imin;
  th.Vout = topo === 'bb' ? -th.Vo : th.Vo;
  th.Mout = topo === 'bb' ? -th.M : th.M;
  th.Iin = th.Vo * th.Vo / R / Vg;
  const nearB = Math.abs(K - Kcrit) / Kcrit < 0.03;
  th.mode = dcm ? (nearB ? 'BCM' : 'DCM') : nearB ? 'BCM' : (sync && th.Imin < 0 ? 'FCCM' : 'CCM');
  return th;
}

// Ideal piecewise-linear waveform for one period (constant Vo for iL slopes).
function theoryRec(p, th, N) {
  const T = p.T, D = p.D, rec = makeRec(N + 32);
  const tOn = D * T, tEnd = th.dcm ? Math.min(T, (D + th.D2) * T) : T;
  const nOn = Math.max(2, Math.round(D * N));
  for (let j = 0; j <= nOn; j++) push(rec, j * tOn / nOn, th.Imin + (th.Ipk - th.Imin) * j / nOn, 0, ON);
  const endI = th.dcm ? 0 : th.Imin;
  const nOff = Math.max(2, Math.round((tEnd - tOn) / T * N));
  for (let j = 0; j <= nOff; j++) push(rec, tOn + j * (tEnd - tOn) / nOff, th.Ipk + (endI - th.Ipk) * j / nOff, 0, OFF);
  if (th.dcm && tEnd < T) {
    const nI = Math.max(2, Math.round((T - tEnd) / T * N));
    for (let j = 0; j <= nI; j++) push(rec, tEnd + j * (T - tEnd) / nI, 0, 0, IDLE);
  }
  // integrate the capacitor current to get the ripple of vC
  const q = new Float64Array(rec.n);
  const ic = i => {
    const iL = rec.iL[i], st = rec.st[i];
    const ifeed = p.topo === 'buck' ? iL : (st === OFF ? iL : 0);
    return ifeed - th.Vo / p.R;
  };
  let area = 0;
  for (let i = 1; i < rec.n; i++) {
    const dt = rec.t[i] - rec.t[i - 1];
    q[i] = q[i - 1] + 0.5 * (ic(i) + ic(i - 1)) * dt;
    area += 0.5 * (q[i] + q[i - 1]) * dt;
  }
  const qm = area / T;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < rec.n; i++) {
    const v = th.Vo + (q[i] - qm) / p.C;
    rec.vC[i] = v; if (v < mn) mn = v; if (v > mx) mx = v;
  }
  th.dVo = mx - mn;
  return rec;
}
