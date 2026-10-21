'use strict';

/* ================= Bode plot ================= */
// Magnitude (top) and phase (bottom) share one log-frequency axis.
const BODE = { ml: 46, mr: 74, mt: 22, gap: 34, mb: 26, n: 400 };

// Sample each curve def { id, name, color (CSS var), H: f -> Cx, dash, width } on a log grid.
// Phase is unwrapped along frequency so it can go below −180°.
function bodeSample(fmin, fmax, defs, n = BODE.n) {
  const f = logspace(fmin, fmax, n);
  const curves = defs.map(d => {
    const mag = new Float64Array(n), ph = new Float64Array(n);
    let prev = NaN, off = 0;
    for (let i = 0; i < n; i++) {
      const H = d.H(f[i]);
      mag[i] = Cx.db(H);
      let a = Cx.deg(H);
      if (isFinite(prev)) { while (a + off - prev > 180) off -= 360; while (a + off - prev < -180) off += 360; }
      ph[i] = a + off; prev = ph[i];
    }
    return { ...d, mag, ph };
  });
  return { f, fmin, fmax, curves };
}

// Value of a sampled curve at frequency f (linear in log f).
function bodeAt(data, c, f) {
  const n = data.f.length, x = (Math.log10(f) - Math.log10(data.fmin)) / (Math.log10(data.fmax) - Math.log10(data.fmin)) * (n - 1);
  const i = clamp(Math.floor(x), 0, n - 2), t = clamp(x - i, 0, 1);
  return { mag: c.mag[i] + t * (c.mag[i + 1] - c.mag[i]), ph: c.ph[i] + t * (c.ph[i + 1] - c.ph[i]) };
}

function niceRange(vals, step, minSpan, lo0, hi0) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!isFinite(lo)) { lo = -step; hi = step; }
  lo = Math.max(lo0, Math.floor(lo / step) * step); hi = Math.min(hi0, Math.ceil(hi / step) * step);
  while (hi - lo < minSpan) { hi += step / 2; lo -= step / 2; }
  return [lo, hi];
}

const fmtHz = f => fmtSI(f, 'Hz', 3);
// Decade label: 0.1, 1, 10, 100, 1k, 10k, 100k, 1M
function decadeLabel(f) {
  for (const [m, u] of [[1e6, 'M'], [1e3, 'k'], [1, '']]) if (f >= m * 0.999) return `${Math.round(f / m)}${u}`;
  return String(+f.toPrecision(1));
}

