import * as db from "./db.js";
import { streamRoutineRecommendation, sanitizeApiKey } from "./gemini.js";
import { RestTimer } from "./timer.js";
import { drawLineChart, drawBarChart } from "./chart.js";

/* ---------------- helpers ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return formatDate(new Date());
}

function formatSet(set) {
  if (set.unit === "none") return `무게없음 × ${set.reps}회`;
  return `${set.weight}${set.unit} × ${set.reps}회`;
}

function formatSetsSummary(sets) {
  return sets.map(formatSet).join(", ");
}

function showToast(msg, ms = 2200) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

/* ---------------- tab navigation ---------------- */

const TAB_TITLES = { home: "홈", workout: "운동", inbody: "인바디", settings: "설정" };

function switchTab(target) {
  $$(".view").forEach((v) => (v.hidden = v.dataset.view !== target));
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.target === target));
  $("#topbar-title").textContent = TAB_TITLES[target];
  if (target === "inbody") renderInbodyTab();
  if (target === "workout") renderWorkoutTab();
  if (target === "home") renderHomeTab();
  if (target === "settings") renderSettingsTab();
}

$$(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.target));
});

/* ---------------- home tab ---------------- */

async function renderHomeTab() {
  const logs = await db.getWorkoutLogsByDate(todayStr());
  renderHomeWorkoutSummary(logs);
  await renderGoalProgress();
  await renderCalendar();
}

/* ---------------- home tab: goal progress ---------------- */

function calcProgressPct(startVal, currentVal, targetVal, direction) {
  if (startVal === targetVal) return currentVal === targetVal ? 100 : 0;
  const raw =
    direction === "increase"
      ? ((currentVal - startVal) / (targetVal - startVal)) * 100
      : ((startVal - currentVal) / (startVal - targetVal)) * 100;
  return Math.max(0, Math.min(100, raw));
}

async function renderGoalProgress() {
  const container = $("#goal-progress-content");
  const records = await db.getAllInbodyRecords();

  if (!records.length) {
    container.innerHTML = `<p class="empty-hint">인바디 탭에서 첫 기록을 입력해주세요</p>`;
    return;
  }

  const goals = await db.getSetting("fitnessGoals", null);
  const items = [
    { key: "weight", label: "체중", unit: "kg", direction: "decrease", target: goals?.targetWeight },
    { key: "bodyFat", label: "체지방률", unit: "%", direction: "decrease", target: goals?.targetBodyFat },
    { key: "muscleMass", label: "골격근량", unit: "kg", direction: "increase", target: goals?.targetMuscleMass },
  ].filter((item) => item.target);

  if (!items.length) {
    container.innerHTML = `<p class="empty-hint">설정 탭에서 목표를 입력해주세요</p>`;
    return;
  }

  const start = records[0];
  const current = records[records.length - 1];

  container.innerHTML = "";
  items.forEach((item) => {
    const startVal = start[item.key];
    const currentVal = current[item.key];
    const pct = calcProgressPct(startVal, currentVal, item.target, item.direction);
    const achieved = pct >= 100;

    const div = document.createElement("div");
    div.className = "goal-progress-item";
    div.innerHTML = `
      <div class="goal-progress-header">
        <span class="goal-progress-label">${item.label}</span>
        <span class="goal-progress-value">현재 ${currentVal}${item.unit} → 목표 ${item.target}${item.unit}</span>
      </div>
      <div class="goal-progress-bar-track">
        <div class="goal-progress-bar-fill${achieved ? " achieved" : ""}" style="width: ${pct}%"></div>
      </div>
      <div class="goal-progress-pct${achieved ? " achieved" : ""}">${achieved ? "🎉 달성!" : `${Math.round(pct)}%`}</div>
    `;
    container.appendChild(div);
  });
}

function renderHomeWorkoutSummary(logs) {
  const container = $("#home-workout-summary");
  if (!logs.length) {
    container.innerHTML = `<p class="empty-hint">오늘 기록된 운동이 없어요.</p>`;
    return;
  }
  container.innerHTML = "";
  const weightCount = logs.filter((l) => l.type === "weight").length;
  const runCount = logs.filter((l) => l.type === "running").length;
  const div = document.createElement("div");
  div.className = "log-item";
  div.innerHTML = `
    <div class="log-main">
      <span class="log-title">오늘 ${logs.length}개 운동 완료</span>
      <span class="log-sub">웨이트 ${weightCount}개 · 러닝 ${runCount}개</span>
    </div>`;
  container.appendChild(div);
}

/* ---------------- home tab: calendar ---------------- */

let calendarViewDate = new Date();
calendarViewDate.setDate(1);

