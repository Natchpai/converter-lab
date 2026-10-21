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
| 3 | Model hooks, complex helpers, averaged plant, Bode (plant) | done |
| 4 | Compensators, loop gain, fc/PM/GM, k-factor, op-amp values, VMC controls | done |
| 5 | Closed-loop switching sim (VMC), events, step metrics, period-map model | done |
| 6 | Peak current-mode control | in progress (math done, UI and tests not yet) |
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

### Phase 3: averaged plant and Bode plot
- `makeModel`: `m.der`, `m.vout`, optional `p.Ix` (current drawn from the output node).
  Defaults give bit-identical results (baseline self-test lines unchanged).
- `js/cplx.js`: `Cx` complex helpers, `quadRoots`.
- `js/plant.js`: `affineState`, `ccmAffine`, `averagedDC`, `ssTF`, `ssZeros`,
  `averagedPlant` (Gvd, Gid, Gvg, Zout, zeros, w0, Q), `dcmPlant` (reduced order),
  `plantAt` (picks CCM or DCM), `solveD0` (duty for a target |vo|).
- `js/bode.js`: `bodeSample` (log grid, unwrapped phase), `bodeAt`, `bodeDraw` (grid,
  fs/2 shading, markers, direct labels, drag handles, hover crosshair; returns geometry for
  hit tests). Series colors `--s1..--s5` (reference categorical slots, validator PASS light
  and dark; light has a contrast WARN, so curves carry direct labels + legend + hover text).
- `js/selftest-cl.js`: `runControlTests()`, called from `runSelfTests()`.
- Control page: Bode of the plant at the slider D, markers f0/fp, fESR, fRHP, fs/2, legend
  toggles, hover readout. Control page grid is wider for the Bode column above 1250 px.
- Checks (all VERIFIED by `node tests/run.js` and `node tests/browser.js selftest`):
  ideal buck Gvd(0) = Vg, f0 exact, no zeros; ideal boost Gvd(0) = Vg/(1−D)², f0 and RHP zero
  exact; ideal buck-boost Gvd(0) and RHP zero R(1−D)²/(D·L) exact; non-ideal buck ESR zero =
  1/(rc·C) exact; non-ideal Gvd(0) vs finite difference of the switched steady state < 0.04 %
  (all three); DCM Gd0 = dVo/dD of the DCM formula (1e-5); `solveD0` exact for ideal cases and
  reports "unreachable" for a lossy boost.
- DCM reduced-order formulas are now derived (linearized averaged diode current), not only
  recalled: buck wp = (2−M)/((1−M)RC), boost (2M−1)/((M−1)RC), buck-boost 2/(RC). Gd0 matches
  dVo/dD analytically. wp still to be cross-checked with the period-map model in Phase 5.

### Phase 4: compensators and VMC loop design
- `js/comp.js`: `COMP_TYPES` (P, I, PI, T2, T3), `compNorm`, `compEval`, `compPoly`,
  `polyMul/polyAdd/polyRoots` (Durand-Kerner, scaled), `phaseAt`, `loopMargins` (all 0 dB
  crossings with PM, −180° crossings with GM, conditional flag), `designComp` (k-factor with
  boost clamp + notes), `opampValues` / `opampEval` (Zf/Zin = H·Gc).
- `js/loop.js`: `VREF = 2.5`, `plantMarks`, `buildLoop(p, cfg)` (D0, plant, Gc, T, CL,
  Zout open/closed, margins, closed-loop poles, op-amp values, warnings), `suggestFc`.
- `logspace` moved to `cplx.js`; plants now carry `poly = { num, den }` of Gvd.
- Control page: left panel has mode (VMC only for now), Vo* (per topology), VM, Dmax and the
  operating point; D row hidden. Design panel: compensator type, its sliders (gain in dB too),
  target fc/PM, Auto design / Suggest fc / Textbook Type 3, loop result (fc, PM, GM, plant
  frequencies, closed-loop poles), warnings, op-amp SVG + part table (incl. Rbot), tips.
  Bode: Gvd, Gc (dashed), T, closed loop, closed-loop Zout; zero/pole handles on Gc.
  A topology change auto-designs with a suggested fc. Scope shows the open-loop waveform at D0.
- Checks (VERIFIED, Node + headless Edge):
  k-factor designs hit fc within 1 % and PM within 0.5° (buck T3/T2, DCM buck PI, buck I,
  boost T3, buck-boost T3, DCM boost T2); pole test agrees with PM sign; ideal buck Type 2
  above f0 is unstable (as theory says); buck PI below the LC peak gets 3 crossovers, is
  unstable and warned; op-amp Zf/Zin = H·Gc to 1e-15 for all five types; polyRoots on known
  polynomials.
- Screenshots checked: control page dark 1400 px; op-amp SVGs for all five types.

### Phase 5: closed-loop switching simulation (VMC)
- `js/simcl.js`: `makeCompSim` (integrator + first-order sections, Tustin with any step h,
  conditional-integration anti-windup, output clamp 0..1.25·VM), `simulateCL` (fixed grid of N
  steps per period, trailing-edge PWM with natural sampling: the step is split at the
  interpolated ramp/vc crossing, Dmax as an event, async diode zero crossing, boost IDLE start;
  per-period model index for load and Vin steps), `computeResCL` (scope result with
  `sigArray`, events), `periodAverages`, `clMetrics` (per-period average |vo|: final, overshoot,
  dip, settling within max(0.1 % Vo*, 10 % of the peak deviation)), `clSizes` (window
  20·fs/fc, ~100k steps), `periodMapVMC` (one-period map linearized by finite differences).
