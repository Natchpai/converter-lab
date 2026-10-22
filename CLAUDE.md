# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Interactive DC-DC converter lab (buck, boost, buck-boost; CCM/DCM) with four pages: Design
(sizing, corners, ratings), Converter (scope), Losses (breakdown, efficiency vs load) and Control
(VMC, peak CMC, average CMC, compensators, Bode, closed-loop switching sim, FRA).
Vanilla JS, no build, no dependencies. `checkpoint.md` holds the phase log, test results,
formula sources and open items; read it before larger changes.

## Commands

- Run: open `index.html` directly (file://). URL options: `?page=design|losses|control`,
  `?mode=pcmc|acmc`, `?theme=light|dark`, `?selftest`, `?uitest`.
- `node tests/run.js [--strip]`: all pure self tests in Node (~7 s). `--strip` removes
  timings so two runs can be diffed. There is no single-test runner; filter the output
  (`node tests/run.js | grep PCMC`).
- `node tests/browser.js selftest`: same tests in headless Edge/Chrome (`index.html?selftest`).
- `node tests/browser.js uitest`: clicks through the Control page (`js/uitest.js`): every
  compensator type per mode, mode switches, topologies, presets, Bode drag, an FRA run.
- `node tests/browser.js shot out.png [W H] [query]`: screenshot. Headless Chrome renders
  about 500 px minimum width.
- Edge 155 returns an empty `--dump-dom`; `browser.js` falls back to the next browser (Chrome).

Regression practice: a change meant to be behaviour-neutral must leave every existing test
line identical (diff `--strip` output before and after). Exception: the "PCMC subharmonic"
Se = 0 number is an unstable limit cycle and moves with float-level changes.

## Script layout and load order

- Classic `<script>` tags in global scope (ES modules are blocked on file://). Load order in
  `index.html` is the dependency order.
- Pure files (no DOM) are also concatenated by `tests/run.js` (`PURE` list). A new pure file
  goes into both `index.html` and `PURE`, in the same order.
- Control-page UI state lives in the single global `CTL` (`js/control-ui.js`), because short
  names (`label`, `MM`, ...) are already taken by converter-page globals.
- `state.page` is one of design, converter, losses, control. Converter and Control share the
  scope: `state.pages[page]` keeps their channels and time base, `state.simPage` is the one
  loaded in `state.ch`. `compute()`, `renderAll()`, `renderLiveNow()` run only on those two
  (`onSimPage()`); Design and Losses render through `requestDesign()` / `requestLosses()`.

## Page layout

- App shell (`css/app.css`, last block): at >= 1100x600 px the page fits the window; every page
  is a sidebar (inputs, collapsible `details.sec`) plus a workspace, each scrolling on its own.
  Smaller windows use normal page scroll. `SHELL` (`js/ui.js`) is the same media query in JS.
- In the shell the scope and Bode canvases take their height from the layout (`resize()`,
  `sizeBode()`); outside it they keep the width-based / fixed heights.
- Converter and Control share one tabbed inspector (`#inspector`, `TABS` and `showTab` in
  `js/ui.js`); tab buttons and panes use `convOnly` / `ctlOnly`. Control results go into the
  panes `#ctlLoop` and `#ctlAmp`; its sliders into `#ctlSide` and `#ctlTrans` (`buildControlUI`).
- Drag handles (`.splitter`, `bindSplitter` in `js/ui.js`) set CSS variables on the page's
  `main`: `#scopeSplit` scope height (`--top`/`--bot`, per page), `#colSplit` bottom-row split
  (`--cl`/`--cr`, per page), `.vside` sidebar width (`--side`, per layout). Saved in localStorage.
  Do not name a split variable like a style token (`--r` is the radius).
- Header option groups never hide: groups that do not apply are disabled in `setPage`
  (`simOpt`, `convOpt`), so the header does not shift between pages.
- `#selftest` (test output of `?selftest` / `?uitest`) is a block after the mains, outside any
  page, so it shows on every page; `tests/browser.js` reads it from the dumped DOM by id.
- The shell media query is `screen` only, so printing never gets the fixed-height layout.
- Published on GitHub Pages under a subpath: keep asset paths relative and file names in exact case.

## Architecture (Control page)

- `makeModel` (`js/model.js`) is the switched model shared by everything; `m.der`, `m.vout`
  give the exact affine form per switch state. `m.vout` is |vo| (buck-boost is regulated by
  magnitude). Dead time (`td`), body diodes (states BDR, BDS) and node capacitance (`Cn`, extra
  state `vn`) only run through `simulateFree` (`js/sim.js`); with td = Cn = 0 `simulate` uses
  the old loop, so control results do not change. The Control page forces td = Vbd = Cn = 0
  in `effParams` because `simcl.js` is 2-state.
- `js/design.js` / `js/losses.js` (pure): `designRun` sizes L/C and solves D at three Vin
  corners with `computeRes` (`solveDuty`); `lossBreakdown` reads the steady-state waveforms.
- `js/plant.js`: averaged CCM plant from that affine form (Gvd, Gid, Gvg, Zout, polynomials),
  DCM reduced-order plant, `solveD0` (duty for a target |vo|).
- `js/comp.js`: one compensator form for P/I/PI/T2/T3 (`compNorm`, `compEval`), margins,
  k-factor `designComp`, op-amp values.
- `js/loop.js` `buildLoop(p, cfg)` returns the loop object `L` (plant, Gc, T, CL, margins,
  closed-loop poles, warnings; ACMC adds Gci, Ti, Gvi, `L.mi`, `L.slope`). `L` is the hub:
  the UI, the switching sim, FRA and the tests all take it.
- `js/simcl.js` `simulateCL(L, opt)`: closed-loop event-split stepper for all three modes
  (natural-sampling PWM, blanking, Dmax, diode zero crossing, events, FRA injection).
  `simulateCLSteps` is the same run as a generator (used to slice FRA in the page).
  `computeResCL` wraps it into the scope's result object.
- Period-map models (`linearizePeriod`): one switching period linearized by finite
  differences. Used for the PCMC plant (`pcmcPlant`), ACMC in DCM (`acmcPlant`), and as an
  exact reference in tests.
- `js/fra.js`: frequency response measured on `simulateCL` (test frequency fs/k, a reference
  run without the sine is subtracted).
- `js/bode.js` draws; `js/control-ui.js` builds panels and wires everything.

## Gotchas

- `syncRows` throws on a missing slider row on purpose. Build rows (`buildCompRows`,
  `buildCiRows`, `buildSideRows`) before `autoDesign`, which syncs the rows of the new type.
- Caches keyed by `JSON.stringify` of params (`PCMC_CACHE`, `ACMC_CACHE`): a new config field
  that changes the result must be added to the key.
- Formulas without a readable source are checked by tests (period map, finite differences,
  switching sim), not by citation; see "Formula notes" in `checkpoint.md`.