async function renderCalendar() {
  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();

  $("#calendar-month-label").textContent = `${year}년 ${month + 1}월`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const monthStartStr = formatDate(firstDay);
  const monthEndExclusiveStr = formatDate(new Date(year, month + 1, 1));
  const monthLogs = await db.getWorkoutLogsBetween(monthStartStr, monthEndExclusiveStr);
  const datesWithLogs = new Set(monthLogs.map((l) => l.date));

  const grid = $("#calendar-grid");
  grid.innerHTML = "";

  for (let i = 0; i < startWeekday; i++) {
    const cell = document.createElement("div");
    cell.className = "calendar-cell empty";
    grid.appendChild(cell);
  }

  const todayString = todayStr();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateString = formatDate(new Date(year, month, day));
    const cell = document.createElement("div");
    cell.className = "calendar-cell" + (dateString === todayString ? " today" : "");
    cell.innerHTML = `
      <span class="calendar-day-num">${day}</span>
      ${datesWithLogs.has(dateString) ? '<span class="calendar-dot"></span>' : ""}
    `;
    cell.addEventListener("click", () => showDayDetail(dateString));
    grid.appendChild(cell);
  }

  const monthCount = datesWithLogs.size;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const weekEndExclusive = new Date(weekStart);
  weekEndExclusive.setDate(weekStart.getDate() + 7);
  const weekLogs = await db.getWorkoutLogsBetween(formatDate(weekStart), formatDate(weekEndExclusive));
  const weekCount = new Set(weekLogs.map((l) => l.date)).size;

  $("#calendar-stats").textContent = `이번 달 ${monthCount}회 운동 · 이번 주 ${weekCount}회 운동`;
}

async function showDayDetail(dateString) {
  const logs = await db.getWorkoutLogsByDate(dateString);
  $("#calendar-day-detail").hidden = false;
  $("#calendar-day-title").textContent = `${dateString} 운동 내역`;
  const container = $("#calendar-day-logs");
  if (!logs.length) {
    container.innerHTML = `<p class="empty-hint">이 날은 기록된 운동이 없어요.</p>`;
    return;
  }
  container.innerHTML = "";
  logs.forEach((log) => {
    const div = document.createElement("div");
    div.className = "log-item";
    if (log.type === "weight") {
      div.innerHTML = `
        <div class="log-main">
          <span class="log-title">${log.equipmentName}</span>
          <span class="log-sub">${log.sets.length}세트 · ${formatSetsSummary(log.sets)}</span>
        </div>`;
    } else {
      div.innerHTML = `
        <div class="log-main">
          <span class="log-title">러닝</span>
          <span class="log-sub">${log.distance}km · ${log.duration}분 · ${log.pace}분/km</span>
        </div>`;
    }
    container.appendChild(div);
  });
}

$("#btn-prev-month").addEventListener("click", () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
  $("#calendar-day-detail").hidden = true;
  renderCalendar();
});
$("#btn-next-month").addEventListener("click", () => {
  calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
  $("#calendar-day-detail").hidden = true;
  renderCalendar();
});
$("#btn-close-day-detail").addEventListener("click", () => {
  $("#calendar-day-detail").hidden = true;
});

/* ---------------- workout tab ---------------- */

let equipmentCache = [];
let restTimer = null;

function initRestTimer() {
  restTimer = new RestTimer({
    onTick: (remaining, total) => {
      $("#timer-display").textContent = RestTimer.formatTime(remaining);
    },
    onComplete: () => {
      $("#btn-timer-toggle").textContent = "시작";
      showToast("쉬는시간 종료!");
    },
  });
}

async function populateEquipmentSelect() {
  equipmentCache = await db.getEquipmentList();
  const select = $("#weight-equipment");
  select.innerHTML = equipmentCache.length
    ? equipmentCache.map((e) => `<option value="${e.id}">${e.name} (${e.category})</option>`).join("")
    : `<option value="">등록된 기구가 없어요 - 설정에서 추가해주세요</option>`;
}

async function renderWorkoutTab() {
  await populateEquipmentSelect();
  const restSeconds = await db.getSetting("defaultRestSeconds", 90);
  if (!restTimer) initRestTimer();
  if (!restTimer.active) {
    restTimer.setDuration(restSeconds);
  }
  $("#timer-display").textContent = RestTimer.formatTime(restTimer.remaining);

  const logs = await db.getWorkoutLogsByDate(todayStr());
  renderWorkoutLogList(logs);

  const prefs = await db.getSetting("weeklyRoutinePrefs", { gymDays: ["월", "수", "금"], runDays: ["화", "목"] });
  gymDaySelection = new Set(prefs.gymDays || []);
  runDaySelection = new Set(prefs.runDays || []);
  applyDaySelectionToButtons("#gym-day-picker", gymDaySelection);
  applyDaySelectionToButtons("#run-day-picker", runDaySelection);
  updateDayConflictWarning();

  renderStoredRoutine(await db.getSetting("weeklyRoutine", null));

  await renderWorkoutStats();
}

