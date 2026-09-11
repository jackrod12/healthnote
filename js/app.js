import * as db from "./db.js";
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
const LAST_TAB_KEY = "lastTab";

function switchTab(target) {
  $$(".view").forEach((v) => (v.hidden = v.dataset.view !== target));
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.target === target));
  $("#topbar-title").textContent = TAB_TITLES[target];
  try {
    localStorage.setItem(LAST_TAB_KEY, target);
  } catch {}
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

function renderMonthActivityStats(monthLogs, monthDrinkLogs) {
  const weightCount = monthLogs.filter((l) => l.type === "weight").length;
  const runningCount = monthLogs.filter((l) => l.type === "running").length;
  const drinkCount = monthDrinkLogs.filter((d) => d.type === "drink" || d.type === "light").length;
  const proteinCount = monthDrinkLogs.filter((d) => d.type === "protein").length;

  $("#month-activity-stats").innerHTML = `
    <div class="activity-stat-item"><span>💪 웨이트 운동</span><span>${weightCount}회</span></div>
    <div class="activity-stat-item"><span>🏃 유산소 운동</span><span>${runningCount}회</span></div>
    <div class="activity-stat-item"><span>🍺 음주 (반주 포함)</span><span>${drinkCount}회</span></div>
    <div class="activity-stat-item"><span>🥤 프로틴 섭취</span><span>${proteinCount}회</span></div>
  `;
}

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
  const [monthLogs, monthDrinkLogs] = await Promise.all([
    db.getWorkoutLogsBetween(monthStartStr, monthEndExclusiveStr),
    db.getDrinkLogsBetween(monthStartStr, monthEndExclusiveStr),
  ]);

  renderMonthActivityStats(monthLogs, monthDrinkLogs);

  const dayInfo = new Map();
  const dayInfoFor = (date) => {
    let info = dayInfo.get(date);
    if (!info) {
      info = { weight: false, running: false, drink: null, protein: false };
      dayInfo.set(date, info);
    }
    return info;
  };
  monthLogs.forEach((l) => {
    const info = dayInfoFor(l.date);
    if (l.type === "weight") info.weight = true;
    if (l.type === "running") info.running = true;
  });
  monthDrinkLogs.forEach((d) => {
    const info = dayInfoFor(d.date);
    if (d.type === "drink" || d.type === "light") info.drink = d.type;
    if (d.type === "protein") info.protein = true;
  });

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
    const info = dayInfo.get(dateString);
    const cell = document.createElement("div");
    cell.className = "calendar-cell" + (dateString === todayString ? " today" : "");

    let dots = "";
    if (info) {
      if (info.weight) dots += '<span class="calendar-dot dot-weight"></span>';
      if (info.running) dots += '<span class="calendar-dot dot-running"></span>';
      if (info.drink === "drink") dots += '<span class="calendar-dot dot-drink"></span>';
      if (info.drink === "light") dots += '<span class="calendar-dot dot-light"></span>';
      if (info.protein) dots += '<span class="calendar-dot dot-protein"></span>';
    }

    cell.innerHTML = `
      <span class="calendar-day-num">${day}</span>
      ${dots ? `<span class="calendar-dots">${dots}</span>` : ""}
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

let currentDetailDate = null;

function updateDrinkToggleButtons(records) {
  const types = new Set(records.map((r) => r.type));
  $("#btn-toggle-drink").classList.toggle("active", types.has("drink"));
  $("#btn-toggle-light").classList.toggle("active", types.has("light"));
  $("#btn-toggle-protein").classList.toggle("active", types.has("protein"));
}

async function showDayDetail(dateString) {
  currentDetailDate = dateString;
  const logs = await db.getWorkoutLogsByDate(dateString);
  const drinkRecords = await db.getDrinkLogsByDate(dateString);
  $("#calendar-day-detail").hidden = false;
  $("#calendar-day-title").textContent = `${dateString} 운동 내역`;
  updateDrinkToggleButtons(drinkRecords);

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

async function toggleDrinkType(type) {
  if (!currentDetailDate) return;
  const records = await db.getDrinkLogsByDate(currentDetailDate);
  const existing = records.find((r) => r.type === type);
  if (existing) {
    await db.deleteDrinkLogById(existing.id);
  } else {
    if (type === "drink" || type === "light") {
      const conflicting = records.find((r) => r.type === "drink" || r.type === "light");
      if (conflicting) await db.deleteDrinkLogById(conflicting.id);
    }
    await db.addDrinkLog(currentDetailDate, type);
  }
  updateDrinkToggleButtons(await db.getDrinkLogsByDate(currentDetailDate));
  await renderCalendar();
}

$("#btn-toggle-drink").addEventListener("click", () => toggleDrinkType("drink"));
$("#btn-toggle-light").addEventListener("click", () => toggleDrinkType("light"));
$("#btn-toggle-protein").addEventListener("click", () => toggleDrinkType("protein"));

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

const DEFAULT_REST_SECONDS = 90;

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
  if (!restTimer) initRestTimer();
  if (!restTimer.active) {
    restTimer.setDuration(DEFAULT_REST_SECONDS);
  }
  $("#timer-display").textContent = RestTimer.formatTime(restTimer.remaining);

  const logs = await db.getWorkoutLogsByDate(todayStr());
  await renderWorkoutLogList(logs);

  await renderWorkoutStats();
}

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
    weeks.push({ label: `${ws.getMonth() + 1}/${ws.getDate()}`, volume: volumeByWeek.get(key) || 0 });
  }

  drawBarChart(
    $("#chart-weekly-volume"),
    weeks.map((w) => w.label),
    weeks.map((w) => Math.round(w.volume)),
    { color: "#00e5a0", unit: "kg" }
  );
}

/* estimated calories: strength training uses total volume(kg) x 0.05 x (body weight / 70),
   running uses MET x body weight(kg) x time(hours), with MET derived from pace(분/km) */
const CALORIES_PER_KG_VOLUME = 0.05;
const DEFAULT_BODY_WEIGHT_KG = 70;

function calcLogVolume(log) {
  if (log.type !== "weight") return 0;
  return log.sets
    .filter((s) => s.unit !== "none")
    .reduce((sum, s) => sum + toKg(s) * s.reps, 0);
}

function calcCaloriesFromVolume(volume, bodyWeightKg) {
  return volume * CALORIES_PER_KG_VOLUME * (bodyWeightKg / DEFAULT_BODY_WEIGHT_KG);
}

async function getLatestBodyWeightKg() {
  const records = await db.getAllInbodyRecords();
  if (!records.length) return DEFAULT_BODY_WEIGHT_KG;
  return records[records.length - 1].weight ?? DEFAULT_BODY_WEIGHT_KG;
}

function getRunningMET(pace) {
  if (pace > 7) return 8.0;
  if (pace >= 6) return 10.0;
  if (pace >= 5) return 11.5;
  if (pace >= 4) return 13.5;
  return 16.0;
}

function calcRunningCalories(log, bodyWeightKg) {
  const met = getRunningMET(log.pace);
  const hours = log.duration / 60;
  return met * bodyWeightKg * hours;
}

async function renderEquipmentLogTable() {
  const container = $("#equipment-log-table");
  const equipmentId = Number($("#stats-equipment-select").value);
  const equipment = statsEquipmentCache.find((e) => e.id === equipmentId);
  if (!equipment) {
    container.innerHTML = `<p class="empty-hint">데이터가 없어요</p>`;
    return;
  }

  const allLogs = await db.getAllWorkoutLogs();
  const logs = allLogs
    .filter((l) => l.type === "weight" && l.equipmentName === equipment.name)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  if (!logs.length) {
    container.innerHTML = `<p class="empty-hint">이 기구의 운동 기록이 없어요.</p>`;
    return;
  }

  const bodyWeightKg = await getLatestBodyWeightKg();
  const rows = logs
    .map((log) => {
      const volume = calcLogVolume(log);
      const calories = calcCaloriesFromVolume(volume, bodyWeightKg);
      return `
        <tr>
          <td>${log.date}</td>
          <td>${formatSetsSummary(log.sets)}</td>
          <td>${Math.round(volume)}kg</td>
          <td>${Math.round(calories)}kcal</td>
        </tr>`;
    })
    .join("");

  container.innerHTML = `
    <table class="log-table">
      <thead>
        <tr><th>날짜</th><th>세트</th><th>총 볼륨</th><th>추정 칼로리</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function renderWorkoutStats() {
  await populateStatsEquipmentSelect();
  await renderMaxWeightChart();
  await renderEquipmentLogTable();
  await renderWeeklyVolumeChart();
}

