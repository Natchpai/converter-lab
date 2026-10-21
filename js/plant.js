'use strict';

/* ================= small-signal plant ================= */
// Affine form of one switch state: x' = A·x + b, vo = c·x + e, with x = [iL, vC].
// makeModel is affine in each state, so values at 0 and at unit steps give it exactly.
function affineState(m, st) {
  const f0 = m.der(st, 0, 0), fI = m.der(st, 1, 0), fV = m.der(st, 0, 1);
  const o0 = m.vout(st, 0, 0), oI = m.vout(st, 1, 0), oV = m.vout(st, 0, 1);
  return {
    A: [[fI[0] - f0[0], fV[0] - f0[0]], [fI[1] - f0[1], fV[1] - f0[1]]],
    b: f0, c: [oI - o0, oV - o0], e: o0,
  };
}

// ON and OFF affine forms, plus their change per volt of Vg and per amp of Ix.
function ccmAffine(p) {
  const m = makeModel(p), mg = makeModel({ ...p, Vg: p.Vg + 1 }), mx = makeModel({ ...p, Ix: 1 });
  const on = affineState(m, ON), off = affineState(m, OFF);
  const dvec = (a, b) => [a[0] - b[0], a[1] - b[1]];
  return {
    on, off,
    bg: [dvec(affineState(mg, ON).b, on.b), dvec(affineState(mg, OFF).b, off.b)],
    bx: [dvec(affineState(mx, ON).b, on.b), dvec(affineState(mx, OFF).b, off.b)],
    ex: [affineState(mx, ON).e - on.e, affineState(mx, OFF).e - off.e],
  };
}

// DC operating point of the averaged CCM model at duty D.
function averagedDC(af, D) {
  const Dp = 1 - D, a = af.on, o = af.off;
  const A = [[D * a.A[0][0] + Dp * o.A[0][0], D * a.A[0][1] + Dp * o.A[0][1]],
             [D * a.A[1][0] + Dp * o.A[1][0], D * a.A[1][1] + Dp * o.A[1][1]]];
  const b = [D * a.b[0] + Dp * o.b[0], D * a.b[1] + Dp * o.b[1]];
  const c = [D * a.c[0] + Dp * o.c[0], D * a.c[1] + Dp * o.c[1]];
  const e = D * a.e + Dp * o.e;
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const X = [-(A[1][1] * b[0] - A[0][1] * b[1]) / det, -(-A[1][0] * b[0] + A[0][0] * b[1]) / det];
  return { A, b, c, e, det, X, Vo: c[0] * X[0] + c[1] * X[1] + e };
}

// Transfer function y/u of x' = A·x + B·u, y = c·x + E·u, evaluated at s = j·2πf.
function ssTF(A, B, c, E) {
  const [a00, a01] = A[0], [a10, a11] = A[1];
  const n0r = -a11 * B[0] + a01 * B[1], n1r = a10 * B[0] - a00 * B[1];
  return f => {
    const w = 2 * Math.PI * f;
    const det = { re: a00 * a11 - a01 * a10 - w * w, im: -w * (a00 + a11) };
    const x0 = Cx.div({ re: n0r, im: w * B[0] }, det), x1 = Cx.div({ re: n1r, im: w * B[1] }, det);
    return { re: c[0] * x0.re + c[1] * x1.re + E, im: c[0] * x0.im + c[1] * x1.im };
  };
}

// Zeros of y/u in rad/s: roots of c·adj(sI − A)·B + E·det(sI − A).
function ssZeros(A, B, c, E) {
  const [a00, a01] = A[0], [a10, a11] = A[1];
  const tr = a00 + a11, dt = a00 * a11 - a01 * a10;
  const cB = c[0] * B[0] + c[1] * B[1];
  const cKB = c[0] * (-a11 * B[0] + a01 * B[1]) + c[1] * (a10 * B[0] - a00 * B[1]);
  return quadRoots(E, cB - E * tr, cKB + E * dt);
}

