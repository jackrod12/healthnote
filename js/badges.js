import * as db from "./db.js";

/* =====================================================================
 * 뱃지 시스템
 * 모든 뱃지는 DB에 저장되지 않고, 기존 기록(workoutLogs/inbodyRecords/
 * drinkLog2)으로부터 매번 다시 계산됩니다. "달성일"은 조건을 최초로
 * 만족시킨 시점의 날짜를 데이터에서 역산해서 구합니다.
 *
 * 디자인: 포켓몬 체육관 뱃지 스타일 — 카테고리별 외곽 형태(방패/원/다이아
 * 몬드/육각형/별/번개) + 티어별 메탈릭 그라디언트(청동/은/금/에메랄드/
 * 다이아몬드) + 상단 하이라이트 + 하단 그림자. 달성/미달성 톤(그레이스케일
 * +30% 불투명도+🔒)은 app.js의 CSS가 담당하고, 여기서는 항상 풀컬러 SVG를
 * 만들어 낸다.
 * ===================================================================== */

export const BADGE_CATEGORIES = [
  { key: "pr", label: "PR", color: "#FFD700" },
  { key: "streak", label: "Streak", color: "#FF6B35" },
  { key: "cardio", label: "유산소", color: "#4A9EFF" },
  { key: "inbody", label: "인바디", color: "#00E5A0" },
  { key: "lifestyle", label: "생활습관", color: "#A855F7" },
  { key: "volume", label: "볼륨", color: "#FF4444" },
];

/* ---------------- 티어(단계)별 메탈릭 컬러 ---------------- */
export const TIER_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#50C878", "#B9F2FF"];

/* ---------------- 카테고리 → 외곽 형태 ---------------- */
const CATEGORY_SHAPE = {
  pr: "shield",
  streak: "circle-flame",
  cardio: "diamond",
  inbody: "hexagon",
  lifestyle: "star",
  volume: "bolt",
};

/* ---------------- 색상 유틸 ---------------- */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  );
}
function lighten(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}
function darken(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
}

/* ---------------- 외곽 형태 path (viewBox 0 0 40 40) ---------------- */
function starPath(cx, cy, outerR, innerR, points) {
  const step = Math.PI / points;
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = -Math.PI / 2 + i * step;
    const x = (cx + r * Math.cos(angle)).toFixed(2);
    const y = (cy + r * Math.sin(angle)).toFixed(2);
    d += (i === 0 ? "M" : "L") + x + " " + y + " ";
  }
  return d + "Z";
}

const SHAPES = {
  shield: "M20 3 L34 8 V18 C34 29 27 35.5 20 38 C13 35.5 6 29 6 18 V8 Z",
  diamond: "M20 2 L37 20 L20 38 L3 20 Z",
  hexagon: "M20 3 L35 11.5 L35 28.5 L20 37 L5 28.5 L5 11.5 Z",
  bolt: "M24 2 L9 23 H18 L15 38 L33 15 H23 Z",
  star: starPath(20, 20, 18, 7.2, 5),
};

