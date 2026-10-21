'use strict';

/* ================= app state and DOM ================= */
const $ = s => document.querySelector(s);
const els = {
  scope: $('#scope'), screen: $('#screen'), mm: $('#modemap'),
  chanRow: $('#chanRow'), measTbl: $('#measTbl'), curInfo: $('#curInfo'),
  schemSvg: $('#schemSvg'), schemInfo: $('#schemInfo'),
  cmpTbl: $('#cmpTbl'), eqTbl: $('#eqTbl'), tips: $('#tips'), simWarn: $('#simWarn'),
  badge: $('#modeBadge'), headVals: $('#headVals'),
};
let RES = null;
let dpr = window.devicePixelRatio || 1;

function compute() {
  RES = state.page === 'control' ? computeControl() : computeRes(effParams(), state.view, state.win);
}

/* ---------- time window of the scope ---------- */
function timeWindow(res) {
  const tdiv = state.tdiv === 'auto'
    ? (res.steady ? nice125ceil(2 * res.T / 10) : res.tEnd / 10)
    : +state.tdiv;
  const span = 10 * tdiv;
  const t0 = res.steady ? -Math.min(state.hpos, 0.9) * span : state.hpos * Math.max(0, res.tEnd - span);
  return { tdiv, span, t0, t1: t0 + span };
}

// Intervals (ON/OFF/IDLE) inside the window, for shading.
function segments(res, win) {
  const r = res.rec, out = [];
  const scan = (i0, i1, off) => {
    let s0 = r.t[i0], cur = r.st[i0];
    for (let i = i0 + 1; i <= i1; i++) {
      if (r.st[i] !== cur) { out.push([s0 + off, r.t[i] + off, cur]); s0 = r.t[i]; cur = r.st[i]; }
    }
    out.push([s0 + off, r.t[i1] + off, cur]);
  };
  if (res.steady) {
    if (win.span / res.T > 40) return null;
    const k0 = Math.floor(win.t0 / res.T), k1 = Math.floor(win.t1 / res.T);
    for (let k = k0; k <= k1; k++) scan(0, r.n - 1, k * res.T);
  } else {
    if (win.span / res.T > 40) return null;
    const [i0, i1] = idxRange(r, Math.max(0, win.t0), Math.min(res.tEnd, win.t1));
    scan(i0, i1, 0);
  }
  return out;
}

/* ---------- scope drawing ---------- */
function drawSeries(ctx, rec, arr, win, W, Y, T) {
  const t = rec.t, n = rec.n, span = win.span;
  let col = null, first = 0, mn = 0, mx = 0, last = 0, started = false;
  ctx.beginPath();
  const flush = () => {
    if (col === null) return;
    if (!started) { ctx.moveTo(col, first); started = true; } else ctx.lineTo(col, first);
    if (mn !== mx) { ctx.lineTo(col, mn); ctx.lineTo(col, mx); }
    ctx.lineTo(col, last);
  };
  const add = (x, y) => {
    const c = Math.round(x);
    if (c !== col) { flush(); col = c; first = mn = mx = last = y; }
    else { if (y < mn) mn = y; if (y > mx) mx = y; last = y; }
  };
  const run = off => {
    const ta = win.t0 - off, tb = win.t1 - off;
    const i0 = Math.max(0, lowerBound(t, n, ta) - 1), i1 = Math.min(n - 1, lowerBound(t, n, tb));
    for (let i = i0; i <= i1; i++) add((t[i] + off - win.t0) / span * W, Y(arr[i]));
  };
  if (T) { const k0 = Math.floor(win.t0 / T), k1 = Math.floor(win.t1 / T); for (let k = k0; k <= k1; k++) run(k * T); }
  else run(0);
  flush();
  ctx.stroke();
}

