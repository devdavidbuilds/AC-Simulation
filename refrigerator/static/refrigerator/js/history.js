/* ============================================================
   history.js
   ------------------------------------------------------------
   Historical Telemetry Replay Engine for Refrigeration Cycle.
   Fetches performance records from PostgreSQL and drives the
   SVG machine diagram and sensor displays frame-by-frame.

   Exposes a single global: window.HistoryPlayer
   ============================================================ */

(function () {
  "use strict";

  let records = [];
  let currentIndex = 0;
  let isPlaying = false;
  let playTimer = null;
  let playbackSpeed = 1.0; // 0.5x, 1x, 2x, 5x, 10x
  let isLooping = true;
  const BASE_INTERVAL_MS = 800;

  const historyLog = [];
  const listeners = [];

  function onFrameChange(fn) {
    listeners.push(fn);
  }

  function notifyFrame(record, index, total) {
    listeners.forEach((fn) => {
      try { fn(record, index, total); } catch(e) { console.error(e); }
    });
  }

  // ------------------------------------------------------------
  // Fetch available range metadata from PostgreSQL
  // ------------------------------------------------------------
  async function fetchRangeInfo() {
    try {
      const resp = await fetch("/api/telemetry/range-info/");
      if (resp.ok) {
        return await resp.json();
      }
    } catch (e) {
      console.warn("Error fetching range info:", e);
    }
    return null;
  }

  // ------------------------------------------------------------
  // Query historical records from PostgreSQL
  // ------------------------------------------------------------
  async function loadHistory(params = {}) {
    pause();
    const query = new URLSearchParams();
    if (params.startTime) query.set("start_time", params.startTime);
    if (params.endTime) query.set("end_time", params.endTime);
    if (params.durationSeconds) query.set("duration_seconds", params.durationSeconds);
    if (params.durationMinutes) query.set("duration_minutes", params.durationMinutes);
    query.set("limit", params.limit || 5000);

    try {
      const resp = await fetch("/api/telemetry/history/?" + query.toString());
      if (!resp.ok) throw new Error("Server returned " + resp.status);
      const data = await resp.json();
      records = data.records || [];
      currentIndex = 0;

      if (records.length > 0) {
        renderCurrentFrame();
        addHistoryLog(`Loaded ${records.length} historical frames from PostgreSQL. Ready to replay.`, "ok");
      } else {
        addHistoryLog("No telemetry records found for selected time range.", "warn");
      }
      return records;
    } catch (err) {
      console.error("Failed to load historical telemetry:", err);
      addHistoryLog("Failed to fetch historical telemetry: " + err.message, "err");
      return [];
    }
  }

  function addHistoryLog(msg, sev) {
    const timeStr = new Date().toLocaleTimeString("en-GB", { hour12: false });
    historyLog.unshift({ time: timeStr, message: "[REPLAY] " + msg, severity: sev || "info" });
    if (historyLog.length > 50) historyLog.length = 50;
  }

  // ------------------------------------------------------------
  // Convert database record into standardized UI render state
  // ------------------------------------------------------------
  function recordToMachineState(rec) {
    if (!rec) return null;
    const isRunning = rec.system_status === "RUNNING" || rec.compressor_status === "RUNNING";
    const isStarting = rec.system_status === "STARTING" || rec.compressor_status === "STARTING";

    const pSuc = Number(rec.suction_pressure) || 1.0;
    const pDis = Number(rec.discharge_pressure) || 1.0;
    const tDis = Number(rec.discharge_temperature) || 24.0;
    const tCondOut = Number(rec.condenser_outlet_temp) || 24.0;
    const tEvapIn = Number(rec.evaporator_inlet_temp) || 24.0;
    const tEvapOut = Number(rec.evaporator_outlet_temp) || 24.0;

    return {
      running: isRunning || isStarting,
      systemStatus: rec.system_status || (isRunning ? "RUNNING" : "STOPPED"),
      suctionPressure: pSuc,
      dischargePressure: pDis,
      dischargeTemp: tDis,
      condenserOutletTemp: tCondOut,
      evaporatorInletTemp: tEvapIn,
      evaporatorOutletTemp: tEvapOut,
      valveOpening: Number(rec.valve_opening) || 60,
      damperPosition: Number(rec.damper_position) || 70,
      fanOn: rec.fan_on !== undefined ? Boolean(rec.fan_on) : isRunning,
      vfdFrequency: Number(rec.vfd_frequency) || 40,
      vavPosition: Number(rec.vav_position) || 70,
      airflowCfm: Number(rec.airflow_cfm) || (isRunning ? 700 : 0),
      supplyAirTemperature: Number(rec.supply_air_temperature) || 24.0,
      returnAirTemperature: Number(rec.return_air_temperature) || 24.0,
      supplyStaticPressure: Number(rec.supply_static_pressure) || 0,
      setTemperature: Number(rec.set_temperature) || 22.0,
      timestamp: rec.timestamp,
      timeDisplay: rec.time_display,
      dateDisplay: rec.date_display,
      faultType: rec.fault_type || "None",
      isHistorical: true
    };
  }

  function renderCurrentFrame() {
    if (records.length === 0) return;
    const rec = records[currentIndex];
    const state = recordToMachineState(rec);

    if (window.UI && typeof window.UI.renderAll === "function") {
      window.UI.renderAll(state, historyLog);
    }

    notifyFrame(rec, currentIndex, records.length);
  }

  // ------------------------------------------------------------
  // Playback Control Methods
  // ------------------------------------------------------------
  function play() {
    if (records.length === 0) return;
    if (isPlaying) return;
    isPlaying = true;

    if (currentIndex >= records.length - 1) {
      currentIndex = 0; // restart from beginning
    }

    renderCurrentFrame();
    updatePlaybackControlsUI();
    scheduleNextTick();
  }

  function pause() {
    isPlaying = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    renderCurrentFrame();
    updatePlaybackControlsUI();
  }

  function togglePlay() {
    if (isPlaying) pause();
    else play();
  }

  function stop() {
    isPlaying = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    currentIndex = 0;
    renderCurrentFrame();
    updatePlaybackControlsUI();
  }

  function nextFrame() {
    pause();
    if (currentIndex < records.length - 1) {
      currentIndex++;
      renderCurrentFrame();
    } else if (isLooping) {
      currentIndex = 0;
      renderCurrentFrame();
    }
  }

  function prevFrame() {
    pause();
    if (currentIndex > 0) {
      currentIndex--;
      renderCurrentFrame();
    } else if (isLooping) {
      currentIndex = records.length - 1;
      renderCurrentFrame();
    }
  }

  function seekToIndex(index) {
    if (records.length === 0) return;
    currentIndex = Math.max(0, Math.min(records.length - 1, Math.round(index)));
    renderCurrentFrame();
  }

  function seekToProgress(progressPercent) {
    if (records.length === 0) return;
    const idx = Math.round((progressPercent / 100) * (records.length - 1));
    seekToIndex(idx);
  }

  function setSpeed(speed) {
    playbackSpeed = parseFloat(speed) || 1.0;
    if (isPlaying) {
      if (playTimer) clearTimeout(playTimer);
      scheduleNextTick();
    }
  }

  function setLoop(loop) {
    isLooping = Boolean(loop);
  }

  function scheduleNextTick() {
    if (!isPlaying) return;
    const interval = Math.max(50, Math.round(BASE_INTERVAL_MS / playbackSpeed));
    playTimer = setTimeout(() => {
      if (currentIndex < records.length - 1) {
        currentIndex++;
        renderCurrentFrame();
        scheduleNextTick();
      } else {
        if (isLooping && records.length > 1) {
          currentIndex = 0;
          renderCurrentFrame();
          scheduleNextTick();
        } else {
          pause();
          addHistoryLog(`Finished historical playback of ${records.length} frames.`, "ok");
        }
      }
    }, interval);
  }

  function updatePlaybackControlsUI() {
    const btnPlay = document.getElementById("btnHistPlay");
    if (btnPlay) {
      btnPlay.innerHTML = isPlaying ? "⏸ Pause" : "▶ Play";
      btnPlay.className = isPlaying ? "btn-hist-play playing" : "btn-hist-play";
    }

    const svgWrap = document.querySelector(".mimic-svg-wrap") || document.getElementById("refrigerationMimic");
    if (svgWrap) {
      if (isPlaying) {
        svgWrap.classList.remove("playback-paused");
      } else {
        svgWrap.classList.add("playback-paused");
      }
    }
  }

  window.HistoryPlayer = {
    loadHistory: loadHistory,
    fetchRangeInfo: fetchRangeInfo,
    play: play,
    pause: pause,
    togglePlay: togglePlay,
    stop: stop,
    nextFrame: nextFrame,
    prevFrame: prevFrame,
    seekToIndex: seekToIndex,
    seekToProgress: seekToProgress,
    setSpeed: setSpeed,
    setLoop: setLoop,
    isLooping: () => isLooping,
    onFrameChange: onFrameChange,
    getCurrentRecord: () => records[currentIndex] || null,
    getRecords: () => records,
    getCurrentIndex: () => currentIndex,
    isPlaying: () => isPlaying,
    getPlaybackSpeed: () => playbackSpeed
  };
})();
