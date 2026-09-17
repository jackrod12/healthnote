import * as db from "./db.js";
import {
  drawLineChart,
  drawMultiLineChart,
  drawPaceTrendChart,
  drawBarChart,
  attachChartClickHandler,
  formatPaceLabel,
  parsePaceLabel,
  parseMinutesSeconds,
  HR_ZONE_COLORS,
} from "./chart.js";
import { evaluateAllBadges, renderBadgeIconSvg, formatProgressText, BADGE_CATEGORIES } from "./badges.js";
import { sanitizeApiKey, parseRunningImages, generateRunningComment } from "./gemini.js";

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

const TAB_TITLES = { home: "홈", workout: "운동", inbody: "인바디", badges: "배지", settings: "설정" };
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
  if (target === "badges") renderBadgesTab();
  if (target === "settings") renderSettingsTab();
}

$$(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.target));
});

/* ---------------- new badge popup ----------------
   badges aren't stored in the DB (evaluateAllBadges recomputes them from
   scratch every time), so "new" is tracked separately via a settings key
   listing every badge id already shown to the user. Any action that can
   unlock a badge should call checkForNewBadges() afterwards. */

const SEEN_BADGE_IDS_KEY = "seenBadgeIds";
let newBadgePopupQueue = [];

async function checkForNewBadges() {
  const badges = await evaluateAllBadges();
  const achievedIds = badges.filter((b) => b.achieved).map((b) => b.id);

  const seen = await db.getSetting(SEEN_BADGE_IDS_KEY, null);
  if (seen === null) {
    // first run of this feature: baseline silently so existing achievements
    // don't all pop up as "new" at once
    await db.setSetting(SEEN_BADGE_IDS_KEY, achievedIds);
    return;
  }

  const seenSet = new Set(seen);
  const newlyAchieved = badges.filter((b) => b.achieved && !seenSet.has(b.id));
  if (!newlyAchieved.length) return;

  await db.setSetting(SEEN_BADGE_IDS_KEY, achievedIds);
  newBadgePopupQueue.push(...newlyAchieved);
  if (newBadgePopupQueue.length === newlyAchieved.length) showNextNewBadgePopup();
}

function showNextNewBadgePopup() {
  if (!newBadgePopupQueue.length) {
    $("#modal-new-badge").hidden = true;
    return;
  }
  const badge = newBadgePopupQueue.shift();
  $("#new-badge-icon").innerHTML = renderBadgeIconSvg(badge, { width: 100, height: 100 });
  $("#new-badge-name").textContent = badge.name;
  $("#new-badge-desc").textContent = badge.description;
  $("#new-badge-date").textContent = `획득일: ${formatBadgeDate(badge.achievedDate)}`;
  $("#modal-new-badge").hidden = false;
}

$("#btn-confirm-new-badge").addEventListener("click", showNextNewBadgePopup);

/* ---------------- home tab ---------------- */

async function renderHomeTab() {
  const logs = await db.getWorkoutLogsByDate(todayStr());
  renderHomeWorkoutSummary(logs);
  await renderGoalProgress();
  await renderWeightPrediction();
  await renderCalendar();
  await renderHomeCalorieStats();
}

/* ---------------- home tab: calorie stats (일간/주간/월간) ---------------- */

function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

