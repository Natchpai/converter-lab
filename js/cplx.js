'use strict';

/* ================= complex numbers ================= */
// Small helper set for frequency responses. A complex number is { re, im }.
const Cx = {
  of: (re, im = 0) => ({ re, im }),
  jw: f => ({ re: 0, im: 2 * Math.PI * f }),
  add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
  sub: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
  mul: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
  scale: (a, k) => ({ re: a.re * k, im: a.im * k }),
  div(a, b) {
    const d = b.re * b.re + b.im * b.im;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  },
  inv: a => Cx.div({ re: 1, im: 0 }, a),
  abs: a => Math.hypot(a.re, a.im),
  arg: a => Math.atan2(a.im, a.re),
  exp(a) { const e = Math.exp(a.re); return { re: e * Math.cos(a.im), im: e * Math.sin(a.im) }; },
  db: a => 20 * Math.log10(Math.hypot(a.re, a.im)),
  deg: a => Math.atan2(a.im, a.re) * 180 / Math.PI,
};

// Roots of a·s² + b·s + c (real coefficients). Returns 0, 1 or 2 complex roots.
function quadRoots(a, b, c) {
  const eps = 1e-14 * (Math.abs(b) + Math.abs(c) + 1e-300);
  if (Math.abs(a) < eps * 1e-6) return Math.abs(b) > 0 ? [Cx.of(-c / b)] : [];
  const disc = b * b - 4 * a * c;
  if (disc >= 0) {
    // stable form: avoid cancellation
    const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
    const r1 = q / a, r2 = q !== 0 ? c / q : -b / a - r1;
    return [Cx.of(r1), Cx.of(r2)];
  }
  const re = -b / (2 * a), im = Math.sqrt(-disc) / (2 * Math.abs(a));
  return [Cx.of(re, im), Cx.of(re, -im)];
}

// n points from a to b, evenly spaced in log scale.
function logspace(a, b, n) {
  const out = new Float64Array(n), la = Math.log10(a), lb = Math.log10(b);
  for (let i = 0; i < n; i++) out[i] = 10 ** (la + (lb - la) * i / (n - 1));
  return out;
}