- Events: load step R → R/(1+s), Vin step, Vref step, soft-start from zero; optional step back.
- `results.js`: `sigArr` and `valueAt` use `res.sigArray` when present (closed-loop results).
- New scope signals (`CL_SIGNALS` in params.js): vc, ramp, duty, vref, vfb, verr, vo avg.
  The Control page channel list includes them. Event markers drawn on the scope.
- UI: Transient test block (event, step size, step back, length), step-response readouts,
  sim time readout. Compensator/target/circuit changes redraw the Bode plot at once and rerun
  the simulation after 200-250 ms.
- Correction to the plan: `simulate()` does not round D (it adapts the ON step length), so the
  VMC period map reuses it.
- Bugs found by tests and fixed: `sigArray` copied the whole buffer capacity; per-period
  averages misassigned the last sample of a period (float time drift), which made the dip
  depend on N.
- Checks (VERIFIED, Node + headless Edge): Tustin lead section vs analytic 2.7e-6; frozen-vc
  closed loop = open-loop steady state (duty exact); buck/boost/buck-boost load x2 and back
  settle to Vo* within 0.5 %, final duty = D0 within 1 %; dip identical at N = 50 and 400;
  buck soft-start overshoot 25 mV; period map vs averaged Gvd ≤ 0.42 dB up to fs/20 (buck,
  boost CCM); DCM slow pole from the period map = derived reduced-order wp within 0.02 %.
- Performance: closed-loop run ~150-190 ms in Node for 200x300 / 1000x94 steps.

### Phase 6 (in progress): peak current-mode control
Done (all existing tests still pass; no PCMC tests yet):
- `simulateCL`: `cfg.mode === 'pcmc'` turn-off rule Ri·iL + Se·(t − tclk) ≥ vc (S turns on at
  every clock, may turn off at once = pulse skip); recorded `ramp` is the comparator input
  Ri·iL + Se·t in PCMC. Options `x0`, `vc0`, `vcLim` start from a given state (period map).
  Compensator clamp in PCMC: 0..`L.vcMax` (= `cfg.vcMax`).
- `simcl.js`: `linearizePeriod` (generic), `periodMapVMC` refactored onto it,
  `pcmcPeriodFn`, `solve3`, `pcmcOperatingPoint` (Newton on iL0, vC0, vc for |vo| = Vt),
  `pcmcPlant` (cached; Gvc from the period map; Sn, Sf, Se = mSe·Sf, mc, Qp, analytic α,
  period-map eigenvalues lamC / lamV, fp, vc0).
- `loop.js` `buildLoop`: PCMC branch (plant = `pcmcPlant`, Fm = 1, `L.Se`, `L.vc0`,
  `L.vcMax`, fmax = fs/2, no Zout curve, no pole polynomial: stability from margins and
  |lamC| < 1), subharmonic / Qp / convergence warnings, `L.plantName`, `L.plantShort`.

To do next (in this order):
1. `CTL.cfg` in control-ui.js: add `Ri: 0.5, mSe: 0.5, vcMax: 4`. Make the side rows depend
   on mode (VMC: Vt, Vm, Dmax; PCMC: Vt, Ri, mSe "Slope comp Se/Sf" 0..2, Dmax), rebuild on mode
   change, enable the "Peak CMC" button in `#ctlMode` (add a click handler: set mode, set comp
   type T2 for PCMC / T3 for VMC, `autoDesign('suggest')`, rebuild rows, `requestCompute()`).
   Button "Se = Sf/2".
2. `renderControl`: use `L.plantName` / `L.plantShort` for the plant curve, skip the Zout
   curve when `L.Zcl` is null, show Sn, Sf, Se, mc, Qp, α (analytic) and lamC (period map),
   vc0 in `#ctlOp` for PCMC; `polesText` must handle `L.poles === null`.
3. Tests in selftest-cl.js: (a) ideal buck CCM: period-map lamC vs α = −(Sf−Se)/(Sn+Se) within
   2 % for mSe = 0.5; (b) PCMC closed loop (T2 auto design) load step settles to Vo*;
   (c) subharmonic: buck Vt = 8 V (D ≈ 0.67), mSe = 0 → iL at clock edges alternates
   > 5 % of ΔiL in the last 20 periods; mSe = 0.5 → < 0.5 %. Use the same compensator for both.
4. Screenshot the Control page in PCMC, then commit Phase 6 and update this file.
Later phases (7 ACMC, 8 FRA, 9 drag + polish) as in the plan table.

## Formula notes

Web research could confirm only the Type 3 k-factor equations
(https://arxiv.org/html/2310.14910, Eqs. 39-43). Other formulas are derived in code or
checked by self tests (see the plan's "Formula sources" table). Readable PDFs of Erickson
Ch. 11/12, Ridley 1991 or TI SLUA079 in `refs/` would allow confirming the rest.

## Next step

Finish Phase 6 with the numbered list in "Phase 6 (in progress)" above.
