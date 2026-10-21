'use strict';

/* ================= design tool ================= */
// Pure: spec tables, L/C sizing, operating points with D solved on the switching model,
// stress vs rating. Runs in the page (Design page) and in Node (tests/run.js).
const TOPO_LABEL = { buck: 'Buck', boost: 'Boost', bb: 'Buck-Boost (inverting)' };
const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
// Smallest E12 value >= x.
function e12Ceil(x) {
  if (!(x > 0) || !isFinite(x)) return NaN;
  let e = Math.floor(Math.log10(x));
  for (let k = 0; k < 2; k++, e++) for (const m of E12) { const v = +(m * 10 ** e).toPrecision(3); if (v >= x * (1 - 1e-9)) return v; }
  return NaN;
}

const SPEC_FIELDS = [
  { k: 'VinMin', label: 'V<sub>in</sub> min', unit: 'V' },
  { k: 'VinNom', label: 'V<sub>in</sub> nom', unit: 'V' },
  { k: 'VinMax', label: 'V<sub>in</sub> max', unit: 'V' },
  { k: 'Vo', label: '|V<sub>o</sub>| target', unit: 'V' },
  { k: 'Io', label: 'I<sub>o</sub> max', unit: 'A' },
  { k: 'fs', label: 'Switching frequency f<sub>s</sub>', unit: 'Hz' },
  { k: 'rip', label: 'Δi<sub>L</sub> target, % of I<sub>L</sub>', unit: '%' },
  { k: 'dVo', label: 'ΔV<sub>o</sub> target (p-p)', unit: 'V' },
  { k: 'Dmax', label: 'D max allowed', unit: '' },
  { k: 'derate', label: 'Derating limit', unit: '%' },
];
const SPEC_DEF = {
  buck:  { VinMin: 10,  VinNom: 12, VinMax: 14,  Vo: 5,  Io: 2, fs: 200e3, rip: 30, dVo: 0.05, Dmax: 0.9, derate: 80 },
  boost: { VinMin: 4.5, VinNom: 5,  VinMax: 5.5, Vo: 12, Io: 1, fs: 200e3, rip: 30, dVo: 0.1,  Dmax: 0.9, derate: 80 },
  bb:    { VinMin: 10,  VinNom: 12, VinMax: 14,  Vo: 12, Io: 1, fs: 200e3, rip: 30, dVo: 0.1,  Dmax: 0.9, derate: 80 },
};
const COMP_DEF = {
  ron: 0.015, swV: 40, swI: 20, tr: 5e-9, tf: 5e-9, CossS: 300e-12, QgS: 12e-9,
  ron2: 0.015, q2V: 40, q2I: 20, CossQ2: 300e-12, QgQ2: 12e-9, QrrQ2: 20e-9,
  Vf: 0.45, dV: 40, dI: 5, QrrD: 0, CjD: 150e-12,
  rL: 0.02, Isat: 6, IrmsL: 5, rc: 0.005, cV: 25, cI: 5,
  AL: 100e-9, Ae: 62e-6, Ve: 2.33e-6, Bsat: 0.39, kc: 2.2, ac: 1.4, bc: 2.5,
  Vdrv: 10, td: 30e-9, Vbd: 0.7,
};
// name, Ron, V rating, I rating, tr, tf, Coss, Qg, body-diode Qrr (typical values for the class, not a real part)
const MOSFET_CLASSES = [
  ['30 V low-Ron MOSFET', 0.006, 30, 40, 6e-9, 6e-9, 600e-12, 25e-9, 30e-9],
  ['40 V MOSFET', 0.015, 40, 20, 5e-9, 5e-9, 300e-12, 12e-9, 20e-9],
  ['60 V MOSFET', 0.02, 60, 30, 8e-9, 8e-9, 400e-12, 20e-9, 40e-9],
  ['100 V MOSFET', 0.035, 100, 20, 10e-9, 10e-9, 300e-12, 25e-9, 60e-9],
  ['200 V MOSFET', 0.08, 200, 15, 15e-9, 15e-9, 200e-12, 30e-9, 150e-9],
  ['650 V superjunction MOSFET', 0.19, 650, 12, 10e-9, 10e-9, 60e-12, 30e-9, 3e-6],
];
const PART_PRESETS = {
  S: MOSFET_CLASSES.map(([n, r, v, i, tr, tf, co, qg]) => [n, { ron: r, swV: v, swI: i, tr, tf, CossS: co, QgS: qg }]),
  Q2: MOSFET_CLASSES.map(([n, r, v, i, , , co, qg, qrr]) => [n, { ron2: r, q2V: v, q2I: i, CossQ2: co, QgQ2: qg, QrrQ2: qrr }]),
  D: [['Schottky 40 V 3 A', { Vf: 0.45, dV: 40, dI: 3, QrrD: 0, CjD: 150e-12 }], ['Schottky 60 V 5 A', { Vf: 0.55, dV: 60, dI: 5, QrrD: 0, CjD: 250e-12 }],
      ['Schottky 100 V 5 A', { Vf: 0.7, dV: 100, dI: 5, QrrD: 0, CjD: 200e-12 }], ['Ultrafast 200 V 8 A', { Vf: 0.95, dV: 200, dI: 8, QrrD: 30e-9, CjD: 50e-12 }],
      ['Ultrafast 600 V 8 A', { Vf: 1.6, dV: 600, dI: 8, QrrD: 100e-9, CjD: 30e-12 }]],
  L: [['Small SMD power inductor', { rL: 0.05, Isat: 3, IrmsL: 2.5 }], ['Medium SMD power inductor', { rL: 0.015, Isat: 8, IrmsL: 6 }],
      ['Large shielded inductor', { rL: 0.005, Isat: 20, IrmsL: 15 }]],
  Core: [['Generic MnZn ferrite, small (approx. 100 °C)', { AL: 100e-9, Ae: 62e-6, Ve: 2.33e-6, Bsat: 0.39, kc: 2.2, ac: 1.4, bc: 2.5 }],
         ['Generic MnZn ferrite, large (approx. 100 °C)', { AL: 160e-9, Ae: 119e-6, Ve: 6.53e-6, Bsat: 0.39, kc: 2.2, ac: 1.4, bc: 2.5 }]],
  C: [['Ceramic MLCC bank 25 V', { rc: 0.003, cV: 25, cI: 5 }], ['Polymer 25 V', { rc: 0.015, cV: 25, cI: 3 }],
      ['Polymer 63 V', { rc: 0.025, cV: 63, cI: 2.5 }], ['Electrolytic 63 V', { rc: 0.08, cV: 63, cI: 1.2 }],
      ['Electrolytic 450 V', { rc: 0.3, cV: 450, cI: 1 }]],
};
// Field: k, label, unit (SI) or scale + disp for non-SI display units, sel = "L/C used" box, only = sync/async.
const PARTS = [
  { id: 'S', title: 'Main switch S', fields: [
    { k: 'ron', label: 'R<sub>on</sub>', unit: 'Ω' }, { k: 'swV', label: 'V<sub>DS</sub> rating', unit: 'V' }, { k: 'swI', label: 'I<sub>D</sub> rating (RMS)', unit: 'A' },
    { k: 'tr', label: 't<sub>r</sub> (turn-on)', unit: 's' }, { k: 'tf', label: 't<sub>f</sub> (turn-off)', unit: 's' },
    { k: 'CossS', label: 'C<sub>oss</sub>', unit: 'F' }, { k: 'QgS', label: 'Q<sub>g</sub>', unit: 'C' }] },
  { id: 'Q2', title: 'Sync FET Q2', only: 'sync', fields: [
    { k: 'ron2', label: 'R<sub>on</sub>', unit: 'Ω' }, { k: 'q2V', label: 'V<sub>DS</sub> rating', unit: 'V' }, { k: 'q2I', label: 'I<sub>D</sub> rating (RMS)', unit: 'A' },
    { k: 'CossQ2', label: 'C<sub>oss</sub>', unit: 'F' }, { k: 'QgQ2', label: 'Q<sub>g</sub>', unit: 'C' }, { k: 'QrrQ2', label: 'Body diode Q<sub>rr</sub>', unit: 'C' }] },
  { id: 'D', title: 'Diode D', only: 'async', fields: [
    { k: 'Vf', label: 'V<sub>f</sub>', unit: 'V' }, { k: 'dV', label: 'V<sub>R</sub> rating', unit: 'V' }, { k: 'dI', label: 'I<sub>F(AV)</sub> rating', unit: 'A' },
    { k: 'QrrD', label: 'Q<sub>rr</sub> (0 for Schottky)', unit: 'C' }, { k: 'CjD', label: 'C<sub>j</sub>', unit: 'F' }] },
  { id: 'Drive', title: 'Gate drive and body diodes', fields: [
    { k: 'Vdrv', label: 'Gate drive voltage', unit: 'V' }, { k: 'Vbd', label: 'Body diode V<sub>f</sub>', unit: 'V' },
    { k: 'td', label: 'Dead time t<sub>d</sub>', unit: 's', only: 'sync' }] },
  { id: 'L', title: 'Inductor L', fields: [
    { k: 'Lsel', label: 'L used', unit: 'H', sel: true }, { k: 'rL', label: 'DCR', unit: 'Ω' },
    { k: 'Isat', label: 'I<sub>sat</sub>', unit: 'A' }, { k: 'IrmsL', label: 'I<sub>rms</sub> rating', unit: 'A' }] },
  { id: 'Core', title: 'Inductor core', fields: [
    { k: 'AL', label: 'A<sub>L</sub>', scale: 1e-9, disp: 'nH/N²' }, { k: 'Ae', label: 'A<sub>e</sub>', scale: 1e-6, disp: 'mm²' },
    { k: 'Ve', label: 'V<sub>e</sub>', scale: 1e-9, disp: 'mm³' }, { k: 'Bsat', label: 'B<sub>sat</sub>', unit: 'T' },
    { k: 'kc', label: 'Steinmetz k', scale: 1, disp: '' }, { k: 'ac', label: 'Steinmetz α', scale: 1, disp: '' },
    { k: 'bc', label: 'Steinmetz β', scale: 1, disp: '' }] },
  { id: 'C', title: 'Output capacitor C', fields: [
    { k: 'Csel', label: 'C used', unit: 'F', sel: true }, { k: 'rc', label: 'ESR', unit: 'Ω' },
    { k: 'cV', label: 'Voltage rating', unit: 'V' }, { k: 'cI', label: 'Ripple current rating (RMS)', unit: 'A' }] },
];
const FIELD = Object.fromEntries(PARTS.flatMap(p => p.fields.map(f => [f.k, f])));
const fmtComp = (k, v) => { const f = FIELD[k]; return f.scale ? `${+(v / f.scale).toPrecision(4)}${f.disp ? ' ' + f.disp : ''}` : fmtSI(v, f.unit, 3); };
const parseComp = (k, txt) => { const f = FIELD[k]; return f.scale ? parseFloat(txt) * f.scale : parseSI(txt); };

