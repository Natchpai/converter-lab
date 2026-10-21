'use strict';

/* ================= constants and parameters ================= */
// Switch-network states.
// ON: S conducts. OFF: rectifier conducts (diode D, or the Q2 channel in sync).
// IDLE: nothing conducts (DCM); the switch node floats and rings if Cn > 0.
// BDR: body diode of Q2 conducts (sync dead time, iL > 0). BDS: body diode of S conducts (iL < 0).
const ON = 0, OFF = 1, IDLE = 2, BDR = 3, BDS = 4;
const ST_NAME = ['ON', 'OFF', 'IDLE', 'BD-Q2', 'BD-S'];

const SIGNALS = [
  { k: 'vg',   n: 'Vin',  u: 'V', d: 'Input voltage' },
  { k: 'iin',  n: 'iin',  u: 'A', d: 'Input current from the source' },
  { k: 'iL',   n: 'iL',   u: 'A', d: 'Inductor current' },
  { k: 'vL',   n: 'vL',   u: 'V', d: 'Inductor voltage (terminals, includes DCR drop)' },
  { k: 'vsw',  n: 'vsw',  u: 'V', d: 'Switch node voltage vx to ground' },
  { k: 'vDS',  n: 'vS',   u: 'V', d: 'Voltage across main switch S' },
  { k: 'iSW',  n: 'iS',   u: 'A', d: 'Current in main switch S' },
  { k: 'iD',   n: 'iD',   u: 'A', d: 'Current in diode D or sync FET Q2' },
  { k: 'vD',   n: 'vD',   u: 'V', d: 'Voltage across D or Q2 (anode to cathode)' },
  { k: 'vC',   n: 'vC',   u: 'V', d: 'Capacitor voltage (ideal C, without ESR)' },
  { k: 'iC',   n: 'iC',   u: 'A', d: 'Capacitor current' },
  { k: 'vo',   n: 'vo',   u: 'V', d: 'Output voltage (includes ESR)' },
  { k: 'io',   n: 'io',   u: 'A', d: 'Load current' },
  { k: 'gate', n: 'gate', u: '',  d: 'Gate signal of S (1 = ON)' },
];
// Extra signals that exist only in the closed-loop simulation (Control page).
const CL_SIGNALS = [
  { k: 'vc',    n: 'vc',    u: 'V', d: 'Control voltage (compensator output)' },
  { k: 'ramp',  n: 'ramp',  u: 'V', d: 'Signal compared with vc (VMC: PWM ramp, PCMC: Ri·iL + Se·t)' },
  { k: 'duty',  n: 'duty',  u: '',  d: 'Duty cycle of each period' },
  { k: 'vref',  n: 'vref',  u: 'V', d: 'Reference voltage' },
  { k: 'vfb',   n: 'vfb',   u: 'V', d: 'Feedback H·|vo|' },
  { k: 'verr',  n: 'verr',  u: 'V', d: 'Error vref − H·|vo|' },
  { k: 'voavg', n: 'vo avg', u: 'V', d: 'Output voltage averaged over each period' },
  { k: 'isense', n: 'Ri·iL', u: 'V', d: 'Sensed inductor current Ri·iL (current modes)' },
  { k: 'iref',  n: 'iref',  u: 'V', d: 'Current reference from the voltage loop (Avg CMC), in volts of Ri·iL' },
];
const SIG = Object.fromEntries([...SIGNALS, ...CL_SIGNALS].map(s => [s.k, s]));
const CH_COLORS = ['#facc15', '#22d3ee', '#f472b6', '#4ade80'];
// Scope screen colors. Dark is the default; light is for saving pictures (PNG export).
const SCOPE_PAL = {
  dark: {
    bg: '#070b10', labelBg: 'rgba(7,11,16,0.78)', stName: 'rgba(203,213,225,0.55)', grid: 'rgba(255,255,255,0.08)',
    axis: 'rgba(255,255,255,0.20)', lane: 'rgba(255,255,255,0.22)', mark: '#fb923c', c1: '#f8fafc', c2: '#94a3b8', glow: 3,
    ch: CH_COLORS,
    fill: ['rgba(34,197,94,0.10)', 'rgba(249,115,22,0.09)', 'rgba(148,163,184,0.10)', 'rgba(192,132,252,0.22)', 'rgba(192,132,252,0.22)'],
  },
  light: {
    bg: '#ffffff', labelBg: 'rgba(255,255,255,0.85)', stName: 'rgba(51,65,85,0.70)', grid: 'rgba(15,23,42,0.10)',
    axis: 'rgba(15,23,42,0.30)', lane: 'rgba(15,23,42,0.30)', mark: '#c2410c', c1: '#0f172a', c2: '#64748b', glow: 0,
    ch: ['#a16207', '#0e7490', '#be185d', '#15803d'],
    fill: ['rgba(34,197,94,0.12)', 'rgba(249,115,22,0.12)', 'rgba(100,116,139,0.10)', 'rgba(147,51,234,0.14)', 'rgba(147,51,234,0.14)'],
  },
};
const scopePal = () => SCOPE_PAL[state.scopeBg] || SCOPE_PAL.dark;
const chColor = i => scopePal().ch[i];

