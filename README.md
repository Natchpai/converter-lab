# DC-DC Converter Lab

**Interactive learning tool for buck, boost and buck-boost converters in CCM and DCM: size the
power stage, watch the switching waveforms on a 4-channel scope, see where the losses go and
design the control loop.**

- Live site: <https://natchpai.github.io/converter-lab/>
- Source: <https://github.com/Natchpai/converter-lab.github.io>

## Overview

The lab is made for learning. Each page puts the simulated waveforms or numbers next to the
equations, with short notes on what to look at. It runs in a browser (on the live site, or
from a local file), with no build step and no dependencies. It has four pages:

- **Design**: specification in, L and C sizing (E12), operating points at V<sub>in</sub> min,
  nom and max with D solved on the switching model, stress vs rating, save/load and print.
- **Converter**: the switched converter model with a steady-state (shooting method) and a
  startup view, a 4-channel scope, schematic, theory table and mode map.
- **Losses**: loss breakdown (conduction, switching, node capacitance, Q<sub>rr</sub>, gate,
  body diodes, DCR, iGSE core, ESR) and efficiency vs load.
- **Control**: voltage-mode control (VMC), peak current-mode control (PCMC) and average
  current-mode control (ACMC), designed on a Bode plot and checked with a closed-loop
  switching simulation.

Every page has the same layout: inputs in a sidebar on the left, results on the right. On a
large window (at least 1100 x 600 px) the page fits the window and the sidebar scrolls on its
own, so the scope and the Bode plot stay in view while you drag a slider. On a small window
or a phone the page scrolls as usual, plots first.

## Key Features

- Ideal or non-ideal parts (ESR, inductor DCR, switch R<sub>on</sub>, diode drop),
  asynchronous diode or synchronous MOSFET, dead time with body diodes, switch-node
  capacitance that rings in DCM.
- Scope export as CSV and PNG. The scope screen can be dark (default) or light; light is
  handy for pictures in reports. PNG pictures (scope, Bode plot, efficiency chart) are drawn
  again at 3x the size on screen, so text and lines stay sharp in a report.
- Printed reports on white paper: the Design summary, a Losses report (loss tables and
  efficiency chart) and a Control report (compensator, loop margins, step response, Bode plot,
  scope and op-amp values). Charts print in the light colors, also from Night theme.
- Compensators P, I, PI, Type 2 and Type 3, with k-factor auto design for a target
  crossover and phase margin.
- Bode plot of plant, compensator, loop gain, closed loop and closed-loop Zout, with
  crossover, phase margin and gain margin. Zeros, poles and gain can be dragged on the plot.
- Op-amp circuits with R/C values: the error amplifier, and the current amplifier in ACMC.
- Save and load the control design as JSON (mode, compensator, current loop, targets, test
  event and the circuit), and export the Bode curves as CSV (frequency, magnitude and phase of
  every curve) for MATLAB or a spreadsheet. Save and load are in the Loop tab of the Control
  page; the CSV and PNG buttons are at the top right of the Bode panel.
- Closed-loop switching simulation with load step, input step, reference step and
  soft-start; step-response numbers and extra scope signals (vc, ramp, duty, iref, ...).
- PCMC with slope compensation and leading-edge blanking (pulses are skipped below the
  minimum on-time), subharmonic check (α, Q<sub>p</sub>).
- ACMC with a current amplifier and a voltage loop, current-loop Bode view and Dixon's
  slope check.
- Frequency response analysis (FRA) measured on the switching simulation, drawn on the Bode
  plot.

## Getting Started

Use the [live site](https://natchpai.github.io/converter-lab/), or open `index.html` in a
browser (works from `file://`).

### Layout tips

- **Resize the panels:** drag the thin grips between panels: the scope height, the sidebar
  width, and the split between the schematic or Bode plot and the tabs next to it. Double-click
  a grip to reset it. A focused grip also moves with the arrow keys.
- **Sections:** click a sidebar heading to fold or unfold it.
- **Tabs:** theory, measurements, equations, mode map, loop results, op-amp values and tips
  are tabs in the panel next to the schematic or Bode plot.
- **Getting started:** a first-visit guide under the header walks through Design, Converter,
  Losses and Control; each step opens its page. The **Guide** button shows it again.
- **Channels:** the channel settings of the scope fold behind the **Channels** button (also on
  phones).
- **Large screens:** the scope and Bode text and lines grow with the plot size; on a short
  window the title gets smaller to leave room for the plots.
- **Header:** buttons that do not apply to the current page are greyed out, not hidden.
- Panel sizes, open tabs, the theme and the scope screen color are kept in the browser
  (localStorage).

URL options (add them to the page address):

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
├── LICENSE         # MIT
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

## License

MIT. See [LICENSE](LICENSE).