// Ideal CCM operating point for a given Vin (Vo is the magnitude).
function idealOp(topo, Vin, Vo) {
  if (topo === 'buck') return { D: Vo / Vin, vOn: Vin - Vo, kIL: 1 };
  if (topo === 'boost') { const D = 1 - Vin / Vo; return { D, vOn: Vin, kIL: 1 / (1 - D) }; }
  const D = Vo / (Vin + Vo); return { D, vOn: Vin, kIL: 1 / (1 - D) };
}
// CCM operating point with conduction drops (Ron, DCR, Vf or Q2 Ron), from volt-second balance on L.
// vOn is the inductor voltage while S is on; it sets the ripple: ΔiL = vOn·D/(fs·L).
function opPoint(topo, Vin, Vo, Io, comp, sync) {
  let { D } = idealOp(topo, Vin, Vo), IL = Io;
  for (let k = 0; k < 8; k++) {
    IL = topo === 'buck' ? Io : Io / (1 - D);
    const Vr = sync ? IL * comp.ron2 : comp.Vf;
    if (topo === 'buck') D = (Vo + IL * comp.rL + Vr) / (Vin - IL * comp.ron + Vr);
    else if (topo === 'boost') D = (Vo + Vr - Vin + IL * comp.rL) / (Vo + Vr - IL * comp.ron);
    else D = (Vo + Vr + IL * comp.rL) / (Vin - IL * comp.ron + Vo + Vr);
    D = clamp(D, 1e-4, 0.999);
  }
  IL = topo === 'buck' ? Io : Io / (1 - D);
  const vOn = topo === 'buck' ? Vin - IL * (comp.ron + comp.rL) - Vo : Vin - IL * (comp.ron + comp.rL);
  return { D, vOn, IL };
}
const kcritOf = (topo, D) => topo === 'buck' ? 1 - D : topo === 'boost' ? D * (1 - D) ** 2 : (1 - D) ** 2;

