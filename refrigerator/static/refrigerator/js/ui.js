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
      "pvCompSucTemp", "pvCompDisTemp",
      "pvCondInTemp", "pvCondOutTemp",
      "pvExpInTemp", "pvExpOutTemp",
      "pvEvapInTemp", "pvEvapOutTemp",
      "pvWaterEvapIn", "pvWaterEvapOut",
      "pvWaterEvap",
      "pvField5", "ahuField5",
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
    groupEl.classList.toggle("is-closed", open <= 0);
    // Supply damper: 3 blades rotate together, 90deg (closed) -> 0deg (open).
    groupEl.querySelectorAll(".ahu-supply-blade").forEach((blade) => {
      blade.style.transform = "rotate(" + (90 * (1 - open)).toFixed(2) + "deg)";
    });
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
    const returnRh = s.dhtHumidity !== undefined ? Number(s.dhtHumidity) : RETURN_RH;
    const mixRh = OA_FRACTION * OUTDOOR_RH + (1 - OA_FRACTION) * returnRh;
    const coolDrop = mixT - coolOut, heatRise = heatOut - coolOut;
    const supplyRh = s.dhtHumidity !== undefined ? Math.round(Number(s.dhtHumidity)) : Math.max(20, mixRh - 0.35 * coolDrop - 0.4 * Math.max(0, heatRise));
    const dp = 85 * Math.pow(upstream / 1800, 2);
    const sdp = 90 * Math.pow(upstream / 1800, 2);
    const valve = Math.round(s.valveOpening || 60), hv = Math.round(s.heatingValveCommand !== undefined ? s.heatingValveCommand : 40);
    const damper = Math.round(s.damperPosition), vav = Math.round(s.vavPosition);
    const t1 = (v) => (v !== null && v !== undefined && !isNaN(v)) ? Number(v).toFixed(1) + " °C" : "-- °C";

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
    setRd("rdRaTemp", t1(s.returnAirTemperature), warnReturn); setRd("rdRaRh", returnRh.toFixed(0) + " %"); setRd("rdRaFlow", raFlow + " CFM");
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

    // Malfunctioning equipment glows / pulses in the AHU diagram (like the refrigeration view)
    const ahuHealth = {
      ahuVavReturn: warnReturn, ahuPreFilter: warnFilter, ahuSupplyFilterStage: warnSFilter,
      ahuCoolingCoil: warnCoolOut, ahuHeatingCoil: warnHeatOut, ahuFanAssembly: warnVfd,
      ahuDamper: warnSupT || warnStatic, ahuCoolingValve: warnSimul, ahuHeatingValve: warnSimul
    };
    Object.keys(ahuHealth).forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.classList.toggle("ahu-health-alarm", !!ahuHealth[id]);
    });

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
    pv("pvSuctionP", L.sP); pv("pvDischargeP", L.dP);
    pv("pvCompSucTemp", sh); pv("pvCompDisTemp", L.dT);
    pv("pvCondInTemp", L.dT); pv("pvCondOutTemp", L.cT);
    pv("pvExpInTemp", L.cT); pv("pvExpOutTemp", capL); pv("pvEvapInTemp", capL); pv("pvEvapOutTemp", sh);
    pv("pvWaterEvapIn", evapL);
    pv("pvWaterEvapOut", evapL);
    pv("pvWaterEvap", evapL);

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
        const isLiveFeed = document.body && (document.body.dataset.pageMode === "live" || document.body.classList.contains("page-live"));
        const modePrefix = isLiveFeed ? "LIVE" : "SIMULATION";
        hdrModeVal.textContent = s.running ? (modePrefix + " (RUNNING)") : (modePrefix + " (STOPPED)");
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

    // ---- Live parameters (Values ALWAYS show real sensor data or N/C when unplugged) ----
    if (el.pvSuctionP) el.pvSuctionP.textContent = s.suctionPressure !== null && s.suctionPressure !== undefined ? s.suctionPressure.toFixed(1) + " bar" : "-- bar";
    if (el.pvDischargeP) el.pvDischargeP.textContent = s.dischargePressure !== null && s.dischargePressure !== undefined ? s.dischargePressure.toFixed(1) + " bar" : "-- bar";

    // Compressor Temperatures
    if (el.pvCompSucTemp) {
      if (s.field5 !== null && s.field5 !== undefined) {
        el.pvCompSucTemp.textContent = s.evaporatorOutletTemp !== null && s.evaporatorOutletTemp !== undefined ? s.evaporatorOutletTemp.toFixed(1) + " °C" : "-- °C";
      } else if (s.evaporatorOutletTemp !== null && s.evaporatorOutletTemp !== undefined) {
        el.pvCompSucTemp.textContent = s.evaporatorOutletTemp.toFixed(1) + " °C";
      } else {
        el.pvCompSucTemp.textContent = "-- °C";
      }
    }
    if (el.pvCompDisTemp) {
      if (s.dischargeTemp !== null && s.dischargeTemp !== undefined) {
        el.pvCompDisTemp.textContent = s.dischargeTemp.toFixed(1) + " °C";
        el.pvCompDisTemp.style.color = "";
      } else {
        el.pvCompDisTemp.textContent = "-- °C (N/C)";
        el.pvCompDisTemp.style.color = "#ef4444";
      }
    }

    // Condenser
    if (el.pvCondInTemp) el.pvCondInTemp.textContent = s.dischargeTemp !== null && s.dischargeTemp !== undefined ? s.dischargeTemp.toFixed(1) + " °C" : "-- °C (N/C)";
    if (el.pvCondOutTemp) el.pvCondOutTemp.textContent = s.condenserOutletTemp !== null && s.condenserOutletTemp !== undefined ? s.condenserOutletTemp.toFixed(1) + " °C" : "-- °C (N/C)";

    // Expansion Valve (Capillary Tube)
    if (el.pvExpInTemp) el.pvExpInTemp.textContent = s.condenserOutletTemp !== null && s.condenserOutletTemp !== undefined ? s.condenserOutletTemp.toFixed(1) + " °C" : "-- °C (N/C)";
    if (el.pvExpOutTemp) el.pvExpOutTemp.textContent = s.evaporatorInletTemp !== null && s.evaporatorInletTemp !== undefined ? s.evaporatorInletTemp.toFixed(1) + " °C" : "-- °C (N/C)";

    // Evaporator
    if (el.pvEvapInTemp) el.pvEvapInTemp.textContent = s.evaporatorInletTemp !== null && s.evaporatorInletTemp !== undefined ? s.evaporatorInletTemp.toFixed(1) + " °C" : "-- °C (N/C)";
    if (el.pvEvapOutTemp) el.pvEvapOutTemp.textContent = s.evaporatorOutletTemp !== null && s.evaporatorOutletTemp !== undefined ? s.evaporatorOutletTemp.toFixed(1) + " °C" : "-- °C (N/C)";
    if (el.pvWaterEvapIn) {
      const inVal = s.waterEvaporatorIn !== null && s.waterEvaporatorIn !== undefined ? s.waterEvaporatorIn : (s.running ? 12.0 : 24.0);
      el.pvWaterEvapIn.textContent = inVal.toFixed(1) + " °C";
    }
    if (el.pvWaterEvapOut) {
      const outVal = s.waterEvaporatorOut !== null && s.waterEvaporatorOut !== undefined ? s.waterEvaporatorOut : (s.waterEvaporator || (s.running ? 7.0 : 24.0));
      el.pvWaterEvapOut.textContent = outVal.toFixed(1) + " °C";
    }
    if (el.pvWaterEvap) {
      const val = s.waterEvaporatorIn !== null && s.waterEvaporatorIn !== undefined ? s.waterEvaporatorIn : (s.running ? 12.0 : 24.0);
      el.pvWaterEvap.textContent = val.toFixed(1) + " °C";
    }

    // Field 5 / Auxiliary Sensor
    if (el.pvField5) el.pvField5.textContent = s.field5 !== null && s.field5 !== undefined ? s.field5 : "--";
    if (el.ahuField5) el.ahuField5.textContent = s.field5 !== null && s.field5 !== undefined ? s.field5 : "--";

    // ---- AHU / BMS process and actuator layer ----
    const valve = Math.round(s.valveOpening || 60);
    const heatingValve = Math.round(s.heatingValveCommand !== undefined ? s.heatingValveCommand : 40);
    const damper = Math.round(s.damperPosition);
    const vav = Math.round(s.vavPosition);
    const valveState = valve <= 2 ? "CLOSED" : (valve >= 98 ? "OPEN" : "MODULATING");
    const ahuRunning = s.fanOn && s.vfdFrequency > 0;
    const fanStatus = s.fanOn ? "ON" : "OFF";

    if (el.ahuReturnTemp) {
      if (s.returnAirTemperature !== null && s.returnAirTemperature !== undefined) {
        el.ahuReturnTemp.textContent = s.returnAirTemperature.toFixed(1) + " °C";
        el.ahuReturnTemp.style.color = "";
      } else {
        el.ahuReturnTemp.textContent = "-- °C (N/C)";
        el.ahuReturnTemp.style.color = "#ef4444";
      }
    }
    if (el.ahuValveCmd) el.ahuValveCmd.textContent = valve + " %";
    if (el.ahuValveCmd2) el.ahuValveCmd2.textContent = valve + " %";
    if (el.ahuValveStatus) el.ahuValveStatus.textContent = valveState;
    if (el.ahuCfm) el.ahuCfm.textContent = Math.round(s.airflowCfm || 0) + " CFM";
    if (el.ahuSupplyTemp) {
      if (s.supplyAirTemperature !== null && s.supplyAirTemperature !== undefined) {
        el.ahuSupplyTemp.textContent = s.supplyAirTemperature.toFixed(1) + " °C";
        el.ahuSupplyTemp.style.color = "";
      } else {
        el.ahuSupplyTemp.textContent = "-- °C (N/C)";
        el.ahuSupplyTemp.style.color = "#ef4444";
      }
    }
    if (el.ahuSupplyTemp2) {
      if (s.supplyAirTemperature !== null && s.supplyAirTemperature !== undefined) {
        el.ahuSupplyTemp2.textContent = s.supplyAirTemperature.toFixed(1) + " °C";
      } else {
        el.ahuSupplyTemp2.textContent = "-- °C (N/C)";
      }
    }
    if (el.ahuStaticPressure) el.ahuStaticPressure.textContent = s.supplyStaticPressure !== null && s.supplyStaticPressure !== undefined ? Math.round(s.supplyStaticPressure) + " Pa" : "-- Pa";
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
      el.ahuHotFlow.style.opacity = String(heatingValve > 2 ? Math.min(1, 0.35 + (heatingValve / 100) * 0.65) : 0);
      el.ahuHotFlow.style.animationDuration = Math.max(0.22, 1.15 - (heatingValve / 100) * 0.85).toFixed(2) + "s";
    }
    if (el.ahuCoolingValve) el.ahuCoolingValve.classList.toggle("active", valve > 2);
    if (el.ahuWaterFlow) {
      el.ahuWaterFlow.style.opacity = String(valve > 2 ? Math.min(1, 0.35 + (valve / 100) * 0.65) : 0);
      el.ahuWaterFlow.style.animationDuration = Math.max(0.22, 1.15 - (valve / 100) * 0.85).toFixed(2) + "s";
    }
    const coolingLevel = Math.max(0, Math.min(100, valve)) / 100;
    if (el.ahuCoolingCoil) {
      el.ahuCoolingCoil.classList.toggle("active", coolingLevel > 0);
      el.ahuCoolingCoil.style.filter = coolingLevel > 0
        ? "drop-shadow(0 0 " + (8 * coolingLevel).toFixed(1) + "px rgba(0, 210, 255, " + (0.65 * coolingLevel).toFixed(2) + "))"
        : "none";
    }
    const coolingTube = el.ahuCoolingCoil && el.ahuCoolingCoil.querySelector(".ahu-coil-tube");
    if (coolingTube) {
      const neutralColor = [101, 115, 123];
      const activeColor = [0, 215, 255];
      const color = neutralColor.map((start, index) => Math.round(start + (activeColor[index] - start) * coolingLevel));
      coolingTube.style.stroke = "rgb(" + color.join(", ") + ")";
    }
    if (el.ahuCoolingCoil) {
      const finPaths = el.ahuCoolingCoil.querySelectorAll(".ahu-coil-fins path");
      const finColors = [
        [[125, 137, 144], [0, 195, 245]],
        [[170, 180, 186], [120, 230, 255]]
      ];
      finPaths.forEach((path, index) => {
        const colors = finColors[Math.min(index, finColors.length - 1)];
        const color = colors[0].map((start, channel) => Math.round(start + (colors[1][channel] - start) * coolingLevel));
        path.style.stroke = "rgb(" + color.join(", ") + ")";
      });
    }
    if (el.ahuCoilGlow) el.ahuCoilGlow.style.opacity = String((0.72 * coolingLevel).toFixed(2));
    const heatingLevel = Math.max(0, Math.min(100, heatingValve)) / 100;
    const heatingElement = el.ahuHeatingCoil && el.ahuHeatingCoil.querySelector(".ahu-heating-tube");
    if (el.ahuHeatingCoil) {
      el.ahuHeatingCoil.classList.toggle("active", heatingLevel > 0);
      el.ahuHeatingCoil.style.filter = heatingLevel > 0
        ? "drop-shadow(0 0 " + (10 * heatingLevel).toFixed(1) + "px rgba(255, 60, 20, " + (0.75 * heatingLevel).toFixed(2) + "))"
        : "none";
    }
    if (heatingElement) {
      const neutralColor = [90, 100, 110];
      const hotColor = [255, 50, 15];
      const color = neutralColor.map((start, index) => Math.round(start + (hotColor[index] - start) * heatingLevel));
      heatingElement.style.stroke = "rgb(" + color.join(", ") + ")";
    }
    if (el.ahuHeatingCoilGlow) el.ahuHeatingCoilGlow.style.opacity = String((0.65 * heatingLevel).toFixed(2));
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
    const fmtBar = (v) => (v !== null && v !== undefined && !isNaN(v)) ? Number(v).toFixed(1) + " bar" : "-- bar";
    const fmtC = (v) => (v !== null && v !== undefined && !isNaN(v)) ? Number(v).toFixed(1) + "°C" : "--°C";
    if (el.svgDischargePressure) el.svgDischargePressure.textContent = fmtBar(s.dischargePressure);
    if (el.svgDischargeTemp) el.svgDischargeTemp.textContent = fmtC(s.dischargeTemp);
    if (el.svgSuctionPressure) el.svgSuctionPressure.textContent = fmtBar(s.suctionPressure);
    if (el.svgCondenserOutletTemp) el.svgCondenserOutletTemp.textContent = fmtC(s.condenserOutletTemp);
    if (el.svgEvaporatorInletTemp) el.svgEvaporatorInletTemp.textContent = fmtC(s.evaporatorInletTemp);
    if (el.svgEvaporatorOutletTemp) el.svgEvaporatorOutletTemp.textContent = fmtC(s.evaporatorOutletTemp);
    if (el.svgCondenserInletTemp) el.svgCondenserInletTemp.textContent = fmtC(s.dischargeTemp);
    if (el.svgCapInletTemp) el.svgCapInletTemp.textContent = fmtC(s.condenserOutletTemp);
    if (el.svgEvapCoilInTemp) el.svgEvapCoilInTemp.textContent = fmtC(s.evaporatorInletTemp);
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
    totalLengths.length = 0;
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
    { id: "condenser", a0: 268, a1: 74, cols: [356, 472, 588], color: "#f0883e", key: "condenserFanSpeed", per: 1 },
    { id: "evaporator", a0: 458, a1: 598, cols: [290, 382, 474, 566], color: "#2fb6ee", key: "evaporatorFanSpeed", per: 1 }
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
      a.el.style.opacity = (fade * (0.25 + 0.45 * pct / 100)).toFixed(2);
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
  // Exactly 4 airflow rows (lanes), evenly spaced across the AHU duct interior (y=86 to y=268).
  // Lane centers at y=178 + offset: y=133, y=163, y=193, y=223.
  const AIR_FLOW_LANES = [-45, -15, 15, 45];
  // 4 lines per row across the 878px duct: 878 / 4 ≈ 220px period
  const AIR_DASH_LENGTH = 220;
  const SUPPLY_DAMPER_START_T = 0.80 + ((1038.5 - 966) / (1062 - 966)) * 0.09;
  const VAV_DAMPER_T = 0.056;
  const SUPPLY_DAMPER_STOP_X = 1038.5;
  // Module-level CFM setpoint (0–500), controlled by the inline CFM slider.
  // This scales visualization flow intensity from light to brighter across all 4 rows.
  let cfmSetpoint = 250;
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
      // Dash: 32px on, 188px off — exactly 4 lines (dashes) per row across duct
      path.setAttribute("stroke-dasharray", "32 188");
      path.setAttribute("stroke-dashoffset", String(-phase));
      el.ahuAirflowDots.appendChild(path);
      airStreamPaths.push({ el: path, phase: phase, laneIndex: laneIndex });
    }

    // Inlet branch paths (no laneIndex → always visible when any air flows)
    addStreamPath("M35 112 H137 C151 112 153 125 153 145 C153 164 145 168 145 178 H257", "air-stream-line air-stream-branch", 0);
    addStreamPath("M35 285 H137 C151 285 153 270 153 251 C153 232 145 221 145 178 H257", "air-stream-line air-stream-branch", 55);
    // Exactly 4 distinct row stream paths across the AHU duct with staggered phase
    AIR_FLOW_LANES.forEach((lane, index) => {
      // Staggered phase offset (0, 55, 110, 165) for natural airflow across rows
      addStreamPath("M257 " + (178 + lane) + " H1135", "air-stream-line", (index * 55) % AIR_DASH_LENGTH, index);
    });

    // 50 dots total: 5 per lane (lane 0..9), evenly offset within each lane
    const DOTS_PER_LANE = 5;
    const TOTAL_DOTS = 0;
    for (let i = 0; i < TOTAL_DOTS; i++) {
      const laneIdx = i % AIR_FLOW_LANES.length;       // lane 0..9
      const dotInLane = Math.floor(i / AIR_FLOW_LANES.length); // 0..4
      const streak = document.createElementNS("http://www.w3.org/2000/svg", "line");
      streak.setAttribute("class", "air-streak");
      streak.setAttribute("stroke-linecap", "round");
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("r", (2.2 + (i % 3) * 0.5).toFixed(2));
      c.setAttribute("class", "air-dot");
      const arrow = (i % 10 === 0) ? document.createElementNS("http://www.w3.org/2000/svg", "path") : null;
      if (arrow) arrow.setAttribute("class", "air-direction-arrow");
      el.ahuAirflowDots.appendChild(streak);
      el.ahuAirflowDots.appendChild(c);
      if (arrow) el.ahuAirflowDots.appendChild(arrow);
      airDots.push({
        el: c,
        streak: streak,
        arrow: arrow,
        // Stagger t within each lane so dots are evenly distributed along the path
        t: (laneIdx / AIR_FLOW_LANES.length) + (dotInLane / TOTAL_DOTS),
        branch: laneIdx % 2 === 0 ? "outdoor" : "return",
        lane: AIR_FLOW_LANES[laneIdx],
        laneIndex: laneIdx,
        opacity: 0.70 + (i % 4) * 0.07,
        trailLength: 0.028 + (i % 4) * 0.006
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
    const heating = s ? Math.max(0, Math.min(1, Math.max((s.heatingValveCommand ?? 0) / 100, (s.setTemperature - cooledAirTemp) / 8))) : 0;
    const cfmRatio = Math.min(1, upstreamCfm / 1500);

    // CFM setpoint intensity factor: 0.0 (light) to 1.0 (brighter).
    // All 10 lanes always look like 100% flow; adjusting CFM smoothly scales the visual intensity.
    const clampedCfm = Math.max(0, Math.min(500, cfmSetpoint));
    const cfmFactor = clampedCfm / 500;

    const effectiveSpeed = active ? speed * (0.80 + 0.40 * cfmFactor) : 0;
    if (active) airStreamOffset = (airStreamOffset + effectiveSpeed * 550 * dt) % AIR_DASH_LENGTH;

    // Intensity scaling from light to brighter:
    // Opacity: light ~0.30 up to brighter ~0.98
    const streamOpacity = active ? String((0.30 + 0.68 * cfmFactor).toFixed(2)) : "0";
    const branchOpacity = active ? String((0.26 + 0.68 * cfmFactor).toFixed(2)) : "0";

    // Stroke width: light 3.2px up to brighter 5.6px
    const streamStrokeWidth = (3.2 + 2.4 * cfmFactor).toFixed(2);
    const branchStrokeWidth = (2.4 + 2.0 * cfmFactor).toFixed(2);

    // Dynamic glow and brightness filter: from soft light glow to radiant bright neon
    const glowWhite = (0.35 + 0.60 * cfmFactor).toFixed(2);
    const glowCyan1 = (0.25 + 0.65 * cfmFactor).toFixed(2);
    const glowCyan2 = (0.10 + 0.50 * cfmFactor).toFixed(2);
    const blur1 = (2 + 3 * cfmFactor).toFixed(1);
    const blur2 = (4 + 6 * cfmFactor).toFixed(1);
    const blur3 = (8 + 8 * cfmFactor).toFixed(1);
    const brightnessVal = (0.90 + 0.40 * cfmFactor).toFixed(2);
    const glowColor = heating > 0.2 ? `rgba(255,160,50,${glowCyan1})` : `rgba(0,210,255,${glowCyan1})`;
    const streamFilter = active
      ? `drop-shadow(0 0 ${blur1}px rgba(255,255,255,${glowWhite})) drop-shadow(0 0 ${blur2}px ${glowColor}) drop-shadow(0 0 ${blur3}px rgba(0,210,255,${glowCyan2})) brightness(${brightnessVal})`
      : "none";
    const branchFilter = active
      ? `drop-shadow(0 0 ${blur1}px rgba(255,255,255,${glowWhite})) drop-shadow(0 0 ${blur2}px #91c9d7) brightness(${brightnessVal})`
      : "none";

    // All stream paths (both branches and all 4 rows) are 100% active when airflow is running
    airStreamPaths.forEach((stream) => {
      let offsetSpeed = 1;
      if (stream.laneIndex !== undefined) {
        // All 4 rows are active — no partial release!
        const lane = AIR_FLOW_LANES[stream.laneIndex];
        const passesDamper = stream.laneIndex < Math.ceil(AIR_FLOW_LANES.length * damperRatio);
        const endX = passesDamper ? 1135 : SUPPLY_DAMPER_STOP_X;
        const pathData = "M257 " + (178 + lane) + " H" + endX;
        if (stream.el.getAttribute("d") !== pathData) stream.el.setAttribute("d", pathData);
        if (passesDamper) offsetSpeed = damperRatio;
        stream.el.style.opacity = streamOpacity;
        stream.el.style.strokeWidth = streamStrokeWidth + "px";
        stream.el.style.filter = streamFilter;
      } else {
        // Branch inlet paths — fully visible with matching intensity
        stream.el.style.opacity = branchOpacity;
        stream.el.style.strokeWidth = branchStrokeWidth + "px";
        stream.el.style.filter = branchFilter;
      }
      stream.el.style.strokeDashoffset = String(-((airStreamOffset * offsetSpeed + stream.phase) % AIR_DASH_LENGTH));
    });

    airGradientStops.forEach((stop, index) => {
      stop.setAttribute("stop-color", airColor(AIR_GRADIENT_POSITIONS[index], cooling, heating));
      stop.setAttribute("stop-opacity", String((0.55 + 0.45 * cfmFactor).toFixed(2)));
    });

    airDots.forEach((dot, index) => {
      const showDot = active;

      // A small local acceleration around the fan gives the stream a clear
      // fan relationship while preserving its left-to-right route.
      const fanBoost = dot.t >= 0.52 && dot.t < 0.72 ? 1.38 : 1;
      const passesDamper = damperRatio >= 1 || dot.laneIndex < Math.ceil(AIR_FLOW_LANES.length * damperRatio);
      const passesVav = vavRatio >= 1 || (index * 0.618) % 1 < vavRatio;
      if (!passesVav && dot.t >= VAV_DAMPER_T) dot.t = 0;
      if (passesDamper) {
        const damperSpeed = dot.t >= SUPPLY_DAMPER_START_T ? damperRatio : 1;
        dot.t = (dot.t + effectiveSpeed * fanBoost * damperSpeed * dt) % 1;
      } else if (dot.t >= SUPPLY_DAMPER_START_T) {
        dot.t = dot.t <= SUPPLY_DAMPER_START_T + 0.0001 ? 0 : SUPPLY_DAMPER_START_T;
      } else {
        dot.t += effectiveSpeed * fanBoost * dt;
        if (dot.t >= SUPPLY_DAMPER_START_T) dot.t = SUPPLY_DAMPER_START_T;
      }
      const point = airPath(dot.t, dot.branch, dot.lane);
      const tailT = Math.max(0, dot.t - dot.trailLength);
      const tail = airPath(tailT, dot.branch, dot.lane);
      const color = airColor(dot.t, cooling, heating, index);
      dot.el.setAttribute("cx", point[0].toFixed(1));
      dot.el.setAttribute("cy", point[1].toFixed(1));
      dot.el.setAttribute("fill", color);
      dot.streak.setAttribute("x1", tail[0].toFixed(1));
      dot.streak.setAttribute("y1", tail[1].toFixed(1));
      dot.streak.setAttribute("x2", point[0].toFixed(1));
      dot.streak.setAttribute("y2", point[1].toFixed(1));
      dot.streak.setAttribute("stroke", color);
      dot.streak.setAttribute("stroke-width", dot.t < 0.18 ? "3.2" : "4.0");
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
        dot.arrow.style.opacity = showDot ? String(Math.min(0.8, 0.5 + (s.airflowCfm || 0) / 5000) * recycleFade) : "0";
      }
      const flowOpacity = (0.35 + 0.65 * cfmFactor) * (0.62 + cfmRatio * 0.35) * dot.opacity;
      dot.el.style.opacity = showDot ? String(flowOpacity * recycleFade) : "0";
      dot.streak.style.opacity = showDot ? String((0.35 + 0.65 * cfmFactor) * (0.68 + cfmRatio * 0.30) * dot.opacity * recycleFade) : "0";
    });
    requestAnimationFrame(animateAirflow);
  }


  function airColor(t, cooling, heating, index) {
    // Stage ranges mirror airPath: neutral mixed air -> cooling coil ->
    // chilled air -> heating coil -> conditioned supply air.
    const neutral = [148, 184, 198];
    const icyCyan = [0, 215, 255];
    const deepColdBlue = [0, 165, 245];
    const icyWhite = [228, 250, 255];
    const hotFiery = [255, 52, 12];
    const hotOrange = [255, 95, 18];
    const hotAmber = [255, 165, 25];
    const hotYellow = [255, 222, 65];

    let from = neutral, to = neutral, amount = 0;

    if (t < 0.26) {
      from = neutral;
      to = neutral;
      amount = 0;
    } else if (t >= 0.26 && t < 0.31) {
      // Entering cooling coil: smoothly shifts from neutral to vivid icy cyan
      from = neutral;
      to = cooling > 0.04 ? icyCyan : neutral;
      amount = ((t - 0.26) / 0.05) * cooling * 0.75;
    } else if (t >= 0.31 && t < 0.414) {
      // Passing through cooling coil: deep freezing electric icy blue with icy-white highlights
      from = cooling > 0.04 ? icyCyan : neutral;
      to = cooling > 0.04 ? deepColdBlue : neutral;
      amount = ((t - 0.31) / 0.104) * cooling;
      if (cooling > 0.12 && index !== undefined) {
        if (index % 4 === 0) return "rgb(" + icyWhite.join(",") + ")";
        if (index % 4 === 2) return "rgb(" + icyCyan.join(",") + ")";
      }
    } else if (t >= 0.414 && t < 0.43) {
      // Between coils: chilled cold air
      from = cooling > 0.04 ? deepColdBlue : neutral;
      to = from;
      amount = 1;
      if (cooling > 0.12 && index !== undefined && index % 4 === 0) {
        return "rgb(" + icyWhite.join(",") + ")";
      }
    } else if (t >= 0.43 && t < 0.534) {
      // Entering and passing through heating coil: radiant amber to fiery red-orange
      const incoming = cooling > 0.04 ? deepColdBlue : neutral;
      from = heating > 0.04 ? hotAmber : incoming;
      to = heating > 0.04 ? hotFiery : (cooling > 0.04 ? icyCyan : neutral);
      amount = ((t - 0.43) / 0.104) * (heating > 0.04 ? heating : cooling);
      if (heating > 0.12 && index !== undefined) {
        if (index % 4 === 0) return "rgb(" + hotYellow.join(",") + ")";
        if (index % 4 === 2) return "rgb(" + hotAmber.join(",") + ")";
      } else if (heating <= 0.04 && cooling > 0.12 && index !== undefined && index % 4 === 0) {
        return "rgb(" + icyWhite.join(",") + ")";
      }
    } else if (t >= 0.534) {
      // Conditioned supply air downstream
      if (heating > 0.04) {
        from = hotFiery;
        to = hotOrange;
        amount = Math.min(1, heating * 1.2);
        if (heating > 0.12 && index !== undefined && index % 4 === 0) {
          return "rgb(" + hotYellow.join(",") + ")";
        }
      } else if (cooling > 0.04) {
        from = deepColdBlue;
        to = icyCyan;
        amount = Math.min(1, cooling * 1.1);
        if (cooling > 0.12 && index !== undefined && index % 4 === 0) {
          return "rgb(" + icyWhite.join(",") + ")";
        }
      } else {
        from = neutral;
        to = neutral;
        amount = 0;
      }
    }

    return "rgb(" + from.map((value, idx) => Math.round(value + (to[idx] - value) * Math.max(0, Math.min(1, amount)))).join(",") + ")";
  }

  function updateClock() {
    if (activeState && activeState.isHistorical) return; // don't override historical replay time
    const now = new Date();
    if (el.hdrDate) el.hdrDate.textContent = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    if (el.hdrTime) el.hdrTime.textContent = now.toLocaleTimeString("en-GB", { hour12: false });
  }

  /**
   * Set the supply-air CFM setpoint (0–500).
   * Updates the module-level cfmSetpoint used by animateAirflow for flow intensity scaling (light to brighter),
   * and refreshes the inline CFM readout elements and the SVG rd_damper card readouts.
   */
  function setCfmSetpoint(value) {
    const clamped = Math.max(0, Math.min(500, Math.round(Number(value) || 0) / 10) * 10);
    cfmSetpoint = clamped;
    const pct = Math.round((clamped / 500) * 100);

    // Inline readouts inside the foreignObject controller
    const inlineCfmReadout = document.getElementById("inlineCfmReadout");
    if (inlineCfmReadout) inlineCfmReadout.textContent = clamped + " CFM";
    const inlineCfmPct = document.getElementById("inlineCfmPct");
    if (inlineCfmPct) inlineCfmPct.textContent = pct + "%";

    // SVG rd_damper card readouts (beside the supply damper in the visualization)
    const rdSetpoint = document.getElementById("rdCfmSetpoint");
    if (rdSetpoint) rdSetpoint.textContent = clamped + " CFM";
    const rdPct = document.getElementById("rdCfmPct");
    if (rdPct) rdPct.textContent = pct + "%";
  }

  window.UI = {
    cache: cache,
    renderAll: renderAll,
    initFlowDots: initFlowDots,
    initAirflowDots: initAirflowDots,
    animateFlow: animateFlow,
    animateAirflow: animateAirflow,
    updateClock: updateClock,
    getActiveState: () => activeState,
    setCfmSetpoint: setCfmSetpoint,
    getCfmSetpoint: () => cfmSetpoint
  };
})();