async function renderHomeCalorieStats() {
  const bodyWeightKg = await getLatestBodyWeightKg();
  const now = new Date();
  const todayString = formatDate(now);

  const monday = getMondayOfWeek(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEndExclusive = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [todayLogs, weekLogs, monthLogs] = await Promise.all([
    db.getWorkoutLogsByDate(todayString),
    db.getWorkoutLogsBetween(formatDate(monday), formatDate(tomorrow)),
    db.getWorkoutLogsBetween(formatDate(monthStart), formatDate(monthEndExclusive)),
  ]);

  const sumCalories = (logs) => logs.reduce((sum, log) => sum + calcLogCalories(log, bodyWeightKg), 0);

  $("#home-calorie-stats").innerHTML = `
    <div class="calorie-stat-item"><span>일간</span><span>${Math.round(sumCalories(todayLogs))}kcal</span></div>
    <div class="calorie-stat-item"><span>주간</span><span>${Math.round(sumCalories(weekLogs))}kcal</span></div>
    <div class="calorie-stat-item"><span>월간</span><span>${Math.round(sumCalories(monthLogs))}kcal</span></div>
  `;
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

/* ---------------- home tab: weight goal prediction ---------------- */

function parseYmd(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatKoreanDate(date) {
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

async function renderWeightPrediction() {
  const container = $("#weight-prediction-content");
  const goals = await db.getSetting("fitnessGoals", null);
  const targetWeight = goals?.targetWeight;

  if (!targetWeight) {
    container.innerHTML = `<p class="empty-hint">설정 탭에서 목표 체중을 입력해주세요</p>`;
    return;
  }

  const records = await db.getAllInbodyRecords();
  if (!records.length) {
    container.innerHTML = `<p class="empty-hint">인바디 탭에서 첫 기록을 입력해주세요</p>`;
    return;
  }

  const latest = records[records.length - 1];
  const latestDate = parseYmd(latest.date);

  if (latest.weight <= targetWeight) {
    container.innerHTML = `<p class="prediction-line prediction-achieved">🎉 목표 체중 달성!</p>`;
    return;
  }

  const fourWeeksAgo = addDays(latestDate, -28);
  const priorCandidates = records.filter((r) => parseYmd(r.date) <= fourWeeksAgo);

  if (!priorCandidates.length) {
    container.innerHTML = `<p class="empty-hint">데이터가 더 쌓이면 예측할 수 있어요 (현재 ${records.length}개)</p>`;
    return;
  }

  const baseline = priorCandidates[priorCandidates.length - 1];
  const baselineDate = parseYmd(baseline.date);
  const elapsedWeeks = (latestDate - baselineDate) / (1000 * 60 * 60 * 24 * 7);
  const weeklyLossKg = (baseline.weight - latest.weight) / elapsedWeeks;

  if (weeklyLossKg <= 0) {
    container.innerHTML = `<p class="empty-hint">현재 감량 추이가 없어요</p>`;
    return;
  }

  const remainingKg = latest.weight - targetWeight;
  const weeksNeeded = remainingKg / weeklyLossKg;
  const predictedDate = addDays(latestDate, Math.round(weeksNeeded * 7));

  container.innerHTML = `
    <p class="prediction-line prediction-date">📅 목표 체중 달성 예상일: ${formatKoreanDate(predictedDate)}</p>
    <p class="prediction-line prediction-rate">현재 주당 평균 -${weeklyLossKg.toFixed(1)}kg 감량 중</p>
  `;
}

function renderHomeWorkoutSummary(logs) {
  const container = $("#home-workout-summary");
  if (!logs.length) {
    container.innerHTML = `<p class="empty-hint">오늘 기록된 운동이 없어요.</p>`;
    return;
  }
  container.innerHTML = "";
  const weightCount = logs.filter((l) => l.type === "weight").length;
  const cardioCount = logs.filter((l) => l.type === "running" || l.type === "stairmaster").length;
  const div = document.createElement("div");
  div.className = "log-item";
  div.innerHTML = `
    <div class="log-main">
      <span class="log-title">오늘 ${logs.length}개 운동 완료</span>
      <span class="log-sub">웨이트 ${weightCount}개 · 유산소 ${cardioCount}개</span>
    </div>`;
  container.appendChild(div);
}

/* ---------------- home tab: calendar ---------------- */

let calendarViewDate = new Date();
calendarViewDate.setDate(1);

function renderMonthActivityStats(monthLogs, monthDrinkLogs) {
  const weightCount = new Set(monthLogs.filter((l) => l.type === "weight").map((l) => l.date)).size;
  const runningCount = new Set(
    monthLogs.filter((l) => l.type === "running" || l.type === "stairmaster").map((l) => l.date)
  ).size;
  const nodrinkCount = monthDrinkLogs.filter((d) => d.type === "nodrink").length;
  const proteinCount = monthDrinkLogs.filter((d) => d.type === "protein").length;

  $("#month-activity-stats").innerHTML = `
    <div class="activity-stat-item"><span>💪 웨이트 운동</span><span>${weightCount}회</span></div>
    <div class="activity-stat-item"><span>🏃 유산소 운동</span><span class="activity-stat-value-cardio">${runningCount}회</span></div>
    <div class="activity-stat-item"><span>💧 금주</span><span class="activity-stat-value-nodrink">${nodrinkCount}회</span></div>
    <div class="activity-stat-item"><span>🥤 프로틴 섭취</span><span class="activity-stat-value-protein">${proteinCount}회</span></div>
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
      info = { weight: false, running: false, nodrink: false, protein: false };
      dayInfo.set(date, info);
    }
    return info;
  };
  monthLogs.forEach((l) => {
    const info = dayInfoFor(l.date);
    if (l.type === "weight") info.weight = true;
    if (l.type === "running" || l.type === "stairmaster") info.running = true;
  });
  monthDrinkLogs.forEach((d) => {
    const info = dayInfoFor(d.date);
    if (d.type === "nodrink") info.nodrink = true;
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
      if (info.nodrink) dots += '<span class="calendar-dot dot-nodrink"></span>';
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
  $("#btn-toggle-nodrink").classList.toggle("active", types.has("nodrink"));
  $("#btn-toggle-protein").classList.toggle("active", types.has("protein"));
}

async function showDayDetail(dateString) {
  currentDetailDate = dateString;
  const logs = await db.getWorkoutLogsByDate(dateString);
  const drinkRecords = await db.getDrinkLogsByDate(dateString);
  const memo = await db.getWorkoutMemo(dateString);
  $("#calendar-day-detail").hidden = false;
  $("#calendar-day-title").textContent = `${dateString} 운동 내역`;
  updateDrinkToggleButtons(drinkRecords);

  const memoEl = $("#calendar-day-memo");
  if (memo) {
    memoEl.textContent = `📝 ${memo}`;
    memoEl.hidden = false;
  } else {
    memoEl.hidden = true;
  }

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
    } else if (log.type === "running") {
      div.innerHTML = `
        <div class="log-main">
          <span class="log-title">러닝</span>
          <span class="log-sub">${log.distance}km · ${log.duration}분 · ${log.pace}분/km</span>
        </div>`;
    } else if (log.type === "stairmaster") {
      const minutes = Math.floor(log.duration / 60);
      const seconds = log.duration % 60;
      div.innerHTML = `
        <div class="log-main">
          <span class="log-title">천국의계단</span>
          <span class="log-sub">단계 ${log.level} · ${minutes}분 ${seconds}초 · 약 ${log.calories}kcal</span>
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
    await db.addDrinkLog(currentDetailDate, type);
  }
  updateDrinkToggleButtons(await db.getDrinkLogsByDate(currentDetailDate));
  await renderCalendar();
}

$("#btn-toggle-nodrink").addEventListener("click", () => toggleDrinkType("nodrink"));
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

let equipmentCache = [];

async function populateEquipmentSelect() {
  equipmentCache = await db.getEquipmentList();
  const select = $("#weight-equipment");
  select.innerHTML = equipmentCache.length
    ? equipmentCache.map((e) => `<option value="${e.id}">${e.name} (${e.category})</option>`).join("")
    : `<option value="">등록된 기구가 없어요 - 설정에서 추가해주세요</option>`;
}

async function renderWorkoutTab() {
  await populateEquipmentSelect();

  const logs = await db.getWorkoutLogsByDate(todayStr());
  await renderWorkoutLogList(logs);

  await renderWorkoutStats();
  await renderRunningSection();

  $("#workout-memo-input").value = await db.getWorkoutMemo(todayStr());
}

$("#btn-save-workout-memo").addEventListener("click", async () => {
  const memo = $("#workout-memo-input").value.trim();
  await db.setWorkoutMemo(todayStr(), memo);
  showToast("메모가 저장되었어요");
});

/* ---------------- workout tab: stats charts ---------------- */

const LB_TO_KG = 0.453592;

function toKg(set) {
  return set.unit === "lb" ? set.weight * LB_TO_KG : set.weight;
}

/* ---------------- workout tab: per-category single-equipment charts ---------------- */

const STAT_CATEGORIES = ["가슴", "등", "하체", "어깨", "팔", "복근"];
const CATEGORY_CHART_SUFFIX = { 가슴: "chest", 등: "back", 하체: "legs", 어깨: "shoulder", 팔: "arms", 복근: "abs" };

let allWorkoutLogsById = new Map();

function normalizeEquipmentName(name) {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCategory(cat) {
  return (cat || "").trim().toLowerCase();
}

/* Matches a weight log to an equipment by equipmentId first; only falls back
   to a normalized (trimmed, case/whitespace-insensitive) equipmentName match
   when that id doesn't resolve to any currently-existing equipment — e.g.
   the log predates equipmentId, or its equipmentId is stale (the equipment
   it pointed to was deleted and re-added under a new id). A log whose
   equipmentId correctly resolves to a *different* equipment never falls
   back to a name match, so same-named equipment in another category can't
   get mixed in. */
function logMatchesEquipment(log, eq, equipmentIds) {
  const idIsResolvable = log.equipmentId != null && equipmentIds.has(log.equipmentId);
  if (idIsResolvable) return log.equipmentId === eq.id;
  return normalizeEquipmentName(log.equipmentName) === normalizeEquipmentName(eq.name);
}

/* builds one equipment's own max-weight-per-date series (deduping same-day
   logs to that day's highest weight), capped to its most recent 20 dates.
   Each equipment now gets its own independent x-axis — since only one
   equipment is charted at a time (see the pill row below), there's no more
   shared category-wide date window for a rarely-logged equipment to get
   squeezed out of. */
function buildEquipmentPoints(allLogs, eq, equipmentIds) {
  const rawPoints = allLogs
    .filter((l) => l.type === "weight" && logMatchesEquipment(l, eq, equipmentIds))
    .map((log) => {
      const weightsKg = log.sets.filter((s) => s.unit !== "none").map(toKg);
      if (!weightsKg.length) return null;
      return { date: log.date, maxWeight: Math.max(...weightsKg), logId: log.id };
    })
    .filter(Boolean);

  const byDate = new Map();
  rawPoints.forEach((p) => {
    const existing = byDate.get(p.date);
    if (!existing || p.maxWeight > existing.maxWeight) byDate.set(p.date, p);
  });
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-20);
}

/* per-category selected equipment id, remembered across re-renders (e.g.
   revisiting the workout tab) until the user picks a different one */
const selectedEquipmentByCategory = new Map();

function renderSingleEquipmentChart(canvas, eq, points) {
  const dateLabels = points.map((p) => p.date.slice(5));
  const series = [
    {
      name: eq.name,
      color: "#00e5a0",
      points: points.map((p, i) => ({ index: i, value: Math.round(p.maxWeight * 10) / 10, date: p.date, logId: p.logId })),
    },
  ];
  drawMultiLineChart(canvas, dateLabels, series, { unit: "kg" });
  attachChartClickHandler(canvas, (point) => {
    if (point.logId != null) openEquipmentLogDetail(point.logId);
  });
}

const STAT_CHART_DEBUG_CATEGORIES = new Set(["가슴", "등", "하체"]);

async function renderCategoryCharts(allLogs, equipmentList) {
  const equipmentIds = new Set(equipmentList.map((eq) => eq.id));

  for (const cat of STAT_CATEGORIES) {
    const suffix = CATEGORY_CHART_SUFFIX[cat];
    const canvas = $(`#chart-cat-${suffix}`);
    const pillRowEl = $(`#equipment-pills-${suffix}`);
    const emptyEl = $(`#empty-cat-${suffix}`);
    // normalized (trimmed + lowercased) comparison guards against a category
    // value that's otherwise "가슴" but carries stray whitespace or mixed
    // casing (e.g. from a manual DB edit or import), which would otherwise
    // silently drop the equipment out of every category tab
    const equipmentInCategory = equipmentList.filter((eq) => normalizeCategory(eq.category) === normalizeCategory(cat));
    const pointsByEquipmentId = new Map(equipmentInCategory.map((eq) => [eq.id, buildEquipmentPoints(allLogs, eq, equipmentIds)]));

    if (STAT_CHART_DEBUG_CATEGORIES.has(cat)) {
      console.log(
        `[운동통계 디버그] "${cat}" category === 인 기구 전체 목록:`,
        equipmentInCategory.map((eq) => ({ id: eq.id, name: eq.name, category: eq.category }))
      );
      console.log(
        `[운동통계 디버그] "${cat}" 기구와 매칭되는 workoutLogs:`,
        equipmentInCategory.flatMap((eq) =>
          allLogs
            .filter((l) => l.type === "weight" && logMatchesEquipment(l, eq, equipmentIds))
            .map((l) => ({
              logId: l.id,
              date: l.date,
              matchedTo: eq.name,
              equipmentId: l.equipmentId,
              equipmentName: l.equipmentName,
              sets: l.sets,
            }))
        )
      );
      console.log(
        `[운동통계 디버그] "${cat}" 기구별 데이터 포인트 수:`,
        equipmentInCategory.map((eq) => ({ name: eq.name, points: (pointsByEquipmentId.get(eq.id) || []).length }))
      );
    }

    const hasAnyData = equipmentInCategory.some((eq) => (pointsByEquipmentId.get(eq.id) || []).length > 0);
    canvas.hidden = !hasAnyData;
    pillRowEl.hidden = !hasAnyData;
    emptyEl.hidden = hasAnyData;
    if (!hasAnyData) continue;

    const selectEquipment = (eqId) => {
      selectedEquipmentByCategory.set(cat, eqId);
      pillRowEl.innerHTML = equipmentInCategory
        .map((eq) => {
          const eqHasData = (pointsByEquipmentId.get(eq.id) || []).length > 0;
          const active = eq.id === eqId ? " active" : "";
          return `<button type="button" class="pill${active}" data-eq-id="${eq.id}" ${eqHasData ? "" : "disabled"}>${eq.name}</button>`;
        })
        .join("");
      $$(".pill", pillRowEl).forEach((btn) => {
        btn.addEventListener("click", () => selectEquipment(Number(btn.dataset.eqId)));
      });

      const eq = equipmentInCategory.find((e) => e.id === eqId);
      renderSingleEquipmentChart(canvas, eq, pointsByEquipmentId.get(eqId) || []);
    };

    let selectedId = selectedEquipmentByCategory.get(cat);
    const selectedHasData = selectedId != null && (pointsByEquipmentId.get(selectedId) || []).length > 0;
    if (!selectedHasData) {
      selectedId = equipmentInCategory.find((eq) => (pointsByEquipmentId.get(eq.id) || []).length > 0).id;
    }

    selectEquipment(selectedId);
  }
}

/* cardio charts are single-series, but still drawn through drawMultiLineChart
   (not drawLineChart) so they share the exact same padding/point-size/font
   constants as the body-part category charts above — see STAT_CHART_* in
   chart.js. */
function toSingleSeries(name, color, logsSorted, valueFn) {
  return [
    {
      name,
      color,
      points: logsSorted.map((l, i) => ({ index: i, value: valueFn(l), date: l.date })),
    },
  ];
}

async function renderCardioCharts(allLogs) {
  const runningLogs = allLogs.filter((l) => l.type === "running").sort((a, b) => (a.date < b.date ? -1 : 1));
  const recentRunning = runningLogs.slice(-20);
  const paceCanvas = $("#chart-cardio-pace");
  const paceEmpty = $("#empty-cardio-pace");
  paceCanvas.hidden = !recentRunning.length;
  paceEmpty.hidden = !!recentRunning.length;
  if (recentRunning.length) {
    drawMultiLineChart(
      paceCanvas,
      recentRunning.map((l) => l.date.slice(5)),
      toSingleSeries("러닝 페이스", "#4dabf7", recentRunning, (l) => l.pace),
      { unit: "분/km" }
    );
  }

  const stairLogs = allLogs.filter((l) => l.type === "stairmaster").sort((a, b) => (a.date < b.date ? -1 : 1));
  const recentStair = stairLogs.slice(-20);
  const stairCanvas = $("#chart-cardio-stairmaster");
  const stairEmpty = $("#empty-cardio-stairmaster");
  stairCanvas.hidden = !recentStair.length;
  stairEmpty.hidden = !!recentStair.length;
  if (recentStair.length) {
    drawMultiLineChart(
      stairCanvas,
      recentStair.map((l) => l.date.slice(5)),
      toSingleSeries("천국의계단", "#ff922b", recentStair, (l) => l.level),
      { unit: "단계" }
    );
  }
}

/* ---------------- workout tab: stats category tabs ---------------- */

let selectedStatsCategory = "가슴";

function switchStatsCategoryTab(cat) {
  selectedStatsCategory = cat;
  $$(".pill", $("#stats-category-tabs")).forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
  $$(".stats-panel").forEach((panel) => {
    panel.hidden = panel.dataset.cat !== cat;
  });
}

$$(".pill", $("#stats-category-tabs")).forEach((btn) => {
  btn.addEventListener("click", () => switchStatsCategoryTab(btn.dataset.cat));
});

async function openEquipmentLogDetail(logId) {
  const log = allWorkoutLogsById.get(logId);
  if (!log) return;
  const bodyWeightKg = await getLatestBodyWeightKg();
  const volume = calcLogVolume(log);
  const calories = calcWeightLogCalories(log, bodyWeightKg);
  $("#equipment-log-detail-title").textContent = `${log.equipmentName} · ${log.date}`;
  $("#equipment-log-detail-content").innerHTML = `
    <div class="log-table-detail">
      ${log.sets.map((s, i) => `<div>세트${i + 1}: ${formatSet(s)}</div>`).join("")}
    </div>
    <div class="log-table-detail-totals">
      <div>총 볼륨: ${Math.round(volume)}kg</div>
      <div>추정 칼로리: 약 ${Math.round(calories)}kcal</div>
    </div>`;
  $("#modal-equipment-log-detail").hidden = false;
}

$("#btn-close-equipment-log-detail").addEventListener("click", () => {
  $("#modal-equipment-log-detail").hidden = true;
});

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

/* bodyweight (unit: "none") sets: MET x body weight(kg) x (set count x 1분) / 60,
   MET looked up by whether the equipment name contains a known exercise keyword */
const BODYWEIGHT_MET_RULES = [
  { keywords: ["레그레이즈", "레그 레이즈"], met: 3.5 },
  { keywords: ["플랭크"], met: 3.0 },
  { keywords: ["크런치", "싯업"], met: 3.8 },
  { keywords: ["딥스"], met: 5.0 },
  { keywords: ["풀업", "친업"], met: 6.0 },
  { keywords: ["푸시업"], met: 3.8 },
  { keywords: ["런지"], met: 4.0 },
  { keywords: ["스쿼트"], met: 5.0 },
];
const DEFAULT_BODYWEIGHT_MET = 3.5;

function getBodyweightMET(equipmentName) {
  const rule = BODYWEIGHT_MET_RULES.find((r) => r.keywords.some((kw) => equipmentName.includes(kw)));
  return rule ? rule.met : DEFAULT_BODYWEIGHT_MET;
}

function calcBodyweightSetsCalories(log, bodyWeightKg) {
  const noneSetCount = log.sets.filter((s) => s.unit === "none").length;
  if (!noneSetCount) return 0;
  const met = getBodyweightMET(log.equipmentName);
  return met * bodyWeightKg * ((noneSetCount * 1) / 60);
}

function calcWeightLogCalories(log, bodyWeightKg) {
  return calcCaloriesFromVolume(calcLogVolume(log), bodyWeightKg) + calcBodyweightSetsCalories(log, bodyWeightKg);
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

/* 천국의계단 (stairmaster) level -> MET */
const STAIRMASTER_MET_BY_LEVEL = {
  6: 6.0,
  7: 7.0,
  8: 8.0,
  9: 9.0,
  10: 10.0,
  11: 11.0,
  12: 12.0,
  13: 13.5,
  14: 15.0,
  15: 16.0,
};

function getStairmasterMET(level) {
  return STAIRMASTER_MET_BY_LEVEL[level] ?? 10.0;
}

function calcStairmasterCalories(log, bodyWeightKg) {
  const met = getStairmasterMET(log.level);
  const hours = log.duration / 3600;
  return met * bodyWeightKg * hours;
}

function calcLogCalories(log, bodyWeightKg) {
  if (log.type === "weight") return calcWeightLogCalories(log, bodyWeightKg);
  if (log.type === "running") return calcRunningCalories(log, bodyWeightKg);
  if (log.type === "stairmaster") return calcStairmasterCalories(log, bodyWeightKg);
  return 0;
}

async function renderWorkoutStats() {
  const [allLogs, equipmentList] = await Promise.all([db.getAllWorkoutLogs(), db.getEquipmentList()]);
  allWorkoutLogsById = new Map(allLogs.map((l) => [l.id, l]));
  await renderCategoryCharts(allLogs, equipmentList);
  await renderCardioCharts(allLogs);
  switchStatsCategoryTab(selectedStatsCategory);
}

/* manual ordering: sortOrder is a lazily-assigned field (see reorderWorkoutLogs).
   Logs without it fall back to id, which reproduces the original newest-first
   order, so legacy logs stay exactly where they were. */
function sortWorkoutLogsForDisplay(logs) {
  return logs.slice().sort((a, b) => (b.sortOrder ?? b.id) - (a.sortOrder ?? a.id));
}

/* a new log always goes to the very bottom of that date's list */
async function getBottomSortOrderForDate(date) {
  const dayLogs = await db.getWorkoutLogsByDate(date);
  if (!dayLogs.length) return 0;
  const minKey = Math.min(...dayLogs.map((l) => l.sortOrder ?? l.id));
  return minKey - 1;
}

async function getBottomSortOrder() {
  return getBottomSortOrderForDate(todayStr());
}

/* reorder mode: checkbox multi-select + "위로"/"아래로" buttons */
let reorderModeActive = false;
let reorderSelectedIds = new Set();

function moveSelectedUp(ordered, selectedIds) {
  const arr = ordered.slice();
  for (let i = 1; i < arr.length; i++) {
    if (selectedIds.has(arr[i].id) && !selectedIds.has(arr[i - 1].id)) {
      [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    }
  }
  return arr;
}

function moveSelectedDown(ordered, selectedIds) {
  const arr = ordered.slice();
  for (let i = arr.length - 2; i >= 0; i--) {
    if (selectedIds.has(arr[i].id) && !selectedIds.has(arr[i + 1].id)) {
      [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    }
  }
  return arr;
}

function setReorderMode(active) {
  reorderModeActive = active;
  reorderSelectedIds = new Set();
  $("#reorder-toolbar").hidden = !active;
}

$("#btn-toggle-reorder-mode").addEventListener("click", async () => {
  setReorderMode(true);
  const logs = await db.getWorkoutLogsByDate(todayStr());
  await renderWorkoutLogList(logs);
});

$("#btn-reorder-done").addEventListener("click", async () => {
  setReorderMode(false);
  const logs = await db.getWorkoutLogsByDate(todayStr());
  await renderWorkoutLogList(logs);
});

async function applyReorderMove(direction) {
  if (!reorderSelectedIds.size) return;
  const logs = await db.getWorkoutLogsByDate(todayStr());
  const ordered = sortWorkoutLogsForDisplay(logs);
  const moved = direction === "up" ? moveSelectedUp(ordered, reorderSelectedIds) : moveSelectedDown(ordered, reorderSelectedIds);
  await db.reorderWorkoutLogs(moved.map((l) => l.id));
  const refreshed = await db.getWorkoutLogsByDate(todayStr());
  await renderWorkoutLogList(refreshed);
}

$("#btn-reorder-up").addEventListener("click", () => applyReorderMove("up"));
$("#btn-reorder-down").addEventListener("click", () => applyReorderMove("down"));

/* newly-created logs carry their own manufacturer snapshot; logs saved
   before that field existed fall back to a live lookup in the current
   equipment list by equipmentId */
function getWorkoutLogManufacturer(log) {
  if (log.manufacturer) return log.manufacturer;
  if (log.equipmentId == null) return "";
  return equipmentCache.find((eq) => eq.id === log.equipmentId)?.manufacturer || "";
}

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

  const ordered = sortWorkoutLogsForDisplay(logs);

  ordered.forEach((log) => {
      const div = document.createElement("div");
      div.className = "log-item";
      let mainHtml = "";
      if (log.type === "weight") {
        const volume = calcLogVolume(log);
        const calories = calcWeightLogCalories(log, bodyWeightKg);
        totalVolume += volume;
        totalCalories += calories;
        const manufacturer = getWorkoutLogManufacturer(log);
        mainHtml = `
          <div class="log-main">
            <span class="log-title">${log.equipmentName}</span>
            ${manufacturer ? `<span class="log-manufacturer">${manufacturer}</span>` : ""}
            <span class="log-sub">${log.sets.length}세트 · ${formatSetsSummary(log.sets)}</span>
            <span class="log-sub">볼륨 ${Math.round(volume)}kg · 칼로리 ${Math.round(calories)}kcal</span>
          </div>`;
      } else if (log.type === "running") {
        const calories = calcRunningCalories(log, bodyWeightKg);
        totalCalories += calories;
        mainHtml = `
          <div class="log-main">
            <span class="log-title">러닝</span>
            <span class="log-sub">${log.distance}km · ${log.duration}분 · ${log.pace}분/km</span>
          </div>`;
      } else if (log.type === "stairmaster") {
        const calories = calcStairmasterCalories(log, bodyWeightKg);
        totalCalories += calories;
        const minutes = Math.floor(log.duration / 60);
        const seconds = log.duration % 60;
        mainHtml = `
          <div class="log-main">
            <span class="log-title">천국의계단</span>
            <span class="log-sub">단계 ${log.level} · ${minutes}분 ${seconds}초 · 약 ${Math.round(calories)}kcal</span>
          </div>`;
      }

      const checkboxHtml = reorderModeActive
        ? `<input type="checkbox" class="log-reorder-checkbox" data-id="${log.id}" ${reorderSelectedIds.has(log.id) ? "checked" : ""} />`
        : "";
      const editButtonHtml = reorderModeActive
        ? ""
        : `<button type="button" class="icon-btn log-edit" data-id="${log.id}">✏️</button>`;
      div.innerHTML = `
        ${checkboxHtml}
        ${mainHtml}
        <div class="log-item-actions">
          ${editButtonHtml}
          <button type="button" class="log-delete" data-id="${log.id}">✕</button>
        </div>`;
      container.appendChild(div);
  });

  totalsEl.hidden = false;
  totalsEl.innerHTML = `
    <div>오늘 총 볼륨 ${Math.round(totalVolume)}kg</div>
    <div>오늘 총 소모 칼로리: 약 ${Math.round(totalCalories)}kcal</div>
  `;

  $$(".log-reorder-checkbox", container).forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) reorderSelectedIds.add(id);
      else reorderSelectedIds.delete(id);
    });
  });

  $$(".log-delete", container).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("정말 삭제할까요?")) return;
      await db.deleteWorkoutLog(Number(btn.dataset.id));
      const refreshed = await db.getWorkoutLogsByDate(todayStr());
      await renderWorkoutLogList(refreshed);
      renderHomeWorkoutSummary(refreshed);
    });
  });

  $$(".log-edit", container).forEach((btn) => {
    btn.addEventListener("click", () => {
      const log = ordered.find((l) => l.id === Number(btn.dataset.id));
      if (log) startEditWorkoutLog(log);
    });
  });
}