// Worst-case L and C sizing from the ideal CCM equations, swept over the Vin range.
function designSizing(topo, sync, s, comp, sel) {
  const errs = [];
  if (!(s.VinMin > 0 && s.VinMin <= s.VinNom && s.VinNom <= s.VinMax)) errs.push('Need 0 < Vin min ≤ Vin nom ≤ Vin max.');
  if (!(s.Vo > 0 && s.Io > 0 && s.fs > 0 && s.rip > 0 && s.dVo > 0)) errs.push('Vo, Io, fs and both ripple targets must be above zero.');
  if (topo === 'buck' && s.VinMin <= s.Vo) errs.push('A buck needs Vin min > Vo.');
  if (topo === 'boost' && s.VinMax >= s.Vo) errs.push('A boost needs Vin max < Vo.');
  if (!(s.Dmax > 0 && s.Dmax < 1)) errs.push('D max must be between 0 and 1.');
  if (errs.length) return { errs };
  const T = 1 / s.fs, r = s.rip / 100, pts = [];
  for (let i = 0; i <= 60; i++) pts.push(s.VinMin + (s.VinMax - s.VinMin) * i / 60);
  pts.push(s.VinNom);
  let Lreq = 0, LreqVin = 0, Dmin = 1, Dhi = 0;
  const ops = pts.map(Vin => ({ Vin, ...opPoint(topo, Vin, s.Vo, s.Io, comp, sync) }));
  if (ops.some(o => !(o.vOn > 0))) errs.push('The conduction drops are larger than the available voltage. Check Ron, DCR and Vf against the specs.');
  for (const o of ops) {
    const L = o.vOn * o.D * T / (r * o.IL);
    if (L > Lreq) { Lreq = L; LreqVin = o.Vin; }
    Dmin = Math.min(Dmin, o.D); Dhi = Math.max(Dhi, o.D);
  }
  if (Dhi > s.Dmax) errs.push(`D reaches ${Dhi.toFixed(3)} at Vin min, above D max = ${s.Dmax}. Raise Vin min or D max, or lower the losses.`);
  if (errs.length) return { errs };
  const Lsug = e12Ceil(Lreq), L = sel.L > 0 ? sel.L : Lsug;
  let Creq = 0, CreqVin = 0, esrMax = Infinity, IoCrit = 0, IoCritVin = 0;
  for (const o of ops) {
    const Vin = o.Vin, IL = o.IL, dIL = o.vOn * o.D * T / L;
    let C, lim;
    if (topo === 'buck') { lim = s.dVo / dIL; const b = s.dVo - comp.rc * dIL; C = b > 0 ? dIL / (8 * s.fs * b) : Infinity; }
    else { const Ipk = IL + dIL / 2; lim = s.dVo / Ipk; const b = s.dVo - comp.rc * Ipk; C = b > 0 ? s.Io * o.D * T / b : Infinity; }
    if (C > Creq) { Creq = C; CreqVin = Vin; }
    esrMax = Math.min(esrMax, lim);
    const Ic = kcritOf(topo, o.D) * s.Vo / (2 * L * s.fs);
    if (Ic > IoCrit) { IoCrit = Ic; IoCritVin = Vin; }
  }
  if (!isFinite(Creq)) errs.push(`The ESR (${fmtSI(comp.rc, 'Ω')}) alone uses up the ΔVo budget. Use ESR below ${fmtSI(esrMax, 'Ω')}.`);
  const Csug = e12Ceil(Creq), C = sel.C > 0 ? sel.C : Csug;
  return { errs, Lreq, LreqVin, Lsug, L, Creq, CreqVin, Csug, C, esrMax, IoCrit, IoCritVin, Dmin, Dhi };
}

