'use strict';

/* ================= loss model ================= */
// Pure: loss breakdown and iGSE core loss from one steady-state result (Losses and Design pages).
// Data the time simulation does not use: switching edges, charges, gate drive, core.
function lossParams(comp, sync) {
  return {
    tr: comp.tr, tf: comp.tf, Cnode: nodeCap(comp, sync), Qrr: sync ? comp.QrrQ2 : comp.QrrD,
    Qg: comp.QgS + (sync ? comp.QgQ2 : 0), Vdrv: comp.Vdrv,
    core: { AL: comp.AL, Ae: comp.Ae, Ve: comp.Ve, Bsat: comp.Bsat, k: comp.kc, a: comp.ac, b: comp.bc },
  };
}
// iGSE coefficient: ki = k / ((2π)^(α−1) ∫0..2π |cos θ|^α dθ · 2^(β−α))
function igseKi(k, a, b) {
  let I = 0; const n = 720;
  for (let i = 0; i < n; i++) I += Math.abs(Math.cos(2 * Math.PI * (i + 0.5) / n)) ** a;
  I *= 2 * Math.PI / n;
  return k / ((2 * Math.PI) ** (a - 1) * I * 2 ** (b - a));
}
// Core loss with iGSE from the simulated iL over one period: B = L·iL/(N·Ae).
function coreLoss(rec, T, L, c) {
  if (!(c && c.AL > 0 && c.Ae > 0 && c.Ve > 0 && c.k > 0)) return null;
  const N = Math.max(1, Math.ceil(Math.sqrt(L / c.AL))), kB = L / (N * c.Ae);
  let mn = Infinity, mx = -Infinity, acc = 0;
  for (let i = 0; i < rec.n; i++) { const B = kB * rec.iL[i]; if (B < mn) mn = B; if (B > mx) mx = B; }
  const ki = igseKi(c.k, c.a, c.b);
  for (let i = 0; i < rec.n - 1; i++) {
    const dt = rec.t[i + 1] - rec.t[i];
    if (dt > 0) acc += ki * Math.abs(kB * (rec.iL[i + 1] - rec.iL[i]) / dt) ** c.a * dt;
  }
  const dB = mx - mn, Pv = acc / T * dB ** (c.b - c.a);
  return { N, Lact: c.AL * N * N, Bpk: Math.max(Math.abs(mn), Math.abs(mx)), dB, Pv, P: Pv * c.Ve, Bsat: c.Bsat };
}