/* ---------------- routine favorites ---------------- */

$("#btn-save-routine").addEventListener("click", async () => {
  const logs = await db.getWorkoutLogsByDate(todayStr());
  const weightLogs = logs.filter((l) => l.type === "weight");
  if (!weightLogs.length) {
    showToast("오늘 기록된 웨이트 운동이 없어요");
    return;
  }
  $("#routine-name-input").value = "";
  $("#modal-save-routine").hidden = false;
});

$("#btn-cancel-save-routine").addEventListener("click", () => {
  $("#modal-save-routine").hidden = true;
});

$("#form-save-routine").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#routine-name-input").value.trim();
  if (!name) return;

  const logs = await db.getWorkoutLogsByDate(todayStr());
  const weightLogs = sortWorkoutLogsForDisplay(logs).filter((l) => l.type === "weight");
  const exercises = weightLogs.map((l) => ({
    equipmentId: l.equipmentId ?? null,
    equipmentName: l.equipmentName,
    category: l.category ?? "",
    sets: l.sets.map((s) => ({ ...s })),
  }));

  await db.addRoutine({ name, exercises, createdAt: Date.now() });
  $("#modal-save-routine").hidden = true;
  showToast("루틴이 저장되었어요");
});

/* a routine's "last used" date: the most recent date on which workoutLogs
   contain every one of the routine's equipment names (not necessarily as a
   single log, just all present somewhere that day) */
async function findRoutineLastUsedDate(routine, allLogs) {
  const namesNeeded = routine.exercises.map((ex) => ex.equipmentName);
  if (!namesNeeded.length) return null;

  const namesByDate = new Map();
  allLogs.forEach((l) => {
    if (l.type !== "weight") return;
    if (!namesByDate.has(l.date)) namesByDate.set(l.date, new Set());
    namesByDate.get(l.date).add(l.equipmentName);
  });

  const matchingDates = [...namesByDate.entries()]
    .filter(([, namesOnDate]) => namesNeeded.every((n) => namesOnDate.has(n)))
    .map(([date]) => date)
    .sort();

  return matchingDates.length ? matchingDates[matchingDates.length - 1] : null;
}

async function renderRoutineList() {
  const routines = await db.getRoutines();
  const container = $("#routine-list");
  if (!routines.length) {
    container.innerHTML = `<p class="empty-hint">저장된 루틴이 없어요.</p>`;
    return;
  }
  const allLogs = await db.getAllWorkoutLogs();
  container.innerHTML = "";
  for (const r of routines) {
    const lastUsedDate = await findRoutineLastUsedDate(r, allLogs);
    const div = document.createElement("div");
    div.className = "log-item routine-item";
    const exerciseLines = r.exercises.map((ex) => `<div>${ex.equipmentName} (${ex.sets.length}세트)</div>`).join("");
    const lastUsedText = lastUsedDate ? `마지막 사용: ${lastUsedDate}` : "아직 사용 기록 없음";
    div.innerHTML = `
      <div class="log-main">
        <span class="log-title">${r.name}</span>
        <div class="routine-exercise-lines">${exerciseLines}</div>
        <span class="log-sub routine-last-used">${lastUsedText}</span>
      </div>
      <div class="set-item-actions">
        <button type="button" class="btn btn-primary btn-sm routine-apply" data-id="${r.id}">불러오기</button>
        <button type="button" class="icon-btn routine-edit" data-id="${r.id}">✏️</button>
        <button type="button" class="log-delete routine-delete" data-id="${r.id}">✕</button>
      </div>`;
    container.appendChild(div);
  }

  $$(".routine-apply", container).forEach((btn) => {
    btn.addEventListener("click", () => applyRoutine(Number(btn.dataset.id)));
  });
  $$(".routine-delete", container).forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("정말 삭제할까요?")) return;
      await db.deleteRoutine(Number(btn.dataset.id));
      await renderRoutineList();
    });
  });
  $$(".routine-edit", container).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const routine = (await db.getRoutines()).find((r) => r.id === id);
      if (routine) openEditRoutineModal(routine);
    });
  });
}

/* ---------------- routine editing ---------------- */

let editingRoutineId = null;
let editingRoutineCreatedAt = null;
let editingRoutineExercises = [];

function renderEditRoutineExerciseList() {
  const container = $("#edit-routine-exercise-list");
  if (!editingRoutineExercises.length) {
    container.innerHTML = `<p class="empty-hint">운동이 없어요.</p>`;
    return;
  }
  container.innerHTML = "";
  editingRoutineExercises.forEach((ex, i) => {
    const div = document.createElement("div");
    div.className = "log-item";
    div.innerHTML = `
      <div class="log-main">
        <span class="log-title">${ex.equipmentName}</span>
        <span class="log-sub">${ex.sets.length}세트</span>
      </div>
      <div class="log-item-actions">
        <button type="button" class="icon-btn routine-ex-up" data-index="${i}" ${i === 0 ? "disabled" : ""}>▲</button>
        <button type="button" class="icon-btn routine-ex-down" data-index="${i}" ${i === editingRoutineExercises.length - 1 ? "disabled" : ""}>▼</button>
        <button type="button" class="log-delete routine-ex-delete" data-index="${i}">✕</button>
      </div>`;
    container.appendChild(div);
  });

  $$(".routine-ex-up", container).forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.index);
      if (i <= 0) return;
      [editingRoutineExercises[i - 1], editingRoutineExercises[i]] = [editingRoutineExercises[i], editingRoutineExercises[i - 1]];
      renderEditRoutineExerciseList();
    });
  });
  $$(".routine-ex-down", container).forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.index);
      if (i >= editingRoutineExercises.length - 1) return;
      [editingRoutineExercises[i], editingRoutineExercises[i + 1]] = [editingRoutineExercises[i + 1], editingRoutineExercises[i]];
      renderEditRoutineExerciseList();
    });
  });
  $$(".routine-ex-delete", container).forEach((btn) => {
    btn.addEventListener("click", () => {
      editingRoutineExercises.splice(Number(btn.dataset.index), 1);
      renderEditRoutineExerciseList();
    });
  });
}