function cornerParams(topo, sync, s, comp, L, C, Vin, Io = s.Io) {
  return {
    topo, sync, Vg: Vin, D: 0.5, fs: s.fs, L, C, R: s.Vo / Io,
    rc: comp.rc, rL: comp.rL, ron: comp.ron, ron2: sync ? comp.ron2 : 0, Vf: sync ? 0 : comp.Vf, T: 1 / s.fs,
    td: sync ? comp.td : 0, Vbd: comp.Vbd, Cn: nodeCap(comp, sync),
  };
}
const nodeCap = (comp, sync) => comp.CossS + (sync ? comp.CossQ2 : comp.CjD);

// Find D so the simulated |Vo| equals the target (steady state, losses included).
function solveDuty(p, target, Dlim, D0) {
  let evals = 0;
  const f = D => { evals++; const r = computeRes({ ...p, D }, 'steady'); return { D, e: Math.abs(r.met.vo.mean) - target, r }; };
  const lo0 = 0.01, hi0 = Dlim;
  let a = f(clamp(D0 - 0.05, lo0, hi0)), b = f(clamp(D0 + 0.08, lo0, hi0)), g = 0;
  while (a.e > 0 && a.D > lo0 && g++ < 12) a = f(Math.max(lo0, a.D - 0.1));
  while (b.e < 0 && b.D < hi0 && g++ < 24) b = f(Math.min(hi0, b.D + 0.1));
  if (b.e < 0) {
    // boost with losses: Vo(D) has a peak, so search below it for any D that reaches the target
    let prev = null;
    for (let D = 0.05; D <= hi0 + 1e-9; D += 0.05) {
      const c = f(Math.min(D, hi0));
      if (c.e >= 0 && prev) { a = prev; b = c; break; }
      prev = c.e < 0 ? c : prev;
    }
  }
  if (a.e > 0) return { ok: false, why: 'Vo is above the target even at the smallest D', evals };
  if (b.e < 0) return { ok: false, why: `the target Vo is not reachable with D ≤ ${Dlim} (losses too high or D max too low)`, evals };
  let side = 0, c = b;
  for (let it = 0; it < 40; it++) {
    const D = (a.D * b.e - b.D * a.e) / (b.e - a.e);
    c = f(D);
    if (Math.abs(c.e) < 1e-5 * target || b.D - a.D < 1e-7) break;
    if (c.e < 0) { a = c; if (side === -1) b.e /= 2; side = -1; }
    else { b = c; if (side === 1) a.e /= 2; side = 1; }
  }
  return { ok: Math.abs(c.e) < 1e-3 * target, D: c.D, r: c.r, evals, why: 'the duty-cycle search did not converge' };
}