$("#stats-equipment-select").addEventListener("change", () => {
  renderMaxWeightChart();
  renderEquipmentLogTable();
});

async function renderWorkoutLogList(logs) {
  const container = $("#workout-log-list");
  const totalsEl = $("#workout-log-totals");
  if (!logs.length) {
    container.innerHTML = `<p class="empty-hint">오늘 기록된 운동이 없어요.</p>`;
    totalsEl.hidden = true;
    return;
  }
  container.innerHTML = "";
  let totalVolume = 0;
  let totalCalories = 0;
  const bodyWeightKg = await getLatestBodyWeightKg();

  logs
    .slice()
    .sort((a, b) => b.id - a.id)
    .forEach((log) => {
      const div = document.createElement("div");
      div.className = "log-item";
      if (log.type === "weight") {
        const volume = calcLogVolume(log);
        const calories = calcCaloriesFromVolume(volume, bodyWeightKg);
        totalVolume += volume;
        totalCalories += calories;
        div.innerHTML = `
          <div class="log-main">
            <span class="log-title">${log.equipmentName}</span>
            <span class="log-sub">${log.sets.length}세트 · ${formatSetsSummary(log.sets)}</span>
            <span class="log-sub">볼륨 ${Math.round(volume)}kg · 칼로리 ${Math.round(calories)}kcal</span>
          </div>
          <button class="log-delete" data-id="${log.id}">✕</button>`;
      } else {
        const calories = calcRunningCalories(log, bodyWeightKg);
        totalCalories += calories;
        div.innerHTML = `
          <div class="log-main">
            <span class="log-title">러닝</span>
            <span class="log-sub">${log.distance}km · ${log.duration}분 · ${log.pace}분/km</span>
          </div>
          <button class="log-delete" data-id="${log.id}">✕</button>`;
      }
      container.appendChild(div);
    });

  totalsEl.hidden = false;
  totalsEl.innerHTML = `
    <div>오늘 총 볼륨 ${Math.round(totalVolume)}kg</div>
    <div>오늘 총 소모 칼로리: 약 ${Math.round(totalCalories)}kcal</div>
  `;

  $$(".log-delete", container).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("정말 삭제할까요?")) return;
      await db.deleteWorkoutLog(Number(btn.dataset.id));
      const refreshed = await db.getWorkoutLogsByDate(todayStr());
      await renderWorkoutLogList(refreshed);
      renderHomeWorkoutSummary(refreshed);
    });
  });
}

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
  await renderWorkoutLogList(logs);
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
  await renderWorkoutLogList(logs);
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
$("#btn-timer-reset").addEventListener("click", () => {
  restTimer.reset(DEFAULT_REST_SECONDS);
  $("#btn-timer-toggle").textContent = "시작";
});

