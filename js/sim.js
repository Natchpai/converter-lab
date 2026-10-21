'use strict';

/* ================= time simulation ================= */
// Simulate nPer periods from x0 = [iL, vC]. Each period: ON for D*T, then OFF (and IDLE in async DCM).
// With dead time or node capacitance, simulateFree() runs instead.
function simulate(m, x0, nPer, N, rec) {
  if (m.td > 0 || m.ring) return simulateFree(m, x0, nPer, N, rec);
  const T = m.T, tOn = m.D * T;
  const nOn = Math.max(2, Math.round(m.D * N)), nOff = Math.max(2, N - nOn);
  const hOn = tOn / nOn, hOff = (T - tOn) / nOff;
  let iL = x0[0], vC = x0[1], t = 0;
  for (let k = 0; k < nPer; k++) {
    t = k * T;
    push(rec, t, iL, vC, ON);
    for (let j = 0; j < nOn; j++) {
      m.step(ON, iL, vC, hOn); iL = m.ni; vC = m.nv; t += hOn;
      push(rec, t, iL, vC, ON);
    }
    t = k * T + tOn;
    let st = OFF;
    if (!m.sync && iL <= 0) { iL = 0; st = m.offRises(vC) ? OFF : IDLE; }
    push(rec, t, iL, vC, st);
    for (let j = 0; j < nOff; j++) {
      const h = hOff;
      if (st === IDLE && m.offRises(vC)) { st = OFF; push(rec, t, iL, vC, OFF); }
      m.step(st, iL, vC, h);
      if (st === OFF && !m.sync && m.ni < 0) {
        // diode stops: find the zero crossing inside this step
        const f = iL > 0 ? iL / (iL - m.ni) : 0, h1 = h * f;
        if (h1 > 0) { m.step(OFF, iL, vC, h1); vC = m.nv; }
        iL = 0; t += h1;
        push(rec, t, 0, vC, OFF);
        st = IDLE; push(rec, t, 0, vC, IDLE);
        m.step(IDLE, 0, vC, h - h1); vC = m.nv; t += h - h1;
        push(rec, t, 0, vC, IDLE);
      } else {
        iL = m.ni; vC = m.nv; t += h;
        push(rec, t, iL, vC, st);
      }
    }
  }
  return [iL, vC];
}

// Simulate nPer periods with dead time and node ringing.
// Gate segments per period: S on for D*T; then the rectifier. Sync with dead time:
// S on, dead time, Q2 on, dead time. In a segment without gate drive ("free") the
// diodes decide: rectifier (iL > 0), body diode of S (iL < 0) or IDLE (iL = 0, node floats).
function simulateFree(m, x0, nPer, N, rec) {
  const T = m.T, tOn = m.D * T, td = m.td, FREE = -1;
  const segs = m.sync
    ? (td > 0 ? [[ON, tOn], [FREE, td], [OFF, T - tOn - 2 * td], [FREE, td]] : [[ON, tOn], [OFF, T - tOn]])
    : [[ON, tOn], [FREE, T - tOn]];
  const nSeg = segs.map(([g, d]) => Math.max(g === FREE && m.sync ? 4 : 2, Math.round(d / T * N)));
  let iL = x0[0], vC = x0[1], vn = 0, t = 0;
  for (let k = 0; k < nPer; k++) {
    let t0 = k * T;
    for (let s = 0; s < segs.length; s++) {
      const [g, dur] = segs[s], n = nSeg[s], h = dur / n;
      t = t0;
      let st = g === FREE ? m.freeState(iL, vC) : g;
      if (!(st === IDLE && m.ring)) vn = m.vxOf(st, iL, vC, vn);   // a floating node keeps its last voltage
      push(rec, t, iL, vC, st, vn);
      for (let j = 0; j < n; j++) {
        if (st === IDLE && !m.ring) {
          if (m.rRises(vC)) { st = m.RST; vn = m.vxOf(st, iL, vC, vn); push(rec, t, iL, vC, st, vn); }
          else if (m.sFalls(vC)) { st = BDS; vn = m.vxOf(st, iL, vC, vn); push(rec, t, iL, vC, st, vn); }
        }
        m.step(st, iL, vC, h, vn);
        if (g === FREE && ((st === m.RST && m.ni < 0) || (st === BDS && m.ni > 0))) {
          // the conducting diode stops when iL reaches zero inside this step
          const f = iL !== m.ni ? clamp(iL / (iL - m.ni), 0, 1) : 0, h1 = h * f;
          if (h1 > 0) { m.step(st, iL, vC, h1, vn); vC = m.nv; }
          const vrail = m.vxOf(st, 0, vC, vn);
          iL = 0; t += h1;
          push(rec, t, 0, vC, st, vrail);
          st = IDLE; vn = m.ring ? vrail : m.vxOf(IDLE, 0, vC, vn);
          push(rec, t, 0, vC, IDLE, vn);
          if (h - h1 > 0) { m.step(IDLE, 0, vC, h - h1, vn); iL = m.ni; vC = m.nv; vn = m.ring ? m.nn : m.vxOf(IDLE, iL, vC, vn); }
          t += h - h1;
          push(rec, t, iL, vC, IDLE, vn);
        } else if (st === IDLE && m.ring) {
          // floating node rings; it clamps when it reaches a rail where a diode conducts
          const rl = m.rails(m.ni, m.nv, m.nn);
          const hitR = rl.rUp ? m.nn > rl.r : m.nn < rl.r, hitS = rl.rUp ? m.nn < rl.s : m.nn > rl.s;
          if (hitR || hitS) {
            const rail = hitR ? rl.r : rl.s, f = m.nn !== vn ? clamp((rail - vn) / (m.nn - vn), 0, 1) : 0, h1 = h * f;
            if (h1 > 0) { m.step(IDLE, iL, vC, h1, vn); iL = m.ni; vC = m.nv; }
            t += h1; push(rec, t, iL, vC, IDLE, rail);
            st = hitR ? m.RST : BDS; vn = m.vxOf(st, iL, vC, rail);
            push(rec, t, iL, vC, st, vn);
            if (h - h1 > 0) { m.step(st, iL, vC, h - h1, vn); iL = m.ni; vC = m.nv; vn = m.vxOf(st, iL, vC, vn); }
            t += h - h1; push(rec, t, iL, vC, st, vn);
          } else { iL = m.ni; vC = m.nv; vn = m.nn; t += h; push(rec, t, iL, vC, IDLE, vn); }
        } else {
          iL = m.ni; vC = m.nv; t += h;
          vn = m.vxOf(st, iL, vC, vn);
          push(rec, t, iL, vC, st, vn);
        }
      }
      t0 += dur;
    }
  }
  return [iL, vC];
}