function openEditRoutineModal(routine) {
  editingRoutineId = routine.id;
  editingRoutineCreatedAt = routine.createdAt ?? Date.now();
  editingRoutineExercises = routine.exercises.map((ex) => ({ ...ex, sets: ex.sets.map((s) => ({ ...s })) }));
  $("#edit-routine-name-input").value = routine.name;
  renderEditRoutineExerciseList();
  $("#modal-edit-routine").hidden = false;
}

function closeEditRoutineModal() {
  $("#modal-edit-routine").hidden = true;
  editingRoutineId = null;
  editingRoutineCreatedAt = null;
  editingRoutineExercises = [];
}

$("#btn-cancel-edit-routine").addEventListener("click", closeEditRoutineModal);

$("#btn-save-edit-routine").addEventListener("click", async () => {
  if (editingRoutineId == null) return;
  const name = $("#edit-routine-name-input").value.trim();
  if (!name) {
    showToast("루틴 이름을 입력해주세요");
    return;
  }
  if (!editingRoutineExercises.length) {
    showToast("운동을 최소 1개 이상 남겨주세요");
    return;
  }
  await db.updateRoutine(editingRoutineId, {
    name,
    exercises: editingRoutineExercises,
    createdAt: editingRoutineCreatedAt,
  });
  closeEditRoutineModal();
  await renderRoutineList();
  showToast("루틴이 수정되었어요");
});

async function applyRoutine(routineId) {
  const routines = await db.getRoutines();
  const routine = routines.find((r) => r.id === routineId);
  if (!routine) return;

  const currentEquipment = await db.getEquipmentList();

  for (const ex of routine.exercises) {
    const equipment = currentEquipment.find((eq) => eq.id === ex.equipmentId);
    const equipmentName = equipment ? equipment.name : ex.equipmentName;
    const category = equipment ? equipment.category : ex.category || "";
    const manufacturer = equipment ? equipment.manufacturer || "" : "";
    const sortOrder = await getBottomSortOrder();
    const log = {
      date: todayStr(),
      type: "weight",
      equipmentId: ex.equipmentId,
      equipmentName,
      category,
      manufacturer,
      sets: ex.sets.map((s) => ({ ...s })),
      sortOrder,
      createdAt: Date.now(),
      fromRoutine: true,
    };
    await db.addWorkoutLog(log);
  }

  $("#modal-load-routine").hidden = true;
  const logs = await db.getWorkoutLogsByDate(todayStr());
  await renderWorkoutLogList(logs);
  renderHomeWorkoutSummary(logs);
  await checkForNewBadges();
  showToast(`"${routine.name}" 루틴을 불러왔어요`);
}

$("#btn-load-routine").addEventListener("click", async () => {
  await renderRoutineList();
  $("#modal-load-routine").hidden = false;
});

$("#btn-cancel-load-routine").addEventListener("click", () => {
  $("#modal-load-routine").hidden = true;
});

/* add workout modal */
const modalAddWorkout = $("#modal-add-workout");

$("#btn-add-workout").addEventListener("click", () => {
  modalAddWorkout.hidden = false;
  updateWeightFormMode();
});

/* 천국의계단 (stairmaster) special entry mode, toggled by the selected equipment */
let stairmasterBodyWeightKg = DEFAULT_BODY_WEIGHT_KG;

function isStairmasterSelected() {
  const equipmentId = Number($("#weight-equipment").value);
  const equipment = equipmentCache.find((eq) => eq.id === equipmentId);
  return equipment?.name === STAIRMASTER_NAME;
}

async function updateWeightFormMode() {
  const stairmaster = isStairmasterSelected();
  $("#weight-set-section").hidden = stairmaster;
  $("#stairmaster-section").hidden = !stairmaster;
  if (stairmaster) {
    stairmasterBodyWeightKg = await getLatestBodyWeightKg();
    updateStairmasterCaloriePreview();
    $("#previous-record-info").hidden = true;
    pendingPreviousRecordSets = null;
  } else {
    await updatePreviousRecordInfo();
  }
}

/* previous-record lookup: shows the most recent log for the selected equipment
   and lets the user load its sets into the current entry in one tap */
let pendingPreviousRecordSets = null;

async function updatePreviousRecordInfo() {
  const equipmentId = Number($("#weight-equipment").value);
  const equipment = equipmentCache.find((eq) => eq.id === equipmentId);
  const container = $("#previous-record-info");
  if (!equipment) {
    container.hidden = true;
    pendingPreviousRecordSets = null;
    return;
  }

  const allLogs = await db.getAllWorkoutLogs();
  const matches = allLogs
    .filter((l) => l.type === "weight" && (l.equipmentId === equipment.id || l.equipmentName === equipment.name))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  const mostRecent = matches[0];

  if (!mostRecent) {
    container.hidden = true;
    pendingPreviousRecordSets = null;
    return;
  }

  pendingPreviousRecordSets = mostRecent.sets;
  $("#previous-record-date-value").textContent = mostRecent.date;
  $("#previous-record-sets").innerHTML = mostRecent.sets
    .map((s, i) => `<div>세트${i + 1}: ${formatSet(s)}</div>`)
    .join("");
  container.hidden = false;
}

function resetPreviousRecordInfo() {
  $("#previous-record-info").hidden = true;
  pendingPreviousRecordSets = null;
}

$("#btn-load-previous-record").addEventListener("click", () => {
  if (!pendingPreviousRecordSets) return;
  currentSets = pendingPreviousRecordSets.map((s) => ({ ...s }));
  renderSetList();
  updateEquipmentLock();
  showToast("이전 기록을 불러왔어요");
});

function updateStairmasterCaloriePreview() {
  const level = Number($("#stairmaster-level").value);
  $("#stairmaster-level-value").textContent = level;
  const met = getStairmasterMET(level);
  $("#stairmaster-met-value").textContent = met.toFixed(1);
  const minutes = Number($("#stairmaster-minutes").value) || 0;
  const seconds = Number($("#stairmaster-seconds").value) || 0;
  const calories = met * stairmasterBodyWeightKg * ((minutes * 60 + seconds) / 3600);
  $("#stairmaster-calorie-preview").textContent = Math.round(calories);
}

$("#weight-equipment").addEventListener("change", updateWeightFormMode);
$("#stairmaster-level").addEventListener("input", updateStairmasterCaloriePreview);
$("#stairmaster-minutes").addEventListener("input", updateStairmasterCaloriePreview);
$("#stairmaster-seconds").addEventListener("input", updateStairmasterCaloriePreview);

