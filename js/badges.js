import * as db from "./db.js";

/* =====================================================================
 * 뱃지 시스템
 * 모든 뱃지는 DB에 저장되지 않고, 기존 기록(workoutLogs/inbodyRecords/
 * drinkLog2)으로부터 매번 다시 계산됩니다. "달성일"은 조건을 최초로
 * 만족시킨 시점의 날짜를 데이터에서 역산해서 구합니다.
 * ===================================================================== */

export const BADGE_CATEGORIES = [
  { key: "pr", label: "PR", color: "#FFD700" },
  { key: "streak", label: "Streak", color: "#FF6B35" },
  { key: "cardio", label: "유산소", color: "#4A9EFF" },
  { key: "inbody", label: "인바디", color: "#00E5A0" },
  { key: "lifestyle", label: "생활습관", color: "#A855F7" },
  { key: "volume", label: "볼륨", color: "#FF4444" },
];

/* ---------------- SVG 아이콘 라이브러리 (카테고리별 2종) ---------------- */
/* fill/stroke는 var(--badge-fill)/var(--badge-stroke)를 참조해서
   달성 여부에 따라 렌더링 시점에 색을 주입한다. */
const ICONS = {
  // PR류: 바벨 / 덤벨
  barbell: `
    <rect x="5" y="18" width="30" height="4" rx="2" fill="var(--badge-fill)"/>
    <rect x="2" y="14" width="4" height="12" rx="2" fill="var(--badge-fill)"/>
    <rect x="34" y="14" width="4" height="12" rx="2" fill="var(--badge-fill)"/>
    <rect x="0" y="16" width="4" height="8" rx="1.5" fill="var(--badge-fill)"/>
    <rect x="36" y="16" width="4" height="8" rx="1.5" fill="var(--badge-fill)"/>`,
  dumbbell: `
    <rect x="16" y="18" width="8" height="4" rx="1.5" fill="var(--badge-fill)"/>
    <circle cx="9" cy="20" r="7" fill="var(--badge-fill)"/>
    <circle cx="31" cy="20" r="7" fill="var(--badge-fill)"/>`,

  // streak류: 불꽃 / 캘린더
  flame: `
    <path d="M20 5c3 5-4 8-4 13a4 4 0 008 0c0-2-1-3-1-5 3 2 6 6 6 10a10 10 0 11-20 0c0-9 8-11 11-18z"
      fill="var(--badge-fill)"/>`,
  calendar: `
    <rect x="6" y="8" width="28" height="26" rx="3" stroke="var(--badge-stroke)" stroke-width="2.5" fill="none"/>
    <path d="M6 16h28" stroke="var(--badge-stroke)" stroke-width="2.5"/>
    <path d="M13 4v8M27 4v8" stroke="var(--badge-stroke)" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="12" y="21" width="6" height="6" rx="1" fill="var(--badge-fill)"/>`,

  // 유산소류: 러닝화 / 심박수
  shoe: `
    <path d="M4 30c0-3 2-5 5-6l6-2 8-6c2-1 4-1 5 1l2 3h6a4 4 0 014 4v3a3 3 0 01-3 3H7a3 3 0 01-3-3z"
      fill="var(--badge-fill)"/>
    <rect x="4" y="30" width="32" height="4" rx="2" fill="var(--badge-fill)" opacity="0.55"/>`,
  heartbeat: `
    <path d="M3 21h7l3-8 5 14 4-10 2 4h13" stroke="var(--badge-stroke)" stroke-width="3"
      stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,

  // 인바디류: 체중계 / 근육
  scale: `
    <rect x="4" y="10" width="32" height="24" rx="4" fill="var(--badge-fill)" opacity="0.25"/>
    <rect x="4" y="10" width="32" height="24" rx="4" stroke="var(--badge-stroke)" stroke-width="2.5" fill="none"/>
    <circle cx="20" cy="23" r="5" fill="var(--badge-fill)"/>
    <rect x="19" y="14" width="2" height="6" fill="var(--badge-fill)"/>`,
  muscle: `
    <path d="M10 30c-3-2-4-6-2-10 1-3 4-5 4-9 0-3 2-5 5-5 4 0 6 3 6 6 3-1 6 0 8 3 3 4 2 10-2 13-3 2-6 3-9 3H14c-1 0-3 0-4-1z"
      fill="var(--badge-fill)"/>`,

  // 생활습관류: 물병 / 하트
  bottle: `
    <rect x="15" y="4" width="10" height="6" rx="2" fill="var(--badge-fill)"/>
    <path d="M13 12h14a2 2 0 012 2v18a4 4 0 01-4 4H15a4 4 0 01-4-4V14a2 2 0 012-2z" fill="var(--badge-fill)"/>`,
  heart: `
    <path d="M20 34S5 24 5 14a8 8 0 0115-4 8 8 0 0115 4c0 10-15 20-15 20z" fill="var(--badge-fill)"/>`,

  // 볼륨/칼로리류: 번개 / 트로피
  bolt: `
    <path d="M22 3 8 22h9l-3 15 17-21h-10l1-13z" fill="var(--badge-fill)"/>`,
  trophy: `
    <path d="M12 6h16v10a8 8 0 01-16 0V6z" fill="var(--badge-fill)"/>
    <path d="M12 8H6a2 2 0 000 4c0 3 2 5 5 6M28 8h6a2 2 0 010 4c0 3-2 5-5 6"
      stroke="var(--badge-stroke)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <rect x="17" y="24" width="6" height="7" fill="var(--badge-fill)"/>
    <rect x="12" y="31" width="16" height="4" rx="1.5" fill="var(--badge-fill)"/>`,
};

export function renderBadgeIconSvg(iconKey, achieved, color) {
  const inner = ICONS[iconKey] || "";
  const fill = achieved ? color : "#444";
  const stroke = achieved ? color : "#666";
  return `<svg viewBox="0 0 40 40" width="40" height="40" style="--badge-fill:${fill};--badge-stroke:${stroke}">${inner}</svg>`;
}

/* ---------------- 순수 계산 헬퍼 (app.js와 독립적인 로컬 사본) ---------------- */
const LB_TO_KG = 0.453592;
function toKg(set) {
  return set.unit === "lb" ? set.weight * LB_TO_KG : set.weight;
}

const CALORIES_PER_KG_VOLUME = 0.05;
const DEFAULT_BODY_WEIGHT_KG = 70;

function calcLogVolume(log) {
  if (log.type !== "weight") return 0;
  return log.sets.filter((s) => s.unit !== "none").reduce((sum, s) => sum + toKg(s) * s.reps, 0);
}
function calcCaloriesFromVolume(volume, bodyWeightKg) {
  return volume * CALORIES_PER_KG_VOLUME * (bodyWeightKg / DEFAULT_BODY_WEIGHT_KG);
}

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
  const rule = BODYWEIGHT_MET_RULES.find((r) => r.keywords.some((kw) => (equipmentName || "").includes(kw)));
  return rule ? rule.met : DEFAULT_BODYWEIGHT_MET;
}
function calcBodyweightSetsCalories(log, bodyWeightKg) {
  const noneSetCount = log.sets.filter((s) => s.unit === "none").length;
  if (!noneSetCount) return 0;
  return getBodyweightMET(log.equipmentName) * bodyWeightKg * ((noneSetCount * 1) / 60);
}
function calcWeightLogCalories(log, bodyWeightKg) {
  return calcCaloriesFromVolume(calcLogVolume(log), bodyWeightKg) + calcBodyweightSetsCalories(log, bodyWeightKg);
}

function getRunningMET(pace) {
  if (pace > 7) return 8.0;
  if (pace >= 6) return 10.0;
  if (pace >= 5) return 11.5;
  if (pace >= 4) return 13.5;
  return 16.0;
}
function calcRunningCalories(log, bodyWeightKg) {
  return getRunningMET(log.pace) * bodyWeightKg * (log.duration / 60);
}

const STAIRMASTER_MET_BY_LEVEL = { 6: 6.0, 7: 7.0, 8: 8.0, 9: 9.0, 10: 10.0, 11: 11.0, 12: 12.0, 13: 13.5, 14: 15.0, 15: 16.0 };
function getStairmasterMET(level) {
  return STAIRMASTER_MET_BY_LEVEL[level] ?? 10.0;
}
function calcStairmasterCalories(log, bodyWeightKg) {
  return getStairmasterMET(log.level) * bodyWeightKg * (log.duration / 3600);
}

function calcLogCalories(log, bodyWeightKg) {
  if (log.type === "weight") return calcWeightLogCalories(log, bodyWeightKg);
  if (log.type === "running") return calcRunningCalories(log, bodyWeightKg);
  if (log.type === "stairmaster") return calcStairmasterCalories(log, bodyWeightKg);
  return 0;
}

/* ---------------- 날짜 헬퍼 ---------------- */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function formatDateObj(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}
function addDaysStr(dateStr, days) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return formatDateObj(d);
}
function isNextDay(prevStr, curStr) {
  return addDaysStr(prevStr, 1) === curStr;
}
function weekKeyOf(dateStr) {
  const d = parseDate(dateStr);
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - d.getDay());
  return formatDateObj(weekStart);
}
function isNextWeekKey(prevKey, curKey) {
  return addDaysStr(prevKey, 7) === curKey;
}
function byDateThenId(a, b) {
  if (a.date < b.date) return -1;
  if (a.date > b.date) return 1;
  return (a.id ?? 0) - (b.id ?? 0);
}

/* ---------------- 시계열 포인트 계산 헬퍼 ---------------- */
function firstReaching(points, threshold) {
  const hit = points.find((p) => p.value >= threshold);
  return hit ? hit.date : null;
}
function findNthDate(datesSorted, n) {
  return datesSorted.length >= n ? datesSorted[n - 1] : null;
}
function computeCumulativePoints(logsSorted, valueFn) {
  let cum = 0;
  const points = [];
  for (const log of logsSorted) {
    cum += valueFn(log);
    points.push({ date: log.date, value: cum });
  }
  return points;
}
function computeStreakAchievements(datesSorted) {
  const results = [];
  let streak = 0;
  let prev = null;
  for (const date of datesSorted) {
    streak = prev && isNextDay(prev, date) ? streak + 1 : 1;
    results.push({ date, value: streak });
    prev = date;
  }
  return results;
}
function computeGroupedCounts(datesSorted, keyFn) {
  const counts = new Map();
  const results = [];
  for (const date of datesSorted) {
    const key = keyFn(date);
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    results.push({ date, value: count });
  }
  return results;
}
function computeWeeklyQualifyingStreak(datesSorted, minPerWeek) {
  const weekMap = new Map();
  for (const date of datesSorted) {
    const wk = weekKeyOf(date);
    if (!weekMap.has(wk)) weekMap.set(wk, []);
    weekMap.get(wk).push(date);
  }
  const weekKeysSorted = [...weekMap.keys()].sort();
  const results = [];
  let streak = 0;
  let prevKey = null;
  for (const wk of weekKeysSorted) {
    const daysInWeek = weekMap.get(wk);
    if (daysInWeek.length < minPerWeek) {
      streak = 0;
      prevKey = null;
      continue;
    }
    streak = prevKey && isNextWeekKey(prevKey, wk) ? streak + 1 : 1;
    results.push({ date: daysInWeek[daysInWeek.length - 1], value: streak });
    prevKey = wk;
  }
  return results;
}
function matchesKeyword(name, keywords) {
  return keywords.some((kw) => (name || "").includes(kw));
}
function computeRunningMaxByKeywords(weightLogsSorted, keywords) {
  let runningMax = 0;
  const points = [];
  for (const log of weightLogsSorted) {
    if (!matchesKeyword(log.equipmentName, keywords)) continue;
    const weights = log.sets.filter((s) => s.unit !== "none").map(toKg);
    if (!weights.length) continue;
    const logMax = Math.max(...weights);
    if (logMax > runningMax) {
      runningMax = logMax;
      points.push({ date: log.date, value: runningMax });
    }
  }
  return points;
}
function computeAllPrEvents(weightLogsSorted) {
  const maxByEquipment = new Map();
  const events = [];
  for (const log of weightLogsSorted) {
    const weights = log.sets.filter((s) => s.unit !== "none").map(toKg);
    if (!weights.length) continue;
    const logMax = Math.max(...weights);
    const key = log.equipmentName || "";
    const prevMax = maxByEquipment.get(key) || 0;
    if (logMax > prevMax) {
      maxByEquipment.set(key, logMax);
      events.push({ date: log.date, value: events.length + 1 });
    }
  }
  return events;
}
function computeInbodyDeltaPoints(sorted, field, direction) {
  if (!sorted.length) return [];
  const baseline = sorted[0][field];
  if (baseline === null || baseline === undefined) return [];
  const points = [];
  for (const r of sorted) {
    const v = r[field];
    if (v === null || v === undefined) continue;
    const delta = direction === "decrease" ? baseline - v : v - baseline;
    points.push({ date: r.date, value: delta });
  }
  return points;
}
function computeAbstinenceStreakPoints(drinkDatesSorted, earliestDate, todayStr) {
  if (!earliestDate) return [];
  const points = [];
  let cursor = earliestDate;
  const boundaries = [...drinkDatesSorted, addDaysStr(todayStr, 1)];
  for (const drinkDate of boundaries) {
    let soberCount = 0;
    let d = cursor;
    // guard against pathological loops
    let safety = 0;
    while (d < drinkDate && safety < 20000) {
      soberCount += 1;
      points.push({ date: d, value: soberCount });
      d = addDaysStr(d, 1);
      safety += 1;
    }
    cursor = addDaysStr(drinkDate, 1);
  }
  return points;
}

/* ---------------- 데이터 준비 ---------------- */
function prepare({ workoutLogs, inbodyRecords, drinkLogs }) {
  const weightLogs = workoutLogs.filter((l) => l.type === "weight").slice().sort(byDateThenId);
  const runningLogs = workoutLogs.filter((l) => l.type === "running").slice().sort(byDateThenId);
  const stairLogs = workoutLogs.filter((l) => l.type === "stairmaster").slice().sort(byDateThenId);
  const allLogsSorted = workoutLogs.slice().sort(byDateThenId);
  const allWorkoutDatesSorted = [...new Set(workoutLogs.map((l) => l.date))].sort();
  const inbodySorted = inbodyRecords.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const proteinDatesSorted = [...new Set(drinkLogs.filter((d) => d.type === "protein").map((d) => d.date))].sort();
  const drinkDatesSorted = [...new Set(drinkLogs.filter((d) => d.type === "drink" || d.type === "light").map((d) => d.date))].sort();
  const workoutDateSet = new Set(allWorkoutDatesSorted);

  const bodyWeightKg = inbodySorted.length ? inbodySorted[inbodySorted.length - 1].weight ?? DEFAULT_BODY_WEIGHT_KG : DEFAULT_BODY_WEIGHT_KG;

  const todayStr = formatDateObj(new Date());
  const allDates = [
    ...workoutLogs.map((l) => l.date),
    ...inbodyRecords.map((r) => r.date),
    ...drinkLogs.map((d) => d.date),
  ];
  const earliestDate = allDates.length ? allDates.reduce((min, d) => (d < min ? d : min)) : null;

  return {
    weightLogs,
    runningLogs,
    stairLogs,
    allWorkoutDatesSorted,
    inbodySorted,

    prEvents: computeAllPrEvents(weightLogs),
    benchMaxPoints: computeRunningMaxByKeywords(weightLogs, ["벤치프레스", "벤치"]),
    squatMaxPoints: computeRunningMaxByKeywords(weightLogs, ["스쿼트"]),
    deadliftMaxPoints: computeRunningMaxByKeywords(weightLogs, ["데드리프트", "데드"]),

    dailyStreak: computeStreakAchievements(allWorkoutDatesSorted),
    weeklyCounts: computeGroupedCounts(allWorkoutDatesSorted, weekKeyOf),
    monthlyCounts: computeGroupedCounts(allWorkoutDatesSorted, (d) => d.slice(0, 7)),
    weeklyStreak3: computeWeeklyQualifyingStreak(allWorkoutDatesSorted, 3),

    cumulativeRunDistance: computeCumulativePoints(runningLogs, (l) => l.distance),
    cumulativeStairMinutes: computeCumulativePoints(stairLogs, (l) => l.duration / 60),

    weightLossPoints: computeInbodyDeltaPoints(inbodySorted, "weight", "decrease"),
    bodyFatDeltaPoints: computeInbodyDeltaPoints(inbodySorted, "bodyFat", "decrease"),
    muscleGainPoints: computeInbodyDeltaPoints(inbodySorted, "muscleMass", "increase"),

    proteinStreak: computeStreakAchievements(proteinDatesSorted),
    proteinDatesSorted,
    noDrinkStreak: computeAbstinenceStreakPoints(drinkDatesSorted, earliestDate, todayStr),
    workoutAndProteinSameDayDates: proteinDatesSorted.filter((d) => workoutDateSet.has(d)).sort(),

    cumulativeVolume: computeCumulativePoints(weightLogs, (l) => calcLogVolume(l)),
    cumulativeCalories: computeCumulativePoints(allLogsSorted, (l) => calcLogCalories(l, bodyWeightKg)),
  };
}

/* ---------------- 뱃지 정의 빌더 ---------------- */
function finalize(list) {
  return list.map((b) => ({ ...b, achieved: !!b.achievedDate }));
}

function buildBadges(data) {
  const list = [];

  /* ============ 💪 PR 달성 (20개) ============ */
  [40, 60, 80, 100, 120].forEach((t) => {
    list.push({
      id: `pr-bench-${t}`,
      category: "pr",
      icon: "barbell",
      name: `벤치프레스 ${t}kg`,
      description: `벤치프레스 최고 중량 ${t}kg 이상을 기록했어요`,
      achievedDate: firstReaching(data.benchMaxPoints, t),
    });
  });
  [60, 80, 100, 120, 150].forEach((t) => {
    list.push({
      id: `pr-squat-${t}`,
      category: "pr",
      icon: "barbell",
      name: `스쿼트 ${t}kg`,
      description: `스쿼트 최고 중량 ${t}kg 이상을 기록했어요`,
      achievedDate: firstReaching(data.squatMaxPoints, t),
    });
  });
  [60, 80, 100, 120, 150].forEach((t) => {
    list.push({
      id: `pr-deadlift-${t}`,
      category: "pr",
      icon: "barbell",
      name: `데드리프트 ${t}kg`,
      description: `데드리프트 최고 중량 ${t}kg 이상을 기록했어요`,
      achievedDate: firstReaching(data.deadliftMaxPoints, t),
    });
  });
  [5, 10, 15, 20, 30].forEach((t) => {
    list.push({
      id: `pr-count-${t}`,
      category: "pr",
      icon: "dumbbell",
      name: `PR ${t}회 갱신`,
      description: `개인 최고 기록을 총 ${t}회 갱신했어요`,
      achievedDate: firstReaching(data.prEvents, t),
    });
  });

  /* ============ 🔥 연속 운동 streak (20개) ============ */
  [3, 7, 14, 30, 60, 100].forEach((t) => {
    list.push({
      id: `streak-days-${t}`,
      category: "streak",
      icon: "flame",
      name: `연속 운동 ${t}일`,
      description: `${t}일 연속으로 운동을 기록했어요`,
      achievedDate: firstReaching(data.dailyStreak, t),
    });
  });
  [2, 3, 4, 5].forEach((t) => {
    list.push({
      id: `streak-weekly-${t}`,
      category: "streak",
      icon: "calendar",
      name: `주 ${t}회 달성`,
      description: `한 주에 ${t}회 이상 운동했어요`,
      achievedDate: firstReaching(data.weeklyCounts, t),
    });
  });
  [4, 12].forEach((t) => {
    list.push({
      id: `streak-weekly3-${t}`,
      category: "streak",
      icon: "flame",
      name: `주 3회 ${t}주 연속`,
      description: `주 3회 이상 운동을 ${t}주 연속 달성했어요`,
      achievedDate: firstReaching(data.weeklyStreak3, t),
    });
  });
  [10, 15, 20, 25, 30].forEach((t) => {
    list.push({
      id: `streak-monthly-${t}`,
      category: "streak",
      icon: "calendar",
      name: `한 달 ${t}회`,
      description: `한 달에 ${t}회 이상 운동했어요`,
      achievedDate: firstReaching(data.monthlyCounts, t),
    });
  });
  [100, 365, 500].forEach((t) => {
    list.push({
      id: `streak-total-${t}`,
      category: "streak",
      icon: "calendar",
      name: `누적 운동 ${t}회`,
      description: `누적 운동 일수 ${t}회를 달성했어요`,
      achievedDate: findNthDate(data.allWorkoutDatesSorted, t),
    });
  });

  /* ============ 🏃 유산소 (20개) ============ */
  list.push({
    id: "cardio-first-run",
    category: "cardio",
    icon: "shoe",
    name: "첫 러닝",
    description: "첫 러닝 기록을 남겼어요",
    achievedDate: data.runningLogs.length ? data.runningLogs[0].date : null,
  });
  [10, 50, 100, 500, 1000].forEach((t) => {
    list.push({
      id: `cardio-cum-dist-${t}`,
      category: "cardio",
      icon: "shoe",
      name: `누적 러닝 ${t}km`,
      description: `누적 러닝 거리 ${t}km를 달성했어요`,
      achievedDate: firstReaching(data.cumulativeRunDistance, t),
    });
  });
  [5, 10, 15, 21].forEach((t) => {
    const hit = data.runningLogs.find((l) => l.distance >= t);
    list.push({
      id: `cardio-single-dist-${t}`,
      category: "cardio",
      icon: "shoe",
      name: t === 21 ? "하프마라톤 완주" : `단일 러닝 ${t}km`,
      description: t === 21 ? "한 번에 21km(하프마라톤)를 달렸어요" : `한 번에 ${t}km를 달렸어요`,
      achievedDate: hit ? hit.date : null,
    });
  });
  [
    { t: 6, label: "6분/km" },
    { t: 5, label: "5분/km" },
    { t: 4.5, label: "4분30초/km" },
    { t: 4, label: "4분/km" },
  ].forEach(({ t, label }) => {
    const hit = data.runningLogs.find((l) => l.pace <= t);
    list.push({
      id: `cardio-pace-${t}`,
      category: "cardio",
      icon: "heartbeat",
      name: `페이스 ${label} 이내`,
      description: `평균 페이스 ${label} 이내로 러닝했어요`,
      achievedDate: hit ? hit.date : null,
    });
  });
  list.push({
    id: "cardio-first-stair",
    category: "cardio",
    icon: "heartbeat",
    name: "천국의계단 첫 기록",
    description: "천국의계단 운동을 처음 기록했어요",
    achievedDate: data.stairLogs.length ? data.stairLogs[0].date : null,
  });
  [10, 13, 15].forEach((t) => {
    const hit = data.stairLogs.find((l) => l.level >= t);
    list.push({
      id: `cardio-stair-level-${t}`,
      category: "cardio",
      icon: "heartbeat",
      name: `천국의계단 단계 ${t}`,
      description: `천국의계단 단계 ${t}을 달성했어요`,
      achievedDate: hit ? hit.date : null,
    });
  });
  [100, 300].forEach((t) => {
    list.push({
      id: `cardio-stair-min-${t}`,
      category: "cardio",
      icon: "heartbeat",
      name: `천국의계단 누적 ${t}분`,
      description: `천국의계단 누적 운동시간 ${t}분을 달성했어요`,
      achievedDate: firstReaching(data.cumulativeStairMinutes, t),
    });
  });

  /* ============ 📉 인바디 변화 (20개) ============ */
  list.push({
    id: "inbody-first",
    category: "inbody",
    icon: "scale",
    name: "첫 인바디 기록",
    description: "첫 인바디 기록을 남겼어요",
    achievedDate: data.inbodySorted.length ? data.inbodySorted[0].date : null,
  });
  [1, 2, 3, 5, 7, 10].forEach((t) => {
    list.push({
      id: `inbody-weight-loss-${t}`,
      category: "inbody",
      icon: "scale",
      name: `체중 -${t}kg`,
      description: `시작 대비 체중을 ${t}kg 감량했어요`,
      achievedDate: firstReaching(data.weightLossPoints, t),
    });
  });
  [1, 2, 3, 5].forEach((t) => {
    list.push({
      id: `inbody-bodyfat-${t}`,
      category: "inbody",
      icon: "muscle",
      name: `체지방률 -${t}%p`,
      description: `시작 대비 체지방률을 ${t}%p 감소시켰어요`,
      achievedDate: firstReaching(data.bodyFatDeltaPoints, t),
    });
  });
  [0.5, 1, 2, 3].forEach((t) => {
    list.push({
      id: `inbody-muscle-${t}`,
      category: "inbody",
      icon: "muscle",
      name: `골격근량 +${t}kg`,
      description: `시작 대비 골격근량을 ${t}kg 늘렸어요`,
      achievedDate: firstReaching(data.muscleGainPoints, t),
    });
  });
  {
    const hit = data.inbodySorted.find((r) => r.bmi >= 18.5 && r.bmi <= 24.9);
    list.push({
      id: "inbody-bmi-normal",
      category: "inbody",
      icon: "scale",
      name: "BMI 정상범위 진입",
      description: "BMI가 정상범위(18.5~24.9)에 진입했어요",
      achievedDate: hit ? hit.date : null,
    });
  }
  [5, 10, 20, 50].forEach((t) => {
    list.push({
      id: `inbody-count-${t}`,
      category: "inbody",
      icon: "scale",
      name: `인바디 기록 ${t}회`,
      description: `인바디 기록을 ${t}회 남겼어요`,
      achievedDate: data.inbodySorted.length >= t ? data.inbodySorted[t - 1].date : null,
    });
  });

  /* ============ 🥤 생활습관 (10개) ============ */
  [7, 14, 30].forEach((t) => {
    list.push({
      id: `life-protein-streak-${t}`,
      category: "lifestyle",
      icon: "bottle",
      name: `프로틴 연속 ${t}일`,
      description: `프로틴을 ${t}일 연속 섭취했어요`,
      achievedDate: firstReaching(data.proteinStreak, t),
    });
  });
  [30, 100].forEach((t) => {
    list.push({
      id: `life-protein-total-${t}`,
      category: "lifestyle",
      icon: "bottle",
      name: `프로틴 누적 ${t}회`,
      description: `프로틴을 누적 ${t}회 섭취했어요`,
      achievedDate: findNthDate(data.proteinDatesSorted, t),
    });
  });
  [7, 14, 30].forEach((t) => {
    list.push({
      id: `life-no-drink-${t}`,
      category: "lifestyle",
      icon: "heart",
      name: `금주 연속 ${t}일`,
      description: `${t}일 연속 금주를 달성했어요`,
      achievedDate: firstReaching(data.noDrinkStreak, t),
    });
  });
  [10, 30].forEach((t) => {
    list.push({
      id: `life-workout-protein-${t}`,
      category: "lifestyle",
      icon: "heart",
      name: `운동+프로틴 ${t}회`,
      description: `운동과 프로틴 섭취를 같은 날 ${t}회 달성했어요`,
      achievedDate: findNthDate(data.workoutAndProteinSameDayDates, t),
    });
  });

  /* ============ ⚡ 볼륨 & 칼로리 (10개) ============ */
  [10000, 50000, 100000, 300000, 500000].forEach((t) => {
    list.push({
      id: `volume-total-${t}`,
      category: "volume",
      icon: "bolt",
      name: `총 볼륨 ${t.toLocaleString()}kg`,
      description: `누적 운동 볼륨 ${t.toLocaleString()}kg을 달성했어요`,
      achievedDate: firstReaching(data.cumulativeVolume, t),
    });
  });
  [1000, 5000, 10000, 30000, 100000].forEach((t) => {
    list.push({
      id: `volume-calories-${t}`,
      category: "volume",
      icon: "trophy",
      name: `총 칼로리 ${t.toLocaleString()}kcal`,
      description: `누적 소모 칼로리 ${t.toLocaleString()}kcal을 달성했어요`,
      achievedDate: firstReaching(data.cumulativeCalories, t),
    });
  });

  return finalize(list);
}

/* ---------------- 엔트리 포인트 ---------------- */
export async function evaluateAllBadges() {
  const [workoutLogs, inbodyRecords, drinkLogs] = await Promise.all([
    db.getAllWorkoutLogs(),
    db.getAllInbodyRecords(),
    db.getAllDrinkLogs(),
  ]);
  const data = prepare({ workoutLogs, inbodyRecords, drinkLogs });
  return buildBadges(data);
}