// Find the periodic steady state with Newton shooting on the one-period map.
function solveSteady(m, x0, N, Is, Vs) {
  const P = x => simulate(m, x, 1, N, null);
  const tolI = 1e-8 * Is, tolV = 1e-8 * Vs;
  let x = x0.slice(), res = Infinity;
  if (!m.sync && !m.ring && x[0] < 0) x[0] = 0;
  const newton = iters => {
    for (let it = 0; it < iters; it++) {
      const y = P(x), F0 = y[0] - x[0], F1 = y[1] - x[1];
      if (!isFinite(F0) || !isFinite(F1)) return false;
      res = Math.max(Math.abs(F0) / Is, Math.abs(F1) / Vs);
      if (Math.abs(F0) < tolI && Math.abs(F1) < tolV) return true;
      const hI = 1e-6 * Math.max(Is, Math.abs(x[0])), hV = 1e-6 * Math.max(Vs, Math.abs(x[1]));
      const yI = P([x[0] + hI, x[1]]), yV = P([x[0], x[1] + hV]);
      const a = (yI[0] - y[0]) / hI - 1, c = (yI[1] - y[1]) / hI;
      const b = (yV[0] - y[0]) / hV, d = (yV[1] - y[1]) / hV - 1;
      const det = a * d - b * c;
      if (!isFinite(det) || det === 0) return false;
      let d0 = -(d * F0 - b * F1) / det, d1 = -(-c * F0 + a * F1) / det;
      const lim = Math.max(Math.abs(d0) / (10 * Is), Math.abs(d1) / (10 * Vs), 1);
      x = [x[0] + d0 / lim, x[1] + d1 / lim];
      if (!m.sync && !m.ring && x[0] < 0) x[0] = 0;
    }
    return false;
  };
  let ok = newton(30);
  if (!ok) {
    // fallback: run the plain simulation for a while, then try Newton again
    x = simulate(m, x0, 3000, Math.min(N, 300), null);
    ok = newton(20);
  }
  return { x, ok: ok || res < 1e-4, res };
}

function stepsPerPeriod(p, frac, nmin, nmax) {
  const rate = Math.max(
    1 / Math.sqrt(p.L * p.C),
    1 / ((p.R + p.rc) * p.C),
    ((p.rL || 0) + Math.max(p.ron || 0, p.ron2 || 0) + (p.rc || 0)) / p.L,
    p.Cn > 0 ? 1 / Math.sqrt(p.L * p.Cn) : 0);
  return clamp(Math.ceil(p.T * rate / frac), nmin, nmax);
}

// Startup window from the averaged small-signal model (slowest pole).
function autoWindow(p, th) {
  const Le = p.topo === 'buck' ? p.L : p.L / ((1 - p.D) ** 2);
  const r = p.rL + p.ron;
  let rate;
  if (th.dcm) rate = 1 / (p.R * p.C);
  else {
    const tr = -r / Le - 1 / (p.R * p.C);
    const det = (r / Le) / (p.R * p.C) + 1 / (Le * p.C);
    const disc = tr * tr / 4 - det;
    rate = disc < 0 ? -tr / 2 : -tr / 2 - Math.sqrt(disc);
  }
  return clamp(Math.ceil(6 / rate / p.T), 20, 4000);
}
