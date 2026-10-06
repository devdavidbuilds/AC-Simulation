# Refrigeration Cycle — Real-Time 4-Component Monitor

## Current HMI scope

The current build combines the vapour-compression refrigeration-cycle mimic with an animated AHU/BMS air-side layer. The AHU includes the mentor-requested controls: cooling valve (0–100%), damper (0–100%), supply fan ON/OFF, VFD frequency, VAV position, CFM airflow and temperature setpoint. The AHU graphic shows a cooling coil, filter, VAV outdoor/return branches, supply fan, damper, VFD block, animated air movement and cooling-water flow.

### Run

```powershell
python manage.py migrate
python manage.py runserver
```

Open `http://127.0.0.1:8000/`. Keep the existing PostgreSQL credentials in your local `project/settings.py`; do not replace that file with credentials from another machine.


A frontend simulation of the basic vapour-compression refrigeration
cycle, focused on exactly four components: **Compressor**,
**Condenser**, **Capillary Tube** (the expansion device), and
**Evaporator**. Styled as a BMS/HMI/SCADA operator screen. Built
with Django (routing, templates, static files only) + vanilla
JavaScript (machine state, sensor physics, animation) + inline SVG
(the cycle mimic).

This version has **no fault simulation** — it's a real-time working
demonstration only: press Start and watch the four components run
through the cycle with live, physically-connected sensor values;
press Stop and watch them return to ambient.

## Running it

```bash
pip install -r requirements.txt
python manage.py runserver
```

Open **http://127.0.0.1:8000/refrigerator/**

No database, no API, no build step.

## The four components and their sensors

| Component | Sensors modeled |
|---|---|
| **Compressor** | Suction pressure (inlet), discharge pressure (outlet), discharge line temperature, motor current, speed (RPM) |
| **Condenser** | Condenser outlet temperature (subcooled liquid leaving the coil) — inlet side shares the compressor's discharge pressure/temperature reading, since that's the same line |
| **Capillary Tube** | No sensor of its own (it's a fixed orifice with no moving parts) — it's monitored indirectly via the pressure/temperature drop between its inlet (condenser outlet) and outlet (evaporator inlet) |
| **Evaporator** | Evaporator inlet temperature (flash-cooled liquid just after the capillary), evaporator outlet temperature (suction side) — the difference between these two is displayed as **Superheat**, the standard way an evaporator coil's performance is checked in the field |

Suction pressure is also shown, taken at the compressor inlet /
evaporator outlet (same line).

## Project structure

```
project/
├── manage.py
├── requirements.txt
├── project/                     Django project (settings, urls, wsgi/asgi)
└── refrigerator/                The single Django app
    ├── views.py                 One view: renders index.html
    ├── urls.py                  /refrigerator/
    ├── models.py                Intentionally empty — no DB in this version
    ├── templates/refrigerator/index.html   HMI layout + inline SVG cycle mimic
    └── static/refrigerator/
        ├── css/style.css        Industrial HMI styling
        ├── js/
        │   ├── simulation.js    machineState + tick loop + sensor physics
        │   ├── ui.js            DOM/SVG rendering + refrigerant flow animation
        │   └── app.js           Start/Stop button wiring + startup
        └── images/refrigerator.svg   Standalone reference icon (not used
                                       by the simulation — the live mimic
                                       is inlined in index.html)
```

## How it's wired together

- **simulation.js** owns `machineState` and runs a fixed-interval
  tick (700 ms). Every value (RPM, current, both pressures, and all
  four temperatures) eases toward a fixed nominal operating point
  when running, and toward ambient (24°C / ~1 bar) when stopped —
  nothing is randomized. `window.Sim` exposes `start()`, `stop()`,
  `onTick()`, `state`.
- **ui.js** reads `machineState` on every tick and updates the
  status panel, live parameter boxes, the event log, and each SVG
  component's CSS state (`state-off` / `state-running` /
  `state-hot` / `state-cooling`). It also runs its own
  `requestAnimationFrame` loop that moves refrigerant flow dots
  along the actual pipe geometry, easing the flow speed toward the
  current compressor speed so start-up/shutdown look like a gradual
  ramp rather than a switch flip.
- **app.js** only wires the Start/Stop buttons to `Sim` and starts
  the two loops.

## Future backend integration (not implemented now)

`simulation.js`'s `tick()` function is the intended seam for
swapping in real sensor data later — replace its computed
`machineState.*` assignments with values read from a Django
view/API response and leave `ui.js`/`app.js`/the template untouched.