function resetStairmasterState() {
  $("#stairmaster-level").value = 10;
  $("#stairmaster-minutes").value = "";
  $("#stairmaster-seconds").value = "";
  $("#stairmaster-level-value").textContent = "10";
  $("#stairmaster-met-value").textContent = "10.0";
  $("#stairmaster-calorie-preview").textContent = "0";
}

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
      <div class="set-item-actions">
        <button type="button" class="btn btn-ghost btn-sm set-copy" data-index="${i}">복사</button>
        <button type="button" class="icon-btn set-edit" data-index="${i}">✏️</button>
        <button type="button" class="log-delete" data-index="${i}">✕</button>
      </div>`;
    container.appendChild(div);
  });
  $$(".log-delete", container).forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      currentSets.splice(idx, 1);
      if (editingSetIndex === idx) exitSetEditMode();
      else if (editingSetIndex !== null && idx < editingSetIndex) editingSetIndex -= 1;
      renderSetList();
      updateEquipmentLock();
    });
  });
  $$(".set-copy", container).forEach((btn) => {
    btn.addEventListener("click", () => {
      copySetToEntry(currentSets[Number(btn.dataset.index)]);
    });
  });
  $$(".set-edit", container).forEach((btn) => {
    btn.addEventListener("click", () => {
      enterSetEditMode(Number(btn.dataset.index));
    });
  });
}

function copySetToEntry(set) {
  if (!set) return;
  exitSetEditMode();
  $("#set-entry").hidden = false;
  currentSetUnit = set.unit;
  $$(".segmented-btn", $("#weight-unit-toggle")).forEach((b) => b.classList.toggle("active", b.dataset.unit === set.unit));
  const isNone = set.unit === "none";
  $("#set-weight-label").hidden = isNone;
  $("#set-weight").value = isNone ? "" : set.weight;
  $("#set-reps").value = set.reps;
}

/* set edit mode: 기록 버튼 -> 수정 완료, 취소 버튼 노출 */
let editingSetIndex = null;

function enterSetEditMode(index) {
  const set = currentSets[index];
  if (!set) return;
  editingSetIndex = index;
  $("#set-entry").hidden = false;
  currentSetUnit = set.unit;
  $$(".segmented-btn", $("#weight-unit-toggle")).forEach((b) => b.classList.toggle("active", b.dataset.unit === set.unit));
  const isNone = set.unit === "none";
  $("#set-weight-label").hidden = isNone;
  $("#set-weight").value = isNone ? "" : set.weight;
  $("#set-reps").value = set.reps;
  $("#btn-record-set").textContent = "수정 완료";
  $("#btn-cancel-set-edit").hidden = false;
}

function exitSetEditMode() {
  editingSetIndex = null;
  $("#btn-record-set").textContent = "기록";
  $("#btn-cancel-set-edit").hidden = true;
}

$("#btn-cancel-set-edit").addEventListener("click", () => {
  exitSetEditMode();
  $("#set-weight").value = "";
  $("#set-reps").value = "";
});

function resetSetEntryState() {
  currentSets = [];
  currentSetUnit = "kg";
  exitSetEditMode();
  $("#set-entry").hidden = true;
  $$(".segmented-btn", $("#weight-unit-toggle")).forEach((b) => b.classList.toggle("active", b.dataset.unit === "kg"));
  $("#set-weight-label").hidden = false;
  $("#set-weight").value = "";
  $("#set-reps").value = "";
  renderSetList();
  updateEquipmentLock();
}

/* ---- 운동 기록 수정 모드 ---- */
let editingLogId = null;
let editingLogSnapshot = null;

function setEditModeIndicator(text) {
  $("#modal-add-workout-title").textContent = text || "운동 추가";
  $("#btn-finish-weight").textContent = text ? "수정 완료" : "운동 완료";
  $("#btn-finish-running").textContent = text ? "수정 완료" : "추가";
  $$(".segmented-btn", $("#workout-type-toggle")).forEach((b) => (b.disabled = !!text));
  $("#weight-equipment").disabled = !!text || currentSets.length > 0;
}

function setWorkoutTypeToggle(type) {
  $$(".segmented-btn", $("#workout-type-toggle")).forEach((b) => b.classList.toggle("active", b.dataset.type === type));
  $("#form-weight").hidden = type !== "weight";
  $("#form-running").hidden = type !== "running";
}

async function startEditWorkoutLog(log) {
  editingLogId = log.id;
  editingLogSnapshot = log;
  modalAddWorkout.hidden = false;

  if (log.type === "running") {
    setWorkoutTypeToggle("running");
    $("#running-distance").value = log.distance;
    $("#running-duration").value = log.duration;
    updateRunningPacePreview();
    setEditModeIndicator("✏️ 수정 중 — 러닝");
    return;
  }

  setWorkoutTypeToggle("weight");
  const equipment =
    equipmentCache.find((eq) => eq.id === log.equipmentId) ??
    equipmentCache.find((eq) => eq.name === log.equipmentName);

  if (log.type === "stairmaster") {
    if (equipment) $("#weight-equipment").value = String(equipment.id);
    await updateWeightFormMode();
    $("#stairmaster-level").value = log.level;
    $("#stairmaster-minutes").value = Math.floor(log.duration / 60);
    $("#stairmaster-seconds").value = log.duration % 60;
    updateStairmasterCaloriePreview();
    setEditModeIndicator(`✏️ 수정 중 — ${STAIRMASTER_NAME}`);
    return;
  }

  if (equipment) $("#weight-equipment").value = String(equipment.id);
  resetPreviousRecordInfo();
  $("#stairmaster-section").hidden = true;
  $("#weight-set-section").hidden = false;
  currentSets = log.sets.map((s) => ({ ...s }));
  exitSetEditMode();
  $("#set-entry").hidden = true;
  renderSetList();
  updateEquipmentLock();
  setEditModeIndicator(`✏️ 수정 중 — ${log.equipmentName}`);
}

function closeAddWorkoutModal() {
  modalAddWorkout.hidden = true;
  resetSetEntryState();
  $("#form-running").reset();
  $("#running-pace-preview").textContent = "-";
  resetStairmasterState();
  resetPreviousRecordInfo();
  resetFitnessImportState();
  editingLogId = null;
  editingLogSnapshot = null;
  setEditModeIndicator(null);
  setWorkoutTypeToggle("weight");
}

$("#btn-cancel-weight").addEventListener("click", closeAddWorkoutModal);
$("#btn-cancel-running").addEventListener("click", closeAddWorkoutModal);

$$(".segmented-btn", $("#workout-type-toggle")).forEach((btn) => {
  btn.addEventListener("click", () => {
    if (editingLogId != null) return;
    setWorkoutTypeToggle(btn.dataset.type);
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
  if (editingSetIndex !== null) {
    currentSets[editingSetIndex] = { weight, unit: currentSetUnit, reps };
    exitSetEditMode();
  } else {
    currentSets.push({ weight, unit: currentSetUnit, reps });
  }
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

  if (equipment.name === STAIRMASTER_NAME) {
    const level = Number($("#stairmaster-level").value);
    const minutes = Number($("#stairmaster-minutes").value) || 0;
    const seconds = Number($("#stairmaster-seconds").value) || 0;
    const duration = minutes * 60 + seconds;
    if (duration <= 0) {
      showToast("운동 시간을 입력해주세요.");
      return;
    }
    const met = getStairmasterMET(level);
    const calories = Math.round(met * stairmasterBodyWeightKg * (duration / 3600));

    if (editingLogId != null) {
      const updated = { ...editingLogSnapshot, type: "stairmaster", level, duration, calories };
      await db.updateWorkoutLog(editingLogId, updated);
      closeAddWorkoutModal();
      const logs = await db.getWorkoutLogsByDate(todayStr());
      await renderWorkoutLogList(logs);
      renderHomeWorkoutSummary(logs);
      await checkForNewBadges();
      showToast("운동 기록이 수정되었어요");
      return;
    }

    const log = {
      date: todayStr(),
      type: "stairmaster",
      level,
      duration,
      calories,
      sortOrder: await getBottomSortOrder(),
      createdAt: Date.now(),
    };
    await db.addWorkoutLog(log);
    closeAddWorkoutModal();
    const logs = await db.getWorkoutLogsByDate(todayStr());
    await renderWorkoutLogList(logs);
    renderHomeWorkoutSummary(logs);
    await checkForNewBadges();
    showToast("천국의계단 운동이 기록되었어요");
    return;
  }

  if (!currentSets.length) {
    showToast("세트를 먼저 기록해주세요.");
    return;
  }

  if (editingLogId != null) {
    const updated = {
      ...editingLogSnapshot,
      type: "weight",
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      category: equipment.category,
      manufacturer: equipment.manufacturer || "",
      sets: currentSets.map((s) => ({ ...s })),
    };
    await db.updateWorkoutLog(editingLogId, updated);
    closeAddWorkoutModal();
    const logs = await db.getWorkoutLogsByDate(todayStr());
    await renderWorkoutLogList(logs);
    renderHomeWorkoutSummary(logs);
    await checkForNewBadges();
    showToast("운동 기록이 수정되었어요");
    return;
  }

  const log = {
    date: todayStr(),
    type: "weight",
    equipmentId: equipment.id,
    equipmentName: equipment.name,
    category: equipment.category,
    manufacturer: equipment.manufacturer || "",
    sets: currentSets.map((s) => ({ ...s })),
    sortOrder: await getBottomSortOrder(),
    createdAt: Date.now(),
  };
  await db.addWorkoutLog(log);
  closeAddWorkoutModal();
  const logs = await db.getWorkoutLogsByDate(todayStr());
  await renderWorkoutLogList(logs);
  renderHomeWorkoutSummary(logs);
  await checkForNewBadges();
  showToast("운동이 기록되었어요");
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

/* ---------------- running: fitness-app image import (Gemini Vision) ---------------- */

let pendingFitnessImport = null;

function resetFitnessImportState() {
  pendingFitnessImport = null;
  $("#fitness-import-status").hidden = true;
  $("#fitness-import-status").textContent = "";
  $("#fitness-import-preview").hidden = true;
  $("#fitness-import-preview").innerHTML = "";
}

/* "32:15" / "0:32:15" / "32분 15초" / "32분" -> 32.25 (decimal minutes) */
function parseDurationToMinutes(text) {
  if (text == null || text === "") return null;
  const str = String(text).trim();

  const colon = str.match(/^(\d+):(\d+)(?::(\d+))?$/);
  if (colon) {
    if (colon[3] != null) {
      return Number(colon[1]) * 60 + Number(colon[2]) + Number(colon[3]) / 60;
    }
    return Number(colon[1]) + Number(colon[2]) / 60;
  }

  const hourMatch = str.match(/(\d+)\s*시간/);
  const minMatch = str.match(/(\d+)\s*분/);
  const secMatch = str.match(/(\d+)\s*초/);
  if (hourMatch || minMatch || secMatch) {
    const h = hourMatch ? Number(hourMatch[1]) : 0;
    const m = minMatch ? Number(minMatch[1]) : 0;
    const s = secMatch ? Number(secMatch[1]) : 0;
    return h * 60 + m + s / 60;
  }

  const num = Number(str);
  return isFinite(num) && str !== "" ? num : null;
}

/* "9월 7일" / "2026년 9월 7일" / "2026-09-07" -> "2026-09-07" (assumes the
   current year when the model doesn't report one) */
function parseParsedDateToIso(text) {
  if (!text) return null;
  const str = String(text).trim();

  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;

  const ko = str.match(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (ko) {
    const year = ko[1] ? Number(ko[1]) : new Date().getFullYear();
    return `${year}-${String(Number(ko[2])).padStart(2, "0")}-${String(Number(ko[3])).padStart(2, "0")}`;
  }
  return null;
}

/* extra (non-form) fields captured from a parsed fitness image, carried
   through onto the saved workoutLog untouched when there's nothing new */
function buildRunningExtraFields(pending) {
  if (!pending) return {};
  return {
    location: pending.location ?? null,
    elapsed_time: pending.elapsed_time ?? null,
    active_calories: pending.active_calories ?? null,
    total_calories: pending.total_calories ?? null,
    avg_heart_rate: pending.avg_heart_rate ?? null,
    avg_power: pending.avg_power ?? null,
    avg_cadence: pending.avg_cadence ?? null,
    intensity_level: pending.intensity_level ?? null,
    intensity_text: pending.intensity_text ?? null,
    elevation_gain: pending.elevation_gain ?? null,
    heart_rate_zones: Array.isArray(pending.heart_rate_zones) ? pending.heart_rate_zones : [],
    splits: Array.isArray(pending.splits) ? pending.splits : [],
  };
}

function applyFitnessImportResult(parsed) {
  pendingFitnessImport = parsed;

  if (parsed.distance_km != null) $("#running-distance").value = parsed.distance_km;
  const minutes = parseDurationToMinutes(parsed.duration ?? parsed.elapsed_time);
  if (minutes != null) $("#running-duration").value = Math.round(minutes * 10) / 10;
  updateRunningPacePreview();

  const rows = [
    parsed.date ? `날짜: ${parsed.date}` : null,
    parsed.location ? `장소: ${parsed.location}` : null,
    parsed.avg_pace ? `평균 페이스: ${parsed.avg_pace}` : null,
    parsed.avg_heart_rate != null ? `평균 심박수: ${parsed.avg_heart_rate}bpm` : null,
    parsed.avg_power != null ? `평균 파워: ${parsed.avg_power}W` : null,
    parsed.avg_cadence != null ? `평균 케이던스: ${parsed.avg_cadence}spm` : null,
    parsed.intensity_text ? `운동강도: ${parsed.intensity_level ?? ""} ${parsed.intensity_text}` : null,
    parsed.elevation_gain != null ? `등반고도: ${parsed.elevation_gain}m` : null,
    parsed.active_calories != null ? `활동 칼로리: ${parsed.active_calories}kcal` : null,
    parsed.total_calories != null ? `총 칼로리: ${parsed.total_calories}kcal` : null,
    Array.isArray(parsed.heart_rate_zones) && parsed.heart_rate_zones.length
      ? `심박수 영역 ${parsed.heart_rate_zones.length}개 인식됨`
      : null,
    Array.isArray(parsed.splits) && parsed.splits.length ? `스플릿 ${parsed.splits.length}개 인식됨` : null,
  ].filter(Boolean);

  const previewEl = $("#fitness-import-preview");
  previewEl.innerHTML = rows.length
    ? `<strong>인식된 데이터</strong>${rows.map((r) => `<div>${r}</div>`).join("")}`
    : "거리/시간 외 추가 데이터는 인식하지 못했어요.";
  previewEl.hidden = false;
}

$("#btn-import-fitness-image").addEventListener("click", () => {
  $("#fitness-image-input").click();
});

$("#fitness-image-input").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;

  const apiKey = await db.getSetting("geminiApiKey", "");
  if (!apiKey) {
    showToast("설정 탭에서 Gemini API 키를 먼저 입력해주세요");
    return;
  }

  const statusEl = $("#fitness-import-status");
  statusEl.hidden = false;
  statusEl.textContent = `이미지 ${files.length}장 분석 중...`;
  $("#fitness-import-preview").hidden = true;

  try {
    const parsed = await parseRunningImages(apiKey, files);
    applyFitnessImportResult(parsed);
    statusEl.textContent = "분석 완료! 아래 내용을 확인하고 저장해주세요.";
  } catch (err) {
    statusEl.textContent = `분석 실패: ${err.message}`;
  }
});

/* ---------------- running: Gemini post-run comment ---------------- */

async function generateAndSaveRunningComment(logId) {
  const apiKey = await db.getSetting("geminiApiKey", "");
  if (!apiKey) return;
  try {
    const allLogs = await db.getAllWorkoutLogs();
    const current = allLogs.find((l) => l.id === logId);
    if (!current) return;

    const previousRun = allLogs
      .filter((l) => l.type === "running" && l.id !== logId)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))[0];

    const bodyWeightKg = await getLatestBodyWeightKg();
    const goals = await db.getSetting("runningGoals", null);
    const comment = await generateRunningComment(apiKey, {
      run: current,
      previousRun: previousRun || null,
      bodyWeightKg,
      goals,
    });

    await db.updateWorkoutLog(logId, { ...current, geminiComment: comment });
    await renderRunningLogList();
  } catch (err) {
    console.error("[러닝 코멘트] 생성 실패:", err);
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
  const extraFields = buildRunningExtraFields(pendingFitnessImport);

  if (editingLogId != null) {
    const updated = { ...editingLogSnapshot, type: "running", distance, duration, pace, ...extraFields };
    await db.updateWorkoutLog(editingLogId, updated);
    closeAddWorkoutModal();
    const logs = await db.getWorkoutLogsByDate(todayStr());
    await renderWorkoutLogList(logs);
    renderHomeWorkoutSummary(logs);
    await checkForNewBadges();
    await renderRunningSection();
    showToast("운동 기록이 수정되었어요");
    return;
  }

  const importedDate = parseParsedDateToIso(pendingFitnessImport?.date);
  const date = importedDate || todayStr();
  const log = {
    date,
    type: "running",
    distance,
    duration,
    pace,
    ...extraFields,
    sortOrder: await getBottomSortOrderForDate(date),
    createdAt: Date.now(),
  };
  const newLogId = await db.addWorkoutLog(log);
  closeAddWorkoutModal();
  const logs = await db.getWorkoutLogsByDate(todayStr());
  await renderWorkoutLogList(logs);
  renderHomeWorkoutSummary(logs);
  await checkForNewBadges();
  await renderRunningSection();
  showToast(importedDate && importedDate !== todayStr() ? `러닝이 ${importedDate}로 기록되었어요` : "러닝이 기록되었어요");
  generateAndSaveRunningComment(newLogId);
});

/* ---------------- running stats section ---------------- */

async function renderRunningSection() {
  const allLogs = await db.getAllWorkoutLogs();
  const runningLogs = allLogs.filter((l) => l.type === "running").sort((a, b) => (a.date < b.date ? -1 : 1));

  await renderPaceTrendChart(runningLogs);
  await renderHrZoneChart(runningLogs);
  await renderPowerEfficiencyChart(runningLogs);
  await renderCadenceChart(runningLogs);
  renderHrDrift(runningLogs);
  renderSplitsChart(runningLogs);
  await renderRunningLogList(runningLogs);
}

async function renderPaceTrendChart(runningLogs) {
  const recent = runningLogs.slice(-20);
  const canvas = $("#chart-running-pace");
  const emptyEl = $("#empty-running-pace");
  const hasData = recent.length > 0;
  canvas.hidden = !hasData;
  emptyEl.hidden = hasData;

  const goals = await db.getSetting("runningGoals", null);
  const targetPace = goals?.targetPaceMin ?? null;
  if (document.activeElement?.id !== "running-target-pace-input") {
    $("#running-target-pace-input").value = goals?.targetPaceLabel || "";
  }

  if (!hasData) return;

  const dateLabels = recent.map((l) => l.date.slice(5));
  const points = recent.map((l, i) => ({ index: i, value: l.pace, date: l.date, logId: l.id }));
  drawPaceTrendChart(canvas, dateLabels, points, { targetPace });
  attachChartClickHandler(canvas, (point) => {
    if (point.logId != null) openRunningDetail(point.logId);
  });
}

$("#btn-save-target-pace").addEventListener("click", async () => {
  const targetPaceMin = parsePaceLabel($("#running-target-pace-input").value);
  if ($("#running-target-pace-input").value.trim() && targetPaceMin == null) {
    showToast(`목표 페이스는 5'30" 형식으로 입력해주세요`);
    return;
  }
  const goals = await db.getSetting("runningGoals", {});
  const updated = {
    ...goals,
    targetPaceMin,
    targetPaceLabel: targetPaceMin != null ? formatPaceLabel(targetPaceMin) : "",
  };
  await db.setSetting("runningGoals", updated);
  renderRunningGoalSummary(updated);
  showToast("목표 페이스가 저장되었어요");
  await renderPaceTrendChart(
    (await db.getAllWorkoutLogs()).filter((l) => l.type === "running").sort((a, b) => (a.date < b.date ? -1 : 1))
  );
});