/* ---------------- workout tab: weekly routine day picker ---------------- */

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

let gymDaySelection = new Set();
let runDaySelection = new Set();

function applyDaySelectionToButtons(containerSelector, daySet) {
  $$(".day-btn", $(containerSelector)).forEach((btn) => {
    btn.classList.toggle("active", daySet.has(btn.dataset.day));
  });
}

function updateDayConflictWarning() {
  const overlap = DAY_LABELS.filter((d) => gymDaySelection.has(d) && runDaySelection.has(d));
  $$(".day-btn", $("#gym-day-picker")).forEach((btn) => {
    btn.classList.toggle("conflict", overlap.includes(btn.dataset.day));
  });
  $$(".day-btn", $("#run-day-picker")).forEach((btn) => {
    btn.classList.toggle("conflict", overlap.includes(btn.dataset.day));
  });
  $("#day-picker-warning").hidden = overlap.length === 0;
}

async function saveDaySelections() {
  await db.setSetting("weeklyRoutinePrefs", {
    gymDays: DAY_LABELS.filter((d) => gymDaySelection.has(d)),
    runDays: DAY_LABELS.filter((d) => runDaySelection.has(d)),
  });
}

$$(".day-btn", $("#gym-day-picker")).forEach((btn) => {
  btn.addEventListener("click", async () => {
    const day = btn.dataset.day;
    if (gymDaySelection.has(day)) gymDaySelection.delete(day);
    else gymDaySelection.add(day);
    btn.classList.toggle("active", gymDaySelection.has(day));
    updateDayConflictWarning();
    await saveDaySelections();
  });
});

$$(".day-btn", $("#run-day-picker")).forEach((btn) => {
  btn.addEventListener("click", async () => {
    const day = btn.dataset.day;
    if (runDaySelection.has(day)) runDaySelection.delete(day);
    else runDaySelection.add(day);
    btn.classList.toggle("active", runDaySelection.has(day));
    updateDayConflictWarning();
    await saveDaySelections();
  });
});

/* ---------------- workout tab: stats charts ---------------- */

const LB_TO_KG = 0.453592;

function toKg(set) {
  return set.unit === "lb" ? set.weight * LB_TO_KG : set.weight;
}

let statsEquipmentCache = [];

async function populateStatsEquipmentSelect() {
  statsEquipmentCache = await db.getEquipmentList();
  const select = $("#stats-equipment-select");
  const prevValue = select.value;
  select.innerHTML = statsEquipmentCache.length
    ? statsEquipmentCache.map((e) => `<option value="${e.id}">${e.name} (${e.category})</option>`).join("")
    : `<option value="">등록된 기구가 없어요</option>`;
  if (statsEquipmentCache.some((e) => String(e.id) === prevValue)) {
    select.value = prevValue;
  }
}

