// Headless browser checks (Windows: Edge or Chrome).
//   node tests/browser.js selftest | uitest     -> prints the #selftest text of index.html?selftest (or ?uitest)
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
const found = BROWSERS.filter(p => fs.existsSync(p));
if (!found.length) { console.error('No Edge or Chrome found'); process.exit(2); }

const page = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const base = ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--virtual-time-budget=60000'];
// One fresh profile per call: a browser that hands off to another process keeps its profile
// locked, and a second browser on the same profile exits at once.
const profiles = [];
const run = (args, exe = found[0]) => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'dcdc-headless-'));
  profiles.push(prof);
  return execFileSync(exe, [...base, `--user-data-dir=${prof}`, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000, stdio: ['ignore', 'pipe', 'ignore'] });
};
const cleanup = () => {
  for (const p of profiles) try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp dir, left for the OS */ }
};

const [cmd, ...rest] = process.argv.slice(2);
let code = 0;
try {
  if (cmd === 'selftest' || cmd === 'uitest') {
    // Edge 155 returns an empty --dump-dom, so try the next browser when that happens
    let dom = '';
    for (const exe of found) {
      try { dom = run(['--dump-dom', page + '?' + cmd], exe); } catch { dom = ''; }
      if (dom.length) { console.error('browser:', path.basename(exe)); break; }
    }
    const m = dom.match(/<(\w+)[^>]*\bid="selftest"[^>]*>([\s\S]*?)<\/\1>/);
    const txt = m ? m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '(no #selftest output)';
    console.log(txt);
    code = /ALL PASS/.test(txt) ? 0 : 1;
  } else if (cmd === 'shot') {
    const [out, W = 1400, H = 1000, q = ''] = rest;
    run([`--screenshot=${path.resolve(out)}`, `--window-size=${W},${H}`, page + (q ? '?' + q : '')]);
    console.log('wrote', path.resolve(out));
  } else {
    console.error('usage: node tests/browser.js selftest | uitest | shot out.png [W H] [query]');
    code = 2;
  }
} finally {
  cleanup();
}
process.exit(code);
