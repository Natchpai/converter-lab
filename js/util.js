'use strict';

/* ================= formatting helpers ================= */
const PFX = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
function fmtSI(v, unit = '', dig = 3) {
  if (v == null || !isFinite(v)) return '–';
  if (Math.abs(v) < 1e-14) return '0 ' + unit;
  const a = Math.abs(v);
  let i = PFX.findIndex(([m]) => a >= m * 0.99999);
  if (i < 0) i = PFX.length - 1;
  let s = (v / PFX[i][0]).toPrecision(dig);
  if (Math.abs(+s) >= 1000 && i > 0) { i--; s = (v / PFX[i][0]).toPrecision(dig); }
  return s + ' ' + PFX[i][1] + unit;
}
const SI_MUL = { G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12 };
function parseSI(str) {
  const m = String(str).trim().match(/^([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([GMkKmuµnp]?)/);
  if (!m) return NaN;
  return parseFloat(m[1]) * (m[2] ? SI_MUL[m[2]] : 1);
}
function nice125ceil(x) {
  if (!(x > 0) || !isFinite(x)) return 1;
  const e = Math.floor(Math.log10(x)), b = Math.pow(10, e), f = x / b;
  const n = f <= 1 + 1e-9 ? 1 : f <= 2 + 1e-9 ? 2 : f <= 5 + 1e-9 ? 5 : 10;
  return n * b;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const f3 = v => isFinite(v) ? v.toFixed(3) : '–';