async function renderMaxWeightChart() {
  const canvas = $("#chart-max-weight");
  const equipmentId = Number($("#stats-equipment-select").value);
  const equipment = statsEquipmentCache.find((e) => e.id === equipmentId);
  if (!equipment) {
    drawLineChart(canvas, [], []);
    return;
  }

  const allLogs = await db.getAllWorkoutLogs();
  const points = allLogs
    .filter((l) => l.type === "weight" && l.equipmentName === equipment.name)
    .map((log) => {
      const weightsKg = log.sets.filter((s) => s.unit !== "none").map(toKg);
      if (!weightsKg.length) return null;
      return { date: log.date, maxWeight: Math.max(...weightsKg) };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const recent = points.slice(-20);
  drawLineChart(
    canvas,
    recent.map((p) => p.date.slice(5)),
    recent.map((p) => Math.round(p.maxWeight * 10) / 10),
    { color: "#00e5a0", unit: "kg" }
  );
}

async function renderWeeklyVolumeChart() {
  const allLogs = await db.getAllWorkoutLogs();
  const weightLogs = allLogs.filter((l) => l.type === "weight");

  const volumeByWeek = new Map();
  for (const log of weightLogs) {
    const logDate = new Date(`${log.date}T00:00:00`);
    const weekStart = new Date(logDate);
    weekStart.setDate(logDate.getDate() - logDate.getDay());
    const weekKey = formatDate(weekStart);

    let logVolume = 0;
    for (const set of log.sets) {
      if (set.unit === "none") continue;
      logVolume += toKg(set) * set.reps;
    }
    volumeByWeek.set(weekKey, (volumeByWeek.get(weekKey) || 0) + logVolume);
  }

  const now = new Date();
  const currentWeekStart = new Date(now);
  currentWeekStart.setDate(now.getDate() - now.getDay());

  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const ws = new Date(currentWeekStart);
    ws.setDate(currentWeekStart.getDate() - i * 7);
    const key = formatDate(ws);
    weeks.push({ label: `${ws.getMonth() + 1}/${ws.getDate()}주`, volume: volumeByWeek.get(key) || 0 });
  }

  drawBarChart(
    $("#chart-weekly-volume"),
    weeks.map((w) => w.label),
    weeks.map((w) => Math.round(w.volume)),
    { color: "#00e5a0", unit: "kg" }
  );
}

async function renderWorkoutStats() {
  await populateStatsEquipmentSelect();
  await renderMaxWeightChart();
  await renderWeeklyVolumeChart();
}

$("#stats-equipment-select").addEventListener("change", renderMaxWeightChart);

function renderStoredRoutine(routine) {
  const textEl = $("#routine-text");
  const updatedEl = $("#routine-updated-at");
  if (!routine || !routine.text) {
    textEl.textContent = "아직 추천받은 루틴이 없어요. 위 버튼을 눌러 이번 주 루틴을 받아보세요.";
    updatedEl.textContent = "";
    return;
  }
  textEl.textContent = routine.text;
  const updated = new Date(routine.generatedAt);
  updatedEl.textContent = `마지막 업데이트: ${updated.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function renderWorkoutLogList(logs) {
  const container = $("#workout-log-list");
  if (!logs.length) {
    container.innerHTML = `<p class="empty-hint">오늘 기록된 운동이 없어요.</p>`;
    return;
  }
  container.innerHTML = "";
  logs
    .slice()
    .sort((a, b) => b.id - a.id)
    .forEach((log) => {
      const div = document.createElement("div");
      div.className = "log-item";
      if (log.type === "weight") {
        div.innerHTML = `
          <div class="log-main">
            <span class="log-title">${log.equipmentName}</span>
            <span class="log-sub">${log.sets.length}세트 · ${formatSetsSummary(log.sets)}</span>
          </div>
          <button class="log-delete" data-id="${log.id}">✕</button>`;
      } else {
        div.innerHTML = `
          <div class="log-main">
            <span class="log-title">러닝</span>
            <span class="log-sub">${log.distance}km · ${log.duration}분 · ${log.pace}분/km</span>
          </div>
          <button class="log-delete" data-id="${log.id}">✕</button>`;
      }
      container.appendChild(div);
    });

  $$(".log-delete", container).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("정말 삭제할까요?")) return;
      await db.deleteWorkoutLog(Number(btn.dataset.id));
      const refreshed = await db.getWorkoutLogsByDate(todayStr());
      renderWorkoutLogList(refreshed);
      renderHomeWorkoutSummary(refreshed);
    });
  });
}

/* AI weekly routine recommendation */
$("#btn-recommend-routine").addEventListener("click", async () => {
  const btn = $("#btn-recommend-routine");
  const gymDays = DAY_LABELS.filter((d) => gymDaySelection.has(d));
  const runDays = DAY_LABELS.filter((d) => runDaySelection.has(d));

  if (!gymDays.length && !runDays.length) {
    showToast("헬스장 또는 러닝 요일을 선택해주세요");
    return;
  }

  btn.disabled = true;
  btn.textContent = "추천 받는 중...";

  const textEl = $("#routine-text");
  const updatedEl = $("#routine-updated-at");
  textEl.textContent = "";
  updatedEl.textContent = "";

  try {
    const apiKey = await db.getSetting("geminiApiKey", "");
    const equipmentList = await db.getEquipmentList();
    const recentLogs = await db.getRecentWorkoutLogs(3);
    const goals = await db.getSetting("fitnessGoals", null);
    const inbodyRecords = await db.getAllInbodyRecords();
    const latestInbody = inbodyRecords.length ? inbodyRecords[inbodyRecords.length - 1] : null;

    const text = await streamRoutineRecommendation(
      apiKey,
      { equipmentList, recentLogs, goals, latestInbody, gymDays, runDays },
      (_delta, fullTextSoFar) => {
        textEl.textContent = fullTextSoFar;
      }
    );

    const routine = { text, generatedAt: Date.now() };
    await db.setSetting("weeklyRoutine", routine);
    renderStoredRoutine(routine);
    showToast("이번 주 루틴이 갱신되었어요");
  } catch (err) {
    showToast(err.message || "루틴 추천에 실패했어요.");
    renderStoredRoutine(await db.getSetting("weeklyRoutine", null));
  } finally {
    btn.disabled = false;
    btn.textContent = "📅 이번 주 루틴 받기";
  }
});

/* add workout modal */
const modalAddWorkout = $("#modal-add-workout");

$("#btn-add-workout").addEventListener("click", () => {
  modalAddWorkout.hidden = false;
});

/* weight sets (in-progress entry before "운동 완료") */
let currentSets = [];
let currentSetUnit = "kg";

function updateEquipmentLock() {
  $("#weight-equipment").disabled = currentSets.length > 0;
}

function renderSetList() {
  const container = $("#set-list");
  container.innerHTML = "";
  currentSets.forEach((set, i) => {
    const div = document.createElement("div");
    div.className = "log-item";
    div.innerHTML = `
      <div class="log-main">
        <span class="log-title">세트 ${i + 1}</span>
        <span class="log-sub">${formatSet(set)}</span>
      </div>
      <button type="button" class="log-delete" data-index="${i}">✕</button>`;
    container.appendChild(div);
  });
  $$(".log-delete", container).forEach((btn) => {
    btn.addEventListener("click", () => {
      currentSets.splice(Number(btn.dataset.index), 1);
      renderSetList();
      updateEquipmentLock();
    });
  });
}

function resetSetEntryState() {
  currentSets = [];
  currentSetUnit = "kg";
  $("#set-entry").hidden = true;
  $$(".segmented-btn", $("#weight-unit-toggle")).forEach((b) => b.classList.toggle("active", b.dataset.unit === "kg"));
  $("#set-weight-label").hidden = false;
  $("#set-weight").value = "";
  $("#set-reps").value = "";
  renderSetList();
  updateEquipmentLock();
}

function closeAddWorkoutModal() {
  modalAddWorkout.hidden = true;
  resetSetEntryState();
  $("#form-running").reset();
  $("#running-pace-preview").textContent = "-";
}

$("#btn-cancel-weight").addEventListener("click", closeAddWorkoutModal);
$("#btn-cancel-running").addEventListener("click", closeAddWorkoutModal);

$$(".segmented-btn", $("#workout-type-toggle")).forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".segmented-btn", $("#workout-type-toggle")).forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const type = btn.dataset.type;
    $("#form-weight").hidden = type !== "weight";
    $("#form-running").hidden = type !== "running";
  });
});

$("#btn-add-set").addEventListener("click", () => {
  $("#set-entry").hidden = false;
});

$$(".segmented-btn", $("#weight-unit-toggle")).forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".segmented-btn", $("#weight-unit-toggle")).forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentSetUnit = btn.dataset.unit;
    const isNone = currentSetUnit === "none";
    $("#set-weight-label").hidden = isNone;
    if (isNone) $("#set-weight").value = "";
  });
});

$("#btn-record-set").addEventListener("click", () => {
  const reps = Number($("#set-reps").value);
  if (!(reps > 0)) {
    showToast("횟수를 입력해주세요");
    return;
  }
  let weight = null;
  if (currentSetUnit !== "none") {
    weight = Number($("#set-weight").value);
    if (!(weight > 0)) {
      showToast("무게를 입력해주세요");
      return;
    }
  }
  currentSets.push({ weight, unit: currentSetUnit, reps });
  renderSetList();
  updateEquipmentLock();
  $("#set-weight").value = "";
  $("#set-reps").value = "";
});

$("#btn-finish-weight").addEventListener("click", async () => {
  const equipmentId = Number($("#weight-equipment").value);
  const equipment = equipmentCache.find((eq) => eq.id === equipmentId);
  if (!equipment) {
    showToast("기구를 먼저 설정 탭에서 등록해주세요.");
    return;
  }
  if (!currentSets.length) {
    showToast("세트를 먼저 기록해주세요.");
    return;
  }

  const log = {
    date: todayStr(),
    type: "weight",
    equipmentName: equipment.name,
    category: equipment.category,
    sets: currentSets.map((s) => ({ ...s })),
    createdAt: Date.now(),
  };
  await db.addWorkoutLog(log);
  closeAddWorkoutModal();
  const logs = await db.getWorkoutLogsByDate(todayStr());
  renderWorkoutLogList(logs);
  renderHomeWorkoutSummary(logs);
  showToast("운동이 기록되었어요");

  $("#rest-timer-card").hidden = false;
  restTimer.reset();
});

$("#running-distance").addEventListener("input", updateRunningPacePreview);
$("#running-duration").addEventListener("input", updateRunningPacePreview);

function updateRunningPacePreview() {
  const distance = Number($("#running-distance").value);
  const duration = Number($("#running-duration").value);
  if (distance > 0 && duration > 0) {
    $("#running-pace-preview").textContent = (duration / distance).toFixed(2);
  } else {
    $("#running-pace-preview").textContent = "-";
  }
}

$("#form-running").addEventListener("submit", async (e) => {
  e.preventDefault();
  const distance = Number($("#running-distance").value);
  const duration = Number($("#running-duration").value);
  if (!(distance > 0)) {
    showToast("거리를 입력해주세요");
    return;
  }
  const pace = Number((duration / distance).toFixed(2));

  const log = {
    date: todayStr(),
    type: "running",
    distance,
    duration,
    pace,
    createdAt: Date.now(),
  };
  await db.addWorkoutLog(log);
  closeAddWorkoutModal();
  const logs = await db.getWorkoutLogsByDate(todayStr());
  renderWorkoutLogList(logs);
  renderHomeWorkoutSummary(logs);
  showToast("러닝이 기록되었어요");
});

/* rest timer controls */
$("#btn-timer-toggle").addEventListener("click", () => {
  const btn = $("#btn-timer-toggle");
  if (restTimer.running) {
    restTimer.pause();
    btn.textContent = "시작";
  } else {
    restTimer.start();
    btn.textContent = "일시정지";
  }
});
$("#btn-timer-plus").addEventListener("click", () => restTimer.addSeconds(15));
$("#btn-timer-minus").addEventListener("click", () => restTimer.addSeconds(-15));
$("#btn-timer-reset").addEventListener("click", async () => {
  const restSeconds = await db.getSetting("defaultRestSeconds", 90);
  restTimer.reset(restSeconds);
  $("#btn-timer-toggle").textContent = "시작";
});

/* ---------------- inbody tab ---------------- */

const INBODY_METRIC_LABELS = {
  weight: "체중",
  bodyFat: "체지방률",
  muscleMass: "골격근량",
  bmi: "BMI",
  visceralFat: "내장지방레벨",
};

let selectedInbodyMetric = "weight";
let inbodyRecordsCache = [];

function renderInbodyChart() {
  const metric = selectedInbodyMetric;
  const unit = $(`.pill[data-metric="${metric}"]`, $("#inbody-metric-tabs")).dataset.unit;
  $("#inbody-chart-title").textContent = `${INBODY_METRIC_LABELS[metric]} 변화`;

  const recent = inbodyRecordsCache.slice(-10);
  drawLineChart(
    $("#chart-inbody"),
    recent.map((r) => r.date.slice(5)),
    recent.map((r) => r[metric]),
    { color: "#00e5a0", unit }
  );
}

$$(".pill", $("#inbody-metric-tabs")).forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".pill", $("#inbody-metric-tabs")).forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedInbodyMetric = btn.dataset.metric;
    renderInbodyChart();
  });
});

async function renderInbodyTab() {
  if (!$("#inbody-date").value) $("#inbody-date").value = todayStr();
  inbodyRecordsCache = await db.getAllInbodyRecords();
  renderInbodyList(inbodyRecordsCache);
  renderInbodyChart();
}

function renderInbodyList(records) {
  const container = $("#inbody-list");
  if (!records.length) {
    container.innerHTML = `<p class="empty-hint">아직 기록이 없어요.</p>`;
    return;
  }
  container.innerHTML = "";
  records
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .forEach((r) => {
      const div = document.createElement("div");
      div.className = "log-item";
      div.innerHTML = `
        <div class="log-main">
          <span class="log-title">${r.date}</span>
          <span class="log-sub">체중 ${r.weight}kg · 체지방 ${r.bodyFat}% · 골격근 ${r.muscleMass}kg · BMI ${r.bmi} · 내장지방 ${r.visceralFat}</span>
        </div>
        <button class="log-delete" data-id="${r.id}">✕</button>`;
      container.appendChild(div);
    });

  $$(".log-delete", container).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("정말 삭제할까요?")) return;
      await db.deleteInbodyRecord(Number(btn.dataset.id));
      renderInbodyTab();
    });
  });
}

$("#inbody-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const record = {
    date: $("#inbody-date").value,
    weight: Number($("#inbody-weight").value),
    bodyFat: Number($("#inbody-fat").value),
    muscleMass: Number($("#inbody-muscle").value),
    bmi: Number($("#inbody-bmi").value),
    visceralFat: Number($("#inbody-visceral").value),
  };
  await db.addInbodyRecord(record);
  $("#inbody-form").reset();
  await renderInbodyTab();
  showToast("인바디 기록이 추가되었어요");
});

/* default equipment seeded on first run (when equipment store is empty) */
const DEFAULT_EQUIPMENT = [
  { name: "스미스머신1", category: "하체" },
  { name: "스미스머신2", category: "하체" },
  { name: "스미스머신3", category: "하체" },
  { name: "스미스머신4", category: "하체" },
  { name: "스미스머신5", category: "하체" },
  { name: "스미스머신6", category: "하체" },
  { name: "로우머신", category: "등" },
  { name: "사레레머신", category: "어깨" },
  { name: "이두컬머신", category: "팔" },
  { name: "햄머하이로우머신", category: "등" },
  { name: "프론트랫풀다운머신", category: "등" },
  { name: "랫풀다운머신", category: "등" },
  { name: "어시스트풀업/딥스", category: "등" },
  { name: "시티드로우머신A", category: "등" },
  { name: "시티드로우머신B", category: "등" },
  { name: "로우로우머신", category: "등" },
  { name: "티바로우", category: "등" },
  { name: "백익스텐션", category: "등" },
  { name: "Level로우", category: "등" },
  { name: "체스트프레스머신", category: "가슴" },
  { name: "시티드체스트머신", category: "가슴" },
  { name: "인클라인체스트프레스머신", category: "가슴" },
  { name: "팩덱플라이", category: "가슴" },
  { name: "듀얼시스템체스트프레스", category: "가슴" },
  { name: "Pectoral machine", category: "가슴" },
  { name: "레터럴레이즈머신", category: "어깨" },
  { name: "숄더프레스머신A", category: "어깨" },
  { name: "숄더프레스머신B", category: "어깨" },
  { name: "라잉레그컬", category: "하체" },
  { name: "레그익스텐션", category: "하체" },
  { name: "이너/아웃타이머신", category: "하체" },
  { name: "스쿼트머신", category: "하체" },
  { name: "티스쿼트", category: "하체" },
  { name: "핵스쿼트", category: "하체" },
  { name: "글루트머신(힙)", category: "하체" },
  { name: "이지바", category: "팔" },
  { name: "플랩바", category: "팔" },
];

/* ---------------- settings tab ---------------- */

async function renderSettingsTab() {
  $("#gemini-api-key").value = await db.getSetting("geminiApiKey", "");
  $("#default-rest-seconds").value = await db.getSetting("defaultRestSeconds", 90);

  const goals = await db.getSetting("fitnessGoals", {});
  $("#goal-current-weight").value = goals.currentWeight ?? "";
  $("#goal-target-weight").value = goals.targetWeight ?? "";
  $("#goal-target-fat").value = goals.targetBodyFat ?? "";
  $("#goal-target-muscle").value = goals.targetMuscleMass ?? "";
  $("#goal-note").value = goals.note ?? "";

  await renderEquipmentList();
}

let settingsEquipmentCache = [];

async function renderEquipmentList() {
  settingsEquipmentCache = await db.getEquipmentList();
  const container = $("#equipment-list");
  if (!settingsEquipmentCache.length) {
    container.innerHTML = `<p class="empty-hint">등록된 기구가 없어요.</p>`;
    return;
  }
  container.innerHTML = "";
  settingsEquipmentCache.forEach((eq) => {
    const div = document.createElement("div");
    div.className = "log-item equipment-item";
    const thumb = eq.photo
      ? `<img class="equipment-thumb" src="${eq.photo}" alt="${eq.name}" />`
      : `<div class="equipment-thumb equipment-thumb-placeholder">🏋️</div>`;
    div.innerHTML = `
      ${thumb}
      <div class="log-main">
        <span class="log-title">${eq.name}</span>
        <span class="log-sub">${eq.category}${eq.memo ? ` · ${eq.memo}` : ""}</span>
      </div>
      <div class="equipment-item-actions">
        <button type="button" class="icon-btn equipment-edit" data-id="${eq.id}">✏️</button>
        <button type="button" class="icon-btn equipment-delete" data-id="${eq.id}">🗑️</button>
      </div>`;
    container.appendChild(div);
  });

  $$(".equipment-delete", container).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("정말 삭제할까요?")) return;
      await db.deleteEquipment(Number(btn.dataset.id));
      await renderEquipmentList();
    });
  });

  $$(".equipment-edit", container).forEach((btn) => {
    btn.addEventListener("click", () => openEditEquipmentModal(Number(btn.dataset.id)));
  });
}

/* equipment edit modal */
let editingEquipmentId = null;
let pendingEditPhoto;

function openEditEquipmentModal(id) {
  const eq = settingsEquipmentCache.find((e) => e.id === id);
  if (!eq) return;
  editingEquipmentId = id;
  pendingEditPhoto = undefined;

  $("#edit-equipment-name").value = eq.name;
  $("#edit-equipment-category").value = eq.category;
  $("#edit-equipment-memo").value = eq.memo || "";

  const preview = $("#edit-equipment-photo-preview");
  if (eq.photo) {
    preview.src = eq.photo;
    preview.hidden = false;
  } else {
    preview.src = "";
    preview.hidden = true;
  }

  $("#modal-edit-equipment").hidden = false;
}

function closeEditEquipmentModal() {
  $("#modal-edit-equipment").hidden = true;
  editingEquipmentId = null;
  pendingEditPhoto = undefined;
  $("#form-edit-equipment").reset();
  $("#edit-equipment-photo-preview").hidden = true;
}

$("#btn-cancel-edit-equipment").addEventListener("click", closeEditEquipmentModal);

$("#btn-edit-equipment-photo").addEventListener("click", () => {
  $("#edit-equipment-photo-input").click();
});

$("#edit-equipment-photo-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingEditPhoto = reader.result;
    const preview = $("#edit-equipment-photo-preview");
    preview.src = reader.result;
    preview.hidden = false;
  };
  reader.readAsDataURL(file);
});

$("#form-edit-equipment").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (editingEquipmentId == null) return;
  const name = $("#edit-equipment-name").value.trim();
  if (!name) return;
  const category = $("#edit-equipment-category").value;
  const memo = $("#edit-equipment-memo").value.trim();
  const existing = settingsEquipmentCache.find((eItem) => eItem.id === editingEquipmentId);
  const photo = pendingEditPhoto !== undefined ? pendingEditPhoto : existing?.photo ?? null;

  await db.updateEquipment(editingEquipmentId, { name, category, memo, photo });
  closeEditEquipmentModal();
  await renderEquipmentList();
  showToast("기구가 수정되었어요");
});

$("#goals-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const goals = {
    currentWeight: Number($("#goal-current-weight").value) || null,
    targetWeight: Number($("#goal-target-weight").value) || null,
    targetBodyFat: Number($("#goal-target-fat").value) || null,
    targetMuscleMass: Number($("#goal-target-muscle").value) || null,
    note: $("#goal-note").value.trim(),
  };
  await db.setSetting("fitnessGoals", goals);
  showToast("목표가 저장되었어요");
});

$("#api-key-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = sanitizeApiKey($("#gemini-api-key").value);
  await db.setSetting("geminiApiKey", key);
  $("#gemini-api-key").value = key;
  showToast("API 키가 저장되었어요");
});

$("#rest-time-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const seconds = Number($("#default-rest-seconds").value) || 90;
  await db.setSetting("defaultRestSeconds", seconds);
  showToast("기본 쉬는시간이 저장되었어요");
});

let pendingAddPhoto = null;

$("#btn-equipment-photo").addEventListener("click", () => {
  $("#equipment-photo-input").click();
});

$("#equipment-photo-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingAddPhoto = reader.result;
    const preview = $("#equipment-photo-preview");
    preview.src = reader.result;
    preview.hidden = false;
  };
  reader.readAsDataURL(file);
});

$("#equipment-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#equipment-name").value.trim();
  const category = $("#equipment-category").value;
  const memo = $("#equipment-memo").value.trim();
  if (!name) return;
  await db.addEquipment({ name, category, memo, photo: pendingAddPhoto });
  $("#equipment-form").reset();
  pendingAddPhoto = null;
  $("#equipment-photo-preview").hidden = true;
  $("#equipment-photo-preview").src = "";
  await renderEquipmentList();
  showToast("기구가 추가되었어요");
});

/* data backup / restore */
$("#btn-export-data").addEventListener("click", async () => {
  try {
    const data = await db.exportAllData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `healthnote_backup_${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("데이터를 내보냈어요");
  } catch (err) {
    showToast("내보내기에 실패했어요");
  }
});

$("#btn-import-data").addEventListener("click", () => {
  $("#import-file-input").click();
});

$("#import-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    showToast("올바른 JSON 파일이 아니에요");
    return;
  }

  const isValid = data && db.STORE_NAMES.every((key) => Array.isArray(data[key]));
  if (!isValid) {
    showToast("백업 파일 형식이 올바르지 않아요");
    return;
  }

  if (!confirm("현재 데이터를 덮어씁니다. 계속할까요?")) return;

  await db.importAllData(data);
  showToast("가져오기 완료! 앱을 새로고침합니다.");
  setTimeout(() => location.reload(), 1500);
});

/* ---------------- init ---------------- */

function initTopbarDate() {
  const d = new Date();
  $("#topbar-date").textContent = d.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

async function init() {
  initTopbarDate();
  await db.seedDefaultEquipmentIfEmpty(DEFAULT_EQUIPMENT);
  await renderHomeTab();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
