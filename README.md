# DC-DC Converter Lab

**Interactive browser lab for buck, boost and buck-boost converters in CCM and DCM, with a
4-channel scope and a control-loop design page.**

## Overview

The lab runs in a browser from a local file, with no build step and no dependencies. It has
four pages:

- **Design**: specification in, L and C sizing (E12), operating points at V<sub>in</sub> min,
  nom and max with D solved on the switching model, stress vs rating, save/load and print.

- **Converter**: the switched converter model with a steady-state (shooting method) and a
  startup view, a 4-channel scope, schematic, theory table and mode map.
- **Losses**: loss breakdown (conduction, switching, node capacitance, Q<sub>rr</sub>, gate,
  body diodes, DCR, iGSE core, ESR) and efficiency vs load.
- **Control**: voltage-mode control (VMC), peak current-mode control (PCMC) and average
  current-mode control (ACMC), designed on a Bode plot and checked with a closed-loop
  switching simulation.

## Key Features

- Ideal or non-ideal parts (ESR, inductor DCR, switch R<sub>on</sub>, diode drop),
  asynchronous diode or synchronous MOSFET, dead time with body diodes, switch-node
  capacitance that rings in DCM.
- Scope export as CSV and PNG.
- Compensators P, I, PI, Type 2 and Type 3, with k-factor auto design for a target
  crossover and phase margin.
- Bode plot of plant, compensator, loop gain, closed loop and closed-loop Zout, with
  crossover, phase margin and gain margin. Zeros, poles and gain can be dragged on the plot.
- Op-amp error amplifier circuit with R/C values.
- Closed-loop switching simulation with load step, input step, reference step and
  soft-start; step-response numbers and extra scope signals (vc, ramp, duty, iref, ...).
- PCMC with slope compensation and leading-edge blanking, subharmonic check (α, Q<sub>p</sub>).
- ACMC with a current amplifier and a voltage loop, current-loop Bode view and Dixon's
  slope check.
- Frequency response analysis (FRA) measured on the switching simulation, drawn on the Bode
  plot.

## Getting Started

Open `index.html` in a browser (works from `file://`).

URL options:

| Option | Effect |
|---|---|
| `?page=design`, `?page=losses`, `?page=control` | Start on that page |
| `?mode=pcmc`, `?mode=acmc` | Start in peak or average current mode |
| `?theme=light`, `?theme=dark` | Color theme |
| `?selftest` | Run the self tests and show the result on the page |
| `?uitest` | Run the UI click-through test |

### Tests

Needs Node.js. The browser commands need Microsoft Edge or Google Chrome.

```sh
node tests/run.js            # self tests in Node
node tests/run.js --strip    # same, without timings (for diffs)
node tests/browser.js selftest                  # self tests in headless Edge/Chrome
node tests/browser.js uitest                    # UI click-through test
node tests/browser.js shot out.png 1400 1000 "page=control&theme=dark"   # screenshot
```

## Architecture

### Components

- `js/model.js`, `js/sim.js`, `js/theory.js`: switched converter model, simulation, steady
  state and theory formulas (Converter page).
- `js/plant.js`, `js/comp.js`, `js/loop.js`: averaged and DCM plant models, compensators and
  margins, and `buildLoop`, which assembles the control loop for the UI, the simulation and
  the tests.
- `js/simcl.js`: closed-loop switching simulation for all three control modes, and
  period-map (one switching period linearized) models.
- `js/fra.js`: frequency response measured on the switching simulation.
- `js/design.js`, `js/losses.js`: design sizing and corners, loss breakdown and iGSE core loss
  (Design and Losses pages); `js/design-ui.js`, `js/losses-ui.js` build those pages.
- `js/bode.js`, `js/control-ui.js`, `js/scope.js`, `js/schem.js`, `js/ui.js`: drawing and page UI.

### Design Considerations

- Classic `<script>` files in global scope, because browsers block ES modules on
  `file://`. The load order in `index.html` is the dependency order.
- Formulas without a readable source are checked by self tests against independent
  calculations (period map, finite differences, switching simulation). See "Formula notes"
  in [checkpoint.md](checkpoint.md).

## Repository Structure

```text
converterCnotrol/
├── index.html      # page markup and script load order
├── css/app.css
├── js/             # model, simulation, control, UI and test scripts
├── tests/
│   ├── run.js      # Node test runner
│   └── browser.js  # headless browser tests and screenshots
├── checkpoint.md   # development log, test results, open items
├── CLAUDE.md       # notes for Claude Code
└── README.md
```

## Documentation

| Resource | Description |
|---|---|
| [checkpoint.md](checkpoint.md) | Phase log, checks and results per phase, formula notes, open items |
| [CLAUDE.md](CLAUDE.md) | Commands, script layout and architecture notes for Claude Code |

## Results

`checkpoint.md` records the self-test and UI-test results for each development phase
(model checks against closed forms, loop designs, closed-loop steps, FRA against the models)
and the items still open.
