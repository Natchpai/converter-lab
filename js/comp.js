'use strict';

/* ================= compensators ================= */
// One form for all types: Gc(s) = G · (1/s)^n · Π(1 + s/ωz) / Π(1 + s/ωp).
// Parameters (frequencies in Hz):
//   P:   Kp                          Gc = Kp
//   I:   fi                          Gc = 2π·fi / s        (|Gc| = 1 at fi)
//   PI:  K, fz1                      Gc = K·(1 + ωz/s)
//   T2:  K, fz1, fp1                 Gc = K·(1 + ωz/s) / (1 + s/ωp)      (K = mid-band gain)
//   T3:  K, fz1, fz2, fp1, fp2       Gc = K·ωz1/s · (1+s/ωz1)(1+s/ωz2) / ((1+s/ωp1)(1+s/ωp2))
const COMP_TYPES = {
  P:  { name: 'P',      keys: ['K'] },
  I:  { name: 'I (Type 1)', keys: ['fi'] },
  PI: { name: 'PI',     keys: ['K', 'fz1'] },
  T2: { name: 'Type 2', keys: ['K', 'fz1', 'fp1'] },
  T3: { name: 'Type 3', keys: ['K', 'fz1', 'fz2', 'fp1', 'fp2'] },
};
const TWO_PI = 2 * Math.PI;

function compNorm(c) {
  const w = f => TWO_PI * f;
  switch (c.type) {
    case 'P':  return { type: c.type, G: c.K, n: 0, wz: [], wp: [] };
    case 'I':  return { type: c.type, G: w(c.fi), n: 1, wz: [], wp: [] };
    case 'PI': return { type: c.type, G: c.K * w(c.fz1), n: 1, wz: [w(c.fz1)], wp: [] };
    case 'T2': return { type: c.type, G: c.K * w(c.fz1), n: 1, wz: [w(c.fz1)], wp: [w(c.fp1)] };
    case 'T3': return { type: c.type, G: c.K * w(c.fz1), n: 1, wz: [w(c.fz1), w(c.fz2)], wp: [w(c.fp1), w(c.fp2)] };
  }
  throw new Error('unknown compensator ' + c.type);
}

function compEval(cn, f) {
  const w = TWO_PI * f;
  let H = { re: cn.G, im: 0 };
  if (cn.n) H = Cx.div(H, { re: 0, im: w });
  for (const z of cn.wz) H = Cx.mul(H, { re: 1, im: w / z });
  for (const p of cn.wp) H = Cx.div(H, { re: 1, im: w / p });
  return H;
}

// Numerator and denominator in ascending powers of s.
function compPoly(cn) {
  let num = [cn.G], den = cn.n ? [0, 1] : [1];
  for (const z of cn.wz) num = polyMul(num, [1, 1 / z]);
  for (const p of cn.wp) den = polyMul(den, [1, 1 / p]);
  return { num, den };
}

/* ---------- polynomials (ascending real coefficients) ---------- */
function polyMul(a, b) {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
  return r;
}
function polyAdd(a, b) {
  const r = new Array(Math.max(a.length, b.length)).fill(0);
  a.forEach((v, i) => { r[i] += v; }); b.forEach((v, i) => { r[i] += v; });
  return r;
}
// Roots by Durand-Kerner, after scaling s = σ·x so the coefficients are of similar size.
// wRef: a typical frequency (rad/s) used to judge which top coefficients are negligible.
function polyRoots(a, wRef) {
  a = a.slice();
  const big = Math.max(...a.map((v, i) => Math.abs(v) * wRef ** i));
  while (a.length > 1 && Math.abs(a[a.length - 1]) * wRef ** (a.length - 1) < 1e-13 * big) a.pop();
  const zeros = [];
  while (a.length > 1 && a[0] === 0) { a.shift(); zeros.push(Cx.of(0)); }
  const n = a.length - 1;
  if (n < 1) return zeros;
  const sig = Math.pow(Math.abs(a[0] / a[n]), 1 / n) || 1;
  const b = a.map((v, i) => v * sig ** i / (a[n] * sig ** n));   // monic in x
  let z = Array.from({ length: n }, (_, k) => Cx.exp({ re: 0, im: 2 * Math.PI * k / n + 0.4 }));
  z = z.map(v => Cx.scale(v, 1.1));
  for (let it = 0; it < 800; it++) {
    let moved = 0;
    for (let k = 0; k < n; k++) {
      let pv = { re: 1, im: 0 };                      // Horner, monic
      for (let i = n - 1; i >= 0; i--) pv = Cx.add(Cx.mul(pv, z[k]), { re: b[i], im: 0 });
      let dn = { re: 1, im: 0 };
      for (let j = 0; j < n; j++) if (j !== k) dn = Cx.mul(dn, Cx.sub(z[k], z[j]));
      const step = Cx.div(pv, dn);
      z[k] = Cx.sub(z[k], step);
      moved = Math.max(moved, Cx.abs(step) / Math.max(1, Cx.abs(z[k])));
    }
    if (moved < 1e-14) break;
  }
  return zeros.concat(z.map(v => Cx.scale(v, sig)));
}