/* ---------------- inbody tab ---------------- */

const INBODY_METRIC_LABELS = {
  weight: "체중",
  muscleMass: "골격근량",
  bodyFatMass: "체지방량",
  bmi: "BMI",
  bodyFat: "체지방률",
  waistHipRatio: "복부비만률",
  visceralFat: "내장지방레벨",
  inbodyScore: "인바디점수",
};

let selectedInbodyMetric = "weight";
let inbodyRecordsCache = [];

/* metric -> fitnessGoals key, used for the chart's y-axis lower bound */
const INBODY_METRIC_GOAL_KEYS = {
  weight: "targetWeight",
  bodyFat: "targetBodyFat",
  muscleMass: "targetMuscleMass",
};

async function getInbodyMetricGoal(metric) {
  const goalKey = INBODY_METRIC_GOAL_KEYS[metric];
  if (!goalKey) return null;
  const goals = await db.getSetting("fitnessGoals", null);
  return goals?.[goalKey] ?? null;
}

async function renderInbodyChart() {
  const metric = selectedInbodyMetric;
  const unit = $(`.pill[data-metric="${metric}"]`, $("#inbody-metric-tabs")).dataset.unit;
  $("#inbody-chart-title").textContent = `${INBODY_METRIC_LABELS[metric]} 변화`;

  const withMetric = inbodyRecordsCache.filter((r) => r[metric] !== null && r[metric] !== undefined);
  const recent = withMetric.slice(-10);
  const values = recent.map((r) => r[metric]);

  let yMin;
  let yMax;
  if (values.length) {
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const goal = await getInbodyMetricGoal(metric);
    const minBase = goal !== null && goal !== undefined ? Math.min(dataMin, goal) : dataMin;
    yMin = minBase * 0.95;
    yMax = dataMax * 1.05;
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
  }

  drawLineChart(
    $("#chart-inbody"),
    recent.map((r) => r.date.slice(5)),
    values,
    { color: "#00e5a0", unit, yMin, yMax }
  );
}

$$(".pill", $("#inbody-metric-tabs")).forEach((btn) => {
  btn.addEventListener("click", async () => {
    $$(".pill", $("#inbody-metric-tabs")).forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedInbodyMetric = btn.dataset.metric;
    await renderInbodyChart();
  });
});

async function renderInbodyTab() {
  if (!$("#inbody-date").value) $("#inbody-date").value = todayStr();
  inbodyRecordsCache = await db.getAllInbodyRecords();
  await renderInbodyChart();
}

/* accordion: 기록 추가 폼 펼치기/접기 */
const inbodyFormCard = $("#inbody-form-card");
const btnToggleInbodyForm = $("#btn-toggle-inbody-form");