const PARAMS = [
  { k: 'Vg', label: 'Input voltage V<sub>in</sub>', unit: 'V', min: 1, max: 400, step: 0.1, def: 12 },
  { k: 'D',  label: 'Duty cycle D', unit: '', min: 0.02, max: 0.95, step: 0.001, def: 0.5 },
  { k: 'fs', label: 'Switching frequency f<sub>s</sub>', unit: 'Hz', min: 10e3, max: 2e6, log: true, def: 100e3 },
  { k: 'L',  label: 'Inductance L', unit: 'H', min: 0.1e-6, max: 10e-3, log: true, def: 100e-6 },
  { k: 'C',  label: 'Capacitance C', unit: 'F', min: 0.1e-6, max: 10e-3, log: true, def: 100e-6 },
  { k: 'R',  label: 'Load resistance R', unit: 'Ω', min: 0.1, max: 10e3, log: true, def: 10 },
];
const NONIDEAL = [
  { k: 'rc',   label: 'Capacitor ESR', unit: 'Ω', min: 0, max: 1, step: 0.001, def: 0.05 },
  { k: 'rL',   label: 'Inductor DCR', unit: 'Ω', min: 0, max: 1, step: 0.001, def: 0.05 },
  { k: 'ron',  label: 'Switch S R<sub>on</sub>', unit: 'Ω', min: 0, max: 1, step: 0.001, def: 0.03 },
  { k: 'ron2', label: 'Sync FET Q2 R<sub>on</sub>', unit: 'Ω', min: 0, max: 1, step: 0.001, def: 0.03, only: 'sync' },
  { k: 'Vf',   label: 'Diode drop V<sub>f</sub>', unit: 'V', min: 0, max: 2, step: 0.01, def: 0.5, only: 'async' },
  { k: 'td',   label: 'Dead time t<sub>d</sub>', unit: 's', min: 0, max: 500e-9, step: 1e-9, def: 30e-9, only: 'sync' },
  { k: 'Vbd',  label: 'Body diode drop V<sub>bd</sub>', unit: 'V', min: 0, max: 2, step: 0.01, def: 0.7 },
  { k: 'Cn',   label: 'Switch node capacitance C<sub>node</sub>', unit: 'F', min: 0, max: 5e-9, step: 1e-12, def: 300e-12 },
];
const PDEF = Object.fromEntries([...PARAMS, ...NONIDEAL].map(d => [d.k, d]));

const state = {
  topo: 'buck', nonideal: false, sync: false, view: 'steady',
  layout: 'split', theory: true, shade: true, scopeBg: 'dark',
  tdiv: 'auto', hpos: 0.1, win: 'auto',
  c1: 0.3, c2: 0.55, playing: false, applyNote: '',
  p: {},
  ch: [
    { on: true, sig: 'iL',  scale: 'auto', pos: 0, ac: false },
    { on: true, sig: 'vL',  scale: 'auto', pos: 0, ac: false },
    { on: true, sig: 'vsw', scale: 'auto', pos: 0, ac: false },
    { on: true, sig: 'vo',  scale: 'auto', pos: 0, ac: false },
  ],
  page: 'converter', simPage: 'converter',
};
// Each page keeps its own channel setup and time base.
state.pages = {
  converter: { ch: state.ch, tdiv: 'auto', hpos: 0.1 },
  control: {
    ch: [
      { on: true, sig: 'vo',   scale: 'auto', pos: 0, ac: false },
      { on: true, sig: 'iL',   scale: 'auto', pos: 0, ac: false },
      { on: true, sig: 'vc',   scale: 'auto', pos: 0, ac: false },
      { on: true, sig: 'duty', scale: 'auto', pos: 0, ac: false },
    ],
    tdiv: 'auto', hpos: 0,
  },
};
function resetParams() { for (const d of [...PARAMS, ...NONIDEAL]) state.p[d.k] = d.def; }
resetParams();
