import * as db from "./db.js";

/* =====================================================================
 * 뱃지 시스템 — 마라톤 완주 메달 스타일 (2차 개편)
 * 모든 뱃지는 DB에 저장되지 않고, 기존 기록(workoutLogs/inbodyRecords/
 * drinkLog2/routines/workoutMemo/settings)으로부터 매번 다시 계산됩니다.
 * "달성일"은 조건을 최초로 만족시킨 시점의 날짜를 데이터에서 역산해서
 * 구합니다.
 *
 * 디자인: 상단 고리 + 원형 메달(카테고리별 컬러 그라디언트 얼굴 + 티어별
 * 메탈릭 테두리) + 중앙 아이콘 + 은색 리본 배너(시리즈명) + 리본 아래
 * 수치 텍스트. 달성/미달성 톤(그레이스케일+40% 불투명도)은 app.js의
 * CSS가 담당하고, 여기서는 항상 풀컬러 SVG를 만들어 낸다.
 * ===================================================================== */

export const BADGE_CATEGORIES = [
  { key: "pr", label: "PR" },
  { key: "streak", label: "Streak" },
  { key: "cardio", label: "유산소" },
  { key: "inbody", label: "인바디" },
  { key: "lifestyle", label: "생활습관" },
  { key: "volume", label: "볼륨 & 칼로리" },
  { key: "style", label: "운동 스타일 & 개성" },
  { key: "special", label: "특별한 순간" },
  { key: "milestone", label: "운동량 마일스톤" },
  { key: "challenge", label: "챌린지" },
  { key: "hidden", label: "히든" },
];

/* ---------------- 카테고리별 메달 얼굴 컬러 (그라디언트 2색) ---------------- */
const CATEGORY_COLORS = {
  pr: ["#1565C0", "#42A5F5"],
  streak: ["#C62828", "#EF5350"],
  cardio: ["#0277BD", "#29B6F6"],
  inbody: ["#2E7D32", "#66BB6A"],
  lifestyle: ["#6A1B9A", "#AB47BC"],
  volume: ["#E65100", "#FFA726"],
  style: ["#00838F", "#4DD0E1"],
  special: ["#B8860B", "#FFD54F"],
  challenge: ["#B8860B", "#FFD54F"],
  hidden: ["#B8860B", "#FFD54F"],
};

/* ---------------- 티어(단계)별 메탈릭 테두리 색: 청동→은→금→백금→다이아몬드→흑요석 ---------------- */
const TIER_COLORS = ["#CD7F32", "#C0C0C0", "#FFD700", "#E5E4E2", "#B9F2FF", "#6B4E8E"];

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

/* ---------------- 뱃지 내부 글리프(작은 장식 아이콘, 0..40 좌표계) ---------------- */
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
  trophy: `
    <path d="M12 6h16v10a8 8 0 01-16 0V6z" fill="#fff"/>
    <path d="M12 8H6a2 2 0 000 4c0 3 2 5 5 6M28 8h6a2 2 0 010 4c0 3-2 5-5 6"
      stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <rect x="17" y="24" width="6" height="7" fill="#fff"/>
    <rect x="12" y="31" width="16" height="4" rx="1.5" fill="#fff"/>`,
  boltGlyph: `<path d="M22 3 8 22h9l-3 15 17-21h-10l1-13z" fill="#fff"/>`,
  sunrise: `
    <path d="M4 24h32" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M10 24a10 10 0 0120 0" fill="#fff"/>
    <path d="M20 6v4M10 10l3 3M30 10l-3 3" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`,
  moon: `<path d="M27 6a15 15 0 100 28 12 12 0 010-28z" fill="#fff"/>`,
  flag: `
    <rect x="8" y="4" width="3" height="32" rx="1.5" fill="#fff"/>
    <path d="M11 6h18l-5 7 5 7H11z" fill="#fff"/>`,
  sunNoon: `
    <circle cx="20" cy="20" r="9" fill="#fff"/>
    <path d="M20 3v5M20 32v5M3 20h5M32 20h5M8 8l3.5 3.5M28.5 28.5L32 32M8 32l3.5-3.5M28.5 11.5L32 8" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`,
  raindrop: `<path d="M20 4c6 9 11 16 11 22a11 11 0 01-22 0c0-6 5-13 11-22z" fill="#fff"/>`,
  checklist: `
    <rect x="7" y="6" width="26" height="28" rx="3" stroke="#fff" stroke-width="2.3" fill="none"/>
    <path d="M12 14l3 3 5-6M12 24l3 3 5-6" stroke="#fff" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M23 15h7M23 25h7" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/>`,
  pencil: `<path d="M8 32l2-8 16-16 6 6-16 16-8 2z" fill="#fff"/>`,
  footprint: `
    <ellipse cx="16" cy="24" rx="6" ry="9" fill="#fff"/>
    <ellipse cx="26" cy="12" rx="5" ry="7" fill="#fff" opacity="0.85"/>`,
  sparkle: `<path d="M20 4 L23 17 L36 20 L23 23 L20 36 L17 23 L4 20 L17 17 Z" fill="#fff"/>`,
  seasons: `
    <path d="M20 20 C20 10 14 6 8 8 C10 14 14 20 20 20Z" fill="#fff" opacity="0.9"/>
    <path d="M20 20 C30 20 34 14 32 8 C26 10 20 14 20 20Z" fill="#fff" opacity="0.75"/>
    <path d="M20 20 C20 30 26 34 32 32 C30 26 26 20 20 20Z" fill="#fff" opacity="0.6"/>
    <path d="M20 20 C10 20 6 26 8 32 C14 30 20 26 20 20Z" fill="#fff" opacity="0.45"/>`,
  starGlyph: `<path d="M20 3 L24.5 15.5 L38 16 L27.5 24 L31 37 L20 29.5 L9 37 L12.5 24 L2 16 L15.5 15.5 Z" fill="#fff"/>`,
  target: `
    <circle cx="20" cy="20" r="15" fill="#fff" opacity="0.25"/>
    <circle cx="20" cy="20" r="15" stroke="#fff" stroke-width="2" fill="none"/>
    <circle cx="20" cy="20" r="9" stroke="#fff" stroke-width="2" fill="none"/>
    <circle cx="20" cy="20" r="3" fill="#fff"/>`,
  chart: `
    <path d="M6 34V10M6 34h28" stroke="#fff" stroke-width="2.3" fill="none" stroke-linecap="round"/>
    <path d="M10 28l7-9 6 5 9-14" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  snowflake: `
    <path d="M20 4v32M6 12l28 16M6 28l28-16" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M20 4l-3 4M20 4l3 4M20 36l-3-4M20 36l3-4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`,
  turtle: `
    <ellipse cx="20" cy="22" rx="12" ry="9" fill="#fff"/>
    <circle cx="33" cy="20" r="4" fill="#fff"/>
    <path d="M10 16l-4-2M10 28l-4 2M30 16l4-2M30 28l4 2" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`,
};

function escapeXml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderGlyph(glyphKey, x, y, w, h) {
  const inner = GLYPHS[glyphKey];
  if (!inner) return "";
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 40 40">${inner}</svg>`;
}

