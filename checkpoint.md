# Checkpoint: Control page for the DC-DC Converter Lab

Work branch: `feat/control-lab` (baseline of the original single file is on `main`).
Full plan: VMC, peak CMC, average CMC; P / I / PI / Type 2 / Type 3; Bode with fc/PM/GM;
k-factor design; closed-loop switching sim with load / Vin / Vref steps; FRA from the sim;
op-amp R/C values; drag poles/zeros on the Bode plot.

## How to check

- `node tests/run.js` runs the pure self tests in Node (`--strip` removes timings).
- `node tests/browser.js selftest` runs `index.html?selftest` in headless Edge/Chrome.
- `node tests/browser.js shot out.png 1400 1000` takes a screenshot.

## Phases

| # | Phase | Status |
|---|---|---|
| 0 | git init, baseline commit on main, branch | done |
| 1 | Split index.html into css/js files, Node test runner | done |
| 2 | Page switch scaffold (Converter / Control) | done |
| 3 | Model hooks, complex helpers, averaged plant, Bode (plant) | todo |
| 4 | Compensators, loop gain, fc/PM/GM, k-factor, op-amp values, VMC controls | todo |
| 5 | Closed-loop switching sim (VMC), events, step metrics, period-map model | todo |
| 6 | Peak current-mode control | todo |
| 7 | Average current-mode control | todo |
| 8 | FRA from the switching sim | todo |
| 9 | Drag poles/zeros, tips, DCM notes, polish | todo |

## Log

### Phase 0
- `git init -b main`, commit `659ca67` with the untouched `index.html`, branch `feat/control-lab`.

### Phase 1: file split
- `index.html` now holds markup only. Styles in `css/app.css`. Script split by exact line
  ranges into `js/params.js, util.js, model.js, sim.js, theory.js, results.js, scope.js,
  schem.js, theorypanel.js, ui.js, selftest.js, main.js` (classic scripts, load order = this
  list). The only code change: `selfTest()` became pure `runSelfTests()` + a DOM wrapper.
- New `tests/run.js` (Node) and `tests/browser.js` (headless browser).
- Checks:
  - VERIFIED: concatenated js files = original script body; css = original style block.
  - VERIFIED: Node self-test and headless Edge `?selftest` lines identical to the baseline
    (timings stripped), ALL PASS.
  - VERIFIED: 1400x1000 dark screenshot of the split page is byte-identical to the baseline.
  - NOT_VERIFIED: light theme and 820 px screenshots (css is byte-identical, so low risk).
- Known issue (also in the original): `resize()` runs in a ResizeObserver callback, clears
  the canvas, and redraws one frame later via rAF. Headless screenshots sometimes catch the
  blank canvas. Fix in Phase 2 by drawing synchronously in `resize()`.

### Phase 2: page switch scaffold
- Header seg `data-group="page"` (Converter | Control) sets `body[data-page]`; CSS classes
  `.convOnly` / `.ctlOnly` hide page-specific parts. New panels `.bode` (grid area
  `schem`) and `.design` (grid area `theory`), side box `#ctlSide`.
- `state.page`, `state.pages[page] = { ch, tdiv, hpos }`: each page keeps its channels and
  time base. `setPage()` in ui.js. `compute()` calls `computeControl()` on the Control page.
- `renderLiveNow()` / `renderAll()` dispatch per page; `drawPageCanvas()` draws the mode
  map or the Bode plot (used by resize and theme change).
- `resize()` now draws synchronously (fixes the blank-frame race from Phase 1).
- URL query: `?page=control`, `?theme=light|dark` (handy for screenshots).
- `js/control-ui.js`: `CTL` object, placeholders `buildControlUI`, `computeControl`
  (open-loop steady state for now), `renderControl`, `renderControlLive`, `sizeBode`, `drawBode`.
- Checks:
  - VERIFIED: Node and headless Edge self-test lines identical to the baseline.
  - VERIFIED: screenshots of both pages (1400 px dark, phone light) render traces.
  - Note: headless Edge has a minimum viewport near 500 px; a 390 px capture is cropped (same
    for the baseline). Use ~500 px for phone checks.

## Formula notes

Web research could confirm only the Type 3 k-factor equations
(https://arxiv.org/html/2310.14910, Eqs. 39-43). Other formulas are derived in code or
checked by self tests (see the plan's "Formula sources" table). Readable PDFs of Erickson
Ch. 11/12, Ridley 1991 or TI SLUA079 in `refs/` would allow confirming the rest.

## Next step

Phase 3: `makeModel` hooks (`m.der`, `m.vout`, `p.Ix`), `js/cplx.js`, `js/plant.js`
(averaged CCM plant, DCM reduced order, D0 solve), Bode canvas with the plant curve.