async function renderHrZoneChart(runningLogs) {
  const canvas = $("#chart-hr-zones");
  const emptyEl = $("#empty-hr-zones");
  const summaryEl = $("#hr-zone-summary");
  const latest = runningLogs[runningLogs.length - 1];
  const zones = latest?.heart_rate_zones;
  const hasData = Array.isArray(zones) && zones.length > 0;
  canvas.hidden = !hasData;
  emptyEl.hidden = hasData;
  summaryEl.hidden = !hasData;
  if (!hasData) return;

  const bars = zones.map((z) => ({
    label: `영역${z.zone}`,
    value: parseMinutesSeconds(z.duration) ?? 0,
    color: HR_ZONE_COLORS[z.zone] || "#888",
    topLabel: z.duration ?? "",
  }));
  drawBarChart(canvas, bars, { zeroBaseline: true });

  const zoneMinutes = (zoneNums) =>
    zones
      .filter((z) => zoneNums.includes(z.zone))
      .reduce((sum, z) => sum + (parseMinutesSeconds(z.duration) ?? 0), 0);
  const totalMin = bars.reduce((sum, b) => sum + b.value, 0) || 1;
  const lowPct = Math.round((zoneMinutes([1, 2]) / totalMin) * 100);
  const highPct = Math.round((zoneMinutes([4, 5]) / totalMin) * 100);
  summaryEl.textContent = `유산소 기반 훈련 ${lowPct}%, 고강도 ${highPct}%`;
}

async function renderPowerEfficiencyChart(runningLogs) {
  const withPower = runningLogs.filter((l) => l.avg_power != null).slice(-20);
  const canvas = $("#chart-power-efficiency");
  const emptyEl = $("#empty-power-efficiency");
  const hasData = withPower.length > 0;
  canvas.hidden = !hasData;
  emptyEl.hidden = hasData;
  if (!hasData) return;

  const bodyWeightKg = await getLatestBodyWeightKg();
  const dateLabels = withPower.map((l) => l.date.slice(5));
  const series = [
    {
      name: "파워 효율",
      color: "#00e5a0",
      points: withPower.map((l, i) => ({
        index: i,
        value: Math.round((l.avg_power / bodyWeightKg) * 100) / 100,
        date: l.date,
        logId: l.id,
      })),
    },
  ];
  drawMultiLineChart(canvas, dateLabels, series, { unit: "W/kg" });
}

async function renderCadenceChart(runningLogs) {
  const withCadence = runningLogs.filter((l) => l.avg_cadence != null).slice(-20);
  const canvas = $("#chart-cadence");
  const emptyEl = $("#empty-cadence");
  const hasData = withCadence.length > 0;
  canvas.hidden = !hasData;
  emptyEl.hidden = hasData;
  if (!hasData) return;

  const dateLabels = withCadence.map((l) => l.date.slice(5));
  const series = [
    {
      name: "케이던스",
      color: "#00e5a0",
      points: withCadence.map((l, i) => ({ index: i, value: l.avg_cadence, date: l.date, logId: l.id })),
    },
  ];
  drawMultiLineChart(canvas, dateLabels, series, {
    unit: "spm",
    referenceLine: { value: 180, label: "180 (이상적)", color: "#9a9a9a" },
  });
}

function renderHrDrift(runningLogs) {
  const el = $("#hr-drift-content");
  const latest = runningLogs[runningLogs.length - 1];
  const splits = latest?.splits;
  const hrValues = Array.isArray(splits)
    ? splits.map((s) => Number(s.heart_rate)).filter((v) => isFinite(v))
    : [];

  if (hrValues.length < 2) {
    el.innerHTML = `<p class="empty-hint">스플릿 심박수 데이터가 부족해요</p>`;
    return;
  }

  const half = Math.floor(hrValues.length / 2);
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  // round each half's average first, then diff the rounded numbers — so the
  // displayed drift always matches what you'd get subtracting the two
  // displayed bpm values by hand
  const firstAvg = Math.round(avg(hrValues.slice(0, half)));
  const secondAvg = Math.round(avg(hrValues.slice(half)));
  const drift = secondAvg - firstAvg;

  el.innerHTML = `
    <div>전반 평균 ${firstAvg}bpm → 후반 평균 ${secondAvg}bpm</div>
    <div class="hr-drift-value">${drift >= 0 ? "+" : ""}${drift}bpm 드리프트</div>
  `;
}

function renderSplitsChart(runningLogs) {
  const canvas = $("#chart-splits");
  const emptyEl = $("#empty-splits");
  const badgeEl = $("#splits-negative-badge");
  const latest = runningLogs[runningLogs.length - 1];
  const splits = latest?.splits;
  const hasData = Array.isArray(splits) && splits.length > 0;
  canvas.hidden = !hasData;
  emptyEl.hidden = hasData;
  badgeEl.hidden = true;
  if (!hasData) return;

  const bars = splits.map((s) => ({
    label: `${s.km}`,
    value: parsePaceLabel(s.pace) ?? 0,
    color: "#00e5a0",
    topLabel: s.heart_rate != null ? `${s.heart_rate}bpm` : "",
  }));
  drawBarChart(canvas, bars);

  const paceValues = splits.map((s) => parsePaceLabel(s.pace)).filter((v) => v != null);
  if (paceValues.length >= 2) {
    const half = Math.floor(paceValues.length / 2);
    const firstAvg = paceValues.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const secondAvg = paceValues.slice(half).reduce((a, b) => a + b, 0) / (paceValues.length - half);
    badgeEl.hidden = !(secondAvg < firstAvg);
  }
}

async function renderRunningLogList(runningLogsSorted) {
  const container = $("#running-log-list");
  const runningLogs =
    runningLogsSorted ?? (await db.getAllWorkoutLogs()).filter((l) => l.type === "running").sort((a, b) => (a.date < b.date ? -1 : 1));
  const ordered = runningLogs.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));

  if (!ordered.length) {
    container.innerHTML = `<p class="empty-hint">기록된 러닝이 없어요.</p>`;
    return;
  }

  const bodyWeightKg = await getLatestBodyWeightKg();
  container.innerHTML = "";
  ordered.forEach((log) => {
    const calories = log.total_calories ?? Math.round(calcRunningCalories(log, bodyWeightKg));
    const div = document.createElement("div");
    div.className = "log-item running-log-item";
    div.innerHTML = `
      <div class="log-main">
        <span class="log-title">${log.date} · ${log.distance}km</span>
        <span class="log-sub">페이스 ${formatPaceLabel(log.pace)}/km${
      log.avg_heart_rate != null ? ` · 심박수 ${log.avg_heart_rate}bpm` : ""
    } · 칼로리 ${Math.round(calories)}kcal</span>
        ${log.geminiComment ? `<div class="running-log-comment">🤖 ${log.geminiComment}</div>` : ""}
      </div>`;
    div.addEventListener("click", () => openRunningDetail(log.id));
    container.appendChild(div);
  });
}

let currentRunningDetailId = null;

async function openRunningDetail(logId) {
  const allLogs = await db.getAllWorkoutLogs();
  const log = allLogs.find((l) => l.id === logId);
  if (!log) return;
  currentRunningDetailId = logId;

  $("#running-detail-title").textContent = `${log.date} · ${log.distance}km 러닝`;

  const bodyWeightKg = await getLatestBodyWeightKg();
  const calories = log.total_calories ?? Math.round(calcRunningCalories(log, bodyWeightKg));

  const summaryHtml = `
    <div class="running-detail-section">
      <h3>요약</h3>
      <div class="log-table-detail">
        <div>거리: ${log.distance}km</div>
        <div>시간: ${log.duration}분</div>
        <div>페이스: ${formatPaceLabel(log.pace)}/km</div>
        ${log.location ? `<div>장소: ${log.location}</div>` : ""}
        ${log.avg_heart_rate != null ? `<div>평균 심박수: ${log.avg_heart_rate}bpm</div>` : ""}
        ${log.avg_power != null ? `<div>평균 파워: ${log.avg_power}W</div>` : ""}
        ${log.avg_cadence != null ? `<div>평균 케이던스: ${log.avg_cadence}spm</div>` : ""}
        ${log.elevation_gain != null ? `<div>등반고도: ${log.elevation_gain}m</div>` : ""}
        ${log.intensity_text ? `<div>운동강도: ${log.intensity_level ?? ""} ${log.intensity_text}</div>` : ""}
        <div>칼로리: 약 ${Math.round(calories)}kcal</div>
      </div>
    </div>`;

  const zonesHtml =
    Array.isArray(log.heart_rate_zones) && log.heart_rate_zones.length
      ? `<div class="running-detail-section"><h3>심박수 영역</h3>${log.heart_rate_zones
          .map(
            (z) =>
              `<div class="hr-zone-row"><span class="hr-zone-dot" style="background:${
                HR_ZONE_COLORS[z.zone] || "#888"
              }"></span>영역${z.zone} · ${z.duration ?? "-"}${z.bpm_range ? ` (${z.bpm_range})` : ""}</div>`
          )
          .join("")}</div>`
      : "";

  const splitsHtml =
    Array.isArray(log.splits) && log.splits.length
      ? `<div class="running-detail-section"><h3>스플릿</h3>
          <table class="log-table">
            <thead><tr><th>km</th><th>시간</th><th>페이스</th><th>심박수</th><th>파워</th></tr></thead>
            <tbody>${log.splits
              .map(
                (s) =>
                  `<tr><td>${s.km}</td><td>${s.time ?? "-"}</td><td>${s.pace ?? "-"}</td><td>${s.heart_rate ?? "-"}</td><td>${s.power ?? "-"}</td></tr>`
              )
              .join("")}</tbody>
          </table>
        </div>`
      : "";

  const commentHtml = log.geminiComment
    ? `<div class="running-detail-section"><h3>🤖 Gemini 코멘트</h3><p>${log.geminiComment}</p></div>`
    : "";

  $("#running-detail-content").innerHTML = summaryHtml + zonesHtml + splitsHtml + commentHtml;
  $("#modal-running-detail").hidden = false;
}

$("#btn-close-running-detail").addEventListener("click", () => {
  $("#modal-running-detail").hidden = true;
  currentRunningDetailId = null;
});

$("#btn-delete-running-detail").addEventListener("click", async () => {
  if (currentRunningDetailId == null) return;
  if (!confirm("정말 삭제할까요?")) return;
  await db.deleteWorkoutLog(currentRunningDetailId);
  $("#modal-running-detail").hidden = true;
  currentRunningDetailId = null;
  await renderRunningSection();
  const logs = await db.getWorkoutLogsByDate(todayStr());
  await renderWorkoutLogList(logs);
  renderHomeWorkoutSummary(logs);
});

/* ---------------- inbody tab ---------------- */

const INBODY_METRIC_LABELS = {
  weight: "체중",
  muscleMass: "골격근량",
  bodyFatMass: "체지방량",
  bmi: "BMI",
  bodyFat: "체지방률",
};

const INBODY_METRIC_UNITS = {
  weight: "kg",
  muscleMass: "kg",
  bodyFatMass: "kg",
  bmi: "",
  bodyFat: "%",
};

const INBODY_METRICS = ["weight", "muscleMass", "bodyFatMass", "bmi", "bodyFat"];

let inbodyRecordsCache = [];

async function renderInbodyChart() {
  INBODY_METRICS.forEach((metric) => {
    const withMetric = inbodyRecordsCache.filter((r) => r[metric] !== null && r[metric] !== undefined);
    const recent = withMetric.slice(-10);
    const values = recent.map((r) => r[metric]);
    // y-axis grid/labels use the shared nice-step rule (see chart.js
    // computeNiceYRange) — drawLineChart computes it internally
    drawLineChart(
      $(`#chart-inbody-${metric}`),
      recent.map((r) => r.date.slice(5)),
      values,
      { color: "#00e5a0", unit: INBODY_METRIC_UNITS[metric] }
    );
  });
}

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
  };
  await db.addInbodyRecord(record);
  $("#inbody-form").reset();
  closeInbodyForm();
  await renderInbodyTab();
  await checkForNewBadges();
  showToast("인바디 기록이 추가되었어요");
});