const FLAME_SPIKE_D = "M20 1 C21.8 4.5 21.8 7 20 9.5 C18.2 7 18.2 4.5 20 1 Z";
const FLAME_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/* ---------------- 뱃지 내부 글리프(작은 장식 아이콘) ---------------- */
const GLYPHS = {
  barbellBench: `
    <rect x="5" y="18" width="30" height="4" rx="2" fill="#fff"/>
    <rect x="2" y="14" width="4" height="12" rx="2" fill="#fff"/>
    <rect x="34" y="14" width="4" height="12" rx="2" fill="#fff"/>
    <rect x="0" y="16" width="4" height="8" rx="1.5" fill="#fff"/>
    <rect x="36" y="16" width="4" height="8" rx="1.5" fill="#fff"/>`,
  barbellSquat: `
    <rect x="5" y="9" width="30" height="4" rx="2" fill="#fff"/>
    <rect x="2" y="5" width="4" height="12" rx="2" fill="#fff"/>
    <rect x="34" y="5" width="4" height="12" rx="2" fill="#fff"/>
    <path d="M14 13 L11 30 M26 13 L29 30 M14 30 L20 36 L26 30" stroke="#fff" stroke-width="3.2"
      fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  barbellDeadlift: `
    <rect x="5" y="27" width="30" height="4" rx="2" fill="#fff"/>
    <rect x="2" y="23" width="4" height="12" rx="2" fill="#fff"/>
    <rect x="34" y="23" width="4" height="12" rx="2" fill="#fff"/>
    <path d="M20 21 V4 M14 10 L20 4 L26 10" stroke="#fff" stroke-width="3.2"
      fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  dumbbell: `
    <rect x="16" y="18" width="8" height="4" rx="1.5" fill="#fff"/>
    <circle cx="9" cy="20" r="7" fill="#fff"/>
    <circle cx="31" cy="20" r="7" fill="#fff"/>`,
  flame: `<path d="M20 5c3 5-4 8-4 13a4 4 0 008 0c0-2-1-3-1-5 3 2 6 6 6 10a10 10 0 11-20 0c0-9 8-11 11-18z" fill="#fff"/>`,
  calendar: `
    <rect x="6" y="8" width="28" height="26" rx="3" stroke="#fff" stroke-width="2.5" fill="none"/>
    <path d="M6 16h28" stroke="#fff" stroke-width="2.5"/>
    <rect x="12" y="21" width="6" height="6" rx="1" fill="#fff"/>`,
  shoe: `
    <path d="M4 30c0-3 2-5 5-6l6-2 8-6c2-1 4-1 5 1l2 3h6a4 4 0 014 4v3a3 3 0 01-3 3H7a3 3 0 01-3-3z" fill="#fff"/>
    <rect x="4" y="30" width="32" height="4" rx="2" fill="#fff" opacity="0.6"/>`,
  heartbeat: `<path d="M3 21h7l3-8 5 14 4-10 2 4h13" stroke="#fff" stroke-width="3.5"
    stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  stairs: `<path d="M4 34V26H12V20H20V14H28V8H36" stroke="#fff" stroke-width="4" fill="none"
    stroke-linecap="round" stroke-linejoin="round"/>`,
  scale: `
    <rect x="4" y="10" width="32" height="24" rx="4" fill="#fff" opacity="0.22"/>
    <rect x="4" y="10" width="32" height="24" rx="4" stroke="#fff" stroke-width="2.5" fill="none"/>
    <circle cx="20" cy="23" r="5" fill="#fff"/>`,
  muscle: `<path d="M10 30c-3-2-4-6-2-10 1-3 4-5 4-9 0-3 2-5 5-5 4 0 6 3 6 6 3-1 6 0 8 3 3 4 2 10-2 13-3 2-6 3-9 3H14c-1 0-3 0-4-1z" fill="#fff"/>`,
  bodyfatDrop: `
    <path d="M20 4c6 9 11 15 11 21a11 11 0 01-22 0c0-6 5-12 11-21z" fill="#fff" opacity="0.92"/>
    <path d="M14 26a6 6 0 006 6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.6"/>`,
  bmiCheck: `
    <circle cx="20" cy="20" r="15" stroke="#fff" stroke-width="2.5" fill="none"/>
    <path d="M12 20l5 5 11-11" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  bottle: `
    <rect x="15" y="4" width="10" height="6" rx="2" fill="#fff"/>
    <path d="M13 12h14a2 2 0 012 2v18a4 4 0 01-4 4H15a4 4 0 01-4-4V14a2 2 0 012-2z" fill="#fff"/>`,
  glassX: `
    <path d="M10 6h20l-3 22a3 3 0 01-3 3H16a3 3 0 01-3-3z" stroke="#fff" stroke-width="2.5" fill="none" stroke-linejoin="round"/>
    <path d="M14 12l12 12M26 12L14 24" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`,
  heart: `<path d="M20 34S5 24 5 14a8 8 0 0115-4 8 8 0 0115 4c0 10-15 20-15 20z" fill="#fff"/>`,
};

function escapeXml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderGlyph(glyphKey, x, y, w, h, opacity = 1) {
  const inner = GLYPHS[glyphKey];
  if (!inner) return "";
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 40 40" opacity="${opacity}">${inner}</svg>`;
}