/* ---------------- 마라톤 완주 메달 SVG 생성 (viewBox 0 0 80 95) ---------------- */
export function renderBadgeIconSvg(badge, opts = {}) {
  const w = opts.width || 64;
  const h = opts.height || 76;
  const uid = badge.id.replace(/[^a-zA-Z0-9]/g, "");
  const faceColors = CATEGORY_COLORS[badge.category] || CATEGORY_COLORS.pr;
  const metal = TIER_COLORS[badge.tier % TIER_COLORS.length];
  const metalLight = lighten(metal, 0.35);
  const metalDark = darken(metal, 0.35);
  const faceDark = darken(faceColors[0], 0.15);

  const hasValue = !!badge.centerLabel;
  const ribbonText = badge.series || badge.name;
  const ribbonLen = ribbonText.length;
  const ribbonFontSize = ribbonLen > 9 ? 5.2 : ribbonLen > 6 ? 6.2 : 7.2;

  const iconMarkup = badge.glyph
    ? hasValue
      ? renderGlyph(badge.glyph, 25, 13, 30, 24)
      : renderGlyph(badge.glyph, 19, 12, 42, 36)
    : "";

  const valueLen = hasValue ? `${badge.centerLabel}${badge.subLabel || ""}`.length : 0;
  const valueFontSize = valueLen > 8 ? 7.5 : valueLen > 5 ? 9 : 11.5;
  const valueMarkup = hasValue
    ? `<text x="40" y="75.5" text-anchor="middle" dominant-baseline="middle" font-size="${valueFontSize}" font-weight="800" fill="#fff" font-family="system-ui, -apple-system, sans-serif" paint-order="stroke" stroke="rgba(0,0,0,0.35)" stroke-width="2" stroke-linejoin="round">${escapeXml(
        `${badge.centerLabel}${badge.subLabel || ""}`.toUpperCase()
      )}</text>`
    : "";

  return `<svg viewBox="0 0 80 95" width="${w}" height="${h}" class="badge-svg">
    <defs>
      <linearGradient id="face-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${faceColors[1]}"/>
        <stop offset="60%" stop-color="${faceColors[0]}"/>
        <stop offset="100%" stop-color="${faceDark}"/>
      </linearGradient>
      <linearGradient id="rim-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${metalLight}"/>
        <stop offset="50%" stop-color="${metal}"/>
        <stop offset="100%" stop-color="${metalDark}"/>
      </linearGradient>
      <linearGradient id="ribbon-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f2f2f4"/>
        <stop offset="100%" stop-color="#c7c7cd"/>
      </linearGradient>
      <radialGradient id="hl-${uid}" cx="35%" cy="22%" r="60%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>

    <!-- 상단 고리 -->
    <rect x="32" y="0" width="16" height="9" rx="3" fill="url(#rim-${uid})"/>

    <!-- 메달 본체 -->
    <circle cx="40" cy="48" r="35" fill="url(#face-${uid})"/>
    <circle cx="40" cy="48" r="35" fill="url(#hl-${uid})"/>
    <circle cx="40" cy="48" r="35" fill="none" stroke="url(#rim-${uid})" stroke-width="4"/>
    <circle cx="40" cy="48" r="31.5" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="1"/>

    <!-- 아이콘 -->
    ${iconMarkup}

    <!-- 리본 배너 -->
    <path d="M0 47 L13 41 L13 61 L0 67 Z" fill="${darken("#c7c7cd", 0.15)}"/>
    <path d="M80 47 L67 41 L67 61 L80 67 Z" fill="${darken("#c7c7cd", 0.15)}"/>
    <rect x="8" y="44" width="64" height="17" fill="url(#ribbon-${uid})"/>
    <text x="40" y="55" text-anchor="middle" dominant-baseline="middle" font-size="${ribbonFontSize}" font-weight="800" fill="#2b2b33" font-family="system-ui, -apple-system, sans-serif" letter-spacing="0.2">${escapeXml(
      ribbonText.toUpperCase()
    )}</text>

    <!-- 수치 -->
    ${valueMarkup}
  </svg>`;
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
function daysBetween(dateStrA, dateStrB) {
  return Math.round((parseDate(dateStrB) - parseDate(dateStrA)) / 86400000);
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
  return computeWeeklyStreakByPredicate(datesSorted, (days) => days.length >= minPerWeek);
}
function computeWeeklyStreakByPredicate(datesSorted, predicateFn) {
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
    if (!predicateFn(daysInWeek)) {
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
function computeDailyTotals(logsSorted, valueFn) {
  const order = [];
  const map = new Map();
  for (const log of logsSorted) {
    if (!map.has(log.date)) {
      map.set(log.date, 0);
      order.push(log.date);
    }
    map.set(log.date, map.get(log.date) + valueFn(log));
  }
  return order.map((date) => ({ date, value: map.get(date) }));
}
function computeDistinctCumulative(logsSorted, keyFn) {
  const seen = new Set();
  const points = [];
  for (const log of logsSorted) {
    const key = keyFn(log);
    if (key && !seen.has(key)) {
      seen.add(key);
      points.push({ date: log.date, value: seen.size });
    }
  }
  return points;
}
function computeMonthlyResetTotals(logsSorted, valueFn) {
  const points = [];
  let curMonth = null;
  let cum = 0;
  for (const log of logsSorted) {
    const month = log.date.slice(0, 7);
    if (month !== curMonth) {
      curMonth = month;
      cum = 0;
    }
    cum += valueFn(log);
    points.push({ date: log.date, value: cum });
  }
  return points;
}
function countStreakCompletions(streakPoints, threshold) {
  const results = [];
  let count = 0;
  let wasBelow = true;
  for (const p of streakPoints) {
    if (p.value >= threshold) {
      if (wasBelow) {
        count++;
        results.push({ date: p.date, value: count });
      }
      wasBelow = false;
    } else {
      wasBelow = true;
    }
  }
  return results;
}
function computeYearMonthMilestone(datesSorted, months, threshold) {
  const byYear = new Map();
  let achievedDate = null;
  let bestCount = 0;
  for (const d of datesSorted) {
    const mm = Number(d.slice(5, 7));
    if (!months.includes(mm)) continue;
    const yyyy = d.slice(0, 4);
    const count = (byYear.get(yyyy) || 0) + 1;
    byYear.set(yyyy, count);
    bestCount = Math.max(bestCount, count);
    if (!achievedDate && count >= threshold) achievedDate = d;
  }
  return { achievedDate, bestCount };
}
function computeStreakRuns(datesSorted) {
  const runs = [];
  let runStart = null;
  let prev = null;
  for (const d of datesSorted) {
    if (!(prev && isNextDay(prev, d))) {
      if (runStart) runs.push({ start: runStart, end: prev });
      runStart = d;
    }
    prev = d;
  }
  if (runStart) runs.push({ start: runStart, end: prev });
  return runs;
}
function seasonOf(dateStr) {
  const m = Number(dateStr.slice(5, 7));
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "fall";
  return "winter";
}

/* ---------------- 데이터 준비 ---------------- */
function prepare({ workoutLogs, inbodyRecords, drinkLogs, routines, memos, goals }) {
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

  /* ---- 신규 50개용 계산 ---- */
  const logsWithTime = workoutLogs.filter((l) => l.createdAt).slice().sort((a, b) => a.createdAt - b.createdAt);
  const runsWithTime = logsWithTime.filter((l) => l.type === "running");
  const dawnLog = logsWithTime.find((l) => new Date(l.createdAt).getHours() < 6);
  const nightLog = logsWithTime.find((l) => new Date(l.createdAt).getHours() >= 22);
  const lunchRunLog = runsWithTime.find((l) => {
    const h = new Date(l.createdAt).getHours();
    return h >= 12 && h < 14;
  });

  const weekendStreakPoints = computeWeeklyStreakByPredicate(allWorkoutDatesSorted, (days) =>
    days.some((d) => [0, 6].includes(parseDate(d).getDay()))
  );
  const mondayStreakPoints = computeWeeklyStreakByPredicate(allWorkoutDatesSorted, (days) =>
    days.some((d) => parseDate(d).getDay() === 1)
  );
  const mondayDatesSorted = allWorkoutDatesSorted.filter((d) => parseDate(d).getDay() === 1);
  const fridayDatesSorted = allWorkoutDatesSorted.filter((d) => parseDate(d).getDay() === 5);

  const nonRoutineLogsSorted = allLogsSorted.filter((l) => l.fromRoutine !== true);

  const routinesSorted = routines.slice().sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const memosSorted = memos.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const firstWorkoutDate = allWorkoutDatesSorted[0] || null;
  const within30OfFirst = firstWorkoutDate
    ? allWorkoutDatesSorted.filter((d) => d < addDaysStr(firstWorkoutDate, 30))
    : [];

  let changeBeginsDate = null;
  if (inbodySorted.length >= 3) {
    const baseline = inbodySorted[0].weight;
    for (let i = 2; i < inbodySorted.length; i++) {
      if (inbodySorted[i].weight != null && baseline != null && inbodySorted[i].weight !== baseline) {
        changeBeginsDate = inbodySorted[i].date;
        break;
      }
    }
  }

  const totalWorkoutSpanDays = firstWorkoutDate
    ? daysBetween(firstWorkoutDate, allWorkoutDatesSorted[allWorkoutDatesSorted.length - 1])
    : 0;
  function spanAchievedDate(spanDays) {
    if (!firstWorkoutDate) return null;
    const target = addDaysStr(firstWorkoutDate, spanDays);
    return allWorkoutDatesSorted.find((d) => d >= target) || null;
  }

  let allSeasonsDate = null;
  {
    const seen = new Set();
    for (const d of allWorkoutDatesSorted) {
      seen.add(seasonOf(d));
      if (seen.size === 4) {
        allSeasonsDate = d;
        break;
      }
    }
  }

  let allRounderDate = null;
  {
    const seenTypes = new Set();
    for (const log of allLogsSorted) {
      seenTypes.add(log.type);
      if (seenTypes.has("weight") && seenTypes.has("running") && seenTypes.has("stairmaster")) {
        allRounderDate = log.date;
        break;
      }
    }
  }

  const bodyProjectDone = !!(goals?.targetWeight && goals?.targetBodyFat && goals?.targetMuscleMass);

  const totalSetCountPoints = computeCumulativePoints(weightLogs, (l) => l.sets.length);
  const noneSetCumulative = computeCumulativePoints(weightLogs, (l) => l.sets.filter((s) => s.unit === "none").length);
  const dailySetTotals = computeDailyTotals(weightLogs, (l) => l.sets.length);
  const dailyVolumeTotals = computeDailyTotals(weightLogs, (l) => calcLogVolume(l));
  const distinctEquipmentPoints = computeDistinctCumulative(weightLogs, (l) => l.equipmentName);

  let allInDate = null;
  {
    const byDate = new Map();
    for (const log of allLogsSorted) {
      if (!byDate.has(log.date)) byDate.set(log.date, new Set());
      byDate.get(log.date).add(log.type === "weight" ? "weight" : log.type === "running" || log.type === "stairmaster" ? "cardio" : null);
    }
    for (const [date, types] of byDate) {
      if (types.has("weight") && types.has("cardio")) {
        allInDate = date;
        break;
      }
    }
  }

  const dailyStreakPoints = computeStreakAchievements(allWorkoutDatesSorted);
  const streak7Completions = countStreakCompletions(dailyStreakPoints, 7);
  const monthlyCalorieTotals = computeMonthlyResetTotals(allLogsSorted, (l) => calcLogCalories(l, bodyWeightKg));

  let muscleEvangelistDate = null;
  if (inbodySorted.length >= 2) {
    const baseMuscle = inbodySorted[0].muscleMass;
    const baseFat = inbodySorted[0].bodyFat;
    for (let i = 1; i < inbodySorted.length; i++) {
      const r = inbodySorted[i];
      if (
        r.muscleMass != null &&
        r.bodyFat != null &&
        baseMuscle != null &&
        baseFat != null &&
        r.muscleMass > baseMuscle &&
        r.bodyFat < baseFat
      ) {
        muscleEvangelistDate = r.date;
        break;
      }
    }
  }

  let perfectWeekDate = null;
  {
    const events = [
      ...weightLogs.map((l) => ({ date: l.date, kind: "weight" })),
      ...runningLogs.map((l) => ({ date: l.date, kind: "running" })),
      ...proteinDatesSorted.map((d) => ({ date: d, kind: "protein" })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const weekHas = new Map();
    for (const ev of events) {
      const wk = weekKeyOf(ev.date);
      if (!weekHas.has(wk)) weekHas.set(wk, new Set());
      weekHas.get(wk).add(ev.kind);
      if (weekHas.get(wk).size === 3) {
        perfectWeekDate = ev.date;
        break;
      }
    }
  }

  const monthlyRunDistanceTotals = computeMonthlyResetTotals(runningLogs, (l) => l.distance);
  const newYearMilestone = computeYearMonthMilestone(allWorkoutDatesSorted, [1], 10);
  const summerMilestone = computeYearMonthMilestone(allWorkoutDatesSorted, [6, 7, 8], 20);
  const winterMilestone = computeYearMonthMilestone(allWorkoutDatesSorted, [12, 1, 2], 15);

  const workoutRuns = computeStreakRuns(allWorkoutDatesSorted);
  function runLengthDays(run) {
    return daysBetween(run.start, run.end) + 1;
  }
  let threeDayMonkDate = null;
  for (let i = 0; i < workoutRuns.length; i++) {
    const run = workoutRuns[i];
    if (runLengthDays(run) < 3) continue;
    const nextRun = workoutRuns[i + 1];
    const gapEndDate = nextRun ? nextRun.start : todayStr;
    const gapDays = daysBetween(run.end, gapEndDate);
    if (gapDays >= 4) {
      threeDayMonkDate = run.end;
      break;
    }
  }

  let comebackDate = null;
  for (let i = 1; i < allWorkoutDatesSorted.length; i++) {
    if (daysBetween(allWorkoutDatesSorted[i - 1], allWorkoutDatesSorted[i]) >= 7) {
      comebackDate = allWorkoutDatesSorted[i];
      break;
    }
  }

  let perfectionistDate = null;
  {
    const byEquipment = new Map();
    for (const log of weightLogs) {
      const key = log.equipmentName || "";
      if (!byEquipment.has(key)) byEquipment.set(key, new Set());
      byEquipment.get(key).add(log.date);
    }
    for (const dateSet of byEquipment.values()) {
      const datesSorted = [...dateSet].sort();
      const hit = firstReaching(computeStreakAchievements(datesSorted), 5);
      if (hit && (!perfectionistDate || hit < perfectionistDate)) perfectionistDate = hit;
    }
  }

  const slowPaceRuns = runningLogs.filter((l) => l.pace >= 6);

  let tooHeavyDate = null;
  outerHeavy: for (const log of weightLogs) {
    for (const s of log.sets) {
      if (s.unit !== "none" && toKg(s) >= 100) {
        tooHeavyDate = log.date;
        break outerHeavy;
      }
    }
  }

  let surprisePrDate = null;
  {
    const maxByEquip = new Map();
    for (const log of weightLogs) {
      const weights = log.sets.filter((s) => s.unit !== "none").map(toKg);
      if (!weights.length) continue;
      const logMax = Math.max(...weights);
      const key = log.equipmentName || "";
      const prevMax = maxByEquip.get(key);
      if (prevMax !== undefined && logMax - prevMax >= 10) {
        surprisePrDate = log.date;
        break;
      }
      if (prevMax === undefined || logMax > prevMax) maxByEquip.set(key, logMax);
    }
  }

  let restMattersDate = null;
  for (let i = 0; i < allWorkoutDatesSorted.length - 1; i++) {
    if (!isNextDay(allWorkoutDatesSorted[i], allWorkoutDatesSorted[i + 1])) {
      restMattersDate = addDaysStr(allWorkoutDatesSorted[i], 1);
      break;
    }
  }

  const turtleStreakPoints = computeWeeklyQualifyingStreak(allWorkoutDatesSorted, 1);

  return {
    weightLogs,
    runningLogs,
    stairLogs,
    allWorkoutDatesSorted,
    inbodySorted,
    todayStr,

    prEvents: computeAllPrEvents(weightLogs),
    benchMaxPoints: computeRunningMaxByKeywords(weightLogs, ["벤치프레스", "벤치"]),
    squatMaxPoints: computeRunningMaxByKeywords(weightLogs, ["스쿼트"]),
    deadliftMaxPoints: computeRunningMaxByKeywords(weightLogs, ["데드리프트", "데드"]),

    dailyStreak: dailyStreakPoints,
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

    /* 신규 */
    dawnLog,
    nightLog,
    lunchRunLog,
    weekendStreakPoints,
    mondayStreakPoints,
    mondayDatesSorted,
    fridayDatesSorted,
    nonRoutineLogsSorted,
    routinesSorted,
    memosSorted,
    firstWorkoutDate,
    within30OfFirst,
    changeBeginsDate,
    totalWorkoutSpanDays,
    spanAchievedDate,
    allSeasonsDate,
    allRounderDate,
    bodyProjectDone,
    totalSetCountPoints,
    noneSetCumulative,
    dailySetTotals,
    dailyVolumeTotals,
    distinctEquipmentPoints,
    allInDate,
    streak7Completions,
    monthlyCalorieTotals,
    muscleEvangelistDate,
    perfectWeekDate,
    monthlyRunDistanceTotals,
    newYearMilestone,
    summerMilestone,
    winterMilestone,
    threeDayMonkDate,
    comebackDate,
    perfectionistDate,
    slowPaceRuns,
    tooHeavyDate,
    surprisePrDate,
    restMattersDate,
    turtleStreakPoints,
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
    achieved: !!b.achievedDate,
  }));
}

function buildBadges(data) {
  const list = [];

  /* ============ 💪 PR 달성 (20개) ============ */
  [40, 60, 80, 100, 120].forEach((t, i) => {
    list.push({
      id: `pr-bench-${t}`,
      category: "pr",
      series: "벤치프레스",
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
      series: "스쿼트",
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
      series: "데드리프트",
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
      series: "PR 갱신",
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

  /* ============ 🔥 연속 운동 streak (20개) ============ */
  [3, 7, 14, 30, 60, 100].forEach((t, i) => {
    list.push({
      id: `streak-days-${t}`,
      category: "streak",
      series: "연속 운동",
      tier: Math.min(i, TIER_COLORS.length - 1),
      glyph: "flame",
      centerLabel: `${t}`,
      subLabel: "일",
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
      series: "주간 달성",
      tier: i,
      glyph: "calendar",
      centerLabel: `${t}`,
      subLabel: "회/주",
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
      series: "주 3회 연속",
      tier: i === 0 ? 1 : 3,
      glyph: "flame",
      centerLabel: `${t}`,
      subLabel: "주",
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
      series: "월간 달성",
      tier: i,
      glyph: "calendar",
      centerLabel: `${t}`,
      subLabel: "회/월",
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
      series: "누적 운동",
      tier: 2 + i,
      glyph: "calendar",
      centerLabel: `${t}`,
      subLabel: "회",
      name: `누적 운동 ${t}회`,
      description: `누적 운동 일수 ${t}회를 달성했어요`,
      achievedDate: findNthDate(data.allWorkoutDatesSorted, t),
      progress: progressFromCount(data.allWorkoutDatesSorted.length, t, "회"),
    });
  });

  /* ============ 🏃 유산소 (20개) ============ */
  list.push({
    id: "cardio-first-run",
    category: "cardio",
    series: "첫 러닝",
    tier: 0,
    glyph: "shoe",
    name: "첫 러닝",
    description: "첫 러닝 기록을 남겼어요",
    achievedDate: data.runningLogs.length ? data.runningLogs[0].date : null,
  });
  [10, 50, 100, 500, 1000].forEach((t, i) => {
    list.push({
      id: `cardio-cum-dist-${t}`,
      category: "cardio",
      series: "누적 러닝",
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
        series: "단일 러닝",
        tier: i,
        glyph: "shoe",
        centerLabel: `${t}`,
        subLabel: t === 21 ? "km 하프" : "km",
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
        series: "페이스",
        tier: i,
        glyph: "heartbeat",
        centerLabel: formatPaceLabel(t),
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
    series: "첫 천국의계단",
    tier: 0,
    glyph: "stairs",
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
        series: "천국의계단 단계",
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
      series: "천국의계단 누적",
      tier: 3 + i,
      glyph: "stairs",
      centerLabel: `${t}`,
      subLabel: "분",
      name: `천국의계단 누적 ${t}분`,
      description: `천국의계단 누적 운동시간 ${t}분을 달성했어요`,
      achievedDate: firstReaching(data.cumulativeStairMinutes, t),
      progress: progressFromPoints(data.cumulativeStairMinutes, t, "분"),
    });
  });

  /* ============ 📉 인바디 변화 (20개) ============ */
  list.push({
    id: "inbody-first",
    category: "inbody",
    series: "첫 인바디",
    tier: 0,
    glyph: "scale",
    name: "첫 인바디 기록",
    description: "첫 인바디 기록을 남겼어요",
    achievedDate: data.inbodySorted.length ? data.inbodySorted[0].date : null,
  });
  [1, 2, 3, 5, 7, 10].forEach((t, i) => {
    list.push({
      id: `inbody-weight-loss-${t}`,
      category: "inbody",
      series: "체중 감량",
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
      series: "체지방률 감소",
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
      series: "골격근량 증가",
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
      series: "BMI 정상범위",
      tier: 2,
      glyph: "bmiCheck",
      centerLabel: "BMI",
      name: "BMI 정상범위 진입",
      description: "BMI가 정상범위(18.5~24.9)에 진입했어요",
      achievedDate: hit ? hit.date : null,
    });
  }
  [5, 10, 20, 50].forEach((t, i) => {
    list.push({
      id: `inbody-count-${t}`,
      category: "inbody",
      series: "인바디 기록",
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

  /* ============ 🥤 생활습관 (10개) ============ */
  [7, 14, 30].forEach((t, i) => {
    list.push({
      id: `life-protein-streak-${t}`,
      category: "lifestyle",
      series: "프로틴 연속",
      tier: 1 + i,
      glyph: "bottle",
      centerLabel: `${t}`,
      subLabel: "일",
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
      series: "프로틴 누적",
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
      series: "금주 연속",
      tier: 1 + i,
      glyph: "glassX",
      centerLabel: `${t}`,
      subLabel: "일",
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
      series: "운동+프로틴",
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

  /* ============ ⚡ 볼륨 & 칼로리 (10개) ============ */
  [10000, 50000, 100000, 300000, 500000].forEach((t, i) => {
    list.push({
      id: `volume-total-${t}`,
      category: "volume",
      series: "총 볼륨",
      tier: i,
      glyph: "boltGlyph",
      centerLabel: `${t / 1000}`,
      subLabel: "t",
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
      series: "총 칼로리",
      tier: i,
      glyph: "trophy",
      centerLabel: `${t / 1000}`,
      subLabel: "K",
      name: `총 칼로리 ${t.toLocaleString()}kcal`,
      description: `누적 소모 칼로리 ${t.toLocaleString()}kcal을 달성했어요`,
      achievedDate: firstReaching(data.cumulativeCalories, t),
      progress: progressFromPoints(data.cumulativeCalories, t, "kcal"),
    });
  });

  /* ============ 🎭 운동 스타일 & 개성 (10개) ============ */
  list.push({
    id: "style-dawn",
    category: "style",
    series: "새벽반",
    tier: 1,
    glyph: "sunrise",
    name: "새벽반",
    description: "오전 6시 이전에 운동을 기록했어요",
    achievedDate: data.dawnLog ? data.dawnLog.date : null,
  });
  list.push({
    id: "style-night-owl",
    category: "style",
    series: "야행성",
    tier: 5,
    glyph: "moon",
    name: "야행성",
    description: "오후 10시 이후에 운동을 기록했어요",
    achievedDate: data.nightLog ? data.nightLog.date : null,
  });
  list.push({
    id: "style-weekend-warrior",
    category: "style",
    series: "주말전사",
    tier: 3,
    glyph: "flag",
    centerLabel: "5",
    subLabel: "주",
    name: "주말전사",
    description: "주말이 낀 주를 5주 연속으로 운동했어요",
    achievedDate: firstReaching(data.weekendStreakPoints, 5),
    progress: progressFromPoints(data.weekendStreakPoints, 5, "주"),
  });
  list.push({
    id: "style-lunch-runner",
    category: "style",
    series: "점심러너",
    tier: 2,
    glyph: "sunNoon",
    name: "점심러너",
    description: "낮 12~2시 사이에 러닝을 기록했어요",
    achievedDate: data.lunchRunLog ? data.lunchRunLog.date : null,
  });
  list.push({
    id: "style-rain-or-shine",
    category: "style",
    series: "비가 와도",
    tier: 1,
    glyph: "raindrop",
    name: "비가 와도",
    description: "날씨와 상관없이 운동을 기록했어요",
    achievedDate: data.allWorkoutDatesSorted.length ? data.allWorkoutDatesSorted[0] : null,
  });
  list.push({
    id: "style-monday-slayer",
    category: "style",
    series: "월요병 극복",
    tier: 2,
    glyph: "calendar",
    centerLabel: "10",
    subLabel: "월",
    name: "월요병 극복",
    description: "월요일에 10회 운동했어요",
    achievedDate: findNthDate(data.mondayDatesSorted, 10),
    progress: progressFromCount(data.mondayDatesSorted.length, 10, "회"),
  });
  list.push({
    id: "style-tgif",
    category: "style",
    series: "불금 운동",
    tier: 2,
    glyph: "flame",
    centerLabel: "10",
    subLabel: "금",
    name: "불금 운동",
    description: "금요일에 10회 운동했어요",
    achievedDate: findNthDate(data.fridayDatesSorted, 10),
    progress: progressFromCount(data.fridayDatesSorted.length, 10, "회"),
  });
  list.push({
    id: "style-solo-fighter",
    category: "style",
    series: "혼자서도 잘해요",
    tier: 3,
    glyph: "dumbbell",
    centerLabel: "30",
    subLabel: "회",
    name: "혼자서도 잘해요",
    description: "루틴 없이 직접 운동을 30회 기록했어요",
    achievedDate: data.nonRoutineLogsSorted.length >= 30 ? data.nonRoutineLogsSorted[29].date : null,
    progress: progressFromCount(data.nonRoutineLogsSorted.length, 30, "회"),
  });
  list.push({
    id: "style-planner",
    category: "style",
    series: "계획형 인간",
    tier: 2,
    glyph: "checklist",
    centerLabel: "5",
    subLabel: "루틴",
    name: "계획형 인간",
    description: "루틴을 5개 저장했어요",
    achievedDate:
      data.routinesSorted.length >= 5
        ? data.routinesSorted[4].createdAt
          ? formatDateObj(new Date(data.routinesSorted[4].createdAt))
          : data.todayStr
        : null,
    progress: progressFromCount(data.routinesSorted.length, 5, "개"),
  });
  list.push({
    id: "style-record-keeper",
    category: "style",
    series: "기록왕",
    tier: 3,
    glyph: "pencil",
    centerLabel: "50",
    subLabel: "메모",
    name: "기록왕",
    description: "운동 메모를 50회 작성했어요",
    achievedDate: data.memosSorted.length >= 50 ? data.memosSorted[49].date : null,
    progress: progressFromCount(data.memosSorted.length, 50, "회"),
  });

  /* ============ 💫 특별한 순간 (10개) ============ */
  list.push({
    id: "special-first-step",
    category: "special",
    series: "첫 발걸음",
    tier: 2,
    glyph: "footprint",
    name: "첫 발걸음",
    description: "앱에 첫 운동 기록을 남겼어요",
    achievedDate: data.firstWorkoutDate,
  });
  list.push({
    id: "special-miracle-month",
    category: "special",
    series: "한 달의 기적",
    tier: 3,
    glyph: "sparkle",
    centerLabel: "10",
    subLabel: "/30일",
    name: "한 달의 기적",
    description: "첫 운동 후 30일 안에 10회를 달성했어요",
    achievedDate: data.within30OfFirst.length >= 10 ? data.within30OfFirst[9] : null,
    progress: progressFromCount(data.within30OfFirst.length, 10, "회"),
  });
  list.push({
    id: "special-change-begins",
    category: "special",
    series: "변화의 시작",
    tier: 2,
    glyph: "scale",
    name: "변화의 시작",
    description: "인바디 3회 이상 기록 후 체중 변화가 감지됐어요",
    achievedDate: data.changeBeginsDate,
  });
  list.push({
    id: "special-consistency-90",
    category: "special",
    series: "꾸준함의 힘",
    tier: 3,
    glyph: "calendar",
    centerLabel: "90",
    subLabel: "일",
    name: "꾸준함의 힘",
    description: "운동 기록이 90일 동안 이어졌어요",
    achievedDate: data.spanAchievedDate(90),
    progress: { current: data.totalWorkoutSpanDays, target: 90, unit: "일" },
  });
  list.push({
    id: "special-half-year",
    category: "special",
    series: "반년의 여정",
    tier: 4,
    glyph: "calendar",
    centerLabel: "180",
    subLabel: "일",
    name: "반년의 여정",
    description: "운동 기록이 180일 동안 이어졌어요",
    achievedDate: data.spanAchievedDate(180),
    progress: { current: data.totalWorkoutSpanDays, target: 180, unit: "일" },
  });
  list.push({
    id: "special-year-miracle",
    category: "special",
    series: "1년의 기적",
    tier: 5,
    glyph: "trophy",
    centerLabel: "365",
    subLabel: "일",
    name: "1년의 기적",
    description: "운동 기록이 365일 동안 이어졌어요",
    achievedDate: data.spanAchievedDate(365),
    progress: { current: data.totalWorkoutSpanDays, target: 365, unit: "일" },
  });
  list.push({
    id: "special-all-seasons",
    category: "special",
    series: "계절을 넘어",
    tier: 4,
    glyph: "seasons",
    name: "계절을 넘어",
    description: "봄, 여름, 가을, 겨울 모두 운동을 기록했어요",
    achievedDate: data.allSeasonsDate,
  });
  list.push({
    id: "special-all-rounder",
    category: "special",
    series: "올라운더",
    tier: 3,
    glyph: "starGlyph",
    name: "올라운더",
    description: "웨이트, 러닝, 천국의계단을 모두 기록했어요",
    achievedDate: data.allRounderDate,
  });
  list.push({
    id: "special-body-project",
    category: "special",
    series: "몸짱 프로젝트",
    tier: 2,
    glyph: "target",
    name: "몸짱 프로젝트",
    description: "목표 체중, 체지방, 근육량을 모두 설정했어요",
    achievedDate: data.bodyProjectDone ? data.todayStr : null,
  });
  list.push({
    id: "special-data-geek",
    category: "special",
    series: "데이터 덕후",
    tier: 1,
    glyph: "chart",
    centerLabel: "10",
    subLabel: "회",
    name: "데이터 덕후",
    description: "인바디를 10회 이상 기록했어요",
    achievedDate: data.inbodySorted.length >= 10 ? data.inbodySorted[9].date : null,
    progress: progressFromCount(data.inbodySorted.length, 10, "회"),
  });

  /* ============ 🏋️ 운동량 마일스톤 (10개) ============ */
  list.push({
    id: "milestone-first-set",
    category: "milestone",
    series: "첫 세트",
    tier: 0,
    glyph: "dumbbell",
    name: "첫 세트",
    description: "첫 웨이트 세트를 기록했어요",
    achievedDate: data.weightLogs.length ? data.weightLogs[0].date : null,
  });
  [100, 1000, 5000].forEach((t, i) => {
    list.push({
      id: `milestone-set-${t}`,
      category: "milestone",
      series: "누적 세트",
      tier: [1, 3, 5][i],
      glyph: "dumbbell",
      centerLabel: `${t}`,
      subLabel: "SET",
      name: `${t}세트`,
      description: `누적 세트 ${t}개를 달성했어요`,
      achievedDate: firstReaching(data.totalSetCountPoints, t),
      progress: progressFromPoints(data.totalSetCountPoints, t, "세트"),
    });
  });
  list.push({
    id: "milestone-daily-10-sets",
    category: "milestone",
    series: "오늘만큼은",
    tier: 2,
    glyph: "dumbbell",
    centerLabel: "10",
    subLabel: "세트",
    name: "오늘만큼은",
    description: "하루에 10세트 이상 기록했어요",
    achievedDate: firstReaching(data.dailySetTotals, 10),
    progress: progressFromPoints(data.dailySetTotals, 10, "세트"),
  });
  list.push({
    id: "milestone-volume-king",
    category: "milestone",
    series: "볼륨킹",
    tier: 2,
    glyph: "boltGlyph",
    centerLabel: "5",
    subLabel: "t",
    name: "볼륨킹",
    description: "하루 총 볼륨 5,000kg 이상을 기록했어요",
    achievedDate: firstReaching(data.dailyVolumeTotals, 5000),
    progress: progressFromPoints(data.dailyVolumeTotals, 5000, "kg"),
  });
  list.push({
    id: "milestone-super-volume",
    category: "milestone",
    series: "슈퍼볼륨",
    tier: 4,
    glyph: "boltGlyph",
    centerLabel: "10",
    subLabel: "t",
    name: "슈퍼볼륨",
    description: "하루 총 볼륨 10,000kg 이상을 기록했어요",
    achievedDate: firstReaching(data.dailyVolumeTotals, 10000),
    progress: progressFromPoints(data.dailyVolumeTotals, 10000, "kg"),
  });
  list.push({
    id: "milestone-muscle-factory",
    category: "milestone",
    series: "근육공장",
    tier: 2,
    glyph: "muscle",
    centerLabel: "10",
    subLabel: "종류",
    name: "근육공장",
    description: "웨이트 운동 종류 10가지 이상을 기록했어요",
    achievedDate: firstReaching(data.distinctEquipmentPoints, 10),
    progress: progressFromPoints(data.distinctEquipmentPoints, 10, "가지"),
  });
  list.push({
    id: "milestone-equipment-master",
    category: "milestone",
    series: "기구마스터",
    tier: 3,
    glyph: "dumbbell",
    centerLabel: "20",
    subLabel: "기구",
    name: "기구마스터",
    description: "20가지 이상 다른 기구를 사용했어요",
    achievedDate: firstReaching(data.distinctEquipmentPoints, 20),
    progress: progressFromPoints(data.distinctEquipmentPoints, 20, "가지"),
  });
  list.push({
    id: "milestone-all-in",
    category: "milestone",
    series: "올인",
    tier: 3,
    glyph: "heartbeat",
    name: "올인",
    description: "하루에 웨이트와 유산소를 모두 기록했어요",
    achievedDate: data.allInDate,
  });

  /* ============ 🌟 챌린지 (10개) ============ */
  list.push({
    id: "challenge-30-days",
    category: "challenge",
    series: "30일 챌린지",
    tier: 4,
    glyph: "flame",
    centerLabel: "30",
    subLabel: "일",
    name: "30일 챌린지",
    description: "30일 동안 매일 운동을 기록했어요",
    achievedDate: firstReaching(data.dailyStreak, 30),
    progress: progressFromPoints(data.dailyStreak, 30, "일"),
  });
  list.push({
    id: "challenge-no-pain-no-gain",
    category: "challenge",
    series: "노페인노게인",
    tier: 3,
    glyph: "muscle",
    centerLabel: "3",
    subLabel: "회",
    name: "노페인노게인",
    description: "연속 7일 운동을 3번 달성했어요",
    achievedDate: firstReaching(data.streak7Completions, 3),
    progress: progressFromPoints(data.streak7Completions, 3, "회"),
  });
  list.push({
    id: "challenge-fat-burner",
    category: "challenge",
    series: "체지방버너",
    tier: 3,
    glyph: "bodyfatDrop",
    centerLabel: "10",
    subLabel: "K",
    name: "체지방버너",
    description: "한 달 누적 칼로리 소모 10,000kcal을 달성했어요",
    achievedDate: firstReaching(data.monthlyCalorieTotals, 10000),
    progress: progressFromPoints(data.monthlyCalorieTotals, 10000, "kcal"),
  });
  list.push({
    id: "challenge-muscle-evangelist",
    category: "challenge",
    series: "근육전도사",
    tier: 4,
    glyph: "muscle",
    name: "근육전도사",
    description: "골격근량 증가와 체지방 감소를 동시에 달성했어요",
    achievedDate: data.muscleEvangelistDate,
  });
  list.push({
    id: "challenge-perfect-week",
    category: "challenge",
    series: "퍼펙트위크",
    tier: 3,
    glyph: "checklist",
    name: "퍼펙트위크",
    description: "한 주에 웨이트, 러닝, 프로틴을 모두 기록했어요",
    achievedDate: data.perfectWeekDate,
  });
  list.push({
    id: "challenge-iron-will",
    category: "challenge",
    series: "철의 의지",
    tier: 4,
    glyph: "calendar",
    centerLabel: "4",
    subLabel: "주",
    name: "철의 의지",
    description: "운동하기 싫은 월요일에 4주 연속 운동했어요",
    achievedDate: firstReaching(data.mondayStreakPoints, 4),
    progress: progressFromPoints(data.mondayStreakPoints, 4, "주"),
  });
  list.push({
    id: "challenge-speed-runner",
    category: "challenge",
    series: "스피드러너",
    tier: 3,
    glyph: "shoe",
    centerLabel: "100",
    subLabel: "km",
    name: "스피드러너",
    description: "한 달 러닝 100km를 달성했어요",
    achievedDate: firstReaching(data.monthlyRunDistanceTotals, 100),
    progress: progressFromPoints(data.monthlyRunDistanceTotals, 100, "km"),
  });
  list.push({
    id: "challenge-new-year",
    category: "challenge",
    series: "새해결심",
    tier: 2,
    glyph: "sparkle",
    centerLabel: "10",
    subLabel: "1월",
    name: "새해결심",
    description: "1월에 10회 이상 운동했어요",
    achievedDate: data.newYearMilestone.achievedDate,
    progress: { current: data.newYearMilestone.bestCount, target: 10, unit: "회" },
  });
  list.push({
    id: "challenge-summer-ready",
    category: "challenge",
    series: "여름준비",
    tier: 2,
    glyph: "sunNoon",
    centerLabel: "20",
    subLabel: "여름",
    name: "여름준비",
    description: "6~8월 중 한 달 20회 이상 운동했어요",
    achievedDate: data.summerMilestone.achievedDate,
    progress: { current: data.summerMilestone.bestCount, target: 20, unit: "회" },
  });
  list.push({
    id: "challenge-winter-overcome",
    category: "challenge",
    series: "겨울극복",
    tier: 2,
    glyph: "snowflake",
    centerLabel: "15",
    subLabel: "겨울",
    name: "겨울극복",
    description: "12~2월 중 한 달 15회 이상 운동했어요",
    achievedDate: data.winterMilestone.achievedDate,
    progress: { current: data.winterMilestone.bestCount, target: 15, unit: "회" },
  });

  /* ============ 🎪 유머 / 숨겨진 뱃지 (10개) ============ */
  list.push({
    id: "hidden-three-day-monk",
    category: "hidden",
    series: "작심삼일",
    tier: 1,
    glyph: "flame",
    name: "작심삼일",
    description: "그 불타던 의지, 어디로 갔을까요? (실패해도 괜찮아요!)",
    achievedDate: data.threeDayMonkDate,
  });
  list.push({
    id: "hidden-comeback",
    category: "hidden",
    series: "다시 시작",
    tier: 2,
    glyph: "footprint",
    name: "다시 시작",
    description: "오랜만이에요! 돌아온 당신을 응원해요",
    achievedDate: data.comebackDate,
  });
  list.push({
    id: "hidden-perfectionist",
    category: "hidden",
    series: "완벽주의자",
    tier: 3,
    glyph: "checklist",
    name: "완벽주의자",
    description: "한 가지에 꽂히면 끝을 보는 타입이군요",
    achievedDate: data.perfectionistDate,
  });
  list.push({
    id: "hidden-slow-is-ok",
    category: "hidden",
    series: "천천히 가도 돼",
    tier: 1,
    glyph: "shoe",
    name: "천천히 가도 돼",
    description: "속도보다 중요한 건 완주예요",
    achievedDate: data.slowPaceRuns.length >= 10 ? data.slowPaceRuns[9].date : null,
    progress: progressFromCount(data.slowPaceRuns.length, 10, "회"),
  });
  list.push({
    id: "hidden-bodyweight-only",
    category: "hidden",
    series: "저도 몰랐어요",
    tier: 2,
    glyph: "muscle",
    name: "저도 몰랐어요",
    description: "맨몸으로도 이렇게 할 수 있다니",
    achievedDate: firstReaching(data.noneSetCumulative, 30),
    progress: progressFromPoints(data.noneSetCumulative, 30, "세트"),
  });
  list.push({
    id: "hidden-too-heavy",
    category: "hidden",
    series: "무거워",
    tier: 3,
    glyph: "dumbbell",
    name: "무거워",
    description: "이 정도면 인간계 최강 아닌가요?",
    achievedDate: data.tooHeavyDate,
  });
  list.push({
    id: "hidden-surprise-pr",
    category: "hidden",
    series: "깜짝 놀랐지",
    tier: 4,
    glyph: "sparkle",
    name: "깜짝 놀랐지",
    description: "갑자기 확 늘어난 그 순간",
    achievedDate: data.surprisePrDate,
  });
  list.push({
    id: "hidden-rest-matters",
    category: "hidden",
    series: "오늘은 쉬어요",
    tier: 0,
    glyph: "moon",
    name: "오늘은 쉬어요",
    description: "쉬는 것도 훈련의 일부예요",
    achievedDate: data.restMattersDate,
  });
  list.push({
    id: "hidden-steady-turtle",
    category: "hidden",
    series: "꾸준한 거북이",
    tier: 4,
    glyph: "turtle",
    centerLabel: "26",
    subLabel: "주",
    name: "꾸준한 거북이",
    description: "느려도 꾸준하면 결국 도착해요",
    achievedDate: firstReaching(data.turtleStreakPoints, 26),
    progress: progressFromPoints(data.turtleStreakPoints, 26, "주"),
  });
  list.push({
    id: "hidden-legend-begins",
    category: "hidden",
    series: "전설의 시작",
    tier: 5,
    glyph: "trophy",
    name: "전설의 시작",
    description: "당신은 이미 많은 걸 해냈어요",
    achievedDate: null, // buildBadges() 마지막에 별도 계산
  });

  return list;
}

/* ---------------- 엔트리 포인트 ---------------- */
export async function evaluateAllBadges() {
  const [workoutLogs, inbodyRecords, drinkLogs, routines, memos, goals] = await Promise.all([
    db.getAllWorkoutLogs(),
    db.getAllInbodyRecords(),
    db.getAllDrinkLogs(),
    db.getRoutines(),
    db.getAllWorkoutMemos(),
    db.getSetting("fitnessGoals", null),
  ]);
  const data = prepare({ workoutLogs, inbodyRecords, drinkLogs, routines, memos, goals });
  const list = buildBadges(data);

  // "전설의 시작"은 다른 149개 뱃지 중 50개를 달성한 시점을 가리키는 메타 뱃지
  const legend = list.find((b) => b.id === "hidden-legend-begins");
  if (legend) {
    const otherAchievedDates = list
      .filter((b) => b.id !== "hidden-legend-begins" && b.achievedDate)
      .map((b) => b.achievedDate)
      .sort();
    legend.achievedDate = otherAchievedDates.length >= 50 ? otherAchievedDates[49] : null;
    legend.progress = progressFromCount(otherAchievedDates.length, 50, "개");
  }

  return finalize(list);
}
