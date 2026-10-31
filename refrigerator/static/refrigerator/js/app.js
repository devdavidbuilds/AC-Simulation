/* ============================================================
   app.js — initialization, mode switching, and event wiring.
   ============================================================ */

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", async function () {
    // 1. Initialize UI & Clock
    UI.cache();
    UI.initFlowDots();
    UI.initAirflowDots();
    UI.updateClock();
    setInterval(UI.updateClock, 1000);

    // 2. Wire Live Simulation to UI
    Sim.onTick(function (state, log) {
      if (Sim.isLiveModeActive()) {
        UI.renderAll(state, log);
      }
    });
    UI.renderAll(Sim.state, Sim.getLog());

    // 3. Start Animation and Live Physics Loop
    requestAnimationFrame(UI.animateFlow);
    requestAnimationFrame(UI.animateAirflow);
    Sim.init();

    // ------------------------------------------------------------
    // Elements & Mode Tabs
    // ------------------------------------------------------------
    const tabLiveMode = document.getElementById("tabLiveMode");
    const tabHistMode = document.getElementById("tabHistMode");
    const liveControlsSection = document.getElementById("liveControlsSection");
    const histControlsSection = document.getElementById("histControlsSection");

    const btnStart = document.getElementById("btnStart");
    const btnStop = document.getElementById("btnStop");
    const btnSaveSnapshot = document.getElementById("btnSaveSnapshot");

    // AHU controls near equipment share the existing simulator state.
    const inlineActuatorInputs = {
      valveOpening: document.getElementById("inlineValveSlider"),
      heatingValveCommand: document.getElementById("inlineHeatingValveSlider"),
      damperPosition: document.getElementById("inlineDamperSlider"),
      vavPosition: document.getElementById("inlineVavSlider"),
      vfdFrequency: document.getElementById("inlineVfdSlider"),
      setTemperature: document.getElementById("inlineSetTempSlider")
    };
    const inlineFanToggle = document.getElementById("inlineFanToggle");

    Object.keys(inlineActuatorInputs).forEach(function (name) {
      const input = inlineActuatorInputs[name];
      if (!input) return;
      input.addEventListener("input", function () {
        Sim.setActuator(name, this.value);
      });
    });
    if (inlineFanToggle) {
      inlineFanToggle.checked = Boolean(Sim.state.fanOn);
      inlineFanToggle.addEventListener("change", function () {
        Sim.setFan(this.checked);
        if (this.checked) {
          Sim.start();
        } else {
          Sim.stop();
        }
      });
    }

    // ---- Supply Air CFM Controller ----
    // The CFM slider controls the airflow visualization intensity (from light to brighter)
    // across all 4 rows (100% full stream flow) independently of the physical simulation's own airflowCfm.
    const inlineCfmSlider = document.getElementById("inlineCfmSlider");
    if (inlineCfmSlider) {
      // Set initial readout display
      UI.setCfmSetpoint(inlineCfmSlider.value !== "" ? Number(inlineCfmSlider.value) : 250);
      inlineCfmSlider.addEventListener("input", function () {
        const raw = Number(this.value);
        // Clamp and snap to step=10 (browser handles step, but clamp for safety)
        const clamped = Math.max(0, Math.min(500, isNaN(raw) ? 0 : raw));
        UI.setCfmSetpoint(clamped);
      });
    }

    const histStartTime = document.getElementById("histStartTime");
    const histDuration = document.getElementById("histDuration");
    const histEndTimeWrap = document.getElementById("histEndTimeWrap");
    const histEndTime = document.getElementById("histEndTime");
    const btnFetchHistory = document.getElementById("btnFetchHistory");
    const btnQuick5m = document.getElementById("btnQuick5m");
    const btnQuick15m = document.getElementById("btnQuick15m");
    const btnQuickAll = document.getElementById("btnQuickAll");

    const histScrubber = document.getElementById("histScrubber");
    const histCurrentTime = document.getElementById("histCurrentTime");
    const histStatusMsg = document.getElementById("histStatusMsg");
    const btnHistPlay = document.getElementById("btnHistPlay");
    const btnHistPrev = document.getElementById("btnHistPrev");
    const btnHistNext = document.getElementById("btnHistNext");
    const btnHistStop = document.getElementById("btnHistStop");
    const histSpeedSelect = document.getElementById("histSpeedSelect");

    const chkHistLoop = document.getElementById("chkHistLoop");

    // ------------------------------------------------------------
    // Mode Switching Logic
    // ------------------------------------------------------------
    async function setSimulationMode(mode) {
      if (mode === "live") {
        tabLiveMode.className = "mode-tab active live";
        tabHistMode.className = "mode-tab";
        liveControlsSection.style.display = "block";
        histControlsSection.style.display = "none";

        HistoryPlayer.pause();
        const svgWrap = document.querySelector(".mimic-svg-wrap");
        if (svgWrap) svgWrap.classList.remove("playback-paused");

        Sim.setLiveModeActive(true);
        UI.renderAll(Sim.state, Sim.getLog());
        Sim.addLog("Switched to LIVE SIMULATION mode", "info");
      } else {
        tabLiveMode.className = "mode-tab";
        tabHistMode.className = "mode-tab active";
        liveControlsSection.style.display = "none";
        histControlsSection.style.display = "block";

        Sim.setLiveModeActive(false);
        HistoryPlayer.pause();

        const svgWrap = document.querySelector(".mimic-svg-wrap");
        if (svgWrap) svgWrap.classList.add("playback-paused");

        if (histStatusMsg) histStatusMsg.textContent = "Connecting to PostgreSQL and loading history...";

        await initHistoricalInputs();
        // Auto-load all available historical records so replay is ready immediately
        await triggerLoadHistory("all");
      }
    }

    // ------------------------------------------------------------
    // Live IoT (ThingSpeak & PostgreSQL) Polling Engine
    // ------------------------------------------------------------
    const THINGSPEAK_CHANNEL_ID = "3560538";
    const THINGSPEAK_READ_KEY = "04X2RNIITIQ0F0JC";
    const THINGSPEAK_DIRECT_URL = `https://api.thingspeak.com/channels/${THINGSPEAK_CHANNEL_ID}/feeds/last.json?api_key=${THINGSPEAK_READ_KEY}`;

    let livePollInterval = null;
    let isLiveIotPollingActive = false;
    const dbSaveStatus = document.getElementById("dbSaveStatus");
    const btnToggleIotFeed = document.getElementById("btnToggleIotFeed");

    function parseSensorVal(raw, minV, maxV) {
      if (raw === null || raw === undefined) return null;
      const s = String(raw).trim().toLowerCase();
      if (s === "" || s === "null" || s === "nan" || s === "none" || s === "-127" || s === "-127.0" || s === "ovf") {
        return null;
      }
      const n = parseFloat(s);
      if (isNaN(n)) return null;
      if (minV !== undefined && n < minV) return null;
      if (maxV !== undefined && n > maxV) return null;
      return n;
    }

    function mapThingSpeakFeedToPayload(feed) {
      if (!feed || feed === -1 || feed === "-1") {
        return {
          waiting: true,
          channelId: THINGSPEAK_CHANNEL_ID,
          telemetry: null,
          source: `ESP32-S3 (ThingSpeak #${THINGSPEAK_CHANNEL_ID})`
        };
      }

      // Channel 3560538 Exact Input Fields:
      // Field 1: COMP OUT/ COND IN   -> Compressor Discharge / Condenser Inlet Temp (°C)
      // Field 2: COMP IN / EVAP OUT  -> Compressor Suction / Evaporator Outlet Temp (°C)
      // Field 3: CT IN / COND OUT    -> Condenser Outlet / Expansion Valve Inlet Temp (°C)
      // Field 4: WATER EVAP          -> Water Evaporator Temp (°C)
      // Field 5: CT OUT / EVAP IN    -> Expansion Valve Outlet / Evaporator Inlet Temp (°C)
      // Field 6: DHT22 Humidity      -> Relative Humidity (%)
      const f1CompOutCondIn = parseSensorVal(feed.field1, -50, 1370);
      const f2CompInEvapOut = parseSensorVal(feed.field2, -50, 1370);
      const f3CtInCondOut = parseSensorVal(feed.field3, -50, 1370);
      const f4WaterEvap = parseSensorVal(feed.field4, -50, 1370);
      const f5CtOutEvapIn = parseSensorVal(feed.field5, -50, 1370);
      const f6Humidity = parseSensorVal(feed.field6, 0, 100);
      const entryId = feed.entry_id || 1;
      const createdAt = feed.created_at || new Date().toISOString();
      const dt = new Date(createdAt);

      const isConnected = (f1CompOutCondIn !== null || f2CompInEvapOut !== null || f3CtInCondOut !== null || f4WaterEvap !== null || f5CtOutEvapIn !== null || f6Humidity !== null);

      const tDischarge = f1CompOutCondIn !== null ? Math.round(f1CompOutCondIn * 10) / 10 : 32.5;
      const tCondOut = f3CtInCondOut !== null ? Math.round(f3CtInCondOut * 10) / 10 : 32.8;
      const tEvapIn = f5CtOutEvapIn !== null ? Math.round(f5CtOutEvapIn * 10) / 10 : 24.0;
      const tEvapOut = f2CompInEvapOut !== null ? Math.round(f2CompInEvapOut * 10) / 10 : 15.0;
      const tWaterOut = f4WaterEvap !== null ? Math.round(f4WaterEvap * 10) / 10 : 14.2;
      const tWaterIn = f4WaterEvap !== null ? Math.round((f4WaterEvap + 5.0) * 10) / 10 : 19.2;
      const rhVal = f6Humidity !== null ? Math.round(f6Humidity * 10) / 10 : 50.0;

      const pressBar = 10.5;
      const suctionP = 1.5;
      const ductStaticPa = isConnected ? 75 : 0;

      return {
        telemetry: {
          id: entryId,
          timestamp: createdAt,
          time_display: !isNaN(dt.getTime()) ? dt.toLocaleTimeString() : new Date().toLocaleTimeString(),
          date_display: !isNaN(dt.getTime()) ? dt.toLocaleDateString() : new Date().toLocaleDateString(),
          suction_pressure: suctionP,
          discharge_pressure: pressBar,
          discharge_temperature: isConnected ? tDischarge : null,
          condenser_outlet_temp: isConnected ? tCondOut : null,
          evaporator_inlet_temp: isConnected ? tEvapIn : null,
          evaporator_outlet_temp: isConnected ? tEvapOut : null,
          water_evaporator: isConnected ? tWaterOut : 14.2,
          water_evaporator_inlet: isConnected ? tWaterIn : 19.2,
          water_evaporator_outlet: isConnected ? tWaterOut : 14.2,
          compressor_status: isConnected ? "RUNNING" : "STANDBY",
          condenser_fan_status: isConnected ? "ACTIVE" : "IDLE",
          evaporator_fan_status: isConnected ? "ACTIVE" : "IDLE",
          system_status: isConnected ? "RUNNING" : "SENSOR_DISCONNECTED",
          fault_type: isConnected ? "None" : "Temperature Sensor Disconnected",
          valve_opening: 60.0,
          heating_valve_command: 40.0,
          damper_position: 70.0,
          fan_on: isConnected,
          vfd_frequency: isConnected ? 45.0 : 0.0,
          vav_position: 70.0,
          airflow_cfm: isConnected ? 850.0 : 0.0,
          supply_air_temperature: isConnected ? tEvapOut : null,
          return_air_temperature: 24.0,
          supply_static_pressure: ductStaticPa,
          set_temperature: 22.0,
          dht_humidity: rhVal,
          field5: tEvapIn,
          environment_temperature: 24.0,
          environment_temp: 24.0,
          sensor_connected: isConnected,
          thingspeak_entry_id: entryId,
          hardware_source: `ESP32-S3 (ThingSpeak #${THINGSPEAK_CHANNEL_ID})`
        },
        entryId: entryId,
        source: `ThingSpeak IoT (ESP32-S3 #${THINGSPEAK_CHANNEL_ID})`,
        createdAt: createdAt
      };
    }

    async function fetchLatestLiveTelemetry() {
      // 1. Try polling ThingSpeak live hardware feed via Django backend
      try {
        const tsResp = await fetch("/api/telemetry/thingspeak/", { cache: "no-store" });
        if (tsResp.ok) {
          const tsData = await tsResp.json();
          if (tsData && tsData.status === "ok" && tsData.telemetry) {
            return {
              telemetry: tsData.telemetry,
              entryId: tsData.entry_id,
              source: `ThingSpeak via Backend (#${THINGSPEAK_CHANNEL_ID})`,
              createdAt: tsData.created_at
            };
          }
        }
      } catch (err) {
        console.warn("Backend ThingSpeak endpoint not reachable, falling back to direct API fetch...");
      }

      // 2. Direct browser-to-ThingSpeak fetch (fallback if Django is offline or opened as static HTML)
      try {
        const directResp = await fetch(THINGSPEAK_DIRECT_URL, { cache: "no-store" });
        if (directResp.ok) {
          const feed = await directResp.json();
          if (feed && feed !== -1 && feed.entry_id) {
            return mapThingSpeakFeedToPayload(feed);
          }
        }
      } catch (directErr) {
        console.warn("Direct ThingSpeak fetch error:", directErr);
      }

      // 3. Fallback to latest record from PostgreSQL if available
      try {
        const info = await HistoryPlayer.fetchRangeInfo();
        if (info && info.latest_record) {
          return {
            telemetry: info.latest_record,
            entryId: info.latest_record.id,
            source: "PostgreSQL Database Cache",
            createdAt: info.latest_record.timestamp
          };
        }
      } catch (err) {
        console.warn("PostgreSQL range-info fallback notice:", err);
      }

      return null;
    }

    async function pollAndRenderTelemetry(bannerEl, statusBadgeEl) {
      const data = await fetchLatestLiveTelemetry();
      if (!data || !data.telemetry) {
        if (bannerEl) bannerEl.textContent = `Connecting to ThingSpeak channel #${THINGSPEAK_CHANNEL_ID}...`;
        if (statusBadgeEl) {
          statusBadgeEl.textContent = "● Error reaching ThingSpeak (Check Network)";
          statusBadgeEl.className = "db-status-badge error";
        }
        return;
      }

      const rec = data.telemetry;
      const state = HistoryPlayer.recordToMachineState ? HistoryPlayer.recordToMachineState(rec) : null;
      if (!state) return;

      const isConnected = (rec.sensor_connected !== undefined ? rec.sensor_connected : (rec.supply_air_temperature !== null || rec.return_air_temperature !== null));

      // Keep animation loops running and responsive
      state.isHistorical = false;
      state.running = isConnected;
      state.fanOn = isConnected;
      state.vfdFrequency = isConnected ? (Number(rec.vfd_frequency) || 45.0) : 0.0;
      state.airflowCfm = isConnected ? (Number(rec.airflow_cfm) || 850.0) : 0.0;
      state.heatingValveCommand = rec.heating_valve_command !== undefined ? Number(rec.heating_valve_command) : 40.0;
      state.dhtHumidity = rec.dht_humidity;
      state.bmpAltitude = rec.bmp_altitude;
      state.field5 = rec.field5 !== undefined ? rec.field5 : rec.bmp_altitude;
      state.sensorConnected = isConnected;
      state.supplyAirTemperature = rec.supply_air_temperature;
      state.returnAirTemperature = rec.return_air_temperature;
      state.dischargeTemp = rec.discharge_temperature;
      state.supplyStaticPressure = rec.supply_static_pressure;
      state.waterEvaporator = rec.water_evaporator !== undefined ? rec.water_evaporator : (isConnected ? 7.0 : 24.0);
      state.waterEvaporatorIn = rec.water_evaporator_inlet !== undefined ? rec.water_evaporator_inlet : (isConnected ? 12.0 : 24.0);
      state.waterEvaporatorOut = rec.water_evaporator_outlet !== undefined ? rec.water_evaporator_outlet : (rec.water_evaporator || (isConnected ? 7.0 : 24.0));
      state.mqAirQuality = rec.mq_air_quality;
      state.environmentTemp = rec.environment_temperature !== undefined ? rec.environment_temperature : (rec.environment_temp !== undefined ? rec.environment_temp : 24.0);

      const timeStr = rec.time_display || new Date().toLocaleTimeString();
      const humText = rec.dht_humidity !== null && rec.dht_humidity !== undefined ? ` | Humidity: ${rec.dht_humidity}%` : "";
      const f5Text = state.field5 !== null && state.field5 !== undefined ? ` | Field 5: ${state.field5}` : "";
      const entryText = data.entryId ? ` [Entry #${data.entryId}]` : "";

      const logMsg = isConnected
        ? `Live IoT Telemetry received from ${data.source}${entryText} — Supply Temp: ${rec.supply_air_temperature}°C, Pressure: ${rec.supply_static_pressure || "--"} hPa${humText}${f5Text}`
        : `[WARNING] Sensor Disconnected / No Data (Field 1: null) from ${data.source}${entryText}${f5Text}`;

      UI.renderAll(state, [{
        time: timeStr,
        message: logMsg,
        severity: isConnected ? "ok" : "err"
      }]);

      const alertBar = document.getElementById("ahuAlertBar") || document.getElementById("rfAlertBar");
      if (alertBar) {
        alertBar.hidden = false;
        alertBar.style.display = "block";
        alertBar.style.padding = "8px 14px";
        alertBar.style.borderRadius = "4px";
        alertBar.style.marginBottom = "10px";
        alertBar.style.fontSize = "12px";

        if (!isConnected) {
          alertBar.style.background = "#7f1d1d";
          alertBar.style.borderColor = "#ef4444";
          alertBar.style.color = "#fee2e2";
          alertBar.innerHTML = `⚠️ <strong>TEMPERATURE SENSOR NOT CONNECTED:</strong> Field 1 reported no signal / disconnected! &nbsp;|&nbsp; <strong>Field 5 (Alt/Aux):</strong> <span style="background:#991b1b; padding:2px 6px; border-radius:3px; font-weight:bold;">${state.field5 ?? "--"}</span> &nbsp;|&nbsp; <strong>Pressure:</strong> ${rec.supply_static_pressure ?? "--"} hPa &nbsp;|&nbsp; <em>Check sensor wiring on ESP32</em>`;
        } else {
          alertBar.style.background = "#064e3b";
          alertBar.style.borderColor = "#10b981";
          alertBar.style.color = "#ecfdf5";
          const dischP = rec.discharge_pressure !== undefined ? rec.discharge_pressure : (state.dischargePressure || 10.5);
          alertBar.innerHTML = `<strong>📡 ThingSpeak Live IoT Sync:</strong> Entry #${data.entryId} (Recorded: ${rec.date_display} ${rec.time_display}) &nbsp;|&nbsp; <strong>Comp Out:</strong> ${rec.discharge_temperature ?? "--"}°C &nbsp;|&nbsp; <strong>Evap Out:</strong> ${rec.evaporator_outlet_temp ?? "--"}°C &nbsp;|&nbsp; <strong>Cond Out:</strong> ${rec.condenser_outlet_temp ?? "--"}°C &nbsp;|&nbsp; <strong>Water Evap:</strong> ${rec.water_evaporator ?? "--"}°C &nbsp;|&nbsp; <strong>Evap In:</strong> ${rec.evaporator_inlet_temp ?? "--"}°C`;
        }
      }

      if (bannerEl) {
        const tempDisp = isConnected ? `${rec.supply_air_temperature}°C` : `<span style="color:#fca5a5; font-weight:bold;">[DISCONNECTED]</span>`;
        bannerEl.innerHTML = `<span class="nav-dot" style="background:${isConnected ? '#2ecc71' : '#ef4444'}; animation:pulse 1.5s infinite; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px;"></span> <strong>LIVE IOT ACTIVE</strong> — ${data.source}${entryText} | Temp: ${tempDisp}${humText}${f5Text} | Last Sync: ${timeStr}`;
      }

      if (statusBadgeEl) {
        if (!isConnected) {
          statusBadgeEl.innerHTML = `● <strong>ThingSpeak Online</strong> [Entry #${data.entryId}] — ⚠️ <span style="color:#fecaca;">TEMP SENSOR NOT CONNECTED</span> | F5: ${state.field5 ?? "--"}`;
          statusBadgeEl.className = "db-status-badge error";
          statusBadgeEl.style.background = "#991b1b";
          statusBadgeEl.style.color = "#ffffff";
        } else {
          statusBadgeEl.innerHTML = `● <strong>ThingSpeak Online</strong> [Entry #${data.entryId}] — ${rec.supply_air_temperature}°C | ${rec.dht_humidity ?? "--"}% Hum | ${rec.supply_static_pressure ?? "--"} hPa | <strong>F5: ${state.field5 ?? "--"}</strong>`;
          statusBadgeEl.className = "db-status-badge saved";
          statusBadgeEl.style.background = "#059669";
          statusBadgeEl.style.color = "#ffffff";
        }
      }
    }

    const isLivePage = Boolean(
      document.body && (
        document.body.dataset.pageMode === "live" ||
        document.body.classList.contains("page-live")
      )
    );

    if (isLivePage) {
      // In live mode: controls must not appear; only live data values from ThingSpeak are displayed
      const ahuSvg = document.getElementById("ahuSvg");
      if (ahuSvg) {
        ahuSvg.setAttribute("viewBox", "0 0 1180 405");
      }
      const ahuInlineControls = document.getElementById("ahuInlineControls");
      if (ahuInlineControls) {
        ahuInlineControls.style.display = "none";
      }

      document.querySelectorAll("input, button").forEach(function (el) {
        if (/^(inline|btnStart|btnStop|btnSaveSnapshot)/.test(el.id)) el.disabled = true;
      });
      setSimulationMode("live");
      Sim.setLiveModeActive(false);

      const liveBannerText = document.getElementById("liveBannerText");
      pollAndRenderTelemetry(liveBannerText, null);
      livePollInterval = setInterval(() => pollAndRenderTelemetry(liveBannerText, null), 3000);
    }

    // Toggle live IoT polling on simulation pages
    if (btnToggleIotFeed) {
      btnToggleIotFeed.addEventListener("click", async function () {
        if (!isLiveIotPollingActive) {
          isLiveIotPollingActive = true;
          Sim.setLiveModeActive(false);
          btnToggleIotFeed.textContent = "⏹ Stop Live IoT (Resume Sim)";
          btnToggleIotFeed.style.background = "#e11d48";
          btnToggleIotFeed.style.borderColor = "#fb7185";
          if (btnStart) btnStart.disabled = true;
          if (btnStop) btnStop.disabled = true;
          if (dbSaveStatus) {
            dbSaveStatus.textContent = "● Polling Live ThingSpeak...";
            dbSaveStatus.className = "db-status-badge saved";
          }
          await pollAndRenderTelemetry(null, dbSaveStatus);
          livePollInterval = setInterval(() => pollAndRenderTelemetry(null, dbSaveStatus), 3000);
          Sim.addLog(`Live IoT polling connected to ESP32-S3 ThingSpeak channel #${THINGSPEAK_CHANNEL_ID}`, "ok");
        } else {
          isLiveIotPollingActive = false;
          if (livePollInterval) {
            clearInterval(livePollInterval);
            livePollInterval = null;
          }
          Sim.setLiveModeActive(true);
          btnToggleIotFeed.textContent = "📡 Poll Live IoT (ThingSpeak)";
          btnToggleIotFeed.style.background = "#0284c7";
          btnToggleIotFeed.style.borderColor = "#38bdf8";
          updateButtonStates(Sim.state);
          if (dbSaveStatus) {
            dbSaveStatus.textContent = "● Auto-saving to PostgreSQL every 5s";
            dbSaveStatus.className = "db-status-badge";
          }
          const alertBar = document.getElementById("ahuAlertBar") || document.getElementById("rfAlertBar");
          if (alertBar) {
            alertBar.hidden = true;
            alertBar.style.display = "none";
          }
          Sim.addLog("Stopped Live IoT polling. Resumed physics simulation.", "info");
          UI.renderAll(Sim.state, Sim.getLog());
        }
      });
    }

    if (tabLiveMode) tabLiveMode.addEventListener("click", () => setSimulationMode("live"));
    if (tabHistMode) tabHistMode.addEventListener("click", () => setSimulationMode("history"));

    // ------------------------------------------------------------
    // Live Controls Wiring
    // ------------------------------------------------------------
    function updateButtonStates(s) {
      if (btnStart) btnStart.disabled = s.running;
      if (btnStop) btnStop.disabled = !s.running;
    }

    if (btnStart) {
      btnStart.addEventListener("click", function () { Sim.start(); });
    }
    if (btnStop) {
      btnStop.addEventListener("click", function () { Sim.stop(); });
    }
    if (btnSaveSnapshot) {
      btnSaveSnapshot.addEventListener("click", async function () {
        await Sim.saveTelemetryToDb();
        Sim.addLog("Manual telemetry snapshot logged to PostgreSQL", "ok");
      });
    }

    updateButtonStates(Sim.state);
    Sim.onTick(updateButtonStates);
    Sim.onTick(function (s) {
      // Sync inline controls (near equipment) — SAME state, bidirectional sync
      if (inlineActuatorInputs.valveOpening && document.activeElement !== inlineActuatorInputs.valveOpening) inlineActuatorInputs.valveOpening.value = s.valveOpening;
      if (inlineActuatorInputs.heatingValveCommand && document.activeElement !== inlineActuatorInputs.heatingValveCommand) inlineActuatorInputs.heatingValveCommand.value = s.heatingValveCommand;
      if (inlineActuatorInputs.damperPosition && document.activeElement !== inlineActuatorInputs.damperPosition) inlineActuatorInputs.damperPosition.value = s.damperPosition;
      if (inlineActuatorInputs.vavPosition && document.activeElement !== inlineActuatorInputs.vavPosition) inlineActuatorInputs.vavPosition.value = s.vavPosition;
      if (inlineActuatorInputs.vfdFrequency && document.activeElement !== inlineActuatorInputs.vfdFrequency) inlineActuatorInputs.vfdFrequency.value = s.vfdFrequency;
      if (inlineActuatorInputs.setTemperature && document.activeElement !== inlineActuatorInputs.setTemperature) inlineActuatorInputs.setTemperature.value = s.setTemperature;
      if (inlineFanToggle && document.activeElement !== inlineFanToggle) inlineFanToggle.checked = s.fanOn;
    });

    // ------------------------------------------------------------
    // Historical Controls Wiring
    // ------------------------------------------------------------
    function formatDateTimeLocal(date) {
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const mins = String(d.getMinutes()).padStart(2, "0");
      const secs = String(d.getSeconds()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${mins}:${secs}`;
    }

    let latestRangeInfo = null;

    async function initHistoricalInputs() {
      latestRangeInfo = await HistoryPlayer.fetchRangeInfo();
      const now = new Date();

      if (latestRangeInfo && latestRangeInfo.latest_timestamp) {
        const latestDt = new Date(latestRangeInfo.latest_timestamp);
        const earliestDt = new Date(latestRangeInfo.earliest_timestamp);
        if (histStartTime) histStartTime.value = formatDateTimeLocal(earliestDt);
        if (histEndTime) histEndTime.value = formatDateTimeLocal(latestDt);
        if (histStatusMsg) {
          histStatusMsg.textContent = `Found ${latestRangeInfo.total_records} records in PostgreSQL (from ${earliestDt.toLocaleTimeString()} to ${latestDt.toLocaleTimeString()})`;
        }
      } else {
        const startDt = new Date(now.getTime() - 15 * 60 * 1000);
        if (histStartTime) histStartTime.value = formatDateTimeLocal(startDt);
        if (histEndTime) histEndTime.value = formatDateTimeLocal(now);
      }
    }

    if (histDuration) {
      histDuration.addEventListener("change", function () {
        if (histEndTimeWrap) {
          histEndTimeWrap.style.display = histDuration.value === "custom" ? "flex" : "none";
        }
      });
    }

    async function triggerLoadHistory(preset) {
      if (preset === "5m") {
        if (histDuration) histDuration.value = "5m";
      } else if (preset === "15m") {
        if (histDuration) histDuration.value = "15m";
      } else if (preset === "all") {
        if (histDuration) histDuration.value = "all";
      }

      const params = {};
      const durationVal = histDuration ? histDuration.value : "all";

      if (durationVal === "all") {
        // fetch all records without time boundary
      } else if (durationVal === "custom") {
        if (histStartTime && histStartTime.value) params.startTime = new Date(histStartTime.value).toISOString();
        if (histEndTime && histEndTime.value) params.endTime = new Date(histEndTime.value).toISOString();
      } else {
        let mins = 5;
        if (durationVal === "15m") mins = 15;
        else if (durationVal === "30m") mins = 30;
        else if (durationVal === "1h") mins = 60;
        
        let anchorTime = (latestRangeInfo && latestRangeInfo.latest_timestamp) ? new Date(latestRangeInfo.latest_timestamp).getTime() : Date.now();
        let startDt = new Date(anchorTime - mins * 60000);
        params.startTime = startDt.toISOString();
        params.durationMinutes = mins;
      }

      if (histStatusMsg) histStatusMsg.textContent = "Querying PostgreSQL...";
      const records = await HistoryPlayer.loadHistory(params);

      const hasRecords = records.length > 0;
      if (histScrubber) {
        histScrubber.disabled = !hasRecords;
        histScrubber.min = "0";
        histScrubber.max = String(Math.max(0, records.length - 1));
        histScrubber.value = "0";
      }
      if (btnHistPlay) btnHistPlay.disabled = !hasRecords;
      if (btnHistPrev) btnHistPrev.disabled = !hasRecords;
      if (btnHistNext) btnHistNext.disabled = !hasRecords;
      if (btnHistStop) btnHistStop.disabled = !hasRecords;

      if (hasRecords) {
        const first = records[0];
        const last = records[records.length - 1];
        if (histStatusMsg) {
          histStatusMsg.textContent = `Loaded ${records.length} frames (${first.time_display} - ${last.time_display}). Press Play to start replay.`;
        }
      } else {
        if (histStatusMsg) histStatusMsg.textContent = "No records found in selected range. Click 'All Records' to replay all data.";
      }
    }

    if (btnFetchHistory) btnFetchHistory.addEventListener("click", () => triggerLoadHistory());
    if (btnQuick5m) btnQuick5m.addEventListener("click", () => triggerLoadHistory("5m"));
    if (btnQuick15m) btnQuick15m.addEventListener("click", () => triggerLoadHistory("15m"));
    if (btnQuickAll) btnQuickAll.addEventListener("click", () => triggerLoadHistory("all"));

    // Playback control buttons
    if (btnHistPlay) btnHistPlay.addEventListener("click", () => HistoryPlayer.togglePlay());
    if (btnHistPrev) btnHistPrev.addEventListener("click", () => HistoryPlayer.prevFrame());
    if (btnHistNext) btnHistNext.addEventListener("click", () => HistoryPlayer.nextFrame());
    if (btnHistStop) btnHistStop.addEventListener("click", () => HistoryPlayer.stop());

    if (chkHistLoop) {
      chkHistLoop.addEventListener("change", function () {
        HistoryPlayer.setLoop(this.checked);
      });
      HistoryPlayer.setLoop(chkHistLoop.checked);
    }

    if (histSpeedSelect) {
      histSpeedSelect.addEventListener("change", function () {
        HistoryPlayer.setSpeed(this.value);
      });
    }

    if (histScrubber) {
      histScrubber.addEventListener("input", function () {
        HistoryPlayer.seekToIndex(parseInt(this.value, 10));
      });
    }

    // Frame change listener: update scrubber & frame label
    HistoryPlayer.onFrameChange(function (record, index, total) {
      if (histScrubber) {
        histScrubber.value = String(index);
      }
      if (histCurrentTime && record) {
        histCurrentTime.textContent = `${record.time_display} (${index + 1}/${total})`;
      }
      if (histStatusMsg && record) {
        histStatusMsg.textContent = `Frame ${index + 1}/${total} | Time: ${record.time_display} | Suction: ${record.suction_pressure} bar | Discharge: ${record.discharge_pressure} bar | Condenser: ${record.condenser_outlet_temp}°C | Evaporator: ${record.evaporator_inlet_temp}°C | Status: ${record.system_status}`;
      }
    });

  });
})();
