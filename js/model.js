'use strict';

/* ================= circuit model ================= */
// Effective parameters for the current selections.
function effParams() {
  const p = { ...state.p, topo: state.topo, sync: state.sync };
  if (!state.nonideal) { p.rc = 0; p.rL = 0; p.ron = 0; p.ron2 = 0; p.Vf = 0; }
  if (state.sync) p.Vf = 0; else p.ron2 = 0;
  p.T = 1 / p.fs;
  return p;
}

// Switched model. States: iL (inductor current) and vC (capacitor voltage magnitude).
// Buck-boost works with magnitudes inside; signs are applied in sig().
function makeModel(p) {
  const { topo, Vg, D, L, C, R, rc, rL, ron, ron2, Vf, sync } = p;
  const kR = R / (R + rc);
  let vx = 0, vom = 0, iCm = 0, vL = 0, dI = 0, dV = 0;

  function core(st, iL, vC) {
    // ifeed: current the topology pushes into the output node (C with ESR, parallel R)
    const ifeed = topo === 'buck' ? iL : (st === OFF ? iL : 0);
    vom = (vC + rc * ifeed) * kR;
    iCm = ifeed - vom / R;
    if (topo === 'buck') {
      vx = st === ON ? Vg - ron * iL : st === OFF ? (sync ? -ron2 * iL : -Vf) : vom;
      vL = vx - vom;
    } else if (topo === 'boost') {
      vx = st === ON ? ron * iL : st === OFF ? vom + (sync ? ron2 * iL : Vf) : Vg;
      vL = Vg - vx;
    } else {
      vx = st === ON ? Vg - ron * iL : st === OFF ? -vom - (sync ? ron2 * iL : Vf) : 0;
      vL = vx;
    }
  }
  function der(st, iL, vC) {
    core(st, iL, vC);
    dI = st === IDLE ? 0 : (vL - rL * iL) / L;
    dV = iCm / C;
  }
  const m = { p, T: 1 / p.fs, D, sync, ni: 0, nv: 0 };
  m.step = function (st, iL, vC, h) {
    der(st, iL, vC); const a1 = dI, b1 = dV;
    der(st, iL + 0.5 * h * a1, vC + 0.5 * h * b1); const a2 = dI, b2 = dV;
    der(st, iL + 0.5 * h * a2, vC + 0.5 * h * b2); const a3 = dI, b3 = dV;
    der(st, iL + h * a3, vC + h * b3); const a4 = dI, b4 = dV;
    m.ni = st === IDLE ? 0 : iL + h * (a1 + 2 * a2 + 2 * a3 + a4) / 6;
    m.nv = vC + h * (b1 + 2 * b2 + 2 * b3 + b4) / 6;
  };
  // In IDLE (async), would the diode start to conduct? (boost at startup: Vin > vo + Vf)
  m.offRises = vC => { core(OFF, 0, vC); return vL > 1e-12; };
  m.sig = function (key, st, iL, vC) {
    core(st, iL, vC);
    const pol = topo === 'bb' ? -1 : 1;
    switch (key) {
      case 'vg': return Vg;
      case 'gate': return st === ON ? 1 : 0;
      case 'iL': return iL;
      case 'vL': return vL;
      case 'vsw': return vx;
      case 'iin': return topo === 'boost' ? iL : (st === ON ? iL : 0);
      case 'iSW': return st === ON ? iL : 0;
      case 'iD': return st === OFF ? iL : 0;
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
  return { n: 0, t: new Float64Array(cap), iL: new Float64Array(cap), vC: new Float64Array(cap), st: new Uint8Array(cap) };
}
function growRec(r) {
  const c = r.t.length * 2 + 64;
  for (const k of ['t', 'iL', 'vC']) { const a = new Float64Array(c); a.set(r[k]); r[k] = a; }
  const s = new Uint8Array(c); s.set(r.st); r.st = s;
}
function push(r, t, iL, vC, st) {
  if (!r) return;
  if (r.n >= r.t.length) growRec(r);
  r.t[r.n] = t; r.iL[r.n] = iL; r.vC[r.n] = vC; r.st[r.n] = st; r.n++;
}
function lowerBound(a, n, v) { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; } return lo; }
function upperBound(a, n, v) { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= v) lo = mid + 1; else hi = mid; } return lo; }