function label(ctx, txt, x, y, color, align = 'left', base = 'top') {
  ctx.font = `${13 * dpr}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = align; ctx.textBaseline = base;
  const w = ctx.measureText(txt).width, h = 17 * dpr, pad = 3 * dpr;
  let bx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  let by = base === 'top' ? y : base === 'bottom' ? y - h : y - h / 2;
  ctx.fillStyle = 'rgba(7,11,16,0.78)';
  ctx.fillRect(bx - pad, by - 1, w + 2 * pad, h + 2);
  ctx.fillStyle = color;
  ctx.fillText(txt, x, y + (base === 'top' ? 1 : base === 'bottom' ? -1 : 0));
}

function chanMaps(res, win, H) {
  const chs = state.ch.map((c, i) => ({ c, i })).filter(o => o.c.on);
  const n = chs.length, out = [];
  const showTh = res.steady && state.theory;
  chs.forEach(({ c, i }, j) => {
    const s = SIG[c.sig];
    const arr = sigArr(res, c.sig);
    const rng = res.steady ? statsArr(res.rec, arr, 0, res.T)
      : statsArr(res.rec, arr, Math.max(0, win.t0), Math.min(res.tEnd, win.t1));
    const mean = c.ac ? rng.mean : 0;
    let lo = rng.min - mean, hi = rng.max - mean;
    let tha = null, thMean = 0, thOff = false;
    if (showTh) {
      tha = thSigArr(res, c.sig);
      const ts = statsArr(res.thRec, tha, 0, res.T);
      thMean = c.ac ? ts.mean : 0;
      // Fit the theory trace only when it is close to the simulated one.
      // Otherwise (e.g. losses shift vo) it would squash the ripple to a flat line.
      const gap = Math.abs(ts.mean - rng.mean) * (c.ac ? 0 : 1);
      if (gap <= 2 * Math.max(rng.pp, ts.pp)) { lo = Math.min(lo, ts.min - thMean); hi = Math.max(hi, ts.max - thMean); }
      else thOff = true;
    }
    let Y, info;
    if (state.layout === 'split') {
      const laneH = H / n, top = j * laneH, pad = 0.16 * laneH;
      if (!(hi - lo > 1e-12 + 1e-9 * Math.max(Math.abs(hi), Math.abs(lo)))) {
        const e = Math.max(Math.abs(hi) * 0.1, 1e-3); lo -= e; hi += e;
      }
      Y = v => top + pad + (hi - v) / (hi - lo) * (laneH - 2 * pad);
      info = { top, laneH, lo, hi, pad };
    } else {
      const scale = c.scale === 'auto' ? nice125ceil(Math.max(Math.abs(lo), Math.abs(hi)) / 3.6) : +c.scale;
      const div = H / 8, y0 = H / 2 - c.pos * div;
      Y = v => y0 - v / scale * div;
      info = { scale, y0 };
    }
    out.push({
      c, i, s, arr, tha, mean, thMean, thOff, info, color: CH_COLORS[i],
      Y: v => Y(v - mean), Yth: v => Y(v - thMean),
    });
  });
  return out;
}

function renderScope() {
  const res = RES; if (!res) return;
  const cv = els.scope, ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.fillStyle = '#070b10'; ctx.fillRect(0, 0, W, H);
  const win = timeWindow(res);
  const X = t => (t - win.t0) / win.span * W;

  // interval shading
  if (state.shade) {
    const segs = segments(res, win);
    if (segs) {
      const fill = ['rgba(34,197,94,0.10)', 'rgba(249,115,22,0.09)', 'rgba(148,163,184,0.10)'];
      for (const [a, b, st] of segs) {
        const xa = X(a), xb = X(b);
        if (xb < 0 || xa > W) continue;
        ctx.fillStyle = fill[st]; ctx.fillRect(xa, 0, xb - xa, H);
        if (xb - xa > 34 * dpr) {
          ctx.font = `${12 * dpr}px ui-monospace, Consolas, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillStyle = 'rgba(203,213,225,0.55)';
          ctx.fillText(ST_NAME[st], (Math.max(xa, 0) + Math.min(xb, W)) / 2, H - 4 * dpr);
        }
      }
    }
  }

  // graticule 10 x 8
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  for (let i = 1; i < 10; i++) { const x = Math.round(i * W / 10) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let i = 1; i < 8; i++) { const y = Math.round(i * H / 8) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.beginPath();
  const cx = Math.round(W / 2) + 0.5, cy = Math.round(H / 2) + 0.5;
  for (let i = 0; i <= 50; i++) { const x = i * W / 50; ctx.moveTo(x, cy - 3 * dpr); ctx.lineTo(x, cy + 3 * dpr); }
  for (let i = 0; i <= 40; i++) { const y = i * H / 40; ctx.moveTo(cx - 3 * dpr, y); ctx.lineTo(cx + 3 * dpr, y); }
  ctx.stroke();

  const maps = chanMaps(res, win, H);
  RES._maps = maps; RES._win = win;
  const Tp = res.steady ? res.T : 0;

  // lanes (split)
  if (state.layout === 'split') {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    maps.forEach((mp, j) => { if (j > 0) { const y = Math.round(mp.info.top) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); } });
    ctx.stroke();
    // zero lines
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    for (const mp of maps) {
      const y0 = mp.Y(0 + mp.mean);
      if (!mp.c.ac && y0 > mp.info.top && y0 < mp.info.top + mp.info.laneH) {
        ctx.strokeStyle = mp.color + '66'; ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  // theory traces
  for (const mp of maps) {
    if (!mp.tha) continue;
    ctx.save();
    if (state.layout === 'split') { ctx.beginPath(); ctx.rect(0, mp.info.top, W, mp.info.laneH); ctx.clip(); }
    ctx.strokeStyle = mp.color + '99'; ctx.lineWidth = 1.3 * dpr; ctx.setLineDash([5 * dpr, 4 * dpr]);
    drawSeries(ctx, res.thRec, mp.tha, win, W, mp.Yth, res.T);
    ctx.restore();
  }
  // simulated traces
  for (const mp of maps) {
    ctx.save();
    if (state.layout === 'split') { ctx.beginPath(); ctx.rect(0, mp.info.top, W, mp.info.laneH); ctx.clip(); }
    ctx.strokeStyle = mp.color; ctx.lineWidth = 1.7 * dpr; ctx.lineJoin = 'round';
    ctx.shadowColor = mp.color; ctx.shadowBlur = 3 * dpr;
    drawSeries(ctx, res.rec, mp.arr, win, W, mp.Y, Tp);
    ctx.restore();
  }

  // labels
  for (const mp of maps) {
    const u = mp.s.u, name = `CH${mp.i + 1} ${mp.s.n}${mp.c.ac ? ' AC' : ''}${mp.thOff && state.layout === 'split' ? '  (theory off-scale)' : ''}`;
    if (state.layout === 'split') {
      const { top, laneH, lo, hi } = mp.info;
      const dig = clamp(Math.ceil(Math.log10(Math.max(Math.abs(hi), Math.abs(lo)) / Math.max(hi - lo, 1e-15))) + 3, 3, 7);
      label(ctx, name, 6 * dpr, top + 4 * dpr, mp.color);
      label(ctx, fmtSI(hi + mp.mean, u, dig), W - 6 * dpr, top + 4 * dpr, mp.color, 'right');
      label(ctx, fmtSI(lo + mp.mean, u, dig), W - 6 * dpr, top + laneH - 4 * dpr, mp.color, 'right', 'bottom');
    } else {
      const y0 = clamp(mp.info.y0, 6 * dpr, H - 6 * dpr);
      ctx.fillStyle = mp.color;
      ctx.beginPath(); ctx.moveTo(0, y0 - 6 * dpr); ctx.lineTo(10 * dpr, y0); ctx.lineTo(0, y0 + 6 * dpr); ctx.fill();
    }
  }
  if (state.layout === 'overlay') {
    let x = 6 * dpr, y = H - 6 * dpr;
    ctx.font = `${13 * dpr}px ui-monospace, Consolas, monospace`;
    for (const mp of maps) {
      const txt = `CH${mp.i + 1} ${mp.s.n} ${fmtSI(mp.info.scale, mp.s.u)}/div${mp.c.ac ? ' AC' : ''}`;
      const w = ctx.measureText(txt).width;
      if (x > 6 * dpr && x + w > W - 6 * dpr) { x = 6 * dpr; y -= 21 * dpr; }
      label(ctx, txt, x, y, mp.color, 'left', 'bottom');
      x += w + 14 * dpr;
    }
  }
  // trigger marker
  if (res.steady) {
    const xt = X(0);
    if (xt >= 0 && xt <= W) {
      ctx.fillStyle = '#fb923c';
      ctx.beginPath(); ctx.moveTo(xt - 6 * dpr, 0); ctx.lineTo(xt + 6 * dpr, 0); ctx.lineTo(xt, 9 * dpr); ctx.fill();
    }
  }
  // test events (closed-loop simulation)
  for (const ev of res.events || []) {
    const x = Math.round(X(ev.t)) + 0.5;
    if (x < 0 || x > W) continue;
    ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 1 * dpr; ctx.setLineDash([2 * dpr, 3 * dpr]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, ev.text, x + 3 * dpr, H - 24 * dpr, '#fb923c', 'left', 'bottom');
  }
  // cursors
  [[state.c1, '#f8fafc', 'C1'], [state.c2, '#94a3b8', 'C2']].forEach(([f, col, nm]) => {
    const x = Math.round(f * W) + 0.5;
    ctx.strokeStyle = col; ctx.lineWidth = 1 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, nm, x + 3 * dpr, 14 * dpr, col);
  });
}

/* ---------- readouts ---------- */
function cursorTimes() { const w = RES._win || timeWindow(RES); return [w.t0 + state.c1 * w.span, w.t0 + state.c2 * w.span]; }

function renderReadout() {
  const res = RES; if (!res) return;
  const win = RES._win || timeWindow(res);
  const [t1, t2] = cursorTimes();
  const dt = t2 - t1;
  const tbase = `${fmtSI(win.tdiv, 's')}/div` + (res.steady ? ` (T=${fmtSI(res.T, 's')}, trigger ▼ = S turns on)` : `, showing ${fmtSI(win.t0, 's')} to ${fmtSI(win.t1, 's')} of ${res.nPer} periods`);
  els.curInfo.textContent = `${tbase}\nC1 t=${fmtSI(t1, 's', 4)}   C2 t=${fmtSI(t2, 's', 4)}   Δt=${fmtSI(dt, 's', 4)}   1/Δt=${fmtSI(Math.abs(dt) > 0 ? 1 / Math.abs(dt) : NaN, 'Hz')}`;
  const [ta, tb] = res.steady ? [0, res.T] : [Math.max(0, win.t0), Math.min(res.tEnd, win.t1)];
  let h = '<tr><th>Ch</th><th class="l">Signal</th><th>Mean</th><th>Min</th><th>Max</th><th>P-P</th><th>RMS</th><th>@C1</th><th>@C2</th><th>C2−C1</th></tr>';
  state.ch.forEach((c, i) => {
    if (!c.on) return;
    const s = SIG[c.sig], u = s.u, st = stats(res, c.sig, ta, tb);
    // hide integration noise, e.g. the mean of vL shown as 1e-13 V
    if (Math.abs(st.mean) < 1e-7 * Math.max(Math.abs(st.min), Math.abs(st.max))) st.mean = 0;
    const v1 = valueAt(res, c.sig, t1), v2 = valueAt(res, c.sig, t2);
    h += `<tr><td style="color:${CH_COLORS[i]};font-weight:700">CH${i + 1}</td><td class="l">${s.n}</td>` +
      `<td>${fmtSI(st.mean, u)}</td><td>${fmtSI(st.min, u)}</td><td>${fmtSI(st.max, u)}</td>` +
      `<td>${fmtSI(st.pp, u)}</td><td>${fmtSI(st.rms, u)}</td><td>${fmtSI(v1, u)}</td><td>${fmtSI(v2, u)}</td><td>${fmtSI(v2 - v1, u)}</td></tr>`;
  });
  els.measTbl.innerHTML = h;
}