// Averaged CCM plant (state-space averaging of the switched model). Valid for CCM and for
// the sync FET in FCCM. Includes ESR zero, RHP zero and parasitic damping.
function averagedPlant(p, D, af = ccmAffine(p)) {
  const dc = averagedDC(af, D), Dp = 1 - D, { on, off } = af, X = dc.X;
  const Bd = [0, 1].map(i => (on.A[i][0] - off.A[i][0]) * X[0] + (on.A[i][1] - off.A[i][1]) * X[1] + on.b[i] - off.b[i]);
  const Ed = (on.c[0] - off.c[0]) * X[0] + (on.c[1] - off.c[1]) * X[1] + on.e - off.e;
  const Bg = [0, 1].map(i => D * af.bg[0][i] + Dp * af.bg[1][i]);
  const Bx = [0, 1].map(i => D * af.bx[0][i] + Dp * af.bx[1][i]);
  const Ex = D * af.ex[0] + Dp * af.ex[1];
  const A = dc.A, ci = [1, 0];
  const tr = A[0][0] + A[1][1];
  const w0 = Math.sqrt(Math.max(dc.det, 0));
  const zx = ssTF(A, Bx, dc.c, Ex);
  return {
    kind: 'ccm', D, X, Vo: dc.Vo, IL: X[0], A, w0, Q: w0 / Math.max(-tr, 1e-300),
    Gvd: ssTF(A, Bd, dc.c, Ed),
    Gid: ssTF(A, Bd, ci, 0),
    Gvg: ssTF(A, Bg, dc.c, 0),
    Zout: f => Cx.scale(zx(f), -1),   // vo per amp drawn from the output
    zeros: ssZeros(A, Bd, dc.c, Ed),
  };
}

// DCM reduced-order plant (ideal parts, one pole). Derived from the averaged diode
// current: dv/dt = (i_out(D, v) − v/R)/C, linearized at the DCM operating point.
// Gd0 = dVo/dD, wp = (1/R + g2)/C with g2 = −∂i_out/∂v.
function dcmPlant(p, D, th) {
  const M = th.Mdcm, V = M * p.Vg, R = p.R, C = p.C;
  let Gd0, wp, Rz;
  if (p.topo === 'buck') { Gd0 = 2 * V * (1 - M) / (D * (2 - M)); wp = (2 - M) / ((1 - M) * R * C); Rz = R * (1 - M) / (2 - M); }
  else if (p.topo === 'boost') { Gd0 = 2 * V * (M - 1) / (D * (2 * M - 1)); wp = (2 * M - 1) / ((M - 1) * R * C); Rz = R * (M - 1) / (2 * M - 1); }
  else { Gd0 = V / D; wp = 2 / (R * C); Rz = R / 2; }
  const wz = p.rc > 0 ? 1 / (p.rc * C) : Infinity;
  const shape = (k, f) => {
    const w = 2 * Math.PI * f;
    return Cx.scale(Cx.div({ re: 1, im: isFinite(wz) ? w / wz : 0 }, { re: 1, im: w / wp }), k);
  };
  return {
    kind: 'dcm', D, Vo: V, IL: th.IL, wp, w0: NaN, Q: NaN,
    Gvd: f => shape(Gd0, f), Gid: null,
    Gvg: f => shape(M, f), Zout: f => shape(Rz, f),
    zeros: isFinite(wz) ? [Cx.of(-wz)] : [], Gd0,
  };
}

// Plant at duty D: DCM reduced order when the diode makes the converter run in DCM.
function plantAt(p, D) {
  const th = theory({ ...p, D });
  return !p.sync && th.dcm ? dcmPlant(p, D, th) : averagedPlant(p, D);
}

// Duty that makes |vo| = Vt: averaged CCM model, or the ideal DCM formula in DCM.
// With losses a boost or buck-boost has a maximum Vo; above it the target is unreachable.
function solveD0(p, Vt) {
  const af = ccmAffine(p), Dmin = PDEF.D.min, Dmax = PDEF.D.max;
  const VoAt = D => {
    const th = theory({ ...p, D });
    return !p.sync && th.dcm ? th.Vo : averagedDC(af, D).Vo;
  };
  // the rising branch ends at the maximum of Vo(D)
  let Dpk = Dmax, vpk = -Infinity;
  for (let i = 0; i <= 80; i++) {
    const D = Dmin + (Dmax - Dmin) * i / 80, v = VoAt(D);
    if (v > vpk) { vpk = v; Dpk = D; }
  }
  if (Vt >= vpk) return { D: Dpk, ok: Math.abs(Vt - vpk) < 1e-9 * vpk, Vmax: vpk };
  let lo = Dmin, hi = Dpk;
  if (Vt <= VoAt(lo)) return { D: lo, ok: false, Vmax: vpk };
  for (let i = 0; i < 60; i++) { const mid = 0.5 * (lo + hi); if (VoAt(mid) < Vt) lo = mid; else hi = mid; }
  return { D: 0.5 * (lo + hi), ok: true, Vmax: vpk };
}
