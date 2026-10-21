'use strict';

/* ================= time simulation ================= */
// Simulate nPer periods from x0 = [iL, vC]. Each period: ON for D*T, then OFF (and IDLE in async DCM).
function simulate(m, x0, nPer, N, rec) {
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

// Find the periodic steady state with Newton shooting on the one-period map.
function solveSteady(m, x0, N, Is, Vs) {
  const P = x => simulate(m, x, 1, N, null);
  const tolI = 1e-8 * Is, tolV = 1e-8 * Vs;
  let x = x0.slice(), res = Infinity;
  if (!m.sync && x[0] < 0) x[0] = 0;
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
      if (!m.sync && x[0] < 0) x[0] = 0;
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
    (p.rL + Math.max(p.ron, p.ron2) + p.rc) / p.L);
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
