'use strict';

/* ================= circuit model ================= */
// Effective parameters for the current selections.
function effParams() {
  const p = { ...state.p, topo: state.topo, sync: state.sync };
  if (!state.nonideal) { p.rc = 0; p.rL = 0; p.ron = 0; p.ron2 = 0; p.Vf = 0; p.td = 0; p.Vbd = 0; p.Cn = 0; }
  if (state.sync) p.Vf = 0; else { p.ron2 = 0; p.td = 0; }
  // The closed-loop stepper (simcl.js) is 2-state: no dead time, body diodes or node ringing.
  if (state.page === 'control') { p.td = 0; p.Vbd = 0; p.Cn = 0; }
  p.T = 1 / p.fs;
  return p;
}

// Switched model. States: iL (inductor current), vC (capacitor voltage magnitude) and,
// only while the node floats (IDLE with Cn > 0), the switch node voltage vn.
// Buck-boost works with magnitudes inside; signs are applied in sig().
function makeModel(p) {
  const { topo, Vg, D, L, C, R, sync } = p;
  const rc = p.rc || 0, rL = p.rL || 0, ron = p.ron || 0, ron2 = p.ron2 || 0, Vf = p.Vf || 0;
  const Vbd = p.Vbd || 0, Cn = p.Cn || 0, T = 1 / p.fs;
  const td = sync ? clamp(p.td || 0, 0, 0.45 * (1 - D) * T) : 0;
  const ring = Cn > 0;
  const RST = sync ? BDR : OFF;        // rectifier state when Q2 has no gate drive
  const rDrop = sync ? Vbd : Vf;       // its forward drop
  const kR = R / (R + rc);
  const Ix = p.Ix || 0;   // extra current drawn from the output node (small-signal Zout only)
  let vx = 0, vom = 0, iCm = 0, vL = 0, dI = 0, dV = 0, dN = 0;

  function core(st, iL, vC, vn) {
    // ifeed: current the topology pushes into the output node (C with ESR, parallel R)
    const ifeed = topo === 'buck' || st === OFF || st === BDR ? iL : 0;
    vom = (vC + rc * (ifeed - Ix)) * kR;
    iCm = ifeed - vom / R - Ix;
    if (st === IDLE) vx = ring ? vn : topo === 'buck' ? vom : topo === 'boost' ? Vg : 0;
    else if (topo === 'buck') vx = st === ON ? Vg - ron * iL : st === OFF ? (sync ? -ron2 * iL : -Vf) : st === BDR ? -Vbd : Vg + Vbd;
    else if (topo === 'boost') vx = st === ON ? ron * iL : st === OFF ? vom + (sync ? ron2 * iL : Vf) : st === BDR ? vom + Vbd : -Vbd;
    else vx = st === ON ? Vg - ron * iL : st === OFF ? -vom - (sync ? ron2 * iL : Vf) : st === BDR ? -vom - Vbd : Vg + Vbd;
    vL = topo === 'buck' ? vx - vom : topo === 'boost' ? Vg - vx : vx;
  }
  function der(st, iL, vC, vn) {
    core(st, iL, vC, vn);
    const fl = st === IDLE && !ring;
    dI = fl ? 0 : (vL - rL * iL) / L;
    dV = iCm / C;
    // floating node: iL charges the node capacitance (into the node for boost, out of it otherwise)
    dN = st === IDLE && ring ? (topo === 'boost' ? iL : -iL) / Cn : 0;
  }
  const m = { p, T, D, sync, td, ring, RST, ni: 0, nv: 0, nn: 0 };
  // One RK4 step. vn (node voltage) only matters while the node floats with Cn > 0.
  m.step = function (st, iL, vC, h, vn = 0) {
    der(st, iL, vC, vn); const a1 = dI, b1 = dV, c1 = dN;
    der(st, iL + 0.5 * h * a1, vC + 0.5 * h * b1, vn + 0.5 * h * c1); const a2 = dI, b2 = dV, c2 = dN;
    der(st, iL + 0.5 * h * a2, vC + 0.5 * h * b2, vn + 0.5 * h * c2); const a3 = dI, b3 = dV, c3 = dN;
    der(st, iL + h * a3, vC + h * b3, vn + h * c3); const a4 = dI, b4 = dV, c4 = dN;
    m.ni = st === IDLE && !ring ? 0 : iL + h * (a1 + 2 * a2 + 2 * a3 + a4) / 6;
    m.nv = vC + h * (b1 + 2 * b2 + 2 * b3 + b4) / 6;
    m.nn = vn + h * (c1 + 2 * c2 + 2 * c3 + c4) / 6;
  };
  // Derivatives and output (vo magnitude) for one switch state; used by the small-signal plant.
  m.der = (st, iL, vC) => { der(st, iL, vC, 0); return [dI, dV]; };
  m.vout = (st, iL, vC) => { core(st, iL, vC, 0); return vom; };
  m.vxOf = (st, iL, vC, vn) => { core(st, iL, vC, vn); return vx; };
  // Node voltages where the rectifier (r) or the body diode of S (s) start to conduct.
  m.rails = (iL, vC, vn) => {
    core(IDLE, iL, vC, vn);
    if (topo === 'buck') return { r: -rDrop, s: Vg + Vbd, rUp: false };
    if (topo === 'boost') return { r: vom + rDrop, s: -Vbd, rUp: true };
    return { r: -vom - rDrop, s: Vg + Vbd, rUp: false };
  };
  // In IDLE (async), would the diode start to conduct? (boost at startup: Vin > vo + Vf)
  m.offRises = vC => { core(OFF, 0, vC, 0); return vL > 1e-12; };
  // Without node capacitance: would a diode start to conduct from iL = 0? (rectifier r, body diode of S s)
  m.rRises = vC => { core(RST, 0, vC, 0); return vL > 1e-12; };
  m.sFalls = vC => { core(BDS, 0, vC, 0); return vL < -1e-12; };
  // State when no gate drives the network.
  m.freeState = (iL, vC) => iL > 0 ? RST : iL < 0 ? BDS : ring ? IDLE : m.rRises(vC) ? RST : m.sFalls(vC) ? BDS : IDLE;
  m.sig = function (key, st, iL, vC, vn = 0) {
    core(st, iL, vC, vn);
    const pol = topo === 'bb' ? -1 : 1;
    const sOn = st === ON || st === BDS, rOn = st === OFF || st === BDR;
    switch (key) {
      case 'vg': return Vg;
      case 'gate': return st === ON ? 1 : 0;
      case 'iL': return iL;
      case 'vL': return vL;
      case 'vsw': return vx;
      case 'iin': return topo === 'boost' ? iL : (sOn ? iL : 0);
      case 'iSW': return sOn ? iL : 0;
      case 'iD': return rOn ? iL : 0;
      case 'vDS': return topo === 'boost' ? vx : Vg - vx;
      case 'vD': return topo === 'buck' ? -vx : topo === 'boost' ? vx - vom : -vom - vx;
      case 'vC': return pol * vC;
      case 'iC': return pol * iCm;
      case 'vo': return pol * vom;
      case 'io': return pol * vom / R;
    }
    return 0;
  };
  return m;
}

/* ================= recording buffers ================= */
function makeRec(cap) {
  return { n: 0, t: new Float64Array(cap), iL: new Float64Array(cap), vC: new Float64Array(cap), vn: new Float64Array(cap), st: new Uint8Array(cap) };
}
function growRec(r) {
  const c = r.t.length * 2 + 64;
  for (const k of ['t', 'iL', 'vC', 'vn']) { const a = new Float64Array(c); a.set(r[k]); r[k] = a; }
  const s = new Uint8Array(c); s.set(r.st); r.st = s;
}
function push(r, t, iL, vC, st, vn = 0) {
  if (!r) return;
  if (r.n >= r.t.length) growRec(r);
  r.t[r.n] = t; r.iL[r.n] = iL; r.vC[r.n] = vC; r.vn[r.n] = vn; r.st[r.n] = st; r.n++;
}
function lowerBound(a, n, v) { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; } return lo; }
function upperBound(a, n, v) { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= v) lo = mid + 1; else hi = mid; } return lo; }
