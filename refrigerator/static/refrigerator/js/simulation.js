/* ============================================================
   simulation.js
   ------------------------------------------------------------
   Real-time working model of the 4-component vapour-compression
   cycle: Compressor, Condenser, Capillary Tube, Evaporator.

   No fault simulation in this version — Start/Stop only. Every
   value is derived from machineState.running (and the startup
   ramp), never randomized.

   Exposes a single global: window.Sim
   ============================================================ */

(function () {
  "use strict";

  const TICK_MS = 700;
  const OUTDOOR_TEMP = 32.5;
  const OA_FRACTION = 0.4;       // share of mixed air taken from outdoors
  const COOLING_RISE_MAX = 19.7; // degC drop across the cooling coil at 100 % valve
  const HEATING_RISE_MAX = 18.0; // degC rise across the heating coil at 100 % valve
  const AMBIENT_TEMP = 24.0; // resting temperature of the whole circuit when stopped

  // Nominal steady-state operating point for a small hermetic
  // reciprocating compressor / capillary-tube system.
  const NOMINAL = {
    suctionPressure: 1.5,
    dischargePressure: 10.0,
    dischargeTemp: 82.0,
    condenserOutletTemp: 40.0,
    evaporatorInletTemp: -8.0,
    evaporatorOutletTemp: 1.0
  };

  // Air-side actuator defaults requested for the AHU/control layer.
  const ACTUATOR_DEFAULTS = {
    valveOpening: 60,
    heatingValveCommand: 40,
    damperPosition: 70,
    fanOn: false,
    vfdFrequency: 40,
    vavPosition: 70,
    setTemperature: 22.0
  };

  // Refrigeration-side adjustable controls (operator sliders beside each component).
  // Defaults reproduce the NOMINAL operating point exactly.
  const REFRIG_DEFAULTS = {
    compressorSpeed: 50,     // Hz
    condenserFanSpeed: 80,   // %
    capillaryOpening: 60,    // % flow restriction relief
    evaporatorFanSpeed: 80   // %
  };

  // Every component malfunctions for FAULT_DURATION_S once per FAULT_CYCLE_S,
  // staggered so each fault is clearly visible on its own.
  const FAULT_CYCLE_S = 60;
  const FAULT_DURATION_S = 5;
  const FAULT_SCHEDULE = [
    { key: "compressor", start: 10, name: "Compressor", cause: "motor overload / overheating" },
    { key: "condenser",  start: 25, name: "Condenser",  cause: "fan failure, poor heat rejection" },
    { key: "capillary",  start: 40, name: "Capillary tube", cause: "blockage / restriction" },
    { key: "evaporator", start: 52, name: "Evaporator", cause: "fan failure / coil icing" }
  ];

  function approach(current, target, rate) {
    const next = current + (target - current) * rate;
    return Math.abs(next - target) < 0.03 ? target : next;
  }
  function round1(v) { return Math.round(v * 10) / 10; }

  const machineState = {
    running: false,
    systemStatus: "STOPPED", // STOPPED | STARTING | RUNNING

    suctionPressure: 1.0,
    dischargePressure: 1.0,
    dischargeTemp: AMBIENT_TEMP,
    condenserOutletTemp: AMBIENT_TEMP,
    evaporatorInletTemp: AMBIENT_TEMP,
    evaporatorOutletTemp: AMBIENT_TEMP,

    // Dynamic (read-only) component values + malfunction schedule
    compressorSpeed: 0,
    condenserFanSpeed: 0,
    capillaryOpening: REFRIG_DEFAULTS.capillaryOpening,
    evaporatorFanSpeed: 0,
    runSeconds: 0,
    cycleSeconds: 0,
    faults: { compressor: false, condenser: false, capillary: false, evaporator: false },
    activeFault: "None",

    // AHU / actuator layer
    valveOpening: ACTUATOR_DEFAULTS.valveOpening,
    heatingValveCommand: ACTUATOR_DEFAULTS.heatingValveCommand,
    damperPosition: ACTUATOR_DEFAULTS.damperPosition,
    fanOn: ACTUATOR_DEFAULTS.fanOn,
    vfdFrequency: ACTUATOR_DEFAULTS.vfdFrequency,
    vavPosition: ACTUATOR_DEFAULTS.vavPosition,
    setTemperature: ACTUATOR_DEFAULTS.setTemperature,
    airflowCfm: 0,
    upstreamCfm: 0,
    mixedAirTemp: AMBIENT_TEMP,
    coolingOutTemp: AMBIENT_TEMP,
    heatingOutTemp: AMBIENT_TEMP,
    supplyAirTemperature: AMBIENT_TEMP,
    returnAirTemperature: AMBIENT_TEMP,
    supplyStaticPressure: 0,

    startupTicksRemaining: 0
  };

  // ------------------------------------------------------------
  // Event log (newest first)
  // ------------------------------------------------------------
  const log = [];
  const MAX_LOG_ENTRIES = 100;

  function timeNow() {
    return new Date().toLocaleTimeString("en-GB", { hour12: false });
  }
  function addLog(message, severity) {
    log.unshift({ time: timeNow(), message: message, severity: severity || "info" });
    if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES;
    notify();
  }

  const listeners = [];
  function onTick(fn) { listeners.push(fn); }
  function notify() { listeners.forEach((fn) => fn(machineState, log)); }

  // ------------------------------------------------------------
  // Tick
  // ------------------------------------------------------------
  function tick() {
    const s = machineState;

    if (s.systemStatus === "STARTING") {
      s.startupTicksRemaining -= 1;
      if (s.startupTicksRemaining <= 0) s.systemStatus = "RUNNING";
    }

    const running = s.running;
    const RATE_PRESSURE = 0.16;
    const RATE_TEMP = 0.08;

    // ---- Dynamic operating point + scheduled malfunctions (refrigeration page only) ----
    const refrigPage = !!document.getElementById("machineSvg");
    if (running) s.runSeconds += TICK_MS / 1000; else s.runSeconds = 0;
    const phase = s.runSeconds % FAULT_CYCLE_S;
    s.cycleSeconds = phase;
    const names = [];
    FAULT_SCHEDULE.forEach((f) => {
      const on = refrigPage && running && phase >= f.start && phase < f.start + FAULT_DURATION_S;
      if (on) names.push(f.name);
      if (on !== s.faults[f.key]) {
        s.faults[f.key] = on;
        if (running) {
          addLog(on ? f.name + " MALFUNCTION - " + f.cause : f.name + " recovered - normal operation", on ? "err" : "ok");
        }
      }
    });
    s.activeFault = names.length ? names.join(" + ") : "None";
    const F = s.faults;

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const tm = Date.now() / 1000;
    const wob = (period, amp, ph) => amp * Math.sin(2 * Math.PI * tm / period + ph);

    const tSuction = clamp(NOMINAL.suctionPressure + wob(7, 0.06, 0) + wob(13, 0.04, 1)
      - (F.compressor ? 0.7 : 0) - (F.capillary ? 0.55 : 0) - (F.evaporator ? 0.45 : 0), 0.5, 3.0);
    const tDischarge = clamp(NOMINAL.dischargePressure + wob(9, 0.3, 0.5) + wob(17, 0.2, 2)
      + (F.compressor ? 4.2 : 0) + (F.condenser ? 2.8 : 0) + (F.capillary ? 1.0 : 0), 4, 16);
    const tDischargeTemp = NOMINAL.dischargeTemp + wob(8, 1.5, 0) + wob(19, 1.0, 1)
      + (F.compressor ? 24 : 0) + (F.condenser ? 11 : 0);
    const tCondOut = NOMINAL.condenserOutletTemp + wob(11, 0.7, 0) + wob(23, 0.4, 2)
      + (F.condenser ? 14 : 0) + (F.compressor ? 3 : 0);
    const tEvapIn = NOMINAL.evaporatorInletTemp + wob(10, 0.4, 0.3) + 7 * (tSuction - NOMINAL.suctionPressure);
    const superheat = (NOMINAL.evaporatorOutletTemp - NOMINAL.evaporatorInletTemp) + wob(12, 0.5, 0)
      + (F.capillary ? 8.5 : 0) - (F.evaporator ? 8.5 : 0);
    const tEvapOut = tEvapIn + superheat;

    const settled = s.runSeconds >= 8;
    const RP = settled ? 0.35 : RATE_PRESSURE;
    const RT = settled ? 0.25 : RATE_TEMP;

    s.suctionPressure = approach(s.suctionPressure, running ? tSuction : 1.0, RP);
    s.dischargePressure = approach(s.dischargePressure, running ? tDischarge : 1.0, RP);
    s.dischargeTemp = approach(s.dischargeTemp, running ? tDischargeTemp : AMBIENT_TEMP, RT);
    s.condenserOutletTemp = approach(s.condenserOutletTemp, running ? tCondOut : AMBIENT_TEMP, RT);
    s.evaporatorInletTemp = approach(s.evaporatorInletTemp, running ? tEvapIn : AMBIENT_TEMP, RT);
    s.evaporatorOutletTemp = approach(s.evaporatorOutletTemp, running ? tEvapOut : AMBIENT_TEMP, RT);

    // Component outputs (drive fan animation / flow speed on the page)
    s.compressorSpeed = Math.round(running ? (F.compressor ? 22 : 50 + wob(10, 1.5, 0)) : 0);
    s.condenserFanSpeed = Math.round(running ? (F.condenser ? 0 : 80 + wob(9, 3, 1)) : 0);
    s.evaporatorFanSpeed = Math.round(running ? (F.evaporator ? 0 : 80 + wob(11, 3, 2)) : 0);
    s.capillaryOpening = Math.round(running && F.capillary ? 15 : REFRIG_DEFAULTS.capillaryOpening + (running ? wob(14, 2, 0) : 0));

    // AHU actuator response. CFM is intentionally deterministic so the
    // operator can see a clear cause/effect relationship when controls move.
    const fanFactor = s.fanOn ? 1 : 0;
    const vfdFactor = Math.max(0, Math.min(60, s.vfdFrequency)) / 60;
    const damperFactor = Math.max(0, Math.min(100, s.damperPosition)) / 100;
    const vavFactor = Math.max(0, Math.min(100, s.vavPosition)) / 100;
    const targetCfm = 1800 * fanFactor * vfdFactor * damperFactor * vavFactor;
    s.airflowCfm = approach(s.airflowCfm, targetCfm, 0.20);

    // AHU air-side response: return air stays close to zone ambient while
    // supply air and static pressure respond to fan, VFD, valve and dampers.
    const zoneHeatLoad = running ? 0.6 : 0.15;
    const targetReturnTemp = Math.min(AMBIENT_TEMP + 1.5, AMBIENT_TEMP + zoneHeatLoad);
    s.returnAirTemperature = approach(s.returnAirTemperature, targetReturnTemp, 0.08);

    // Air-side temperature chain: mixed air -> cooling coil -> heating coil -> supply.
    // Coil effect scales with the air actually entering the unit upstream of the supply damper.
    const upstreamTarget = 1800 * fanFactor * vfdFactor * vavFactor;
    s.upstreamCfm = approach(s.upstreamCfm, upstreamTarget, 0.20);
    const coilFlowFactor = fanFactor * Math.min(1, s.upstreamCfm / 600);
    const targetMixed = OA_FRACTION * OUTDOOR_TEMP + (1 - OA_FRACTION) * s.returnAirTemperature;
    s.mixedAirTemp = approach(s.mixedAirTemp, targetMixed, 0.15);
    const coolingFrac = Math.max(0, Math.min(100, s.valveOpening)) / 100;
    const heatingFrac = Math.max(0, Math.min(100, s.heatingValveCommand)) / 100;
    s.coolingOutTemp = approach(s.coolingOutTemp, s.mixedAirTemp - COOLING_RISE_MAX * coolingFrac * coilFlowFactor, 0.15);
    s.heatingOutTemp = approach(s.heatingOutTemp, s.coolingOutTemp + HEATING_RISE_MAX * heatingFrac * coilFlowFactor, 0.15);
    const targetSupplyTemp = s.fanOn && s.airflowCfm > 1 ? s.heatingOutTemp : s.returnAirTemperature;
    s.supplyAirTemperature = approach(s.supplyAirTemperature, targetSupplyTemp, 0.12);

    const targetStaticPressure = s.fanOn ? 70 + 430 * Math.pow(Math.min(1, s.airflowCfm / 1800), 2) : 0;
    s.supplyStaticPressure = approach(s.supplyStaticPressure, targetStaticPressure, 0.18);

    // Keep the eight dashboard values clean and readable.
    s.suctionPressure = round1(s.suctionPressure);
    s.dischargePressure = round1(s.dischargePressure);
    s.dischargeTemp = round1(s.dischargeTemp);
    s.condenserOutletTemp = round1(s.condenserOutletTemp);
    s.evaporatorInletTemp = round1(s.evaporatorInletTemp);
    s.evaporatorOutletTemp = round1(s.evaporatorOutletTemp);
    s.airflowCfm = Math.round(s.airflowCfm);
    s.supplyAirTemperature = round1(s.supplyAirTemperature);
    s.mixedAirTemp = round1(s.mixedAirTemp);
    s.coolingOutTemp = round1(s.coolingOutTemp);
    s.heatingOutTemp = round1(s.heatingOutTemp);
    s.upstreamCfm = Math.round(s.upstreamCfm);
    s.returnAirTemperature = round1(s.returnAirTemperature);
    s.supplyStaticPressure = Math.round(s.supplyStaticPressure);

    if (s.systemStatus !== "STARTING") {
      s.systemStatus = running ? "RUNNING" : "STOPPED";
    }

    notify();
  }

  // ------------------------------------------------------------
  // PostgreSQL Database Telemetry Logger (5-second interval)
  // ------------------------------------------------------------
  const DB_SAVE_INTERVAL_MS = 5000;
  let dbSaveTimer = null;
  let isLiveActive = true;
  let lastSavedId = null;

  async function saveTelemetryToDb() {
    if (!isLiveActive) return;
    const s = machineState;

    const payload = {
      timestamp: new Date().toISOString(),
      suction_pressure: s.suctionPressure,
      discharge_pressure: s.dischargePressure,
      discharge_temperature: s.dischargeTemp,
      condenser_outlet_temp: s.condenserOutletTemp,
      evaporator_inlet_temp: s.evaporatorInletTemp,
      evaporator_outlet_temp: s.evaporatorOutletTemp,
      valve_opening: s.valveOpening,
      damper_position: s.damperPosition,
      fan_on: s.fanOn,
      vfd_frequency: s.vfdFrequency,
      vav_position: s.vavPosition,
      airflow_cfm: s.airflowCfm,
      supply_air_temperature: s.supplyAirTemperature,
      return_air_temperature: s.returnAirTemperature,
      supply_static_pressure: s.supplyStaticPressure,
      set_temperature: s.setTemperature,
      compressor_status: s.running ? (s.systemStatus === "STARTING" ? "STARTING" : "RUNNING") : "OFF",
      condenser_fan_status: s.running ? "ACTIVE" : "IDLE",
      evaporator_fan_status: s.running ? "ACTIVE" : "IDLE",
      system_status: s.systemStatus,
      fault_type: s.activeFault || "None"
    };

    try {
      const resp = await fetch("/api/telemetry/save/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (resp.ok) {
        const data = await resp.json();
        lastSavedId = data.id;
        const dbBadge = document.getElementById("dbSaveStatus");
        if (dbBadge) {
          dbBadge.textContent = "● Saved to DB #" + data.id + " (" + new Date().toLocaleTimeString() + ")";
          dbBadge.className = "db-status-badge saved";
        }
      } else {
        console.warn("Telemetry save response status:", resp.status);
      }
    } catch (err) {
      console.warn("Telemetry DB auto-save network error:", err);
      const dbBadge = document.getElementById("dbSaveStatus");
      if (dbBadge) {
        dbBadge.textContent = "● DB Connection Error";
        dbBadge.className = "db-status-badge error";
      }
    }
  }

  // ------------------------------------------------------------
  // Commands
  // ------------------------------------------------------------
  function start() {
    if (machineState.running) return;
    machineState.running = true;
    machineState.systemStatus = "STARTING";
    machineState.startupTicksRemaining = 2;
    addLog("System started (LIVE MODE)", "ok");
    addLog("Compressor start command issued", "info");
    // Trigger immediate save on startup
    saveTelemetryToDb();
  }

  function stop() {
    if (!machineState.running) return;
    machineState.running = false;
    machineState.systemStatus = "STOPPED";
    addLog("System stopped by operator", "info");
    // Trigger immediate save on shutdown
    saveTelemetryToDb();
  }

  function setActuator(name, value) {
    const numeric = (v) => Math.max(0, Math.min(100, Number(v) || 0));
    if (name === "valveOpening") machineState.valveOpening = numeric(value);
    if (name === "heatingValveCommand") machineState.heatingValveCommand = numeric(value);
    if (name === "damperPosition") machineState.damperPosition = numeric(value);
    if (name === "vavPosition") machineState.vavPosition = numeric(value);
    if (name === "vfdFrequency") machineState.vfdFrequency = Math.max(0, Math.min(60, Number(value) || 0));
    if (name === "setTemperature") machineState.setTemperature = Math.max(10, Math.min(35, Number(value) || 22));
    notify();
  }

  function setFan(on) {
    const next = Boolean(on);
    if (machineState.fanOn !== next) {
      machineState.fanOn = next;
      addLog("Supply fan turned " + (next ? "ON" : "OFF"), next ? "ok" : "info");
    }
    notify();
  }

  function setLiveModeActive(active) {
    isLiveActive = active;
    if (active) {
      notify();
    }
  }

  let simInterval = null;
  function init() {
    addLog("System initialized (LIVE SIMULATION MODE)", "info");
    notify();
    if (!simInterval) {
      simInterval = setInterval(function () {
        if (isLiveActive) tick();
      }, TICK_MS);
    }
    if (!dbSaveTimer) {
      dbSaveTimer = setInterval(function () {
        if (isLiveActive && machineState.running) {
          saveTelemetryToDb();
        }
      }, DB_SAVE_INTERVAL_MS);
    }
  }

  window.Sim = {
    state: machineState,
    constants: { TICK_MS, AMBIENT_TEMP, NOMINAL, ACTUATOR_DEFAULTS, REFRIG_DEFAULTS, DB_SAVE_INTERVAL_MS },
    onTick: onTick,
    addLog: addLog,
    getLog: () => log,
    start: start,
    stop: stop,
    setActuator: setActuator,
    setFan: setFan,
    init: init,
    saveTelemetryToDb: saveTelemetryToDb,
    setLiveModeActive: setLiveModeActive,
    isLiveModeActive: () => isLiveActive,
    getLastSavedId: () => lastSavedId
  };
})();
