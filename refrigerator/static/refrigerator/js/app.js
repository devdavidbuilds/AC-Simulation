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
      inlineFanToggle.addEventListener("change", function () {
        Sim.setFan(this.checked);
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