function openInbodyForm() {
  inbodyFormCard.hidden = false;
  btnToggleInbodyForm.textContent = "닫기";
}

function closeInbodyForm() {
  inbodyFormCard.hidden = true;
  btnToggleInbodyForm.textContent = "+ 기록 추가";
}

btnToggleInbodyForm.addEventListener("click", () => {
  if (inbodyFormCard.hidden) openInbodyForm();
  else closeInbodyForm();
});

function numOrNull(value) {
  return value === "" ? null : Number(value);
}

$("#inbody-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const record = {
    date: $("#inbody-date").value,
    weight: Number($("#inbody-weight").value),
    muscleMass: Number($("#inbody-muscle").value),
    bodyFatMass: numOrNull($("#inbody-bodyfatmass").value),
    bmi: Number($("#inbody-bmi").value),
    bodyFat: Number($("#inbody-fat").value),
    waistHipRatio: numOrNull($("#inbody-whr").value),
    visceralFat: Number($("#inbody-visceral").value),
    inbodyScore: numOrNull($("#inbody-score").value),
  };
  await db.addInbodyRecord(record);
  $("#inbody-form").reset();
  closeInbodyForm();
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
      <input type="checkbox" class="equipment-checkbox" data-id="${eq.id}" />
      ${thumb}
      <div class="log-main">
        <span class="log-title">${eq.name}</span>
        ${eq.manufacturer ? `<span class="log-manufacturer">${eq.manufacturer}</span>` : ""}
        <span class="log-sub">${eq.category}${eq.memo ? ` · ${eq.memo}` : ""}</span>
      </div>
      <div class="equipment-item-actions">
        <button type="button" class="icon-btn equipment-edit" data-id="${eq.id}">✏️</button>
      </div>`;
    container.appendChild(div);
  });

  $("#equipment-select-all").checked = false;

  $$(".equipment-checkbox", container).forEach((cb) => {
    cb.addEventListener("change", () => {
      const all = $$(".equipment-checkbox", container);
      $("#equipment-select-all").checked = all.length > 0 && all.every((c) => c.checked);
    });
  });

  $$(".equipment-edit", container).forEach((btn) => {
    btn.addEventListener("click", () => openEditEquipmentModal(Number(btn.dataset.id)));
  });
}

$("#equipment-select-all").addEventListener("change", (e) => {
  $$(".equipment-checkbox").forEach((cb) => (cb.checked = e.target.checked));
});

$("#btn-delete-selected-equipment").addEventListener("click", async () => {
  const selectedIds = $$(".equipment-checkbox:checked").map((cb) => Number(cb.dataset.id));
  if (!selectedIds.length) {
    showToast("선택된 기구가 없어요");
    return;
  }
  if (!confirm(`선택한 ${selectedIds.length}개 기구를 삭제할까요?`)) return;
  for (const id of selectedIds) {
    await db.deleteEquipment(id);
  }
  await renderEquipmentList();
  showToast("선택한 기구가 삭제되었어요");
});

/* equipment edit modal */
let editingEquipmentId = null;
let pendingEditPhoto;

function openEditEquipmentModal(id) {
  const eq = settingsEquipmentCache.find((e) => e.id === id);
  if (!eq) return;
  editingEquipmentId = id;
  pendingEditPhoto = undefined;

  $("#edit-equipment-name").value = eq.name;
  $("#edit-equipment-manufacturer").value = eq.manufacturer || "";
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
  const manufacturer = $("#edit-equipment-manufacturer").value.trim();
  const category = $("#edit-equipment-category").value;
  const memo = $("#edit-equipment-memo").value.trim();
  const existing = settingsEquipmentCache.find((eItem) => eItem.id === editingEquipmentId);
  const photo = pendingEditPhoto !== undefined ? pendingEditPhoto : existing?.photo ?? null;

  await db.updateEquipment(editingEquipmentId, { name, manufacturer, category, memo, photo });
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
  const manufacturer = $("#equipment-manufacturer").value.trim();
  const category = $("#equipment-category").value;
  const memo = $("#equipment-memo").value.trim();
  if (!name) return;
  await db.addEquipment({ name, manufacturer, category, memo, photo: pendingAddPhoto });
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

function getLastTab() {
  try {
    const saved = localStorage.getItem(LAST_TAB_KEY);
    return saved && TAB_TITLES[saved] ? saved : "home";
  } catch {
    return "home";
  }
}

async function init() {
  initTopbarDate();
  await db.seedDefaultEquipmentIfEmpty(DEFAULT_EQUIPMENT);
  await db.deleteSetting("weeklyRoutinePrefs");
  await db.deleteSetting("weeklyRoutine");
  await db.deleteSetting("defaultRestSeconds");

  switchTab(getLastTab());

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