function renderCenterContent(badge) {
  if (badge.centerLabel) {
    const hasSub = !!badge.subLabel;
    const glyphMarkup = badge.glyph ? renderGlyph(badge.glyph, 13, 3, 14, 11, 0.9) : "";
    const numY = hasSub ? 25.5 : 23;
    const len = String(badge.centerLabel).length;
    const numSize = len > 5 ? 7.5 : len > 3 ? 9.5 : len > 2 ? 12 : 15;
    const numMarkup = `<text x="20" y="${numY}" text-anchor="middle" dominant-baseline="middle" font-size="${numSize}" font-weight="800" fill="#fff" font-family="system-ui, -apple-system, sans-serif" paint-order="stroke" stroke="rgba(0,0,0,0.4)" stroke-width="2" stroke-linejoin="round">${escapeXml(badge.centerLabel)}</text>`;
    const subMarkup = hasSub
      ? `<text x="20" y="32.5" text-anchor="middle" font-size="5.5" font-weight="700" letter-spacing="0.5" fill="#fff" opacity="0.85" font-family="system-ui, -apple-system, sans-serif">${escapeXml(badge.subLabel)}</text>`
      : "";
    return glyphMarkup + numMarkup + subMarkup;
  }
  if (badge.glyph) {
    return renderGlyph(badge.glyph, 8, 8, 24, 24, 0.95);
  }
  return "";
}

function svgDefs(uid, color) {
  const light = lighten(color, 0.42);
  const dark = darken(color, 0.38);
  const shadowColor = darken(color, 0.6);
  return `
    <linearGradient id="g-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${light}"/>
      <stop offset="55%" stop-color="${color}"/>
      <stop offset="100%" stop-color="${dark}"/>
    </linearGradient>
    <radialGradient id="hl-${uid}" cx="32%" cy="18%" r="65%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="sh-${uid}" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="1.1" stdDeviation="1" flood-color="${shadowColor}" flood-opacity="0.6"/>
    </filter>
  `;
}

/* 포켓몬 체육관 뱃지 스타일 SVG 생성: 방패/원(불꽃테두리)/다이아몬드/육각형/별/번개
   외곽 + 티어 메탈릭 그라디언트 + 상단 글로시 하이라이트 + 하단 드롭섀도. */
export function renderBadgeIconSvg(badge, opts = {}) {
  const size = opts.size || 40;
  const uid = badge.id.replace(/[^a-zA-Z0-9]/g, "");
  const color = TIER_COLORS[badge.tier % TIER_COLORS.length];
  const strokeColor = darken(color, 0.5);
  const defs = svgDefs(uid, color);

  let shapeMarkup;
  if (badge.shape === "circle-flame") {
    const spikes = FLAME_ANGLES.map(
      (deg) =>
        `<path d="${FLAME_SPIKE_D}" transform="rotate(${deg} 20 20)" fill="url(#g-${uid})" stroke="${strokeColor}" stroke-width="0.5"/>`
    ).join("");
    shapeMarkup = `
      <g filter="url(#sh-${uid})">
        <circle cx="20" cy="20" r="13" fill="url(#g-${uid})" stroke="${strokeColor}" stroke-width="1.6"/>
        ${spikes}
      </g>
      <circle cx="20" cy="20" r="13" fill="url(#hl-${uid})"/>
    `;
  } else {
    const d = SHAPES[badge.shape] || SHAPES.hexagon;
    shapeMarkup = `
      <g filter="url(#sh-${uid})">
        <path d="${d}" fill="url(#g-${uid})" stroke="${strokeColor}" stroke-width="1.6" stroke-linejoin="round"/>
      </g>
      <path d="${d}" fill="url(#hl-${uid})"/>
    `;
  }

  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" class="badge-svg"><defs>${defs}</defs>${shapeMarkup}${renderCenterContent(badge)}</svg>`;
}

/* 미달성 뱃지의 모달용 진행률 문구 ("23 / 50km" 등) */
export function formatProgressText(badge) {
  if (badge.achieved) return null;
  const p = badge.progress;
  if (!p) return "아직 조건을 만족하지 않았어요";
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (p.invert) {
    return p.current != null
      ? `최고 기록 ${fmt(p.current)}${p.unit} (목표 ${fmt(p.target)}${p.unit} 이내)`
      : "아직 기록이 없어요";
  }
  return `${fmt(p.current)} / ${fmt(p.target)}${p.unit}`;
}