// Loss breakdown for one steady-state result. Conduction terms come from the waveforms;
// edge terms use the node voltages and currents just before and after each switching edge.
function lossBreakdown(res, lp) {
  const p = res.p, m = res.m, r = res.rec, T = res.T, fs = 1 / T, n = r.n, sync = p.sync;
  const ic = sigArr(res, 'iC');
  let sS = 0, sQ = 0, sD = 0, sB = 0, sL = 0, sC = 0;
  for (let i = 0; i < n - 1; i++) {
    const dt = r.t[i + 1] - r.t[i]; if (dt <= 0) continue;
    const a = r.iL[i], b = r.iL[i + 1], sq = (a * a + a * b + b * b) / 3, st = r.st[i];
    sL += sq * dt; sC += (ic[i] * ic[i] + ic[i] * ic[i + 1] + ic[i + 1] * ic[i + 1]) / 3 * dt;
    if (st === ON) sS += sq * dt;
    else if (st === OFF) { if (sync) sQ += sq * dt; else sD += (a + b) / 2 * dt; }
    else if (st === BDR || st === BDS) sB += Math.abs(a + b) / 2 * dt;
  }
  const sig = (k, i) => m.sig(k, r.st[i], r.iL[i], r.vC[i], r.vn[i]);
  // S turn-on at t = 0 (sample n−1 is the end of the previous period), S turn-off at the first ON -> other edge
  const on0 = n - 1, on1 = 0;
  let off1 = 1; while (off1 < n && r.st[off1] === ON) off1++;
  const Ion = r.iL[on1], Ioff = off1 < n ? r.iL[off1] : 0;
  const vBefore = Math.abs(sig('vDS', on0)), vAfter = off1 < n ? Math.abs(sig('vDS', off1)) : 0;
  const Pon = Ion > 0 ? 0.5 * vBefore * Ion * lp.tr * fs : 0;
  const Poff = Ioff > 0 ? 0.5 * vAfter * Ioff * lp.tf * fs : 0;
  // node capacitance charged or discharged hard at every gated edge (S on, and Q2 on in sync)
  let Pnode = 0;
  const edge = (i0, i1) => { const dv = sig('vsw', i1) - sig('vsw', i0); Pnode += 0.5 * lp.Cnode * dv * dv * fs; };
  edge(on0, on1);
  // Q2 turn-on is hard only from a floating node (IDLE) or against the S body diode (BDS);
  // after its own body diode conducted (BDR) it is zero-voltage switching.
  if (sync) for (let i = 1; i < n; i++) if (r.st[i] === OFF && r.st[i - 1] !== OFF && Math.abs(r.t[i] - r.t[i - 1]) < 1e-9 * T) {
    if (r.st[i - 1] === IDLE || r.st[i - 1] === BDS) edge(i - 1, i);
    break;
  }
  // reverse recovery: the rectifier (D or Q2 body diode) still conducts when S turns on
  const stB = r.st[on0], rConducts = (stB === OFF && !sync) || stB === BDR;
  const Prr = rConducts && r.iL[on0] > 0 ? lp.Qrr * Math.abs(sig('vD', on1)) * fs : 0;
  const core = coreLoss(r, T, p.L, lp.core);
  const sub = (a, b) => `${a}<sub>${b}</sub>`;
  const items = [
    { k: 'sCond', name: 'S conduction', P: (p.ron || 0) * sS / T, f: `${sub('R', 'on')}·${sub('I', 'S,rms')}²` },
    { k: 'sSw', name: 'S switching (V·I overlap)', P: Pon + Poff, f: `½·V·${sub('I', 'on')}·${sub('t', 'r')}·${sub('f', 's')} + ½·V·${sub('I', 'off')}·${sub('t', 'f')}·${sub('f', 's')}` },
    { k: 'node', name: 'Node capacitance (Coss, Cj)', P: Pnode, f: `½·${sub('C', 'node')}·ΔV²·${sub('f', 's')} per hard edge` },
    { k: 'rr', name: 'Reverse recovery Qrr', P: Prr, f: `${sub('Q', 'rr')}·${sub('V', 'R')}·${sub('f', 's')}` },
    { k: 'gate', name: 'Gate drive', P: lp.Qg * lp.Vdrv * fs, f: `${sub('Q', 'g')}·${sub('V', 'drv')}·${sub('f', 's')}` },
    sync ? { k: 'rCond', name: 'Q2 conduction', P: (p.ron2 || 0) * sQ / T, f: `${sub('R', 'on2')}·${sub('I', 'Q2,rms')}²` }
         : { k: 'rCond', name: 'Diode conduction', P: (p.Vf || 0) * sD / T, f: `${sub('V', 'f')}·${sub('I', 'D,avg')}` },
    { k: 'bd', name: 'Body diodes (dead time)', P: (p.Vbd || 0) * sB / T, f: `${sub('V', 'bd')}·|i<sub>L</sub>| in dead time` },
    { k: 'dcr', name: 'Inductor copper (DCR)', P: (p.rL || 0) * sL / T, f: `DCR·${sub('I', 'L,rms')}²` },
    { k: 'core', name: 'Inductor core (iGSE)', P: core ? core.P : 0, f: `iGSE · ${sub('V', 'e')}` },
    { k: 'esr', name: 'Capacitor ESR', P: (p.rc || 0) * sC / T, f: `ESR·${sub('I', 'C,rms')}²` },
  ];
  const total = items.reduce((s, x) => s + x.P, 0), Pout = res.met.Pout;
  return { items, total, Pout, eta: Pout / (Pout + total), core, edges: { Ion, Ioff, vBefore, vAfter } };
}