/* ---------- loop analysis ---------- */
// Unwrapped phase (deg) of H at f, following the phase from fStart upward.
function phaseAt(H, f, fStart, n = 240) {
  let prev = Cx.deg(H(fStart)), off = 0;
  const l0 = Math.log10(fStart), l1 = Math.log10(f);
  for (let i = 1; i <= n; i++) {
    let a = Cx.deg(H(10 ** (l0 + (l1 - l0) * i / n)));
    while (a + off - prev > 180) off -= 360;
    while (a + off - prev < -180) off += 360;
    prev = a + off;
  }
  return prev;
}
const wrap180 = a => a - 360 * Math.round(a / 360);

// Gain crossovers with phase margin, phase crossovers with gain margin.
function loopMargins(T, fmin, fmax, n = 700) {
  const f = logspace(fmin, fmax, n), mag = new Float64Array(n), ph = new Float64Array(n);
  let off = 0;
  for (let i = 0; i < n; i++) {
    const H = T(f[i]); mag[i] = Cx.db(H);
    let a = Cx.deg(H);
    if (i) { while (a + off - ph[i - 1] > 180) off -= 360; while (a + off - ph[i - 1] < -180) off += 360; }
    ph[i] = a + off;
  }
  const phInterp = x => {                       // unwrapped phase at frequency x
    const j = clamp(lowerBound(f, n, x) - 1, 0, n - 2);
    const raw = Cx.deg(T(x)), ref = ph[j] + (ph[j + 1] - ph[j]) * (Math.log(x / f[j]) / Math.log(f[j + 1] / f[j]));
    return raw + 360 * Math.round((ref - raw) / 360);
  };
  const cross = [];
  for (let i = 0; i < n - 1; i++) {
    if ((mag[i] >= 0) === (mag[i + 1] >= 0)) continue;
    let a = f[i], b = f[i + 1];
    for (let k = 0; k < 50; k++) { const m = Math.sqrt(a * b); if ((Cx.db(T(m)) >= 0) === (mag[i] >= 0)) a = m; else b = m; }
    const fc = Math.sqrt(a * b), p = phInterp(fc);
    cross.push({ f: fc, down: mag[i] >= 0, ph: p, pm: wrap180(p + 180) });
  }
  const pcross = [];
  for (let i = 0; i < n - 1; i++) {
    const k0 = Math.floor((ph[i] + 180) / 360), k1 = Math.floor((ph[i + 1] + 180) / 360);
    if (k0 === k1) continue;
    const lvl = 360 * Math.max(k0, k1) - 180;
    const t = (lvl - ph[i]) / (ph[i + 1] - ph[i]);
    const fx = f[i] * (f[i + 1] / f[i]) ** t;
    pcross.push({ f: fx, gm: -Cx.db(T(fx)) });
  }
  const downs = cross.filter(c => c.down);
  const fc = downs.length ? downs[downs.length - 1].f : NaN;
  const pm = cross.length ? Math.min(...cross.map(c => c.pm)) : NaN;
  const above = pcross.filter(c => !(c.f < fc));
  const gm = above.length ? Math.min(...above.map(c => c.gm)) : Infinity;
  return { cross, pcross, fc, pm, gm, conditional: pcross.some(c => c.f < fc && c.gm < 0) };
}

