// Node test runner: loads the pure (no DOM) script files in page load order into one
// context and runs the same self tests as index.html?selftest.
// Usage: node tests/run.js [--strip]   (--strip removes timings, for diffs)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PURE = ['params', 'util', 'model', 'sim', 'theory', 'results', 'selftest'];

const js = path.join(__dirname, '..', 'js');
const code = PURE.map(n => `// ---- ${n}.js\n` + fs.readFileSync(path.join(js, n + '.js'), 'utf8')).join('\n;\n')
  + '\n;runSelfTests();';
const ctx = vm.createContext({ console, performance, Math, Float64Array, Float32Array, Uint8Array });
const res = vm.runInContext(code, ctx, { filename: 'pure-bundle.js' });

let lines = res.lines;
if (process.argv.includes('--strip')) lines = lines.map(s => s.replace(/\s+\d+\.\d ms$/, ''));
console.log(lines.join('\n'));
process.exit(res.allPass ? 0 : 1);
