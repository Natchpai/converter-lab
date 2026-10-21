// Headless browser checks (Windows: Edge or Chrome).
//   node tests/browser.js selftest              -> prints the #selftest text of index.html?selftest
//   node tests/browser.js shot out.png [W H] [query]  -> screenshot, e.g. query "page=control&theme=dark"
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const exe = BROWSERS.find(p => fs.existsSync(p));
if (!exe) { console.error('No Edge or Chrome found'); process.exit(2); }

const page = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'dcdc-headless-'));
const base = ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--user-data-dir=${prof}`, '--virtual-time-budget=20000'];
const run = args => execFileSync(exe, [...base, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] });

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'selftest') {
    const dom = run(['--dump-dom', page + '?selftest']);
    const m = dom.match(/<div id="selftest">([\s\S]*?)<\/div>/);
    const txt = m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '(no #selftest output)';
    console.log(txt);
    process.exit(/ALL PASS/.test(txt) ? 0 : 1);
  } else if (cmd === 'shot') {
    const [out, W = 1400, H = 1000, q = ''] = rest;
    run([`--screenshot=${path.resolve(out)}`, `--window-size=${W},${H}`, page + (q ? '?' + q : '')]);
    console.log('wrote', path.resolve(out));
  } else {
    console.error('usage: node tests/browser.js selftest | shot out.png [W H] [query]');
    process.exit(2);
  }
} finally {
  fs.rmSync(prof, { recursive: true, force: true });
}