// opt: { markers: [{ f, text }], shadeFrom, hoverF, handles: [{ f, db, kind: 'zero'|'pole'|'gain', color }],
//        dots: [{ f, mag, ph, color }] (measured points, drawn as squares) }
function bodeDraw(cv, data, opt = {}) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, k = dpr;
  const cs = getComputedStyle(document.documentElement), tok = n => cs.getPropertyValue(n).trim();
  const ink = tok('--ink'), muted = tok('--muted'), line = tok('--line'), soft = tok('--soft');
  const ml = BODE.ml * k, mr = BODE.mr * k, mt = BODE.mt * k, gap = BODE.gap * k, mb = BODE.mb * k;
  const pw = W - ml - mr, ph = H - mt - mb - gap, hM = ph * 0.56, hP = ph - hM;
  const yM0 = mt, yP0 = mt + hM + gap;
  const lf0 = Math.log10(data.fmin), lf1 = Math.log10(data.fmax);
  const X = f => ml + (Math.log10(f) - lf0) / (lf1 - lf0) * pw;
  const vis = data.curves.filter(c => !c.hidden);
  const all = a => vis.flatMap(c => Array.from(c[a]));
  const [m0, m1] = niceRange(all('mag'), 20, 40, -120, 160);
  const [p0, p1] = niceRange(all('ph'), 90, 180, -630, 270);
  const YM = v => yM0 + (m1 - v) / (m1 - m0) * hM, YP = v => yP0 + (p1 - v) / (p1 - p0) * hP;
  ctx.clearRect(0, 0, W, H);

  // averaged models are not valid above fs/2
  if (opt.shadeFrom && opt.shadeFrom < data.fmax) {
    const xs = X(opt.shadeFrom);
    ctx.fillStyle = soft;
    ctx.fillRect(xs, yM0, ml + pw - xs, hM); ctx.fillRect(xs, yP0, ml + pw - xs, hP);
  }
  // grid
  ctx.lineWidth = 1; ctx.font = `${12 * k}px ui-monospace, Consolas, monospace`;
  const grid = (y0, h) => {
    for (let e = Math.floor(lf0); e <= Math.ceil(lf1); e++) {
      for (let d = 1; d < 10; d++) {
        const f = d * 10 ** e; if (f < data.fmin * 0.999 || f > data.fmax * 1.001) continue;
        const x = Math.round(X(f)) + 0.5;
        ctx.strokeStyle = line; ctx.globalAlpha = d === 1 ? 1 : 0.45;
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + h); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  };
  grid(yM0, hM); grid(yP0, hP);
  const mStep = m1 - m0 > 120 ? 40 : 20, pStep = p1 - p0 > 360 ? 90 : 45;
  ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = m0; v <= m1 + 1e-9; v += mStep) {
    const y = Math.round(YM(v)) + 0.5;
    ctx.strokeStyle = v === 0 ? muted : line; ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke();
    ctx.fillText(`${v}`, ml - 5 * k, y);
  }
  for (let v = p0; v <= p1 + 1e-9; v += pStep) {
    const y = Math.round(YP(v)) + 0.5;
    ctx.strokeStyle = v === -180 ? muted : line;
    if (v === -180) ctx.setLineDash([5 * k, 4 * k]);
    ctx.beginPath(); ctx.moveTo(ml, y); ctx.lineTo(ml + pw, y); ctx.stroke(); ctx.setLineDash([]);
    if (v % 90 === 0) ctx.fillText(`${v}°`, ml - 5 * k, y);
  }
  ctx.strokeStyle = muted; ctx.strokeRect(ml + 0.5, yM0 + 0.5, pw, hM); ctx.strokeRect(ml + 0.5, yP0 + 0.5, pw, hP);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let e = Math.ceil(lf0); e <= Math.floor(lf1); e++) ctx.fillText(decadeLabel(10 ** e), X(10 ** e), yP0 + hP + 6 * k);
  ctx.textAlign = 'right'; ctx.fillText('Hz', W - 4 * k, yP0 + hP + 6 * k);
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.font = `${12 * k}px system-ui, sans-serif`;
  ctx.fillText('Magnitude (dB)', ml, yM0 - 4 * k);
  ctx.fillText('Phase (degrees)', ml, yP0 - 4 * k);

  // markers (characteristic frequencies) on top of the magnitude panel
  const marks = (opt.markers || []).filter(m => m.f >= data.fmin && m.f <= data.fmax).sort((a, b) => a.f - b.f);
  let lastX = -1e9, row = 0;
  for (const m of marks) {
    const x = X(m.f);
    row = x - lastX < 46 * k ? row + 1 : 0; lastX = x;
    ctx.strokeStyle = muted; ctx.setLineDash([2 * k, 3 * k]);
    ctx.beginPath(); ctx.moveTo(x, yM0); ctx.lineTo(x, yM0 + hM); ctx.moveTo(x, yP0); ctx.lineTo(x, yP0 + hP); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = muted; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `${12 * k}px system-ui, sans-serif`;
    ctx.fillText(m.text, x + 3 * k, yM0 + 3 * k + row * 14 * k);
  }

  // curves
  const clip = (y0, h) => { ctx.save(); ctx.beginPath(); ctx.rect(ml, y0, pw, h); ctx.clip(); };
  for (const c of vis) {
    const col = tok(c.color);
    for (const [arr, Y, y0, h] of [[c.mag, YM, yM0, hM], [c.ph, YP, yP0, hP]]) {
      clip(y0, h);
      ctx.strokeStyle = col; ctx.lineWidth = (c.width || 2) * k; ctx.lineJoin = 'round';
      ctx.setLineDash(c.dash ? [6 * k, 4 * k] : []);
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < data.f.length; i++) {
        const v = arr[i]; if (!isFinite(v)) { pen = false; continue; }
        const x = X(data.f[i]), y = Y(v);
        if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.restore();
    }
  }
  ctx.setLineDash([]);

  // direct labels at the right end of the magnitude panel (text in ink, mark in series color)
  const lab = vis.map(c => ({ c, y: clamp(YM(c.mag[c.mag.length - 1]), yM0 + 8 * k, yM0 + hM - 8 * k) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < lab.length; i++) lab[i].y = Math.max(lab[i].y, lab[i - 1].y + 15 * k);
  ctx.font = `${12 * k}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const { c, y } of lab) {
    ctx.strokeStyle = tok(c.color); ctx.lineWidth = 3 * k;
    ctx.beginPath(); ctx.moveTo(ml + pw + 4 * k, y); ctx.lineTo(ml + pw + 14 * k, y); ctx.stroke();
    ctx.fillStyle = ink; ctx.fillText(c.short || c.name, ml + pw + 17 * k, y);
  }

  // measured points (FRA)
  for (const d of opt.dots || []) {
    if (d.f < data.fmin || d.f > data.fmax) continue;
    const x = X(d.f), r = 4 * k;
    ctx.fillStyle = tok(d.color); ctx.strokeStyle = ink; ctx.lineWidth = 1.2 * k;
    for (const [v, Y, y0, h] of [[d.mag, YM, yM0, hM], [d.ph, YP, yP0, hP]]) {
      const y = Y(v); if (!isFinite(y) || y < y0 || y > y0 + h) continue;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
    }
  }

  // drag handles (zeros ○, poles ×, gain ◆)
  for (const hd of opt.handles || []) {
    if (hd.f < data.fmin || hd.f > data.fmax) continue;
    const x = X(hd.f), y = clamp(YM(hd.db), yM0, yM0 + hM), r = 6 * k;
    ctx.lineWidth = 2 * k; ctx.strokeStyle = tok(hd.color || '--ink'); ctx.fillStyle = tok('--panel');
    ctx.beginPath();
    if (hd.kind === 'zero') { ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); }
    else if (hd.kind === 'pole') { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); }
    else { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }

  // hover crosshair
  if (opt.hoverF && opt.hoverF >= data.fmin && opt.hoverF <= data.fmax) {
    const x = Math.round(X(opt.hoverF)) + 0.5;
    ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(x, yM0); ctx.lineTo(x, yM0 + hM); ctx.moveTo(x, yP0); ctx.lineTo(x, yP0 + hP); ctx.stroke();
    ctx.globalAlpha = 1;
    for (const c of vis) {
      const v = bodeAt(data, c, opt.hoverF);
      ctx.fillStyle = tok(c.color); ctx.strokeStyle = tok('--panel'); ctx.lineWidth = 2 * k;
      for (const y of [YM(v.mag), YP(v.ph)]) {
        if (y < yM0 || y > yP0 + hP) continue;
        ctx.beginPath(); ctx.arc(x, y, 4.5 * k, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      }
    }
  }
  const geo = { X, YM, YP, ml, pw, yM0, hM, yP0, hP, m0, m1, p0, p1, lf0, lf1 };
  geo.fAt = px => 10 ** (lf0 + (px - ml) / pw * (lf1 - lf0));
  geo.dbAt = py => m1 - (py - yM0) / hM * (m1 - m0);
  return geo;
}
