# Checkpoint: Control page for the DC-DC Converter Lab

Work branch: `feat/control-lab` (baseline of the original single file is on `main`).
Full plan: VMC, peak CMC, average CMC; P / I / PI / Type 2 / Type 3; Bode with fc/PM/GM;
k-factor design; closed-loop switching sim with load / Vin / Vref steps; FRA from the sim;
op-amp R/C values; drag poles/zeros on the Bode plot.

## How to check

- `node tests/run.js` runs the pure self tests in Node (`--strip` removes timings).
- `node tests/browser.js selftest` runs `index.html?selftest` in headless Edge/Chrome.
- `node tests/browser.js uitest` runs `index.html?uitest`: clicks through the Control page
  (every compensator type in VMC and PCMC, mode switches, topologies, presets) and checks for
  errors, missing slider rows, NaN readouts and non-finite Bode curves.
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
| 6 | Peak current-mode control | done |
| 7 | Average current-mode control | done |
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

### Phase 6: peak current-mode control
Math (simulator, period map, operating point, loop):
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

- `loop.js`: warning when vc at the operating point is above 0.8·vcMax (current limit acts).

UI (`control-ui.js`):
- `CTL.cfg` has `Ri: 0.5, mSe: 0.5, vcMax: 4`. `CTL_SIDE` is now a keyed object;
  `CTL_SIDE_KEYS[mode]` picks the rows (VMC: Vt, Vm, Dmax; PCMC: Vt, Ri, mSe, Dmax).
  `buildSideRows()` rebuilds `#ctlSideRows`, adds the "Se = Sf/2" button in PCMC and hides
  "Textbook Type 3" (VMC only).
- `#ctlMode` click: set mode, Type 2 for PCMC / Type 3 for VMC, `autoDesign('suggest')`,
  rebuild rows. Avg CMC button still disabled.
- `renderControl`: plant curve named from `L.plantName/plantShort`, curves with no `H` (Zout in
  PCMC) are dropped. `#ctlOp` (PCMC): switched D, H, vc0. Loop result (PCMC): Sn, Sf, Se, mc,
  Qp (shows "–" when mc·D′ ≤ 0.5), analytic α, period-map pole, averaged D0. No pole list.
- PCMC tips (`pcmcTips`), op-amp SVG says "to current comparator", Bode hint text per mode.
- `?mode=pcmc` URL query (clicks the mode button at start; for screenshots).
- `CL_SIGNALS.ramp` description covers both modes.

Tests (`selftest-cl.js`, all VERIFIED in Node and headless Chrome):
- period-map current-loop pole vs α at Se = Sf/2: buck −0.2633 vs −0.2632, boost −0.3334 vs
  −0.3333 (plan bound 2 %).
- Gvc(0) of the period map vs dVo/dvc from two PCMC operating points (Vo* ± 10 mV), lossy
  buck: 0.001 % (plan bound 2 %).
- closed loop, auto-designed Type 2: buck fc 10 kHz and boost fc 2 kHz, PM 60.0°, load x2 and
  back settle to Vo* within 0.5 %.
- subharmonic, ideal buck Vo* = 8 V (D = 0.667), same compensator: iL change between clock
  edges 200 % of ΔiL at Se = 0 (α = −2, warned, unstable), 0.0033 % at Se = Sf/2. The Se = 0
  number differs a little between engines (Node 200.4 %, Chrome 206.9 %): it is an unstable
  limit cycle, so float differences grow. Bounds (> 5 %, < 0.5 %) hold in both.

Test tooling (`tests/browser.js`): Edge 155 now returns an empty `--dump-dom` (screenshots
still work). `selftest` tries each installed browser until one returns a DOM (Chrome here) and
prints the browser name on stderr. Each call gets a fresh profile (a second browser on a
profile that Edge still locks exits with status 21); cleanup no longer throws on a locked dir.

Screenshots checked: Control page PCMC dark and light at 1400 px, PCMC at 520 px, VMC dark
1400 px (unchanged). NOT_VERIFIED: switching PCMC → VMC by hand in a real browser (the
VMC → PCMC click path runs at start with `?mode=pcmc`).

## Formula notes