/* ---------------- badges tab ---------------- */

let allBadgesCache = [];

function formatBadgeDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${y}.${m}.${d}`;
}

/* 1~6번 카테고리(PR/연속/유산소/인바디/생활습관/볼륨): 시리즈별 가로 스크롤 행
   7~11번 카테고리(스타일/특별/마일스톤/챌린지/히든): 필터 없이 grid로 나열 */
const SERIES_GROUPED_CATEGORIES = new Set(["pr", "연속", "cardio", "inbody", "lifestyle", "volume"]);

function renderBadgeCard(b) {
  const icon = renderBadgeIconSvg(b, { width: 48, height: 48 });
  return `
    <button type="button" class="badge-card${b.achieved ? " achieved" : ""}" data-badge-id="${b.id}" aria-label="${b.name}">
      ${icon}
    </button>`;
}

function renderCategorySection(cat) {
  const badgesInCat = allBadgesCache.filter((b) => b.category === cat.key);
  if (!badgesInCat.length) return "";

  const achievedCount = badgesInCat.filter((b) => b.achieved).length;
  const header = `
    <div class="badge-section-header">
      <span class="badge-section-title">${cat.label}</span>
      <span class="badge-section-count">${achievedCount} / ${badgesInCat.length}</span>
    </div>`;

  if (!SERIES_GROUPED_CATEGORIES.has(cat.key)) {
    // 그냥 나열: 필터/구분 없이 achieved-first 정렬한 grid
    const sorted = badgesInCat.slice().sort((a, b) => b.achieved - a.achieved);
    const cards = sorted.map(renderBadgeCard).join("");
    return `<section class="badge-section">${header}<div class="badge-flat-grid">${cards}</div></section>`;
  }

  // 같은 시리즈끼리 원래 순서 그대로 묶고, 다른 시리즈는 새 줄
  const seriesOrder = [];
  const seriesMap = new Map();
  badgesInCat.forEach((b) => {
    const key = b.series || b.name;
    if (!seriesMap.has(key)) {
      seriesMap.set(key, []);
      seriesOrder.push(key);
    }
    seriesMap.get(key).push(b);
  });

  const rows = seriesOrder
    .map((seriesName) => {
      const badgesInSeries = seriesMap
        .get(seriesName)
        .slice()
        .sort((a, b) => b.achieved - a.achieved);
      const cards = badgesInSeries.map(renderBadgeCard).join("");
      return `
        <div class="badge-series-row">
          <div class="badge-series-title">${seriesName}</div>
          <div class="badge-series-scroll">${cards}</div>
        </div>`;
    })
    .join("");

  return `<section class="badge-section">${header}${rows}</section>`;
}

function renderBadgeSections() {
  const container = $("#badge-sections");

  const groupedHtml = BADGE_CATEGORIES.filter((c) => SERIES_GROUPED_CATEGORIES.has(c.key))
    .map(renderCategorySection)
    .join("");
  const flatHtml = BADGE_CATEGORIES.filter((c) => !SERIES_GROUPED_CATEGORIES.has(c.key))
    .map(renderCategorySection)
    .join("");

  container.innerHTML = `${groupedHtml}<div class="badge-zone-divider"></div>${flatHtml}`;

  $$(".badge-card", container).forEach((card) => {
    card.addEventListener("click", () => openBadgeModal(card.dataset.badgeId));
  });
}

function renderBadgeSummary() {
  const total = allBadgesCache.length;
  const achieved = allBadgesCache.filter((b) => b.achieved).length;
  const pct = total ? Math.round((achieved / total) * 100) : 0;
  $("#badge-summary").innerHTML = `
    <div class="badge-summary-count">🏅 ${achieved} / ${total}개 달성</div>
    <div class="badge-summary-bar"><div class="badge-summary-bar-fill" style="width:${pct}%"></div></div>
  `;

  $("#badge-category-bars").innerHTML = BADGE_CATEGORIES.map((cat) => {
    const inCat = allBadgesCache.filter((b) => b.category === cat.key);
    if (!inCat.length) return "";
    const catAchieved = inCat.filter((b) => b.achieved).length;
    const catPct = Math.round((catAchieved / inCat.length) * 100);
    return `
      <div class="badge-cat-bar-row">
        <span class="badge-cat-bar-label">${cat.label}</span>
        <div class="badge-cat-bar-track"><div class="badge-cat-bar-fill" style="width:${catPct}%"></div></div>
        <span class="badge-cat-bar-count">${catAchieved}/${inCat.length}</span>
      </div>`;
  }).join("");
}

function computeProgressPercent(badge) {
  const p = badge.progress;
  if (!p) return 0;
  if (p.invert) {
    if (p.current == null || p.current <= 0) return 0;
    return Math.max(0, Math.min(100, (p.target / p.current) * 100));
  }
  if (!p.target) return 0;
  return Math.max(0, Math.min(100, (p.current / p.target) * 100));
}

function renderRecentBadges() {
  const card = $("#badge-recent-card");
  const recent = allBadgesCache
    .filter((b) => b.achieved)
    .sort((a, b) => (a.achievedDate < b.achievedDate ? 1 : a.achievedDate > b.achievedDate ? -1 : 0))
    .slice(0, 5);

  if (!recent.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  $("#badge-recent-list").innerHTML = recent
    .map(
      (b) => `
        <div class="badge-recent-item">
          ${renderBadgeCard(b)}
          <span class="badge-recent-date">${formatBadgeDate(b.achievedDate)}</span>
        </div>`
    )
    .join("");

  $$(".badge-card", $("#badge-recent-list")).forEach((card) => {
    card.addEventListener("click", () => openBadgeModal(card.dataset.badgeId));
  });
}

function renderUpcomingBadges() {
  const card = $("#badge-upcoming-card");
  const upcoming = allBadgesCache
    .filter((b) => !b.achieved && computeProgressPercent(b) >= 70)
    .map((b) => ({ b, pct: computeProgressPercent(b) }))
    .sort((x, y) => y.pct - x.pct)
    .slice(0, 5);

  if (!upcoming.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  $("#badge-upcoming-list").innerHTML = upcoming
    .map(
      ({ b, pct }) => `
        <div class="badge-upcoming-item">
          ${renderBadgeCard(b)}
          <div class="badge-upcoming-info">
            <div class="badge-upcoming-name">${b.name}</div>
            <div class="badge-upcoming-bar-track"><div class="badge-upcoming-bar-fill" style="width:${pct}%"></div></div>
            <div class="badge-upcoming-fraction">${formatProgressText(b)}</div>
          </div>
        </div>`
    )
    .join("");

  $$(".badge-card", $("#badge-upcoming-list")).forEach((card) => {
    card.addEventListener("click", () => openBadgeModal(card.dataset.badgeId));
  });
}

function openBadgeModal(badgeId) {
  const badge = allBadgesCache.find((b) => b.id === badgeId);
  if (!badge) return;

  const categoryLabel = BADGE_CATEGORIES.find((c) => c.key === badge.category)?.label || badge.category;
  $("#badge-modal-icon").innerHTML = renderBadgeIconSvg(badge, { width: 120, height: 120 });
  $("#badge-modal-icon").classList.toggle("achieved", badge.achieved);
  $("#badge-modal-name").textContent = badge.name;
  $("#badge-modal-category").textContent = categoryLabel;
  $("#badge-modal-desc").textContent = badge.description;

  const statusEl = $("#badge-modal-status");
  if (badge.achieved) {
    statusEl.innerHTML = `
      <p class="badge-modal-achieved-msg">🎉 축하해요! 뱃지를 획득했어요</p>
      <p class="badge-modal-date">획득일: ${formatBadgeDate(badge.achievedDate)}</p>
    `;
  } else {
    statusEl.innerHTML = `<p class="badge-modal-progress">📊 진행률: ${formatProgressText(badge)}</p>`;
  }

  $("#modal-badge-detail").hidden = false;
}

function closeBadgeModal() {
  $("#modal-badge-detail").hidden = true;
}

$("#btn-close-badge-modal").addEventListener("click", closeBadgeModal);
$("#modal-badge-detail").addEventListener("click", (e) => {
  if (e.target.id === "modal-badge-detail") closeBadgeModal();
});

async function renderBadgesTab() {
  allBadgesCache = await evaluateAllBadges();
  renderBadgeSummary();
  renderRecentBadges();
  renderUpcomingBadges();
  renderBadgeSections();
}

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
  { name: "천국의계단", category: "유산소" },
];

const STAIRMASTER_NAME = "천국의계단";

async function ensureStairmasterEquipment() {
  const existing = await db.getEquipmentList();
  if (!existing.some((eq) => eq.name === STAIRMASTER_NAME)) {
    await db.addEquipment({ name: STAIRMASTER_NAME, manufacturer: "", category: "유산소", memo: "", photo: null });
  }
}

/* ---------------- settings tab ---------------- */

function renderGoalSummary(goals) {
  const parts = [];
  if (goals?.targetWeight) parts.push(`체중 ${goals.targetWeight}kg`);
  if (goals?.targetBodyFat) parts.push(`체지방률 ${goals.targetBodyFat}%`);
  if (goals?.targetMuscleMass) parts.push(`골격근량 ${goals.targetMuscleMass}kg`);
  $("#goal-summary").textContent = parts.length ? parts.join(" · ") : "아직 설정된 목표가 없어요.";
}

/* accordion: 목표 설정 폼 펼치기/접기 */
const goalsFormCard = $("#goals-form-card");
const btnToggleGoalsForm = $("#btn-toggle-goals-form");

function openGoalsForm() {
  goalsFormCard.hidden = false;
  btnToggleGoalsForm.textContent = "닫기";
}

function closeGoalsForm() {
  goalsFormCard.hidden = true;
  btnToggleGoalsForm.textContent = "목표 설정 +";
}

btnToggleGoalsForm.addEventListener("click", () => {
  if (goalsFormCard.hidden) openGoalsForm();
  else closeGoalsForm();
});

/* ---------------- settings tab: running goals ---------------- */

function renderRunningGoalSummary(goals) {
  const parts = [];
  if (goals?.targetPaceLabel) parts.push(`페이스 ${goals.targetPaceLabel}/km`);
  if (goals?.targetWeeklyKm) parts.push(`주간 ${goals.targetWeeklyKm}km`);
  if (goals?.targetZone3PlusPct) parts.push(`영역3+ ${goals.targetZone3PlusPct}%`);
  $("#running-goal-summary").textContent = parts.length ? parts.join(" · ") : "아직 설정된 러닝 목표가 없어요.";
}

const runningGoalsFormCard = $("#running-goals-form-card");
const btnToggleRunningGoalsForm = $("#btn-toggle-running-goals-form");

function openRunningGoalsForm() {
  runningGoalsFormCard.hidden = false;
  btnToggleRunningGoalsForm.textContent = "닫기";
}

function closeRunningGoalsForm() {
  runningGoalsFormCard.hidden = true;
  btnToggleRunningGoalsForm.textContent = "러닝 목표 설정 +";
}

btnToggleRunningGoalsForm.addEventListener("click", () => {
  if (runningGoalsFormCard.hidden) openRunningGoalsForm();
  else closeRunningGoalsForm();
});

$("#running-goals-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const targetPaceMin = parsePaceLabel($("#running-goal-pace").value);
  if ($("#running-goal-pace").value.trim() && targetPaceMin == null) {
    showToast(`목표 페이스는 5'30" 형식으로 입력해주세요`);
    return;
  }
  const goals = {
    targetPaceMin,
    targetPaceLabel: targetPaceMin != null ? formatPaceLabel(targetPaceMin) : "",
    targetWeeklyKm: Number($("#running-goal-weekly-km").value) || null,
    targetZone3PlusPct: Number($("#running-goal-zone3-pct").value) || null,
  };
  await db.setSetting("runningGoals", goals);
  renderRunningGoalSummary(goals);
  closeRunningGoalsForm();
  await renderRunningSection();
  showToast("러닝 목표가 저장되었어요");
});

