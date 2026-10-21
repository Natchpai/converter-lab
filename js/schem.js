'use strict';

/* ================= schematic ================= */
function svgComp(type, x1, y1, x2, y2, id, cls = '') {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI, m = len / 2;
  const ln = (a, b, c, d) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`;
  let s = '';
  if (type === 'R') {
    s += ln(0, 0, m - 20, 0) + ln(m + 20, 0, len, 0);
    const pts = [[m - 20, 0]];
    for (let k = 0; k < 6; k++) pts.push([m - 20 + (k + 0.5) * 40 / 6, k % 2 ? 7 : -7]);
    pts.push([m + 20, 0]);
    s += `<polyline points="${pts.join(' ')}"/>`;
  } else if (type === 'L') {
    s += ln(0, 0, m - 30, 0) + ln(m + 30, 0, len, 0);
    s += `<path d="M${m - 30} 0 a7.5 7.5 0 0 1 15 0 a7.5 7.5 0 0 1 15 0 a7.5 7.5 0 0 1 15 0 a7.5 7.5 0 0 1 15 0"/>`;
  } else if (type === 'C') {
    s += ln(0, 0, m - 5, 0) + ln(m + 5, 0, len, 0);
    s += `<line class="plate" x1="${m - 5}" y1="-15" x2="${m - 5}" y2="15"/><line class="plate" x1="${m + 5}" y1="-15" x2="${m + 5}" y2="15"/>`;
  } else if (type === 'D') {
    s += ln(0, 0, m - 9, 0) + ln(m + 9, 0, len, 0);
    s += `<path class="dio" d="M${m - 9} -10 L${m + 9} 0 L${m - 9} 10 Z"/><line x1="${m + 9}" y1="-11" x2="${m + 9}" y2="11"/>`;
  } else if (type === 'S') {
    s += ln(0, 0, m - 18, 0) + ln(m + 18, 0, len, 0);
    s += `<circle class="term" cx="${m - 18}" cy="0" r="3"/><circle class="term" cx="${m + 18}" cy="0" r="3"/>`;
    s += `<line class="blade" data-cx="${m - 18}" x1="${m - 18}" y1="0" x2="${m + 15}" y2="0"/>`;
  }
  return `<g class="comp ${cls}" ${id ? `id="${id}"` : ''} transform="translate(${x1} ${y1}) rotate(${ang})">${s}</g>`;
}

const SCHEM = {
  buck: {
    S: [110, 60, 190, 60], L: [250, 60, 370, 60], D: [220, 210, 220, 60], Cx: 440, Rx: 520,
    wires: [[[60, 60], [110, 60]], [[190, 60], [250, 60]], [[370, 60], [520, 60]], [[60, 210], [520, 210]]],
    nodes: [[220, 60], [440, 60], [220, 210], [440, 210]],
    loops: {
      on: [[60, 210], [60, 60], [520, 60], [520, 210], [60, 210]],
      off: [[220, 210], [220, 60], [520, 60], [520, 210], [220, 210]],
      cap: [[440, 60], [520, 60], [520, 210], [440, 210], [440, 60]],
    },
    lbl: { S: [150, 96, 'middle'], L: [310, 38, 'middle'], iL: [310, 96, 'middle'], D: [236, 132, 'start'], vx: [220, 46, 'middle'] },
  },
  boost: {
    S: [260, 60, 260, 210], L: [100, 60, 220, 60], D: [290, 60, 370, 60], Cx: 440, Rx: 520,
    wires: [[[60, 60], [100, 60]], [[220, 60], [290, 60]], [[370, 60], [520, 60]], [[60, 210], [520, 210]]],
    nodes: [[260, 60], [440, 60], [260, 210], [440, 210]],
    loops: {
      on: [[60, 210], [60, 60], [260, 60], [260, 210], [60, 210]],
      off: [[60, 210], [60, 60], [520, 60], [520, 210], [60, 210]],
      cap: [[440, 60], [520, 60], [520, 210], [440, 210], [440, 60]],
    },
    lbl: { S: [276, 140, 'start'], L: [160, 38, 'middle'], iL: [160, 96, 'middle'], D: [330, 96, 'middle'], vx: [260, 46, 'middle'] },
  },
  bb: {
    S: [100, 60, 180, 60], L: [230, 60, 230, 210], D: [350, 60, 270, 60], Cx: 440, Rx: 520,
    wires: [[[60, 60], [100, 60]], [[180, 60], [270, 60]], [[350, 60], [520, 60]], [[60, 210], [520, 210]]],
    nodes: [[230, 60], [440, 60], [230, 210], [440, 210]],
    loops: {
      on: [[60, 210], [60, 60], [230, 60], [230, 210], [60, 210]],
      off: [[230, 60], [230, 210], [520, 210], [520, 60], [230, 60]],
      cap: [[440, 210], [520, 210], [520, 60], [440, 60], [440, 210]],
    },
    lbl: { S: [140, 96, 'middle'], L: [246, 124, 'start'], iL: [246, 144, 'start'], D: [310, 96, 'middle'], vx: [230, 46, 'middle'] },
  },
};

function buildSchem() {
  const L = SCHEM[state.topo], sync = state.sync;
  const pts = a => a.map(p => p.join(',')).join(' ');
  let s = `<svg viewBox="-34 0 614 240" role="img" aria-label="${state.topo} converter schematic">`;
  for (const k of ['on', 'off', 'cap']) s += `<polyline class="glow g-${k}" id="glow-${k}" points="${pts(L.loops[k])}"/>`;
  for (const k of ['on', 'off', 'cap']) s += `<polyline class="flow g-${k}" id="flow-${k}" points="${pts(L.loops[k])}"/>`;
  for (const w of L.wires) s += `<polyline class="wire" points="${pts(w)}"/>`;
  // source
  s += `<g class="src"><line x1="60" y1="60" x2="60" y2="115"/><line x1="60" y1="155" x2="60" y2="210"/><circle cx="60" cy="135" r="20"/></g>`;
  s += `<text x="60" y="130" text-anchor="middle" class="big">+</text><text x="60" y="150" text-anchor="middle" class="big">−</text>`;
  s += `<text x="14" y="132" text-anchor="middle">V<tspan font-size="11" dy="3">in</tspan></text>`;
  s += `<text x="10" y="154" text-anchor="middle" class="val" id="lblVg"></text>`;
  s += svgComp('S', ...L.S, 'cS');
  s += sync ? svgComp('S', ...L.D, 'cD') : svgComp('D', ...L.D, 'cD');
  s += svgComp('L', ...L.L);
  s += svgComp('C', L.Cx, 60, L.Cx, 210);
  s += svgComp('R', L.Rx, 60, L.Rx, 210);
  for (const [x, y] of L.nodes) s += `<circle class="node" cx="${x}" cy="${y}" r="3.5"/>`;
  const t = (k, txt, cls = '', id = '') => { const [x, y, a] = L.lbl[k]; return `<text x="${x}" y="${y}" text-anchor="${a}" class="${cls}" ${id ? `id="${id}"` : ''}>${txt}</text>`; };
  s += t('S', '', 'big', 'lblS');
  s += t('L', 'L');
  s += t('iL', '', 'val', 'lblIL');
  s += t('D', '', 'big', 'lblD');
  s += t('vx', 'x', 'val');
  s += `<text x="${L.Cx - 22}" y="132" text-anchor="end">C</text><text x="${L.Cx - 22}" y="150" text-anchor="end" class="val" id="lblESR"></text>`;
  s += `<text x="${L.Rx + 16}" y="132">R</text><text x="${L.Rx + 16}" y="150" class="val" id="lblIo"></text>`;
  s += `<text x="${L.Cx}" y="44" text-anchor="middle" class="val" id="lblVo"></text>`;
  if (state.topo === 'bb') {
    s += `<text x="${L.Cx + 14}" y="84" text-anchor="middle" class="big">−</text><text x="${L.Cx + 14}" y="198" text-anchor="middle" class="big">+</text>`;
  }
  s += `</svg>`;
  els.schemSvg.innerHTML = s;
}

const DESC = {
  buck: {
    ON: 'S closed. L sees V<sub>in</sub> − V<sub>o</sub>, so i<sub>L</sub> ramps up. The source supplies i<sub>L</sub>.',
    OFF: 'S open. {D} carries i<sub>L</sub>. L sees about −V<sub>o</sub>, so i<sub>L</sub> ramps down.',
    IDLE: 'Both off. i<sub>L</sub> = 0 and v<sub>L</sub> = 0. C alone feeds the load. Switch node sits at V<sub>o</sub>.',
  },
  boost: {
    ON: 'S closed. L sees V<sub>in</sub>, so i<sub>L</sub> ramps up. C alone feeds the load.',
    OFF: 'S open. V<sub>in</sub> and L push i<sub>L</sub> through {D} into C and R. v<sub>L</sub> = V<sub>in</sub> − V<sub>o</sub> &lt; 0.',
    IDLE: 'Both off. i<sub>L</sub> = 0, switch node = V<sub>in</sub>. C alone feeds the load.',
  },
  bb: {
    ON: 'S closed. L sees V<sub>in</sub>, so i<sub>L</sub> ramps up. C alone feeds the load.',
    OFF: 'S open. L pushes i<sub>L</sub> through {D} and charges C negative. v<sub>L</sub> = V<sub>o</sub> &lt; 0.',
    IDLE: 'Both off. i<sub>L</sub> = 0, switch node = 0. C alone feeds the load.',
  },
};

function renderSchem() {
  const res = RES; if (!res) return;
  const [t1] = cursorTimes();
  const s = stateAt(res, t1), st = s.st, m = res.m;
  const v = k => m.sig(k, st, s.iL, s.vC);
  const blade = (id, closed) => {
    const b = document.querySelector(`#${id} .blade`); if (!b) return;
    const cx = b.getAttribute('data-cx');
    if (closed) b.removeAttribute('transform'); else b.setAttribute('transform', `rotate(-32 ${cx} 0)`);
  };
  blade('cS', st === ON);
  const cD = document.getElementById('cD');
  if (state.sync) blade('cD', st === OFF); else cD.classList.toggle('on', st === OFF);
  const rev = s.iL < 0;
  const capAct = st === IDLE || (st === ON && state.topo !== 'buck');
  [['on', st === ON], ['off', st === OFF], ['cap', capAct]].forEach(([k, a]) => {
    document.getElementById('glow-' + k).classList.toggle('act', a);
    const f = document.getElementById('flow-' + k);
    f.classList.toggle('act', a);
    f.classList.toggle('rev', k !== 'cap' && rev);
  });
  const dn = state.sync ? 'Q2' : 'D';
  document.getElementById('lblS').textContent = `S · ${st === ON ? 'ON' : 'OFF'}`;
  document.getElementById('lblD').textContent = `${dn} · ${st === OFF ? 'ON' : 'OFF'}`;
  document.getElementById('lblIL').textContent = `iL = ${fmtSI(s.iL, 'A')}`;
  document.getElementById('lblVo').textContent = `vo = ${fmtSI(v('vo'), 'V')}`;
  document.getElementById('lblVg').textContent = fmtSI(res.p.Vg, 'V', 3);
  document.getElementById('lblIo').textContent = fmtSI(res.p.R, 'Ω');
  document.getElementById('lblESR').textContent = state.nonideal ? `ESR ${fmtSI(res.p.rc, 'Ω')}` : '';
  const desc = DESC[state.topo][ST_NAME[st]].replace('{D}', state.sync ? 'Q2' : 'the diode D');
  let extra = '';
  if (st === OFF && s.iL < 0) extra = ' <b>i<sub>L</sub> is negative:</b> Q2 conducts backwards and energy returns toward the input.';
  if (st === ON && s.iL < 0) extra = ' <b>i<sub>L</sub> is still negative:</b> current flows back into the source through S.';
  const vals = [['iL', s.iL, 'A'], ['vL', v('vL'), 'V'], ['vsw', v('vsw'), 'V'], ['iin', v('iin'), 'A'],
    ['iD', v('iD'), 'A'], ['iC', v('iC'), 'A'], ['vC', v('vC'), 'V'], ['vo', v('vo'), 'V']];
  els.schemInfo.innerHTML =
    `<span class="stTag" style="color:${st === ON ? 'var(--glow-on)' : st === OFF ? 'var(--glow-off)' : 'var(--glow-cap)'}">${ST_NAME[st]} interval</span>` +
    ` at t = ${fmtSI(t1, 's', 4)}. ${desc}${extra}` +
    `<div class="vals">${vals.map(([n, x, u]) => `<span>${n} = ${fmtSI(x, u)}</span>`).join('')}</div>`;
}