function cornerStats(res) {
  const T = res.T, s = k => stats(res, k, 0, T);
  const iL = s('iL'), iSW = s('iSW'), iD = s('iD'), vDS = s('vDS'), vD = s('vD'), vo = s('vo'), iC = s('iC'), iin = s('iin');
  return {
    mode: res.met.mode, Vo: vo.mean, dVo: vo.pp, voAbsMax: Math.max(Math.abs(vo.max), Math.abs(vo.min)),
    IL: iL.mean, dIL: iL.pp, ILpk: Math.max(Math.abs(iL.max), Math.abs(iL.min)), ILrms: iL.rms,
    Isw: iSW.rms, IswPk: iSW.max, IDavg: iD.mean, IDrms: iD.rms, VDS: vDS.max, VR: -vD.min,
    ICrms: Math.sqrt(Math.max(0, iC.ms - iC.mean ** 2)), Iin: iin.mean,
    CinRms: Math.sqrt(Math.max(0, iin.ms - iin.mean ** 2)), eta: res.met.eta, Pin: res.met.Pin, Pout: res.met.Pout,
  };
}

// Full design run (pure: does not touch the page).
function designRun(topo, sync, s, comp, sel) {
  const t0 = performance.now();
  const z = designSizing(topo, sync, s, comp, sel);
  const out = { topo, sync, s: { ...s }, comp: { ...comp }, z, corners: [], errs: [...z.errs] };
  if (!out.errs.length && isFinite(z.L) && isFinite(z.C)) {
    const Dlim = Math.min(s.Dmax, PDEF.D.max);
    [s.VinMin, s.VinNom, s.VinMax].forEach((Vin, i) => {
      const p = cornerParams(topo, sync, s, comp, z.L, z.C, Vin);
      const sol = solveDuty(p, s.Vo, Dlim, clamp(opPoint(topo, Vin, s.Vo, s.Io, comp, sync).D, 0.02, Dlim));
      const st = sol.ok ? cornerStats(sol.r) : null;
      if (st) st.loss = lossBreakdown(sol.r, lossParams(comp, sync));
      out.corners.push({ Vin, ok: sol.ok, D: sol.ok ? sol.D : NaN, p, st, evals: sol.evals });
      if (!sol.ok) out.errs.push(`Vin ${['min', 'nom', 'max'][i]} (${fmtSI(Vin, 'V')}): ${sol.why}.`);
    });
  }
  out.ms = performance.now() - t0;
  return out;
}