/* ---------------- settings tab: Gemini API key ---------------- */

$("#api-key-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = sanitizeApiKey($("#gemini-api-key").value);
  await db.setSetting("geminiApiKey", key);
  $("#gemini-api-key").value = key;
  showToast("API 키가 저장되었어요");
});

/* ---------------- settings tab: workout notification ---------------- */

const NOTIFY_SETTINGS_KEY = "workoutNotify";
let selectedNotifyDays = new Set();

function updateNotifyPermissionStatus(permissionOverride) {
  const el = $("#notify-permission-status");
  const btn = $("#btn-notify-permission");
  if (!("Notification" in window)) {
    el.textContent = "이 브라우저는 알림을 지원하지 않아요";
    el.className = "notify-permission-status denied";
    btn.disabled = true;
    return;
  }
  const permission = permissionOverride ?? Notification.permission;
  if (permission === "granted") {
    el.textContent = "✅ 알림이 허용되었어요";
    el.className = "notify-permission-status granted";
    btn.disabled = true;
    btn.textContent = "🔔 알림 허용됨";
  } else if (permission === "denied") {
    el.textContent = "🚫 알림이 차단되었어요. 브라우저 설정에서 허용해주세요";
    el.className = "notify-permission-status denied";
    btn.disabled = false;
    btn.textContent = "🔔 알림 허용";
  } else {
    el.textContent = "알림을 받으려면 허용해주세요";
    el.className = "notify-permission-status";
    btn.disabled = false;
    btn.textContent = "🔔 알림 허용";
  }
}

$("#btn-notify-permission").addEventListener("click", async () => {
  if (!("Notification" in window)) return;
  let permission = Notification.permission;
  try {
    permission = await Notification.requestPermission();
  } catch {}
  updateNotifyPermissionStatus(permission);
});

$$(".weekday-toggle-btn", $("#notify-weekday-row")).forEach((btn) => {
  btn.addEventListener("click", () => {
    const day = btn.dataset.day;
    if (selectedNotifyDays.has(day)) {
      selectedNotifyDays.delete(day);
    } else {
      selectedNotifyDays.add(day);
    }
    btn.classList.toggle("active", selectedNotifyDays.has(day));
  });
});

$("#btn-save-notify-settings").addEventListener("click", async () => {
  const notifyTime = $("#notify-time-input").value || "09:00";
  const notifyDays = [...selectedNotifyDays].map(Number).sort();

  await db.setSetting(NOTIFY_SETTINGS_KEY, { notifyDays, notifyTime });

  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "workout-notify-settings-updated" });
  }

  if ("serviceWorker" in navigator && "periodicSync" in ServiceWorkerRegistration.prototype) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.periodicSync.register("workout-reminder-check", { minInterval: 60 * 60 * 1000 });
    } catch {}
  }

  showToast("알림 설정이 저장되었어요");
});

async function renderNotifySettings() {
  updateNotifyPermissionStatus();

  const saved = await db.getSetting(NOTIFY_SETTINGS_KEY, null);
  selectedNotifyDays = new Set((saved?.notifyDays ?? []).map(String));
  $("#notify-time-input").value = saved?.notifyTime ?? "09:00";

  $$(".weekday-toggle-btn", $("#notify-weekday-row")).forEach((btn) => {
    btn.classList.toggle("active", selectedNotifyDays.has(btn.dataset.day));
  });
}

async function renderSettingsTab() {
  const goals = await db.getSetting("fitnessGoals", {});
  $("#goal-current-weight").value = goals.currentWeight ?? "";
  $("#goal-target-weight").value = goals.targetWeight ?? "";
  $("#goal-target-fat").value = goals.targetBodyFat ?? "";
  $("#goal-target-muscle").value = goals.targetMuscleMass ?? "";
  $("#goal-note").value = goals.note ?? "";
  renderGoalSummary(goals);

  const runningGoals = await db.getSetting("runningGoals", {});
  $("#running-goal-pace").value = runningGoals.targetPaceLabel ?? "";
  $("#running-goal-weekly-km").value = runningGoals.targetWeeklyKm ?? "";
  $("#running-goal-zone3-pct").value = runningGoals.targetZone3PlusPct ?? "";
  renderRunningGoalSummary(runningGoals);

  $("#gemini-api-key").value = await db.getSetting("geminiApiKey", "");

  await renderEquipmentList();
  await renderNotifySettings();
}

let settingsEquipmentCache = [];

/* ---- category tabs for the equipment list ---- */
const EQUIPMENT_CATEGORIES = ["가슴", "등", "하체", "어깨", "팔", "복근", "유산소"];
let selectedEquipmentCategory = "all";

function getFilteredEquipmentList() {
  if (selectedEquipmentCategory === "all") return settingsEquipmentCache;
  if (selectedEquipmentCategory === "기타") {
    return settingsEquipmentCache.filter((eq) => !EQUIPMENT_CATEGORIES.includes(eq.category));
  }
  return settingsEquipmentCache.filter((eq) => eq.category === selectedEquipmentCategory);
}

function renderEquipmentCategoryTabs() {
  const container = $("#equipment-category-tabs");
  const counts = { all: settingsEquipmentCache.length, 기타: 0 };
  EQUIPMENT_CATEGORIES.forEach((cat) => {
    counts[cat] = 0;
  });
  settingsEquipmentCache.forEach((eq) => {
    if (EQUIPMENT_CATEGORIES.includes(eq.category)) counts[eq.category]++;
    else counts["기타"]++;
  });

  const tabs = [{ key: "all", label: "전체" }, ...EQUIPMENT_CATEGORIES.map((c) => ({ key: c, label: c })), { key: "기타", label: "기타" }];

  container.innerHTML = tabs
    .map(
      (t) =>
        `<button type="button" class="pill${selectedEquipmentCategory === t.key ? " active" : ""}" data-category="${t.key}">${t.label} ${counts[t.key]}</button>`
    )
    .join("");

  $$(".pill", container).forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedEquipmentCategory = btn.dataset.category;
      $$(".pill", container).forEach((b) => b.classList.toggle("active", b === btn));
      renderFilteredEquipmentItems();
    });
  });
}

async function renderEquipmentList() {
  settingsEquipmentCache = await db.getEquipmentList();
  $("#equipment-list-toggle-label").textContent = `헬스장 기구 (${settingsEquipmentCache.length}개)`;
  renderEquipmentCategoryTabs();
  renderFilteredEquipmentItems();
}

/* accordion: 기구 리스트(카테고리 탭 + 목록) 펼치기/접기, 기본 접힘 */
let equipmentListExpanded = false;

$("#btn-toggle-equipment-list").addEventListener("click", () => {
  equipmentListExpanded = !equipmentListExpanded;
  $("#equipment-list-body").hidden = !equipmentListExpanded;
  $("#equipment-list-toggle-arrow").textContent = equipmentListExpanded ? "▲" : "▼";
});

/* accordion: 기구 등록 폼 펼치기/접기 */
const equipmentFormCard = $("#equipment-form-card");
const btnToggleEquipmentForm = $("#btn-toggle-equipment-form");

function openEquipmentForm() {
  equipmentFormCard.hidden = false;
  btnToggleEquipmentForm.textContent = "닫기";
}

function closeEquipmentForm() {
  equipmentFormCard.hidden = true;
  btnToggleEquipmentForm.textContent = "기구 추가 +";
}

btnToggleEquipmentForm.addEventListener("click", () => {
  if (equipmentFormCard.hidden) openEquipmentForm();
  else closeEquipmentForm();
});

function renderFilteredEquipmentItems() {
  const container = $("#equipment-list");
  const filtered = getFilteredEquipmentList();
  if (!filtered.length) {
    container.innerHTML = `<p class="empty-hint">등록된 기구가 없어요.</p>`;
    return;
  }
  container.innerHTML = "";
  filtered.forEach((eq) => {
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

function readPhotoFile(file, onLoaded) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => onLoaded(reader.result);
  reader.readAsDataURL(file);
}

$("#btn-edit-equipment-photo-camera").addEventListener("click", () => {
  $("#edit-equipment-photo-camera-input").click();
});
$("#btn-edit-equipment-photo-gallery").addEventListener("click", () => {
  $("#edit-equipment-photo-gallery-input").click();
});

function onEditEquipmentPhotoSelected(e) {
  readPhotoFile(e.target.files[0], (dataUrl) => {
    pendingEditPhoto = dataUrl;
    const preview = $("#edit-equipment-photo-preview");
    preview.src = dataUrl;
    preview.hidden = false;
  });
}
$("#edit-equipment-photo-camera-input").addEventListener("change", onEditEquipmentPhotoSelected);
$("#edit-equipment-photo-gallery-input").addEventListener("change", onEditEquipmentPhotoSelected);

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
  if (existing) {
    await db.renameEquipmentInWorkoutLogs(editingEquipmentId, existing.name, name);
    await db.renameEquipmentInRoutines(editingEquipmentId, existing.name, name);
  }
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
  renderGoalSummary(goals);
  closeGoalsForm();
  showToast("목표가 저장되었어요");
});

let pendingAddPhoto = null;

$("#btn-equipment-photo-camera").addEventListener("click", () => {
  $("#equipment-photo-camera-input").click();
});
$("#btn-equipment-photo-gallery").addEventListener("click", () => {
  $("#equipment-photo-gallery-input").click();
});

function onEquipmentPhotoSelected(e) {
  readPhotoFile(e.target.files[0], (dataUrl) => {
    pendingAddPhoto = dataUrl;
    const preview = $("#equipment-photo-preview");
    preview.src = dataUrl;
    preview.hidden = false;
  });
}
$("#equipment-photo-camera-input").addEventListener("change", onEquipmentPhotoSelected);
$("#equipment-photo-gallery-input").addEventListener("change", onEquipmentPhotoSelected);

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
  closeEquipmentForm();
  await renderEquipmentList();
  showToast("기구가 추가되었어요");
});

/* app update: clear SW caches + re-register SW, never touches IndexedDB */
$("#btn-app-update").addEventListener("click", async () => {
  const btn = $("#btn-app-update");
  btn.disabled = true;
  btn.textContent = "업데이트 중...";

  try {
    if ("caches" in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
      await navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  } catch (err) {
    showToast("업데이트에 실패했어요");
    btn.disabled = false;
    btn.textContent = "🔄 최신 버전으로 업데이트";
    return;
  }

  location.reload(true);
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
  await ensureStairmasterEquipment();
  await db.deleteSetting("weeklyRoutinePrefs");
  await db.deleteSetting("weeklyRoutine");
  await db.deleteSetting("defaultRestSeconds");

  switchTab(getLastTab());
  await checkForNewBadges();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