Web research could confirm only the Type 3 k-factor equations
(https://arxiv.org/html/2310.14910, Eqs. 39-43). Other formulas are derived in code or
checked by self tests (see the plan's "Formula sources" table). Readable PDFs of Erickson
Ch. 11/12, Ridley 1991 or TI SLUA079 in `refs/` would allow confirming the rest.

### Phase 6 review (fixes, tests, blanking)
Read-only review of Phase 6, then fixes. Plan: `~/.claude/plans/breezy-frolicking-parrot.md`.
- Bug since Phase 4: the compensator-type, mode and Textbook handlers ran `autoDesign()`
  (which syncs the rows of the new type) before `buildCompRows()`. Switching to a type with
  parameters the old rows lacked threw (any → Type 3 or I, P → PI/T2, I → any, PCMC → VMC).
  Fixed by building the rows first. Found and confirmed by the new UI test (FAIL before,
  PASS after).
- PCMC with no steady state (target above the reachable Vo, duty limit): Newton hit a
  singular Jacobian and gave NaN everywhere. `pcmcOperatingPoint` now keeps the best finite
  iterate and uses a strict `ok` (all residuals < 1e-9 scale). At the duty limit Gvc is 0
  (vc has no effect), so the page shows only Gc, "–" readouts, no slope rows, no fp marker,
  and auto design is skipped with a note.
- PCMC in DCM: `pl.dcm` (iL = 0 at the clock). Slopes are evaluated at vC = Vo* (was the CCM
  averaged vC at the DCM duty: buck DCM Sf 24.2 kV/s, now 35.0 kV/s = Ri·Vo/L). α = 0,
  mc and Qp "– (DCM)", no CCM RHP zero marker, DCM tip.
- New: leading-edge blanking `tb` (fraction of T, row "Blanking time tb/T (min on-time)",
  default 0). `simulateCL` ends a step at tB and ignores the comparator before it; if the
  comparator is already high at tB the switch turns off there. Warning when D0 < tb.
- New pure tests: buck-boost pole vs α; DCM buck (pole 0, Sf, Type 2 load step); DCM boost
  markers; lossy boost 400 V (finite, flagged, warned); Vin step and soft-start; blanking
  below D0 changes nothing (1e-6), above D0 sets duty = tb and Vo above target.
- All old test lines unchanged except the Se = 0 subharmonic number (200.4 % → 193.8 %): the
  slope point moved by 2e-15 V and that unstable orbit amplifies it. Node and Chrome now print
  identical lines.
- Checks (VERIFIED): `node tests/run.js` 62 PASS, `browser.js selftest` ALL PASS,
  `browser.js uitest` ALL PASS (Chrome). Screenshots: PCMC DCM buck, PCMC unreachable 20 V,
  VMC after switching back from PCMC (made with a scratch copy of the site plus a small
  state script, not part of the repo).
- Known limits: blanking has no separate pulse-skip threshold (vc is clamped at 0, so the
  duty never drops below tb).

### Phase 7: average current-mode control
Structure: iref = Gcv·(Vref − H·|vo|) (limited to 0..vcMax), vc = Gci·(iref − Ri·iL)
(limited to 0..1.25·VM), trailing-edge PWM as in VMC.
- `plant.js`: `averagedPlant` also returns `polyI` (Gid = num/den); `ilSlopes(af, X)` and
  `slopePoint(p, af, D0, Vt)` (shared with PCMC, same numbers as before).
- `simcl.js`: `linearizePeriod` returns `Gout[j]` for every output (G = first one);
  `periodMapVMC` also outputs the period-average iL (`Gout[1]` = Gid). `acmcPlant`: averaged
  model in CCM; in DCM (reduced order has no iL state) `kind: 'pmap'`, Gvd and Gid from the
  period map, plotted to fs/2 (cached). `simulateCL` ACMC branch: second compensator
  `compI`, both advanced and redone together at switching instants; new recorded signal
  `iref`; `sigArray('isense')` = Ri·iL.
- `loop.js` ACMC: `L.cni/Gci`, `plantKi = Ri·Gid/VM`, `Ti`, `Gvi = (Gci·Gvd/VM)/(1 + Ti)`,
  `plantK = H·Gvi`, `L.mi` (current-loop margins). CCM poles of both loops:
  Dci·Dcv·Dp + Fm·Nci·(H·Ncv·Nv + Ri·Ni·Dcv) = 0; DCM: margins of both loops. Slope check
  `L.slope` (Dixon: |Gci(fs)|·Ri·|diL/dt|off vs VM·fs), warnings for the current loop, slope
  ratio > 1, and fc above fci/2. `suggestFc` keeps fc ≤ fciT/4; `suggestFci` = fs/6.
- UI: Avg CMC button; side rows Vt, VM, Ri, Dmax; design block "Current loop: amplifier Gci"
  (type, rows, fci/PM targets), "Voltage loop: compensator Gcv". Auto design does the current
  loop first, then the voltage loop. Bode view toggle Voltage loop / Current loop (handles
  follow the shown compensator). Readouts: iref at the operating point, fci, PMi, GMi, slope
  numbers. ACMC tips; op-amp output "to current amplifier"; `?mode=acmc`.
- Scope signals: `isense` (Ri·iL), `iref`.
- Finding: a PCMC-style ripple pole estimate (sense gain |Gci(fs)|·Ri, Se = VM·fs) was far too
  optimistic (|α| = 1 only at slope ratio 4.5), while the switching sim shows period-2 duty
  alternation from ratio 1.2-1.6 (buck D 0.67), 1.5-2.0 (buck D 0.42), 1.8-2.4 (boost D 0.5).
  So only Dixon's ratio is shown and warned. Dixon's rule itself is still not text-confirmed.
- Tests (VERIFIED, Node 70 PASS = Chrome, old 62 lines unchanged; UI test 55 steps PASS incl.
  every Gci and Gcv type, Bode view toggle, topologies, DCM, mode switches):
  period-map Gid vs averaged Gid ≤ 0.072 dB up to fs/20 (buck, boost); buck and boost: both
  loops hit fc and PM (1 %, 0.5°), Gvi(0) = Gvd/(Ri·Gid), outer gain ×1.5 past GM gives RHP
  poles; closed loop buck, boost and DCM buck: load ×2 and back settle within 0.5 %, average
  Ri·iL = iref within 0.5 %, duty = D0; slope rule buck D 0.667: ratio 0.8 no alternation and
  no warning, ratio 2.0 duty alternates by 0.47 and warned.
- Screenshots checked: ACMC buck dark (voltage loop) and light (current loop) at 1400 px.
  NOT_VERIFIED: ACMC at phone width (layout uses the same blocks as the other modes).
- Not done: closed-loop Zout for ACMC (curve hidden), op-amp values of the current amplifier.

## Next step

Phase 8, FRA from the switching simulation (plan section 6 and the Phase 8 check row).
`node tests/browser.js selftest` uses Chrome while Edge's `--dump-dom` is broken.