/* ---------- k-factor design (Venable) ---------- */
// plantK: f -> Cx, everything in the loop except the compensator (e.g. H·Gvd/Vm).
// Returns new compensator parameters with |T(fc)| = 1, plus notes.
function designComp(type, plantK, fc, pm, fStart) {
  const phi = phaseAt(plantK, fc, fStart);         // plant phase at fc (deg, unwrapped)
  let boost = pm - phi - 90;                        // phase the compensator must add above −90°
  const notes = [];
  const c = { type };
  const lim = { PI: [3, 87], T2: [3, 87], T3: [3, 175] }[type];
  if (lim && (boost < lim[0] || boost > lim[1])) {
    notes.push(`Needed boost ${boost.toFixed(0)}° is outside what ${COMP_TYPES[type].name} can give (${lim[0]}° to ${lim[1]}°); clamped.`);
    boost = clamp(boost, lim[0], lim[1]);
  }
  const rad = boost * Math.PI / 180;
  if (type === 'PI') c.fz1 = fc / Math.tan(rad);
  else if (type === 'T2') { const k = Math.tan(rad / 2 + Math.PI / 4); c.fz1 = fc / k; c.fp1 = fc * k; }
  else if (type === 'T3') { const k = Math.tan(rad / 4 + Math.PI / 4) ** 2, r = Math.sqrt(k); c.fz1 = c.fz2 = fc / r; c.fp1 = c.fp2 = fc * r; }
  // gain: |Gc(fc)|·|plant(fc)| = 1
  if (type === 'I') c.fi = 1;
  else c.K = 1;
  const g1 = Cx.abs(compEval(compNorm(c), fc)) * Cx.abs(plantK(fc));
  // a plant with no gain at fc (e.g. PCMC without a steady state) would give K = ∞ or NaN
  if (g1 > 0 && isFinite(g1)) { if (type === 'I') c.fi = 1 / g1; else c.K = 1 / g1; }
  else notes.push('The plant has no finite gain at fc, so the gain is left at 1.');
  const expectPm = type === 'P' ? 180 + phi : type === 'I' ? 90 + phi : pm;
  if (type === 'P' || type === 'I') notes.push(`${COMP_TYPES[type].name} adds no phase boost: expected PM ${expectPm.toFixed(0)}°.`);
  return { comp: c, phi, boost, notes };
}

/* ---------- op-amp realization ---------- */
// Inverting error amplifier; the lower divider resistor sits at virtual ground, so the
// amplifier itself realizes Zf/Zin = H·Gc. Input network R1 (T3: R1 ∥ (R3 + C3)),
// feedback C2 ∥ (R2 + C1). Returns null entries for parts the type does not use.
function opampValues(c, H, R1) {
  const cn = compNorm(c), wI = cn.G * H;          // op-amp integrator gain (rad/s), or gain for P
  const v = { R1, R2: null, C1: null, C2: null, R3: null, C3: null, ok: true, note: '' };
  if (c.type === 'P') { v.R2 = wI * R1; return v; }
  if (c.type === 'I') { v.C1 = 1 / (R1 * wI); return v; }
  const Ct = 1 / (R1 * wI), wz1 = cn.wz[0];
  if (c.type === 'PI') { v.C1 = Ct; v.R2 = 1 / (wz1 * Ct); return v; }
  const wp1 = cn.wp[0];
  if (wp1 <= wz1) { v.ok = false; v.note = 'fp1 must be above fz1.'; return v; }
  v.C2 = Ct * wz1 / wp1; v.C1 = Ct - v.C2; v.R2 = 1 / (wz1 * v.C1);
  if (c.type === 'T3') {
    const wz2 = cn.wz[1], wp2 = cn.wp[1];
    if (wp2 <= wz2) { v.ok = false; v.note = 'fp2 must be above fz2.'; return v; }
    v.C3 = (1 / wz2 - 1 / wp2) / R1; v.R3 = 1 / (wp2 * v.C3);
  }
  return v;
}

// Zf/Zin of the op-amp circuit from its part values, for checks.
function opampEval(v, f) {
  const s = Cx.jw(f), z = (R, C) => Cx.add(Cx.of(R || 0), C ? Cx.inv(Cx.scale(s, C)) : Cx.of(0));
  const par = (a, b) => Cx.div(Cx.mul(a, b), Cx.add(a, b));
  let Zf = v.R2 != null && !v.C1 ? Cx.of(v.R2) : z(v.R2, v.C1);
  if (v.C2) Zf = par(Zf, Cx.inv(Cx.scale(s, v.C2)));
  let Zi = Cx.of(v.R1);
  if (v.C3) Zi = par(Zi, z(v.R3, v.C3));
  return Cx.div(Zf, Zi);
}
