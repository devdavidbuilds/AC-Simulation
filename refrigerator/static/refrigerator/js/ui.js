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
      "svgCondenserInletTemp", "svgCapInletTemp", "svgEvapCoilInTemp",
      "svgCompSpeed", "svgCondFanSpeed", "svgCapOpening", "svgEvapFanSpeed",
      "lampFault", "valFault", "valCycle",
      "rfcard_comp", "rfcard_cond", "rfcard_cap", "rfcard_evap",
      "compressor", "compressorMotor", "condenser", "evaporator", "capillaryTube",
      "condShimmer1", "evapShimmer1", "capillaryGlow",
      "refrigerantFlow",
      "actFanStatus", "actVfdLed",
      "ahuReturnTemp", "ahuValveCmd", "ahuValveStatus", "ahuCfm", "ahuSupplyTemp", "ahuStaticPressure",
      "ahuSupplyTemp2", "ahuVfdHz2", "ahuSupplyFilter",
      "ahuValveCmd2", "ahuHeatingValveCmd", "ahuHeatingValve", "ahuHeatingValveStem", "ahuHotFlow", "ahuFilterLed", "ahuCoolingValve", "ahuValveStem", "ahuWaterFlow", "ahuCoilGlow", "ahuCoolingCoil", "ahuHeatingCoil", "ahuHeatingCoilGlow",
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

  // Vertical louver slats (front view): 0% = slats side by side and touching (closed), 100% = slats edge-on (open); they open/close left-to-right.
  const DAMPER_EDGE_THICKNESS = 2.2;
  function setDamperPosition(groupEl, percentage) {
    if (!groupEl) return;
    const open = Math.max(0, Math.min(100, percentage)) / 100;
    groupEl.querySelectorAll(".ahu-damper-blade").forEach((blade) => {
      const pitch = Number(blade.dataset.pitch) || 20;
      const scale = 1 - open * (1 - DAMPER_EDGE_THICKNESS / pitch);
      blade.style.transform = "scaleX(" + scale.toFixed(3) + ")";
    });
  }

  // ---- Equipment reading cards + threshold alerts ----
  const OUTDOOR_TEMP = 32.5, OUTDOOR_RH = 62, RETURN_RH = 55, OA_FRACTION = 0.4;
  const THRESHOLDS = {
    returnTempHigh: 28, filterDpHigh: 80, sFilterDpHigh: 85, coilOutLow: 12,
    heatOutHigh: 35, supplyTempHigh: 26, supplyTempLow: 14, staticHigh: 450, vfdHigh: 55
  };
  const rdCache = {};
  function rd(id) { return rdCache[id] || (rdCache[id] = document.getElementById(id)); }
  function setRd(id, text, warn) {
    const node = rd(id);
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("warn", !!warn);
  }
  function flagCard(id, warn) {
    const node = rd(id);
    if (node) node.classList.toggle("warn", !!warn);
  }
  function updateAhuReadings(s) {
    const fanOn = !!s.fanOn;
    const vfd = Math.max(0, Math.min(60, Number(s.vfdFrequency) || 0));
    const vavF = Math.max(0, Math.min(100, s.vavPosition)) / 100;
    const upstream = s.upstreamCfm !== undefined ? s.upstreamCfm : (fanOn ? 1800 * vfd / 60 * vavF : 0);
    const supplyFlow = Math.round(s.airflowCfm);
    const oaFlow = Math.round(upstream * OA_FRACTION);
    const raFlow = Math.round(upstream * (1 - OA_FRACTION));
    const mixT = s.mixedAirTemp !== undefined ? s.mixedAirTemp : OA_FRACTION * OUTDOOR_TEMP + (1 - OA_FRACTION) * s.returnAirTemperature;
    const coolOut = s.coolingOutTemp !== undefined ? s.coolingOutTemp : mixT;
    const heatOut = s.heatingOutTemp !== undefined ? s.heatingOutTemp : coolOut;
    const mixRh = OA_FRACTION * OUTDOOR_RH + (1 - OA_FRACTION) * RETURN_RH;
    const coolDrop = mixT - coolOut, heatRise = heatOut - coolOut;
    const supplyRh = Math.max(20, mixRh - 0.35 * coolDrop - 0.4 * Math.max(0, heatRise));
    const dp = 85 * Math.pow(upstream / 1800, 2);
    const sdp = 90 * Math.pow(upstream / 1800, 2);
    const valve = Math.round(s.valveOpening), hv = Math.round(s.heatingValveCommand);
    const damper = Math.round(s.damperPosition), vav = Math.round(s.vavPosition);
    const t1 = (v) => v.toFixed(1) + " °C";

    const alerts = [];
    const warnReturn = s.returnAirTemperature > THRESHOLDS.returnTempHigh;
    const warnFilter = dp > THRESHOLDS.filterDpHigh;
    const warnSFilter = sdp > THRESHOLDS.sFilterDpHigh;
    const coolActive = fanOn && upstream > 1;
    const warnCoolOut = coolActive && coolOut < THRESHOLDS.coilOutLow;
    const warnHeatOut = coolActive && heatOut > THRESHOLDS.heatOutHigh;
    const warnSupT = coolActive && (s.supplyAirTemperature > THRESHOLDS.supplyTempHigh || s.supplyAirTemperature < THRESHOLDS.supplyTempLow);
    const warnStatic = s.supplyStaticPressure > THRESHOLDS.staticHigh;
    const warnVfd = vfd > THRESHOLDS.vfdHigh;
    const warnSimul = coolActive && valve > 60 && hv > 60;
    if (warnReturn) alerts.push("RETURN AIR TEMP HIGH (" + s.returnAirTemperature.toFixed(1) + " °C > " + THRESHOLDS.returnTempHigh + " °C)");
    if (warnFilter) alerts.push("PRE-FILTER DP HIGH (" + Math.round(dp) + " Pa > " + THRESHOLDS.filterDpHigh + " Pa)");
    if (warnSFilter) alerts.push("SUPPLY FILTER DP HIGH (" + Math.round(sdp) + " Pa > " + THRESHOLDS.sFilterDpHigh + " Pa)");
    if (warnCoolOut) alerts.push("COOLING COIL OUTLET TEMP LOW (" + coolOut.toFixed(1) + " °C < " + THRESHOLDS.coilOutLow + " °C) - FREEZE RISK");
    if (warnHeatOut) alerts.push("HEATING COIL OUTLET TEMP HIGH (" + heatOut.toFixed(1) + " °C > " + THRESHOLDS.heatOutHigh + " °C)");
    if (warnSupT) alerts.push("SUPPLY AIR TEMP OUT OF RANGE (" + s.supplyAirTemperature.toFixed(1) + " °C, limits " + THRESHOLDS.supplyTempLow + "-" + THRESHOLDS.supplyTempHigh + " °C)");
    if (warnStatic) alerts.push("SUPPLY STATIC PRESSURE HIGH (" + Math.round(s.supplyStaticPressure) + " Pa > " + THRESHOLDS.staticHigh + " Pa)");
    if (warnVfd) alerts.push("VFD SPEED HIGH (" + vfd.toFixed(1) + " Hz > " + THRESHOLDS.vfdHigh + " Hz)");
    if (warnSimul) alerts.push("SIMULTANEOUS COOLING AND HEATING (both valves > 60 %)");

    setRd("rdOaTemp", t1(OUTDOOR_TEMP)); setRd("rdOaRh", OUTDOOR_RH + " %"); setRd("rdOaFlow", oaFlow + " CFM");
    setRd("rdVavOaPos", vav + " %"); setRd("rdVavOaFlow", oaFlow + " CFM");
    setRd("rdRaTemp", t1(s.returnAirTemperature), warnReturn); setRd("rdRaRh", RETURN_RH + " %"); setRd("rdRaFlow", raFlow + " CFM");
    setRd("rdVavRaPos", vav + " %"); setRd("rdVavRaFlow", raFlow + " CFM");
    setRd("rdMixTemp", t1(mixT)); setRd("rdMixRh", mixRh.toFixed(0) + " %"); setRd("rdMixFlow", Math.round(upstream) + " CFM");
    setRd("rdFilterDp", Math.round(dp) + " Pa", warnFilter); setRd("rdFilterSts", warnFilter ? "ALARM" : "NORMAL", warnFilter);
    setRd("rdCoolIn", t1(mixT)); setRd("rdCoolOut", t1(coolOut), warnCoolOut); setRd("rdCoolVlv", valve + " %");
    setRd("rdHeatIn", t1(coolOut)); setRd("rdHeatOut", t1(heatOut), warnHeatOut); setRd("rdHeatVlv", hv + " %", warnSimul);
    setRd("rdFanSts", fanOn ? "ON" : "OFF"); setRd("rdFanHz", vfd.toFixed(0) + " Hz", warnVfd);
    setRd("rdFanRpm", (fanOn ? Math.round(vfd * 21.25) : 0) + " RPM"); setRd("rdFanCfm", Math.round(upstream) + " CFM");
    setRd("rdSFilterDp", Math.round(sdp) + " Pa", warnSFilter); setRd("rdSFilterSts", warnSFilter ? "ALARM" : "NORMAL", warnSFilter);
    setRd("rdDamperPos", damper + " %"); setRd("rdDamperFlow", supplyFlow + " CFM");
    setRd("rdSaTemp", t1(s.supplyAirTemperature), warnSupT); setRd("rdSaRh", supplyRh.toFixed(0) + " %");
    setRd("rdSaStatic", Math.round(s.supplyStaticPressure) + " Pa", warnStatic); setRd("rdSaFlow", supplyFlow + " CFM");

    flagCard("rd_ra", warnReturn); flagCard("rd_filter", warnFilter); flagCard("rd_sfilter", warnSFilter);
    flagCard("rd_cool", warnCoolOut); flagCard("rd_heat", warnHeatOut || warnSimul); flagCard("rd_fan", warnVfd);
    flagCard("rd_supply", warnSupT || warnStatic);
    flagCard("rd_coolValve", warnSimul); flagCard("rd_heatValve", warnSimul);

    const bar = document.getElementById("ahuAlertBar");
    if (bar) {
      bar.hidden = alerts.length === 0;
      const html = alerts.length ? '<span class="alert-tag">ALERT</span>' + alerts.map((a) => "<span>&#9888; " + a + "</span>").join("") : "";
      if (bar.dataset.sig !== html) { bar.innerHTML = html; bar.dataset.sig = html; }
    }
  }

  // ---- Refrigeration health: component colours + alerts (like the AHU alert bar) ----
  const RF_LIMITS = {
    dischargeP:  { warn: 11.5, alarm: 13,  high: true,  label: "DISCHARGE PRESSURE HIGH", unit: " bar" },
    suctionP:    { warn: 1.1,  alarm: 0.9, high: false, label: "SUCTION PRESSURE LOW", unit: " bar" },
    dischargeT:  { warn: 92,   alarm: 100, high: true,  label: "DISCHARGE TEMP HIGH", unit: " °C" },
    condOutT:    { warn: 46,   alarm: 52,  high: true,  label: "CONDENSER OUTLET TEMP HIGH (POOR HEAT REJECTION)", unit: " °C" },
    superheatLo: { warn: 4,    alarm: 2,   high: false, label: "LOW SUPERHEAT - LIQUID FLOODBACK RISK", unit: " K" },
    superheatHi: { warn: 12,   alarm: 15,  high: true,  label: "HIGH SUPERHEAT - EVAPORATOR STARVED", unit: " K" }
  };
  function rfLevel(key, v) {
    const l = RF_LIMITS[key];
    const beyond = (t) => (l.high ? v > t : v < t);
    return beyond(l.alarm) ? 2 : (beyond(l.warn) ? 1 : 0);
  }
  function setHealth(node, lvl) {
    if (!node) return;
    node.classList.remove("health-warn", "health-alarm");
    if (lvl === 1) node.classList.add("health-warn");
    if (lvl === 2) node.classList.add("health-alarm");
  }
  function updateRefrigHealth(s, active) {
    const L = { dP: 0, sP: 0, dT: 0, cT: 0, shLo: 0, shHi: 0 };
    const alerts = [];
    let compL = 0, condL = 0, capL = 0, evapL = 0;
    const superheat = s.evaporatorOutletTemp - s.evaporatorInletTemp;

    const settled = typeof s.runSeconds !== "number" || s.runSeconds >= 9;
    if (active && s.systemStatus !== "STARTING" && settled) {
      L.dP = rfLevel("dischargeP", s.dischargePressure);
      L.sP = rfLevel("suctionP", s.suctionPressure);
      L.dT = rfLevel("dischargeT", s.dischargeTemp);
      L.cT = rfLevel("condOutT", s.condenserOutletTemp);
      L.shLo = rfLevel("superheatLo", superheat);
      L.shHi = rfLevel("superheatHi", superheat);
      const add = (key, lvl, v) => {
        if (lvl) alerts.push({ lvl: lvl, text: RF_LIMITS[key].label + " (" + v.toFixed(1) + RF_LIMITS[key].unit + ")" });
      };
      add("dischargeP", L.dP, s.dischargePressure);
      add("suctionP", L.sP, s.suctionPressure);
      add("dischargeT", L.dT, s.dischargeTemp);
      add("condOutT", L.cT, s.condenserOutletTemp);
      add("superheatLo", L.shLo, superheat);
      add("superheatHi", L.shHi, superheat);

      const F = s.isHistorical ? {} : (s.faults || {});
      const FAULT_TEXT = {
        compressor: "COMPRESSOR MALFUNCTION - MOTOR OVERLOAD / OVERHEATING",
        condenser: "CONDENSER MALFUNCTION - FAN FAILURE, POOR HEAT REJECTION",
        capillary: "CAPILLARY TUBE MALFUNCTION - BLOCKAGE / RESTRICTION",
        evaporator: "EVAPORATOR MALFUNCTION - FAN FAILURE / COIL ICING"
      };
      Object.keys(FAULT_TEXT).forEach((k) => { if (F[k]) alerts.unshift({ lvl: 2, text: FAULT_TEXT[k] }); });

      compL = Math.max(L.dP, L.sP, L.dT, F.compressor ? 2 : 0);
      condL = Math.max(L.cT, L.dP, F.condenser ? 2 : 0);
      capL = Math.max(L.shHi, F.capillary ? 2 : 0);
      evapL = Math.max(L.shLo, L.shHi, F.evaporator ? 2 : 0);
    }

    setHealth(el.compressor, compL);
    setHealth(el.condenser, condL);
    setHealth(el.capillaryTube, capL);
    setHealth(el.evaporator, evapL);
    setHealth(el.rfcard_comp, compL); setHealth(el.rfcard_cond, condL);
    setHealth(el.rfcard_cap, capL); setHealth(el.rfcard_evap, evapL);

    const sh = Math.max(L.shLo, L.shHi);
    [["svgDischargePressure", L.dP], ["svgDischargeTemp", L.dT], ["svgSuctionPressure", L.sP],
     ["svgCondenserOutletTemp", L.cT], ["svgCondenserInletTemp", L.dT], ["svgCapInletTemp", L.cT], ["svgEvapCoilInTemp", capL], ["svgEvaporatorInletTemp", capL], ["svgEvaporatorOutletTemp", sh]
    ].forEach((r) => setHealth(el[r[0]], r[1]));
    const pv = (id, lvl) => { if (el[id] && el[id].parentElement) setHealth(el[id].parentElement, lvl); };
    pv("pvSuctionP", L.sP); pv("pvDischargeP", L.dP); pv("pvCondInTemp", L.dT); pv("pvCondOutTemp", L.cT);
    pv("pvExpInTemp", L.cT); pv("pvExpOutTemp", capL); pv("pvEvapInTemp", capL); pv("pvEvapOutTemp", sh);

    ["rfCompDisP", "rfCondOutT", "rfCapEvapIn", "rfEvapOutT"].forEach((id, i) => {
      const n = document.getElementById(id);
      if (n) setHealth(n.closest(".inline-ctrl-card"), [compL, condL, capL, evapL][i]);
    });

    if (el.valFault) {
      const liveFault = active && !s.isHistorical && s.activeFault && s.activeFault !== "None";
      el.valFault.textContent = liveFault ? s.activeFault.toUpperCase() : (active ? "NONE (NORMAL)" : "--");
      setLamp(el.lampFault, liveFault ? "alarm" : (active ? "on" : ""));
    }
    if (el.valCycle) el.valCycle.textContent = active && !s.isHistorical ? Math.floor(s.cycleSeconds || 0) + " s / 60 s" : "-- / 60 s";

    // Fan rotation follows the component's fan speed; 0 % stops the blades.
    [[el.condenser, s.condenserFanSpeed], [el.evaporator, s.evaporatorFanSpeed]].forEach((f) => {
      if (!f[0] || typeof f[1] !== "number") return;
      const pct = Math.max(0, Math.min(100, f[1]));
      f[0].classList.toggle("fan-stopped", pct < 1);
      if (pct >= 1) f[0].style.setProperty("--fan-dur", (0.3 / (pct / 100)).toFixed(2) + "s");
    });

    const bar = document.getElementById("rfAlertBar");
    if (bar) {
      bar.hidden = alerts.length === 0;
      const html = alerts.length ? '<span class="alert-tag">ALERT</span>' + alerts.map((a) =>
        '<span class="' + (a.lvl === 2 ? "lvl-alarm" : "lvl-warn") + '">&#9888; ' + a.text + "</span>").join("") : "";
      if (bar.dataset.sig !== html) { bar.innerHTML = html; bar.dataset.sig = html; }
    }
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
    const fl = (!s.isHistorical && s.faults) ? s.faults : {};
    if (el.valCompressor) el.valCompressor.textContent = compOn ? (fl.compressor ? "FAULT" : "ON") : "OFF";
    if (el.lampCompressor) setLamp(el.lampCompressor, compOn ? (fl.compressor ? "alarm" : "on") : "");

    const condActive = isSimulating && s.running;
    if (el.valCondenser) el.valCondenser.textContent = condActive ? (fl.condenser ? "FAULT" : "ACTIVE") : "IDLE";
    if (el.lampCondenser) setLamp(el.lampCondenser, condActive ? (fl.condenser ? "alarm" : "warm") : "");

    const evapActive = isSimulating && s.running;
    if (el.valEvaporator) el.valEvaporator.textContent = evapActive ? (fl.evaporator ? "FAULT" : "ACTIVE") : "IDLE";
    if (el.lampEvaporator) setLamp(el.lampEvaporator, evapActive ? (fl.evaporator ? "alarm" : "cool") : "");

    const capActive = isSimulating && s.running;
    if (el.valCapillary) el.valCapillary.textContent = capActive ? (fl.capillary ? "FAULT" : "METERING") : "IDLE";
    if (el.lampCapillary) setLamp(el.lampCapillary, capActive ? (fl.capillary ? "alarm" : "cool") : "");

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

    if (el.ahuValveStem) el.ahuValveStem.setAttribute("y2", (72 - valve * 0.05).toFixed(1));
    if (el.ahuHeatingValveStem) el.ahuHeatingValveStem.setAttribute("y2", (72 - heatingValve * 0.05).toFixed(1));
    if (el.ahuHeatingValveCmd) el.ahuHeatingValveCmd.textContent = heatingValve + " %";
    if (el.ahuHeatingValve) el.ahuHeatingValve.classList.toggle("active", heatingValve > 2);
    if (el.ahuHotFlow) {
      el.ahuHotFlow.style.opacity = String(heatingValve / 100);
      el.ahuHotFlow.style.animationDuration = Math.max(0.18, 1.1 - heatingValve / 100).toFixed(2) + "s";
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
    updateAhuReadings(s);
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

    updateRefrigHealth(s, isSimulating && s.running);
    const dirArrows = document.getElementById("flowArrows");
    if (dirArrows) dirArrows.classList.toggle("flowing", !!(isSimulating && s.running));

    // ---- Sensor readouts on the diagram (Always display historical frame values) ----
    if (el.svgDischargePressure) el.svgDischargePressure.textContent = s.dischargePressure.toFixed(1) + " bar";
    if (el.svgDischargeTemp) el.svgDischargeTemp.textContent = s.dischargeTemp.toFixed(1) + "°C";
    if (el.svgSuctionPressure) el.svgSuctionPressure.textContent = s.suctionPressure.toFixed(1) + " bar";
    if (el.svgCondenserOutletTemp) el.svgCondenserOutletTemp.textContent = s.condenserOutletTemp.toFixed(1) + "°C";
    if (el.svgEvaporatorInletTemp) el.svgEvaporatorInletTemp.textContent = s.evaporatorInletTemp.toFixed(1) + "°C";
    if (el.svgEvaporatorOutletTemp) el.svgEvaporatorOutletTemp.textContent = s.evaporatorOutletTemp.toFixed(1) + "°C";
    if (el.svgCondenserInletTemp) el.svgCondenserInletTemp.textContent = s.dischargeTemp.toFixed(1) + "°C";
    if (el.svgCapInletTemp) el.svgCapInletTemp.textContent = s.condenserOutletTemp.toFixed(1) + "°C";
    if (el.svgEvapCoilInTemp) el.svgEvapCoilInTemp.textContent = s.evaporatorInletTemp.toFixed(1) + "°C";
    if (el.svgCompSpeed) el.svgCompSpeed.textContent = Math.round(s.compressorSpeed || 0) + " Hz";
    if (el.svgCondFanSpeed) el.svgCondFanSpeed.textContent = Math.round(s.condenserFanSpeed || 0) + " %";
    if (el.svgCapOpening) el.svgCapOpening.textContent = Math.round(s.capillaryOpening || 0) + " %";
    if (el.svgEvapFanSpeed) el.svgEvapFanSpeed.textContent = Math.round(s.evaporatorFanSpeed || 0) + " %";
  }

  // ------------------------------------------------------------
  // Refrigerant flow animation
  // ------------------------------------------------------------
  const FLOW_SEGMENTS = [
    // 1. Hot gas discharge: compressor right port (208, 200) → S-curve up → condenser left inlet (244, 93)
    { points: [[208, 200], [222, 200], [234, 150], [234, 93], [244, 93]], hot: true, color: "#e03a2c" },
    // 2. Through condenser (left to right, down serpentines to fan bottom)
    { points: [[244, 93], [617, 93], [617, 239], [660, 276]], hot: true, color: "#e8512b" },
    // 3. High-P liquid line: condenser bottom → down to y=360 → right to x=736 → up to y=290 → capillary inlet
    { points: [[660, 276], [660, 360], [736, 360], [736, 290], [760, 290]], hot: true, color: "#b03a2e" },
    // 4. Through capillary tube (expansion — left to right through copper spiral coil)
    { points: [[760, 290], [974, 290]], hot: false, color: "#e8863a" },
    // 5. Low-P expanded line: capillary outlet → right → down → left → evaporator right
    { points: [[974, 290], [1025, 290], [1025, 525], [672, 525]], hot: false, color: "#2a7fc9" },
    // 6. Through evaporator (right to left at y=525)
    { points: [[672, 525], [215, 525]], hot: false, color: "#4aa3df" },
    // 7. Suction line: evaporator left → left → up → right into compressor left port (88, 293)
    { points: [[215, 525], [58, 525], [58, 293], [88, 293]], hot: false, color: "#1f6fb5" }
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
            return { point: [x, y], hot: seg.hot, color: seg.color, angle: Math.atan2(seg.points[j + 1][1] - seg.points[j][1], seg.points[j + 1][0] - seg.points[j][0]) * 180 / Math.PI };
          }
          acc += segDist;
        }
      }
      d -= segLen;
    }
    return { point: FLOW_SEGMENTS[0].points[0], hot: true };
  }


  // ---- Fan air-flow arrows (condenser warm air, evaporator cold air) ----
  // Air moves vertically through each coil: warm air rises off the condenser,
  // cool air sinks off the evaporator (kept apart from the horizontal refrigerant lines).
  const AIR_ZONES = [
    { id: "condenser", a0: 268, a1: 74, cols: [300, 350, 400, 450, 500, 550, 595], color: "#f0883e", key: "condenserFanSpeed", per: 3 },
    { id: "evaporator", a0: 458, a1: 598, cols: [250, 295, 340, 385, 430, 475, 520, 565], color: "#2fb6ee", key: "evaporatorFanSpeed", per: 2 }
  ];
  const airArrows = [];
  function initAirArrows() {
    const host = document.getElementById("airFlowArrows");
    if (!host) return;
    host.innerHTML = "";
    airArrows.length = 0;
    AIR_ZONES.forEach((z) => {
      const span = Math.abs(z.a1 - z.a0);
      z.dir = z.a1 > z.a0 ? 1 : -1;
      z.cols.forEach((x, ci) => {
        for (let i = 0; i < z.per; i++) {
          const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
          node.setAttribute("d", "M -5,-5 L 3,0 L -5,5");
          node.setAttribute("class", "air-arrow");
          node.setAttribute("stroke", z.color);
          host.appendChild(node);
          airArrows.push({ el: node, zone: z, x: x, off: ((i + (ci % 2) * 0.5) / z.per) * span });
        }
      });
    });
  }
  function stepAirArrows(dt, flowing) {
    const s = activeState || (window.Sim ? window.Sim.state : null);
    airArrows.forEach((a) => {
      const z = a.zone;
      const pct = s && typeof s[z.key] === "number" ? Math.max(0, Math.min(100, s[z.key])) : 0;
      if (!flowing || pct < 1) { a.el.style.opacity = "0"; return; }
      const span = Math.abs(z.a1 - z.a0);
      a.off = (a.off + (22 + pct * 1.6) * dt) % span;
      const t = a.off / span;
      const fade = Math.min(1, t / 0.12, (1 - t) / 0.12);
      const y = z.a0 + z.dir * a.off;
      a.el.setAttribute("transform", "translate(" + a.x + "," + y.toFixed(1) + ") rotate(" + (z.dir > 0 ? 90 : -90) + ")");
      a.el.style.opacity = (fade * (0.35 + 0.6 * pct / 100)).toFixed(2);
    });
  }

  const DOT_COUNT = 30;
  const dots = [];

  function initFlowDots() {
    initAirArrows();
    precalculateCircuit();
    if (!el.refrigerantFlow) return;
    el.refrigerantFlow.innerHTML = "";
    dots.length = 0;

    const spacing = circuitLength / DOT_COUNT;
    for (let i = 0; i < DOT_COUNT; i++) {
      const initialDist = i * spacing;
      const arrow = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      arrow.setAttribute("points", "-7,-6 6,0 -7,6 -3,0");
      arrow.setAttribute("class", "flow-arrow-dot");
      el.refrigerantFlow.appendChild(arrow);
      dots.push({ el: arrow, distance: initialDist });
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
    const speedFactor = typeof s.compressorSpeed === "number" ? s.compressorSpeed / 50 : 1;
    return BASE_SPEED * speedFactor * (s.running ? 1 : 0);
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
      dot.el.setAttribute("transform", "translate(" + loc.point[0].toFixed(1) + "," + loc.point[1].toFixed(1) + ") rotate(" + loc.angle.toFixed(0) + ")");
      dot.el.setAttribute("fill", loc.color);
    });

    stepAirArrows(dt, currentFlowSpeed > 1);
    requestAnimationFrame(animateFlow);
  }

  const AIR_DOT_COUNT = 36;
  const AIR_FLOW_LANES = [-36, -24, -12, 0, 12, 24, 36];
  const AIR_DASH_LENGTH = 46;
  const SUPPLY_DAMPER_START_T = 0.80 + ((992 - 966) / (1062 - 966)) * 0.09;
  const VAV_DAMPER_T = 0.056;
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
    // The damper only limits what passes THROUGH it; upstream air keeps moving.
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
      const passesVav = vavRatio >= 1 || (index * 0.618) % 1 < vavRatio;
      if (!passesVav && dot.t >= VAV_DAMPER_T) dot.t = 0;
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
      let recycleFade = Math.min(1, dot.t / 0.018, (1 - dot.t) / 0.018);
      // Blocked particles fade out as they reach the closed/partly closed damper.
      if (!passesDamper) recycleFade = Math.min(recycleFade, Math.max(0, (SUPPLY_DAMPER_START_T - dot.t) / 0.03));
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