function ratingRows(out) {
  const cs = out.corners.filter(c => c.st);
  if (!cs.length) return [];
  const mx = k => Math.max(...cs.map(c => c.st[k])), c = out.comp, d = out.s.derate / 100;
  const rows = [
    ['S', 'Voltage V<sub>DS</sub> max', mx('VDS'), c.swV, 'V'],
    ['S', 'Current RMS', mx('Isw'), c.swI, 'A'],
    out.sync ? ['Q2', 'Voltage V<sub>DS</sub> max', mx('VR'), c.q2V, 'V'] : ['D', 'Reverse voltage V<sub>R</sub> max', mx('VR'), c.dV, 'V'],
    out.sync ? ['Q2', 'Current RMS', mx('IDrms'), c.q2I, 'A'] : ['D', 'Average current I<sub>F(AV)</sub>', mx('IDavg'), c.dI, 'A'],
    ['L', 'Peak current (vs I<sub>sat</sub>)', mx('ILpk'), c.Isat, 'A'],
    ['L', 'RMS current', mx('ILrms'), c.IrmsL, 'A'],
    ['C', 'Voltage |V<sub>o</sub>| max', mx('voAbsMax'), c.cV, 'V'],
    ['C', 'Ripple current RMS', mx('ICrms'), c.cI, 'A'],
  ];
  const cores = cs.map(x => x.st.loss && x.st.loss.core).filter(Boolean);
  if (cores.length) rows.splice(6, 0, ['L core', `Peak flux B<sub>pk</sub> (vs B<sub>sat</sub>), N = ${cores[0].N}`, Math.max(...cores.map(x => x.Bpk)), c.Bsat, 'T']);
  return rows.map(([part, what, stress, rating, u]) => {
    const use = rating > 0 ? stress / rating : NaN;
    const cls = !(rating > 0) ? 'na' : use <= d ? 'ok' : use <= 1 ? 'warn' : 'bad';
    const txt = { na: 'no rating', ok: 'OK', warn: 'above derating', bad: 'over rating' }[cls];
    return { part, what, stress, rating, u, use, cls, txt };
  });
}
