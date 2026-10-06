/* ============================================================
   ui.js
   ------------------------------------------------------------
   Reads machineState (from simulation.js) and writes it to the
   DOM/SVG. No fault/alarm rendering in this version.

   Exposes a single global: window.UI
   ============================================================ */

(function () {
  "use strict";

  const el = {};
  function cache() {
    [
      "hdrDate", "hdrTime",
      "mimicSystemStatusTag",
      "lampSystemStatus", "valSystemStatus",
      "lampCompressor", "valCompressor",
      "lampCondenser", "valCondenser",
      "lampEvaporator", "valEvaporator",
      "lampCapillary", "valCapillary",
      "pvSuctionP", "pvDischargeP",
      "pvCondInTemp", "pvCondOutTemp",
      "pvExpInTemp", "pvExpOutTemp",
      "pvEvapInTemp", "pvEvapOutTemp",
      "eventLog",
      "svgDischargePressure", "svgDischargeTemp", "svgSuctionPressure",
      "svgCondenserOutletTemp", "svgEvaporatorInletTemp", "svgEvaporatorOutletTemp",
      "compressor", "compressorMotor", "condenser", "evaporator", "capillaryTube",
      "condShimmer1", "evapShimmer1", "capillaryGlow",
      "refrigerantFlow",
      "actFanStatus", "actVfdLed",
      "ahuReturnTemp", "ahuValveCmd", "ahuValveStatus", "ahuCfm", "ahuSupplyTemp", "ahuStaticPressure",
      "ahuSupplyTemp2", "ahuVfdHz2", "ahuSupplyFilter",
      "ahuValveCmd2", "ahuFilterLed", "ahuCoolingValve", "ahuValveStem", "ahuWaterFlow", "ahuCoilGlow", "ahuCoolingCoil", "ahuHeatingCoil", "ahuHeatingCoilGlow",
      "ahuFanRotor", "ahuDamper", "ahuVavOutdoor", "ahuVavReturn", "ahuAirflowDots",
      "inlineValvePct", "inlineHeatingValvePct", "inlineDamperPct", "inlineVavPct", "inlineVfdHz", "inlineSetTemp", "inlineFanStatus"
    ].forEach((id) => (el[id] = document.getElementById(id)));
  }

  function setLamp(lampEl, cls) {
    if (!lampEl) return;
    lampEl.className = "status-lamp" + (cls ? " " + cls : "");
  }
  function setComponentState(groupEl, stateClass) {
    if (!groupEl) return;
    groupEl.classList.remove("state-off", "state-running", "state-cooling", "state-hot", "state-on");
    groupEl.classList.add(stateClass);
  }

  const damperBladeGeometry = new WeakMap();
  function setDamperPosition(groupEl, percentage) {
    if (!groupEl) return;
    const angle = -Math.PI * Math.max(0, Math.min(100, percentage)) / 200;
    groupEl.querySelectorAll("line").forEach((line) => {
      let geometry = damperBladeGeometry.get(line);
      if (!geometry) {
        geometry = {
          centerX: (Number(line.getAttribute("x1")) + Number(line.getAttribute("x2"))) / 2,
          centerY: (Number(line.getAttribute("y1")) + Number(line.getAttribute("y2"))) / 2,
          halfLength: Math.hypot(
            Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")),
            Number(line.getAttribute("y2")) - Number(line.getAttribute("y1"))
          ) / 2
        };
        damperBladeGeometry.set(line, geometry);
      }
      const halfX = -Math.sin(angle) * geometry.halfLength;
      const halfY = Math.cos(angle) * geometry.halfLength;
      const target = [
        geometry.centerX - halfX,
        geometry.centerY - halfY,
        geometry.centerX + halfX,
        geometry.centerY + halfY
      ].map((value) => value.toFixed(2));
      if (geometry.target && target.every((value, index) => value === geometry.target[index])) return;
      if (geometry.frameId) cancelAnimationFrame(geometry.frameId);

      const start = ["x1", "y1", "x2", "y2"].map((attribute) => Number(line.getAttribute(attribute)));
      geometry.target = target;
      if (start.every((value, index) => Math.abs(value - Number(target[index])) < 0.01)) {
        target.forEach((value, index) => line.setAttribute(["x1", "y1", "x2", "y2"][index], value));
        geometry.frameId = null;
        return;
      }

      const startTime = performance.now();
      function animateDamper(now) {
        const progress = Math.min(1, (now - startTime) / 350);
        const eased = progress * progress * (3 - 2 * progress);
        const current = start.map((value, index) => value + (Number(target[index]) - value) * eased);
        current.forEach((value, index) => line.setAttribute(["x1", "y1", "x2", "y2"][index], value.toFixed(2)));
        if (progress < 1) {
          geometry.frameId = requestAnimationFrame(animateDamper);
        } else {
          target.forEach((value, index) => line.setAttribute(["x1", "y1", "x2", "y2"][index], value));
          geometry.frameId = null;
        }
      }
      geometry.frameId = requestAnimationFrame(animateDamper);
    });
  }

  let activeState = null;

  function renderAll(s, log) {
    activeState = s;
    const isHistorical = Boolean(s.isHistorical);
    const histPlaying = isHistorical && window.HistoryPlayer && window.HistoryPlayer.isPlaying();
    const isSimulating = isHistorical ? histPlaying : s.running;

    // ---- Historical Clock display override ----
    if (isHistorical && s.timestamp) {
      try {
        const dt = new Date(s.timestamp);
        if (el.hdrDate) el.hdrDate.textContent = dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) + " [HISTORICAL]";
        if (el.hdrTime) el.hdrTime.textContent = dt.toLocaleTimeString("en-GB", { hour12: false });
      } catch(e) {}
    }

    // ---- Header status tag & Mode tag ----
    if (el.mimicSystemStatusTag) {
      let displayStatus = s.systemStatus;
      if (isHistorical) {
        displayStatus = histPlaying ? s.systemStatus + " (REPLAY)" : "STANDBY (READY)";
      }
      el.mimicSystemStatusTag.textContent = displayStatus;
      let sysColor = "text-gray";
      if (s.systemStatus === "RUNNING" && isSimulating) sysColor = "text-green";
      else if (s.systemStatus === "STARTING" && isSimulating) sysColor = "text-orange";
      el.mimicSystemStatusTag.className = sysColor;
    }

    const hdrModeVal = document.getElementById("hdrModeVal");
    const hdrModeItem = document.getElementById("hdrModeItem");
    if (hdrModeVal) {
      if (isHistorical) {
        hdrModeVal.textContent = histPlaying ? "HISTORICAL (PLAYING)" : "HISTORICAL (STANDBY)";
        if (hdrModeItem) hdrModeItem.className = histPlaying ? "meta-item mode-live" : "meta-item mode-hist";
      } else {
        hdrModeVal.textContent = s.running ? "LIVE (RUNNING)" : "LIVE (STOPPED)";
        if (hdrModeItem) hdrModeItem.className = s.running ? "meta-item mode-live" : "meta-item";
      }
    }

    // ---- Status panel ----
    if (el.valSystemStatus) {
      if (isHistorical) {
        el.valSystemStatus.textContent = histPlaying ? s.systemStatus : "STANDBY / PAUSED";
      } else {
        el.valSystemStatus.textContent = s.systemStatus;
      }
    }
    if (el.lampSystemStatus) setLamp(el.lampSystemStatus, isSimulating ? (s.systemStatus === "RUNNING" ? "on" : "warm") : "");

    const compOn = isSimulating && s.running;
    if (el.valCompressor) el.valCompressor.textContent = compOn ? "ON" : "OFF";
    if (el.lampCompressor) setLamp(el.lampCompressor, compOn ? "on" : "");

    const condActive = isSimulating && s.running;
    if (el.valCondenser) el.valCondenser.textContent = condActive ? "ACTIVE" : "IDLE";
    if (el.lampCondenser) setLamp(el.lampCondenser, condActive ? "warm" : "");

    const evapActive = isSimulating && s.running;
    if (el.valEvaporator) el.valEvaporator.textContent = evapActive ? "ACTIVE" : "IDLE";
    if (el.lampEvaporator) setLamp(el.lampEvaporator, evapActive ? "cool" : "");

    const capActive = isSimulating && s.running;
    if (el.valCapillary) el.valCapillary.textContent = capActive ? "METERING" : "IDLE";
    if (el.lampCapillary) setLamp(el.lampCapillary, capActive ? "cool" : "");

    // ---- Live parameters (Values ALWAYS show the historical record's numbers) ----
    if (el.pvSuctionP) el.pvSuctionP.textContent = s.suctionPressure.toFixed(1) + " bar";
    if (el.pvDischargeP) el.pvDischargeP.textContent = s.dischargePressure.toFixed(1) + " bar";

    // Condenser
    if (el.pvCondInTemp) el.pvCondInTemp.textContent = s.dischargeTemp.toFixed(1) + " °C";
    if (el.pvCondOutTemp) el.pvCondOutTemp.textContent = s.condenserOutletTemp.toFixed(1) + " °C";

    // Expansion Valve (Capillary Tube)
    if (el.pvExpInTemp) el.pvExpInTemp.textContent = s.condenserOutletTemp.toFixed(1) + " °C";
    if (el.pvExpOutTemp) el.pvExpOutTemp.textContent = s.evaporatorInletTemp.toFixed(1) + " °C";

    // Evaporator
    if (el.pvEvapInTemp) el.pvEvapInTemp.textContent = s.evaporatorInletTemp.toFixed(1) + " °C";
    if (el.pvEvapOutTemp) el.pvEvapOutTemp.textContent = s.evaporatorOutletTemp.toFixed(1) + " °C";

    // ---- AHU / BMS process and actuator layer ----
    const valve = Math.round(s.valveOpening);
    const heatingValve = Math.round(s.heatingValveCommand);
    const damper = Math.round(s.damperPosition);
    const vav = Math.round(s.vavPosition);
    const valveState = valve <= 2 ? "CLOSED" : (valve >= 98 ? "OPEN" : "MODULATING");
    const ahuRunning = s.fanOn && s.vfdFrequency > 0;
    const fanStatus = s.fanOn ? "ON" : "OFF";

    if (el.ahuReturnTemp) el.ahuReturnTemp.textContent = s.returnAirTemperature.toFixed(1) + " °C";
    if (el.ahuValveCmd) el.ahuValveCmd.textContent = valve + " %";
    if (el.ahuValveCmd2) el.ahuValveCmd2.textContent = valve + " %";
    if (el.ahuValveStatus) el.ahuValveStatus.textContent = valveState;
    if (el.ahuCfm) el.ahuCfm.textContent = Math.round(s.airflowCfm) + " CFM";
    if (el.ahuSupplyTemp) el.ahuSupplyTemp.textContent = s.supplyAirTemperature.toFixed(1) + " °C";
    if (el.ahuSupplyTemp2) el.ahuSupplyTemp2.textContent = s.supplyAirTemperature.toFixed(1) + " °C";
    if (el.ahuStaticPressure) el.ahuStaticPressure.textContent = Math.round(s.supplyStaticPressure) + " Pa";
    if (el.ahuVfdHz2) el.ahuVfdHz2.textContent = s.vfdFrequency.toFixed(1) + " Hz";
    if (el.ahuSupplyFilter) el.ahuSupplyFilter.textContent = "NORMAL";

    // Inline control readouts (near equipment) — mirror the same values
    if (el.inlineValvePct) el.inlineValvePct.textContent = valve + " %";
    if (el.inlineHeatingValvePct) el.inlineHeatingValvePct.textContent = heatingValve + " %";
    if (el.inlineDamperPct) el.inlineDamperPct.textContent = damper + " %";
    if (el.inlineVavPct) el.inlineVavPct.textContent = vav + " %";
    if (el.inlineVfdHz) el.inlineVfdHz.textContent = s.vfdFrequency.toFixed(1) + " Hz";
    if (el.inlineSetTemp) el.inlineSetTemp.textContent = s.setTemperature.toFixed(1) + " °C";
    if (el.inlineFanStatus) { el.inlineFanStatus.textContent = fanStatus; el.inlineFanStatus.className = "actuator-readout " + (s.fanOn ? "on" : "off"); }

    if (el.ahuValveStem) {
      const y = 81 + valve * 0.06;
      el.ahuValveStem.setAttribute("y2", y.toFixed(1));
    }
    if (el.ahuCoolingValve) el.ahuCoolingValve.classList.toggle("active", valve > 2);
    if (el.ahuWaterFlow) {
      el.ahuWaterFlow.style.opacity = String(valve / 100);
      el.ahuWaterFlow.style.animationDuration = Math.max(0.18, 1.1 - valve / 100).toFixed(2) + "s";
    }
    const coolingLevel = Math.max(0, Math.min(100, valve)) / 100;
    const coolingTube = el.ahuCoolingCoil && el.ahuCoolingCoil.querySelector(".ahu-coil-tube");
    if (coolingTube) {
      const neutralColor = [101, 115, 123];
      const activeColor = [32, 169, 213];
      const color = neutralColor.map((start, index) => Math.round(start + (activeColor[index] - start) * coolingLevel));
      coolingTube.style.stroke = "rgb(" + color.join(", ") + ")";
    }
    if (el.ahuCoolingCoil) {
      const finPaths = el.ahuCoolingCoil.querySelectorAll(".ahu-coil-fins path");
      const finColors = [
        [[125, 137, 144], [50, 147, 185]],
        [[170, 180, 186], [138, 203, 224]]
      ];
      finPaths.forEach((path, index) => {
        const colors = finColors[Math.min(index, finColors.length - 1)];
        const color = colors[0].map((start, channel) => Math.round(start + (colors[1][channel] - start) * coolingLevel));
        path.style.stroke = "rgb(" + color.join(", ") + ")";
      });
    }
    if (el.ahuCoilGlow) el.ahuCoilGlow.style.opacity = String(0.36 * coolingLevel * coolingLevel);
    const heatingLevel = Math.max(0, Math.min(100, heatingValve)) / 100;
    const heatingElement = el.ahuHeatingCoil && el.ahuHeatingCoil.querySelector(".ahu-heating-tube");
    if (el.ahuHeatingCoil) {
      el.ahuHeatingCoil.classList.toggle("active", heatingLevel > 0);
      el.ahuHeatingCoil.style.filter = heatingLevel > 0
        ? "drop-shadow(0 0 " + (9 * heatingLevel).toFixed(1) + "px rgba(255, 71, 34, " + (0.55 * heatingLevel).toFixed(2) + "))"
        : "none";
    }
    if (heatingElement) {
      const neutralColor = [90, 100, 110];
      const hotColor = [255, 55, 20];
      const color = neutralColor.map((start, index) => Math.round(start + (hotColor[index] - start) * heatingLevel));
      heatingElement.style.stroke = "rgb(" + color.join(", ") + ")";
    }
    if (el.ahuHeatingCoilGlow) el.ahuHeatingCoilGlow.style.opacity = String(0.28 * heatingLevel * heatingLevel);
    if (el.ahuFanRotor) {
      el.ahuFanRotor.classList.toggle("active", s.fanOn && s.vfdFrequency > 0);
      el.ahuFanRotor.style.setProperty("--fan-speed", Math.max(0.20, 1.1 - (s.vfdFrequency / 60) * 0.9).toFixed(2) + "s");
    }
    setDamperPosition(el.ahuDamper, damper);
    setDamperPosition(el.ahuVavOutdoor, vav);
    setDamperPosition(el.ahuVavReturn, vav);
    if (el.actVfdLed) el.actVfdLed.classList.toggle("active", ahuRunning);

    // ---- Event log ----
    if (el.eventLog && log) {
      el.eventLog.innerHTML = log.slice(0, 30).map((entry) => {
        const sevClass = entry.severity === "ok" ? "sev-ok" : (entry.severity === "warn" ? "sev-warn" : (entry.severity === "err" ? "sev-err" : ""));
        return '<li class="' + sevClass + '"><span class="log-time">' + entry.time + '</span><span class="log-msg">' + entry.message + "</span></li>";
      }).join("");
    }

    // ---- SVG component states (Only active when simulating / playing!) ----
    if (el.compressor) setComponentState(el.compressor, compOn ? "state-running" : "state-off");
    if (el.compressorMotor) {
      const pulse = el.compressorMotor.querySelector(".compressor-pulse");
      if (pulse) pulse.classList.toggle("active", compOn);
    }

    if (el.condenser) setComponentState(el.condenser, condActive ? "state-hot" : "state-off");
    if (el.condShimmer1) el.condShimmer1.classList.toggle("active", condActive);

    if (el.evaporator) setComponentState(el.evaporator, evapActive ? "state-cooling" : "state-off");
    if (el.evapShimmer1) el.evapShimmer1.classList.toggle("active", evapActive);

    if (el.capillaryTube) setComponentState(el.capillaryTube, capActive ? "state-cooling" : "state-off");
    if (el.capillaryGlow) el.capillaryGlow.classList.toggle("active", capActive);

    // ---- Sensor readouts on the diagram (Always display historical frame values) ----
    if (el.svgDischargePressure) el.svgDischargePressure.textContent = s.dischargePressure.toFixed(1) + " bar";
    if (el.svgDischargeTemp) el.svgDischargeTemp.textContent = s.dischargeTemp.toFixed(1) + "°C";
    if (el.svgSuctionPressure) el.svgSuctionPressure.textContent = s.suctionPressure.toFixed(1) + " bar";
    if (el.svgCondenserOutletTemp) el.svgCondenserOutletTemp.textContent = s.condenserOutletTemp.toFixed(1) + "°C";
    if (el.svgEvaporatorInletTemp) el.svgEvaporatorInletTemp.textContent = s.evaporatorInletTemp.toFixed(1) + "°C";
    if (el.svgEvaporatorOutletTemp) el.svgEvaporatorOutletTemp.textContent = s.evaporatorOutletTemp.toFixed(1) + "°C";
  }

  // ------------------------------------------------------------
  // Refrigerant flow animation
  // ------------------------------------------------------------
  const FLOW_SEGMENTS = [
    // 1. Hot gas discharge: compressor right port (208, 200) → S-curve up → condenser left inlet (244, 93)
    { points: [[208, 200], [222, 200], [234, 150], [234, 93], [244, 93]], hot: true },
    // 2. Through condenser (left to right, down serpentines to fan bottom)
    { points: [[244, 93], [617, 93], [617, 239], [660, 276]], hot: true },
    // 3. High-P liquid line: condenser bottom → down to y=360 → right to x=736 → up to y=290 → capillary inlet
    { points: [[660, 276], [660, 360], [736, 360], [736, 290], [760, 290]], hot: true },
    // 4. Through capillary tube (expansion — left to right through copper spiral coil)
    { points: [[760, 290], [974, 290]], hot: false },
    // 5. Low-P expanded line: capillary outlet → right → down → left → evaporator right
    { points: [[974, 290], [1025, 290], [1025, 525], [672, 525]], hot: false },
    // 6. Through evaporator (right to left at y=525)
    { points: [[672, 525], [215, 525]], hot: false },
    // 7. Suction line: evaporator left → left → up → right into compressor left port (88, 293)
    { points: [[215, 525], [58, 525], [58, 293], [88, 293]], hot: false }
  ];

  const totalLengths = [];
  let circuitLength = 0;

  function dist(p1, p2) {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function precalculateCircuit() {
    circuitLength = 0;
    FLOW_SEGMENTS.forEach((seg) => {
      let segLen = 0;
      for (let i = 0; i < seg.points.length - 1; i++) {
        segLen += dist(seg.points[i], seg.points[i + 1]);
      }
      totalLengths.push(segLen);
      circuitLength += segLen;
    });
  }

  function locate(distance) {
    let d = ((distance % circuitLength) + circuitLength) % circuitLength;
    for (let i = 0; i < FLOW_SEGMENTS.length; i++) {
      const segLen = totalLengths[i];
      if (d <= segLen) {
        const seg = FLOW_SEGMENTS[i];
        let acc = 0;
        for (let j = 0; j < seg.points.length - 1; j++) {
          const segDist = dist(seg.points[j], seg.points[j + 1]);
          if (d <= acc + segDist) {
            const frac = segDist === 0 ? 0 : (d - acc) / segDist;
            const x = seg.points[j][0] + (seg.points[j + 1][0] - seg.points[j][0]) * frac;
            const y = seg.points[j][1] + (seg.points[j + 1][1] - seg.points[j][1]) * frac;
            return { point: [x, y], hot: seg.hot };
          }
          acc += segDist;
        }
      }
      d -= segLen;
    }
    return { point: FLOW_SEGMENTS[0].points[0], hot: true };
  }

  const DOT_COUNT = 36;
  const dots = [];

  function initFlowDots() {
    precalculateCircuit();
    if (!el.refrigerantFlow) return;
    el.refrigerantFlow.innerHTML = "";
    dots.length = 0;

    const spacing = circuitLength / DOT_COUNT;
    for (let i = 0; i < DOT_COUNT; i++) {
      const initialDist = i * spacing;
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("r", "3.5");
      circle.setAttribute("class", "flow-dot");
      el.refrigerantFlow.appendChild(circle);
      dots.push({ el: circle, distance: initialDist });
    }
  }

  let currentFlowSpeed = 0;
  let lastFrameTime = null;

  function targetFlowSpeed() {
    const s = activeState || (window.Sim ? window.Sim.state : null);
    if (!s || !s.running) {
      currentFlowSpeed = 0;
      return 0;
    }

    // In historical mode, ONLY move flow dots when playback is actively playing
    if (s.isHistorical) {
      const isPlaying = Boolean(window.HistoryPlayer && window.HistoryPlayer.isPlaying());
      if (!isPlaying) {
        currentFlowSpeed = 0;
        return 0;
      }
    }

    const BASE_SPEED = 140;
    return BASE_SPEED * (s.running ? 1 : 0);
  }

  function animateFlow(timestamp) {
    if (lastFrameTime === null) lastFrameTime = timestamp;
    const dt = Math.min(0.1, (timestamp - lastFrameTime) / 1000);
    lastFrameTime = timestamp;

    const target = targetFlowSpeed();
    currentFlowSpeed += (target - currentFlowSpeed) * 0.05;
    if (Math.abs(currentFlowSpeed - target) < 0.3) currentFlowSpeed = target;

    dots.forEach((dot) => {
      dot.distance += currentFlowSpeed * dt;
      const loc = locate(dot.distance);
      dot.el.setAttribute("cx", loc.point[0].toFixed(1));
      dot.el.setAttribute("cy", loc.point[1].toFixed(1));
      dot.el.classList.toggle("hot", loc.hot);
    });

    requestAnimationFrame(animateFlow);
  }

  const AIR_DOT_COUNT = 36;
  const AIR_FLOW_LANES = [-36, -24, -12, 0, 12, 24, 36];
  const AIR_DASH_LENGTH = 46;
  const SUPPLY_DAMPER_START_T = 0.80 + ((992 - 966) / (1062 - 966)) * 0.09;
  const SUPPLY_DAMPER_STOP_X = 992;
  const AIR_GRADIENT_STOP_IDS = [
    "ahuAirGradientStop0", "ahuAirGradientStop1", "ahuAirGradientStop2",
    "ahuAirGradientStop3", "ahuAirGradientStop4", "ahuAirGradientStop5"
  ];
  const AIR_GRADIENT_POSITIONS = [0.22, 0.31, 0.414, 0.43, 0.534, 0.82];
  const airDots = [];
  const airStreamPaths = [];
  let airGradientStops = [];
  let airStreamOffset = 0;
  let airLastFrame = null;
  function initAirflowDots() {
    if (!el.ahuAirflowDots) return;
    el.ahuAirflowDots.innerHTML = "";
    airDots.length = 0;
    airStreamPaths.length = 0;
    airGradientStops = AIR_GRADIENT_STOP_IDS.map((id) => document.getElementById(id)).filter(Boolean);
    airStreamOffset = 0;

    function addStreamPath(pathData, className, phase, laneIndex) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.setAttribute("class", className);
      path.setAttribute("stroke-dasharray", "28 18");
      path.setAttribute("stroke-dashoffset", String(-phase));
      el.ahuAirflowDots.appendChild(path);
      airStreamPaths.push({ el: path, phase: phase, laneIndex: laneIndex });
    }

    addStreamPath("M35 112 H137 C151 112 153 125 153 145 C153 164 145 168 145 178 H235", "air-stream-line air-stream-branch", 0);
    addStreamPath("M35 285 H137 C151 285 153 270 153 251 C153 232 145 221 145 178 H235", "air-stream-line air-stream-branch", 9.5);
    AIR_FLOW_LANES.forEach((lane, index) => {
      addStreamPath("M235 178 L257 " + (178 + lane) + " H1135", "air-stream-line", index * 5.7, index);
    });

    const AIR_DOT_COUNT = 48;
    for (let i = 0; i < AIR_DOT_COUNT; i++) {
      const streak = document.createElementNS("http://www.w3.org/2000/svg", "line");
      streak.setAttribute("class", "air-streak");
      streak.setAttribute("stroke-linecap", "round");
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("r", (2 + (i % 3) * 0.45).toFixed(2));
      c.setAttribute("class", "air-dot");
      const arrow = i % 8 === 0 ? document.createElementNS("http://www.w3.org/2000/svg", "path") : null;
      if (arrow) arrow.setAttribute("class", "air-direction-arrow");
      el.ahuAirflowDots.appendChild(streak);
      el.ahuAirflowDots.appendChild(c);
      if (arrow) el.ahuAirflowDots.appendChild(arrow);
      airDots.push({
        el: c,
        streak: streak,
        arrow: arrow,
        t: i / AIR_DOT_COUNT,
        branch: i % 2 === 0 ? "outdoor" : "return",
        lane: AIR_FLOW_LANES[i % AIR_FLOW_LANES.length],
        opacity: 0.72 + (i % 4) * 0.06,
        trailLength: 0.03 + (i % 4) * 0.007
      });
    }
  }

  function airPath(t, branch, lane) {
    // Physical AHU sequence: branch -> mixing -> filter -> coil -> fan -> damper -> supply.
    let x, y;
    if (t < 0.18) {
      const q = t / 0.18;
      const branchY = (branch === "outdoor" ? 112 : 285) + lane * 0.18;
      if (q < 0.42) {
        x = 40 + (q / 0.42) * 105;
        y = branchY;
      } else if (q < 0.74) {
        const segment = (q - 0.42) / 0.32;
        const eased = segment * segment * (3 - 2 * segment);
        x = 145 + 8 * Math.sin(Math.PI * segment);
        y = branchY + (178 - branchY) * eased;
      } else {
        x = 145 + ((q - 0.74) / 0.26) * 90;
        y = 178;
      }
    } else if (t < 0.22) {
      const q = (t - 0.18) / 0.04; x = 235 + q * 35; y = 178 + lane * q;
    } else if (t < 0.31) {
      const q = (t - 0.22) / 0.09; x = 270 + q * 90; y = 178 + lane;
    } else if (t < 0.55) {
      const q = (t - 0.31) / 0.24; x = 360 + q * 300; y = 178 + lane;
    } else if (t < 0.72) {
      const q = (t - 0.55) / 0.17; x = 660 + q * 220; y = 178 + lane;
    } else if (t < 0.80) {
      const q = (t - 0.72) / 0.08; x = 880 + q * 86; y = 178 + lane;
    } else if (t < 0.89) {
      const q = (t - 0.80) / 0.09; x = 966 + q * 96; y = 178 + lane;
    } else {
      const q = (t - 0.89) / 0.11; x = 1062 + q * 68; y = 178 + lane;
    }
    return [x, y];
  }

  function animateAirflow(timestamp) {
    if (airLastFrame === null) airLastFrame = timestamp;
    const dt = Math.min(0.08, (timestamp - airLastFrame) / 1000);
    airLastFrame = timestamp;
    const s = activeState || (window.Sim ? window.Sim.state : null);
    const damperRatio = s ? Math.max(0, Math.min(100, Number(s.damperPosition) || 0)) / 100 : 0;
    const vfdRatio = s ? Math.max(0, Math.min(60, Number(s.vfdFrequency) || 0)) / 60 : 0;
    const vavRatio = s ? Math.max(0, Math.min(100, Number(s.vavPosition) || 0)) / 100 : 0;
    const upstreamCfm = s && s.fanOn
      ? Math.min(1800, damperRatio > 0 ? Math.max(0, s.airflowCfm) / damperRatio : 1800 * vfdRatio * vavRatio)
      : 0;
    const active = s && s.fanOn && upstreamCfm > 1;
    const speed = active ? (0.055 + Math.min(1, upstreamCfm / 1800) * 0.30) : 0;
    const cooling = s ? Math.max(0, Math.min(1, s.valveOpening / 100)) : 0;
    const cooledAirTemp = s ? s.returnAirTemperature - cooling * 8.5 : 0;
    const heating = s ? Math.max(0, Math.min(1, (s.setTemperature - cooledAirTemp) / 8)) : 0;
    const cfmRatio = Math.min(1, upstreamCfm / 1500);
    const passingLaneCount = Math.ceil(AIR_FLOW_LANES.length * damperRatio);
    if (active) airStreamOffset = (airStreamOffset + speed * 550 * dt) % AIR_DASH_LENGTH;
    airStreamPaths.forEach((stream) => {
      let offsetSpeed = 1;
      if (stream.laneIndex !== undefined) {
        const lane = AIR_FLOW_LANES[stream.laneIndex];
        const passesDamper = stream.laneIndex < passingLaneCount;
        const endX = passesDamper ? 1135 : SUPPLY_DAMPER_STOP_X;
        const pathData = "M235 178 L257 " + (178 + lane) + " H" + endX;
        if (stream.el.getAttribute("d") !== pathData) stream.el.setAttribute("d", pathData);
        if (passesDamper) offsetSpeed = damperRatio;
      }
      stream.el.style.strokeDashoffset = String(-((airStreamOffset * offsetSpeed + stream.phase) % AIR_DASH_LENGTH));
      stream.el.style.opacity = active ? String(0.52 + cfmRatio * 0.27) : "0";
    });
    airGradientStops.forEach((stop, index) => {
      stop.setAttribute("stop-color", airColor(AIR_GRADIENT_POSITIONS[index], cooling, heating));
    });
    airDots.forEach((dot, index) => {
      // A small local acceleration around the fan gives the stream a clear
      // fan relationship while preserving its left-to-right route.
      const fanBoost = dot.t >= 0.52 && dot.t < 0.72 ? 1.38 : 1;
      const branchParticleIndex = Math.floor(index / 2);
      const passesDamper = damperRatio >= 1 || (branchParticleIndex * damperRatio) % 1 < damperRatio;
      if (passesDamper) {
        const damperSpeed = dot.t >= SUPPLY_DAMPER_START_T ? damperRatio : 1;
        dot.t = (dot.t + speed * fanBoost * damperSpeed * dt) % 1;
      } else if (dot.t >= SUPPLY_DAMPER_START_T) {
        dot.t = dot.t <= SUPPLY_DAMPER_START_T + 0.0001 ? 0 : SUPPLY_DAMPER_START_T;
      } else {
        dot.t += speed * fanBoost * dt;
        if (dot.t >= SUPPLY_DAMPER_START_T) dot.t = SUPPLY_DAMPER_START_T;
      }
      const point = airPath(dot.t, dot.branch, dot.lane);
      const tailT = Math.max(0, dot.t - dot.trailLength);
      const tail = airPath(tailT, dot.branch, dot.lane);
      const color = airColor(dot.t, cooling, heating);
      dot.el.setAttribute("cx", point[0].toFixed(1));
      dot.el.setAttribute("cy", point[1].toFixed(1));
      dot.el.setAttribute("fill", color);
      dot.streak.setAttribute("x1", tail[0].toFixed(1));
      dot.streak.setAttribute("y1", tail[1].toFixed(1));
      dot.streak.setAttribute("x2", point[0].toFixed(1));
      dot.streak.setAttribute("y2", point[1].toFixed(1));
      dot.streak.setAttribute("stroke", color);
      dot.streak.setAttribute("stroke-width", dot.t < 0.18 ? "3.0" : "3.6");
      const recycleFade = Math.min(1, dot.t / 0.018, (1 - dot.t) / 0.018);
      if (dot.arrow) {
        const ahead = airPath(Math.min(0.999, dot.t + 0.006), dot.branch, dot.lane);
        const angle = Math.atan2(ahead[1] - point[1], ahead[0] - point[0]);
        const backX = point[0] - Math.cos(angle) * 6;
        const backY = point[1] - Math.sin(angle) * 6;
        const sideX = Math.sin(angle) * 3.5;
        const sideY = Math.cos(angle) * 3.5;
        dot.arrow.setAttribute("d", "M" + point[0].toFixed(1) + " " + point[1].toFixed(1) + " L" + (backX + sideX).toFixed(1) + " " + (backY + sideY).toFixed(1) + " L" + (backX - sideX).toFixed(1) + " " + (backY - sideY).toFixed(1) + " Z");
        dot.arrow.setAttribute("fill", color);
        dot.arrow.style.opacity = active ? String(Math.min(0.8, 0.5 + s.airflowCfm / 5000) * recycleFade) : "0";
      }
      const flowOpacity = (0.42 + cfmRatio * 0.34) * dot.opacity;
      dot.el.style.opacity = active ? String(flowOpacity * recycleFade) : "0";
      dot.streak.style.opacity = active ? String((0.5 + cfmRatio * 0.32) * dot.opacity * recycleFade) : "0";
    });
    requestAnimationFrame(animateAirflow);
  }

  function airColor(t, cooling, heating) {
    // Stage ranges mirror airPath: neutral mixed air -> cooling coil ->
    // chilled air -> heating coil -> conditioned supply air.
    const neutral = [145, 181, 195];
    const cyan = [72, 189, 214];
    const blue = [42, 133, 190];
    const warm = [211, 154, 115];
    const warmMix = Math.min(1, heating * 2);
    let from = neutral, to = neutral, amount = 0;
    if (t >= 0.31 && t < 0.414) {
      from = neutral;
      to = cooling > 0.05 ? blue : neutral;
      amount = ((t - 0.31) / 0.104) * cooling;
    } else if (t >= 0.414 && t < 0.43) {
      from = cooling > 0.05 ? blue : neutral;
      to = from;
      amount = 1;
    } else if (t >= 0.43 && t < 0.534) {
      from = cooling > 0.05 ? blue : neutral;
      to = heating > 0.05 ? warm : cyan;
      amount = ((t - 0.43) / 0.104) * Math.max(cooling, warmMix);
    } else if (t >= 0.534) {
      from = cooling > 0.05 ? blue : neutral;
      to = heating > 0.05 ? warm : cyan;
      amount = Math.max(cooling * 0.65, warmMix);
    }
    return "rgb(" + from.map((value, index) => Math.round(value + (to[index] - value) * Math.max(0, Math.min(1, amount)))).join(",") + ")";
  }

  function updateClock() {
    if (activeState && activeState.isHistorical) return; // don't override historical replay time
    const now = new Date();
    if (el.hdrDate) el.hdrDate.textContent = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    if (el.hdrTime) el.hdrTime.textContent = now.toLocaleTimeString("en-GB", { hour12: false });
  }

  window.UI = {
    cache: cache,
    renderAll: renderAll,
    initFlowDots: initFlowDots,
    initAirflowDots: initAirflowDots,
    animateFlow: animateFlow,
    animateAirflow: animateAirflow,
    updateClock: updateClock,
    getActiveState: () => activeState
  };
})();