function formatPaceLabel(paceDecimal) {
  const min = Math.floor(paceDecimal);
  const sec = Math.round((paceDecimal - min) * 60);
  return `${min}'${String(sec).padStart(2, "0")}"`;
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

/* ---------------- 진행률(progress) 헬퍼 ---------------- */
function round1(n) {
  return Math.round(n * 10) / 10;
}
function progressFromPoints(points, target, unit) {
  return { current: round1(points.length ? points[points.length - 1].value : 0), target, unit };
}
function progressFromCount(count, target, unit) {
  return { current: Math.min(count, target), target, unit };
}

/* ---------------- 뱃지 정의 빌더 ---------------- */
function finalize(list) {
  return list.map((b) => ({
    ...b,
    shape: CATEGORY_SHAPE[b.category],
    achieved: !!b.achievedDate,
  }));
}

function buildBadges(data) {
  const list = [];

  /* ============ 💪 PR 달성 (20개, 방패형) ============ */
  [40, 60, 80, 100, 120].forEach((t, i) => {
    list.push({
      id: `pr-bench-${t}`,
      category: "pr",
      tier: i,
      glyph: "barbellBench",
      centerLabel: `${t}`,
      subLabel: "kg",
      name: `벤치프레스 ${t}kg`,
      description: `벤치프레스 최고 중량 ${t}kg 이상을 기록했어요`,
      achievedDate: firstReaching(data.benchMaxPoints, t),
      progress: progressFromPoints(data.benchMaxPoints, t, "kg"),
    });
  });
  [60, 80, 100, 120, 150].forEach((t, i) => {
    list.push({
      id: `pr-squat-${t}`,
      category: "pr",
      tier: i,
      glyph: "barbellSquat",
      centerLabel: `${t}`,
      subLabel: "kg",
      name: `스쿼트 ${t}kg`,
      description: `스쿼트 최고 중량 ${t}kg 이상을 기록했어요`,
      achievedDate: firstReaching(data.squatMaxPoints, t),
      progress: progressFromPoints(data.squatMaxPoints, t, "kg"),
    });
  });
  [60, 80, 100, 120, 150].forEach((t, i) => {
    list.push({
      id: `pr-deadlift-${t}`,
      category: "pr",
      tier: i,
      glyph: "barbellDeadlift",
      centerLabel: `${t}`,
      subLabel: "kg",
      name: `데드리프트 ${t}kg`,
      description: `데드리프트 최고 중량 ${t}kg 이상을 기록했어요`,
      achievedDate: firstReaching(data.deadliftMaxPoints, t),
      progress: progressFromPoints(data.deadliftMaxPoints, t, "kg"),
    });
  });
  [5, 10, 15, 20, 30].forEach((t, i) => {
    list.push({
      id: `pr-count-${t}`,
      category: "pr",
      tier: i,
      glyph: "dumbbell",
      centerLabel: `${t}`,
      subLabel: "PR",
      name: `PR ${t}회 갱신`,
      description: `개인 최고 기록을 총 ${t}회 갱신했어요`,
      achievedDate: firstReaching(data.prEvents, t),
      progress: progressFromPoints(data.prEvents, t, "회"),
    });
  });

  /* ============ 🔥 연속 운동 streak (20개, 원형+불꽃 테두리) ============ */
  [3, 7, 14, 30, 60, 100].forEach((t, i) => {
    list.push({
      id: `streak-days-${t}`,
      category: "streak",
      tier: Math.min(i, TIER_COLORS.length - 1),
      glyph: "flame",
      centerLabel: `${t}`,
      subLabel: "DAYS",
      name: `연속 운동 ${t}일`,
      description: `${t}일 연속으로 운동을 기록했어요`,
      achievedDate: firstReaching(data.dailyStreak, t),
      progress: progressFromPoints(data.dailyStreak, t, "일"),
    });
  });
  [2, 3, 4, 5].forEach((t, i) => {
    list.push({
      id: `streak-weekly-${t}`,
      category: "streak",
      tier: i,
      glyph: "calendar",
      centerLabel: `${t}`,
      subLabel: "WEEK",
      name: `주 ${t}회 달성`,
      description: `한 주에 ${t}회 이상 운동했어요`,
      achievedDate: firstReaching(data.weeklyCounts, t),
      progress: progressFromPoints(data.weeklyCounts, t, "회"),
    });
  });
  [4, 12].forEach((t, i) => {
    list.push({
      id: `streak-weekly3-${t}`,
      category: "streak",
      tier: i === 0 ? 1 : 3,
      glyph: "flame",
      centerLabel: `${t}`,
      subLabel: "WEEKS",
      name: `주 3회 ${t}주 연속`,
      description: `주 3회 이상 운동을 ${t}주 연속 달성했어요`,
      achievedDate: firstReaching(data.weeklyStreak3, t),
      progress: progressFromPoints(data.weeklyStreak3, t, "주"),
    });
  });
  [10, 15, 20, 25, 30].forEach((t, i) => {
    list.push({
      id: `streak-monthly-${t}`,
      category: "streak",
      tier: i,
      glyph: "calendar",
      centerLabel: `${t}`,
      subLabel: "MONTH",
      name: `한 달 ${t}회`,
      description: `한 달에 ${t}회 이상 운동했어요`,
      achievedDate: firstReaching(data.monthlyCounts, t),
      progress: progressFromPoints(data.monthlyCounts, t, "회"),
    });
  });
  [100, 365, 500].forEach((t, i) => {
    list.push({
      id: `streak-total-${t}`,
      category: "streak",
      tier: 2 + i,
      glyph: "calendar",
      centerLabel: `${t}`,
      subLabel: "TOTAL",
      name: `누적 운동 ${t}회`,
      description: `누적 운동 일수 ${t}회를 달성했어요`,
      achievedDate: findNthDate(data.allWorkoutDatesSorted, t),
      progress: progressFromCount(data.allWorkoutDatesSorted.length, t, "회"),
    });
  });

  /* ============ 🏃 유산소 (20개, 다이아몬드형) ============ */
  list.push({
    id: "cardio-first-run",
    category: "cardio",
    tier: 0,
    glyph: "shoe",
    centerLabel: null,
    subLabel: null,
    name: "첫 러닝",
    description: "첫 러닝 기록을 남겼어요",
    achievedDate: data.runningLogs.length ? data.runningLogs[0].date : null,
  });
  [10, 50, 100, 500, 1000].forEach((t, i) => {
    list.push({
      id: `cardio-cum-dist-${t}`,
      category: "cardio",
      tier: i,
      glyph: "shoe",
      centerLabel: `${t}`,
      subLabel: "km",
      name: `누적 러닝 ${t}km`,
      description: `누적 러닝 거리 ${t}km를 달성했어요`,
      achievedDate: firstReaching(data.cumulativeRunDistance, t),
      progress: progressFromPoints(data.cumulativeRunDistance, t, "km"),
    });
  });
  {
    const bestSingleDist = data.runningLogs.length ? Math.max(...data.runningLogs.map((l) => l.distance)) : 0;
    [5, 10, 15, 21].forEach((t, i) => {
      const hit = data.runningLogs.find((l) => l.distance >= t);
      list.push({
        id: `cardio-single-dist-${t}`,
        category: "cardio",
        tier: i,
        glyph: "shoe",
        centerLabel: `${t}`,
        subLabel: t === 21 ? "HALF" : "km",
        name: t === 21 ? "하프마라톤 완주" : `단일 러닝 ${t}km`,
        description: t === 21 ? "한 번에 21km(하프마라톤)를 달렸어요" : `한 번에 ${t}km를 달렸어요`,
        achievedDate: hit ? hit.date : null,
        progress: { current: round1(bestSingleDist), target: t, unit: "km" },
      });
    });
  }
  {
    const bestPace = data.runningLogs.length ? Math.min(...data.runningLogs.map((l) => l.pace)) : null;
    [
      { t: 6, label: "6분/km" },
      { t: 5, label: "5분/km" },
      { t: 4.5, label: "4분30초/km" },
      { t: 4, label: "4분/km" },
    ].forEach(({ t, label }, i) => {
      const hit = data.runningLogs.find((l) => l.pace <= t);
      list.push({
        id: `cardio-pace-${t}`,
        category: "cardio",
        tier: i,
        glyph: "heartbeat",
        centerLabel: formatPaceLabel(t),
        subLabel: "PACE",
        name: `페이스 ${label} 이내`,
        description: `평균 페이스 ${label} 이내로 러닝했어요`,
        achievedDate: hit ? hit.date : null,
        progress: { current: bestPace != null ? round1(bestPace) : null, target: t, unit: "분/km", invert: true },
      });
    });
  }
  list.push({
    id: "cardio-first-stair",
    category: "cardio",
    tier: 0,
    glyph: "stairs",
    centerLabel: null,
    subLabel: null,
    name: "천국의계단 첫 기록",
    description: "천국의계단 운동을 처음 기록했어요",
    achievedDate: data.stairLogs.length ? data.stairLogs[0].date : null,
  });
  {
    const bestStairLevel = data.stairLogs.length ? Math.max(...data.stairLogs.map((l) => l.level)) : 0;
    [10, 13, 15].forEach((t, i) => {
      const hit = data.stairLogs.find((l) => l.level >= t);
      list.push({
        id: `cardio-stair-level-${t}`,
        category: "cardio",
        tier: 2 + i,
        glyph: "stairs",
        centerLabel: `${t}`,
        subLabel: "LV",
        name: `천국의계단 단계 ${t}`,
        description: `천국의계단 단계 ${t}을 달성했어요`,
        achievedDate: hit ? hit.date : null,
        progress: { current: bestStairLevel, target: t, unit: "단계" },
      });
    });
  }
  [100, 300].forEach((t, i) => {
    list.push({
      id: `cardio-stair-min-${t}`,
      category: "cardio",
      tier: 3 + i,
      glyph: "stairs",
      centerLabel: `${t}`,
      subLabel: "MIN",
      name: `천국의계단 누적 ${t}분`,
      description: `천국의계단 누적 운동시간 ${t}분을 달성했어요`,
      achievedDate: firstReaching(data.cumulativeStairMinutes, t),
      progress: progressFromPoints(data.cumulativeStairMinutes, t, "분"),
    });
  });

  /* ============ 📉 인바디 변화 (20개, 육각형) ============ */
  list.push({
    id: "inbody-first",
    category: "inbody",
    tier: 0,
    glyph: "scale",
    centerLabel: null,
    subLabel: null,
    name: "첫 인바디 기록",
    description: "첫 인바디 기록을 남겼어요",
    achievedDate: data.inbodySorted.length ? data.inbodySorted[0].date : null,
  });
  [1, 2, 3, 5, 7, 10].forEach((t, i) => {
    list.push({
      id: `inbody-weight-loss-${t}`,
      category: "inbody",
      tier: Math.min(i, TIER_COLORS.length - 1),
      glyph: "scale",
      centerLabel: `-${t}`,
      subLabel: "kg",
      name: `체중 -${t}kg`,
      description: `시작 대비 체중을 ${t}kg 감량했어요`,
      achievedDate: firstReaching(data.weightLossPoints, t),
      progress: progressFromPoints(data.weightLossPoints, t, "kg"),
    });
  });
  [1, 2, 3, 5].forEach((t, i) => {
    list.push({
      id: `inbody-bodyfat-${t}`,
      category: "inbody",
      tier: i,
      glyph: "bodyfatDrop",
      centerLabel: `-${t}`,
      subLabel: "%p",
      name: `체지방률 -${t}%p`,
      description: `시작 대비 체지방률을 ${t}%p 감소시켰어요`,
      achievedDate: firstReaching(data.bodyFatDeltaPoints, t),
      progress: progressFromPoints(data.bodyFatDeltaPoints, t, "%p"),
    });
  });
  [0.5, 1, 2, 3].forEach((t, i) => {
    list.push({
      id: `inbody-muscle-${t}`,
      category: "inbody",
      tier: i,
      glyph: "muscle",
      centerLabel: `+${t}`,
      subLabel: "kg",
      name: `골격근량 +${t}kg`,
      description: `시작 대비 골격근량을 ${t}kg 늘렸어요`,
      achievedDate: firstReaching(data.muscleGainPoints, t),
      progress: progressFromPoints(data.muscleGainPoints, t, "kg"),
    });
  });
  {
    const hit = data.inbodySorted.find((r) => r.bmi >= 18.5 && r.bmi <= 24.9);
    list.push({
      id: "inbody-bmi-normal",
      category: "inbody",
      tier: 2,
      glyph: "bmiCheck",
      centerLabel: "BMI",
      subLabel: null,
      name: "BMI 정상범위 진입",
      description: "BMI가 정상범위(18.5~24.9)에 진입했어요",
      achievedDate: hit ? hit.date : null,
    });
  }
  [5, 10, 20, 50].forEach((t, i) => {
    list.push({
      id: `inbody-count-${t}`,
      category: "inbody",
      tier: i,
      glyph: "scale",
      centerLabel: `${t}`,
      subLabel: "회",
      name: `인바디 기록 ${t}회`,
      description: `인바디 기록을 ${t}회 남겼어요`,
      achievedDate: data.inbodySorted.length >= t ? data.inbodySorted[t - 1].date : null,
      progress: progressFromCount(data.inbodySorted.length, t, "회"),
    });
  });

  /* ============ 🥤 생활습관 (10개, 별형) ============ */
  [7, 14, 30].forEach((t, i) => {
    list.push({
      id: `life-protein-streak-${t}`,
      category: "lifestyle",
      tier: 1 + i,
      glyph: "bottle",
      centerLabel: `${t}`,
      subLabel: "DAYS",
      name: `프로틴 연속 ${t}일`,
      description: `프로틴을 ${t}일 연속 섭취했어요`,
      achievedDate: firstReaching(data.proteinStreak, t),
      progress: progressFromPoints(data.proteinStreak, t, "일"),
    });
  });
  [30, 100].forEach((t, i) => {
    list.push({
      id: `life-protein-total-${t}`,
      category: "lifestyle",
      tier: 1 + i * 2,
      glyph: "bottle",
      centerLabel: `${t}`,
      subLabel: "회",
      name: `프로틴 누적 ${t}회`,
      description: `프로틴을 누적 ${t}회 섭취했어요`,
      achievedDate: findNthDate(data.proteinDatesSorted, t),
      progress: progressFromCount(data.proteinDatesSorted.length, t, "회"),
    });
  });
  [7, 14, 30].forEach((t, i) => {
    list.push({
      id: `life-no-drink-${t}`,
      category: "lifestyle",
      tier: 1 + i,
      glyph: "glassX",
      centerLabel: `${t}`,
      subLabel: "DAYS",
      name: `금주 연속 ${t}일`,
      description: `${t}일 연속 금주를 달성했어요`,
      achievedDate: firstReaching(data.noDrinkStreak, t),
      progress: progressFromPoints(data.noDrinkStreak, t, "일"),
    });
  });
  [10, 30].forEach((t, i) => {
    list.push({
      id: `life-workout-protein-${t}`,
      category: "lifestyle",
      tier: 2 + i * 2,
      glyph: "heart",
      centerLabel: `${t}`,
      subLabel: "회",
      name: `운동+프로틴 ${t}회`,
      description: `운동과 프로틴 섭취를 같은 날 ${t}회 달성했어요`,
      achievedDate: findNthDate(data.workoutAndProteinSameDayDates, t),
      progress: progressFromCount(data.workoutAndProteinSameDayDates.length, t, "회"),
    });
  });

  /* ============ ⚡ 볼륨 & 칼로리 (10개, 번개형) ============ */
  [10000, 50000, 100000, 300000, 500000].forEach((t, i) => {
    list.push({
      id: `volume-total-${t}`,
      category: "volume",
      tier: i,
      glyph: null,
      centerLabel: `${t / 1000}t`,
      subLabel: "VOL",
      name: `총 볼륨 ${t.toLocaleString()}kg`,
      description: `누적 운동 볼륨 ${t.toLocaleString()}kg을 달성했어요`,
      achievedDate: firstReaching(data.cumulativeVolume, t),
      progress: progressFromPoints(data.cumulativeVolume, t, "kg"),
    });
  });
  [1000, 5000, 10000, 30000, 100000].forEach((t, i) => {
    list.push({
      id: `volume-calories-${t}`,
      category: "volume",
      tier: i,
      glyph: null,
      centerLabel: `${t / 1000}k`,
      subLabel: "KCAL",
      name: `총 칼로리 ${t.toLocaleString()}kcal`,
      description: `누적 소모 칼로리 ${t.toLocaleString()}kcal을 달성했어요`,
      achievedDate: firstReaching(data.cumulativeCalories, t),
      progress: progressFromPoints(data.cumulativeCalories, t, "kcal"),
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
