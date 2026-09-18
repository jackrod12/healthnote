const MINT = "#00e5a0";
const GRID = "#333333";
const TEXT_DIM = "#9a9a9a";

/* Fixed 8%/84%/8% x-axis layout: the first point sits 8% of the plot width
   in from the left, the last sits 8% in from the right, and points between
   are spaced evenly across the remaining 84% — instead of a margin that
   shrinks as more points are added. */
const X_EDGE_MARGIN_FRAC = 0.08;

/* shared visual settings for every "운동 통계" chart (the single-equipment
   category charts, plus the running-pace and stairmaster charts) so they
   render with identical padding, point size, and font sizes — every one of
   those charts must go through drawMultiLineChart and read these, never a
   locally hardcoded copy. */
const STAT_CHART_PADDING = { top: 28, right: 16, bottom: 22, left: 44 };
const STAT_CHART_POINT_RADIUS = 3.5;
const STAT_CHART_AXIS_FONT = "11px system-ui";
const STAT_CHART_VALUE_FONT = "9px system-ui";
const STAT_CHART_DATE_FONT = "13px system-ui";
const STAT_CHART_EMPTY_FONT = "13px system-ui";

function xForIndex(i, n, plotW, plotLeft) {
  if (n <= 1) return plotLeft + 0.5 * plotW;
  return plotLeft + (X_EDGE_MARGIN_FRAC + (i / (n - 1)) * (1 - 2 * X_EDGE_MARGIN_FRAC)) * plotW;
}

/* Canvases inside a hidden tab panel ([hidden] -> display:none) report a
   zero-size getBoundingClientRect(). Falling back to canvas.width/height in
   that case is a trap: those are the *buffer* pixel counts we ourselves set
   below (already multiplied by dpr), so redrawing a still-hidden canvas
   would keep re-multiplying its own previous output on every render — the
   chart balloons in logical size a little more each time, and once the tab
   is finally shown, CSS squeezes that oversized buffer back down, making
   fonts/points/padding look shrunken relative to a chart that was visible
   (and therefore correctly measured) from the start. Caching the last
   known-good CSS size per canvas — seeded from its pristine width/height
   attributes before we ever touch them — avoids that entirely. */
const nominalSizeCache = new WeakMap();

function setupCanvasForDPR(canvas) {
  const dpr = window.devicePixelRatio || 1;
  if (!nominalSizeCache.has(canvas)) {
    nominalSizeCache.set(canvas, { width: canvas.width, height: canvas.height });
  }
  const rect = canvas.getBoundingClientRect();
  const cached = nominalSizeCache.get(canvas);
  const cssWidth = rect.width || cached.width;
  const cssHeight = rect.height || cached.height;
  if (rect.width && rect.height) {
    nominalSizeCache.set(canvas, { width: rect.width, height: rect.height });
  }
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: cssWidth, height: cssHeight };
}

/**
 * Chooses a "nice" grid step from the data's own range, then floors the
 * minimum / ceils the maximum to that step, so the axis lands on round,
 * human-friendly numbers (e.g. a 57~83 range becomes a 50~90 axis with
 * 10-unit gridlines) instead of an arbitrary padded range. Shared by every
 * chart in the app (workout stat charts and inbody charts alike) so they
 * all follow the exact same rule:
 *   range >= 100 -> step 20   range >= 50 -> step 10
 *   range >= 20  -> step 5    range >= 10 -> step 2
 *   otherwise    -> step 1
 */
export function computeNiceYRange(values) {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const range = dataMax - dataMin;
  let step;
  if (range >= 100) step = 20;
  else if (range >= 50) step = 10;
  else if (range >= 20) step = 5;
  else if (range >= 10) step = 2;
  else step = 1;

  let min = Math.floor(dataMin / step) * step;
  let max = Math.ceil(dataMax / step) * step;
  if (max <= min) {
    min -= step;
    max += step;
  }
  return { min, max, step };
}

/* yFor is passed in (rather than recomputed here) so a chart with an
   inverted axis — e.g. pace, where a smaller number is "better" and drawn
   higher up — still gets gridlines at the right pixel positions */
function drawYAxisGrid(ctx, { padding, plotW, width, min, max, step, yFor }) {
  const tickCount = Math.round((max - min) / step) + 1;

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.fillStyle = TEXT_DIM;
  ctx.font = STAT_CHART_AXIS_FONT;
  ctx.textAlign = "right";

  for (let i = 0; i < tickCount; i++) {
    const value = min + step * i;
    const y = yFor(value);

    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    ctx.fillText(`${value}`, padding.left - 8, y + 4);
  }
}

/**
 * Draws a simple single-series line chart on a canvas (used for inbody
 * metrics). Always mint, always shows y-axis gridlines/labels on the
 * shared nice-step rule above.
 * @param {HTMLCanvasElement} canvas
 * @param {string[]} labels - x-axis labels (dates)
 * @param {number[]} values - y values
 * @param {{color?: string, unit?: string}} [options]
 */
export function drawLineChart(canvas, labels, values, options = {}) {
  const color = options.color || MINT;
  const unit = options.unit || "";
  const { ctx, width, height } = setupCanvasForDPR(canvas);

  ctx.clearRect(0, 0, width, height);

  if (!values || values.length === 0) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = STAT_CHART_EMPTY_FONT;
    ctx.textAlign = "center";
    ctx.fillText("데이터가 없어요", width / 2, height / 2);
    return;
  }

  // y-axis labels are always shown, so the left padding always reserves room for them
  const padding = { top: 28, right: 40, bottom: 22, left: 50 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const { min, max, step } = computeNiceYRange(values);
  const range = max - min || 1;
  const yFor = (v) => padding.top + plotH - ((v - min) / range) * plotH;
  const n = values.length;
  const xFor = (i) => xForIndex(i, n, plotW, padding.left);

  drawYAxisGrid(ctx, { padding, plotW, width, min, max, step, yFor });

  // line path
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = xFor(i);
    const y = yFor(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  // fill under line
  const last = n - 1;
  ctx.lineTo(xFor(last), padding.top + plotH);
  ctx.lineTo(xFor(0), padding.top + plotH);
  ctx.closePath();
  ctx.fillStyle = color + "22";
  ctx.fill();

  // points
  values.forEach((v, i) => {
    const x = xFor(i);
    const y = yFor(v);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  // shared thinning: at most 6 labels (point values and dates alike), always
  // keeping the first and last, so a long series doesn't turn into a smear
  const maxLabels = 6;
  const step2 = Math.max(1, Math.ceil((n - 1) / (maxLabels - 1)) || 1);
  const isShownIndex = (i) => i === 0 || i === n - 1 || i % step2 === 0;

  // per-point value labels, centered 8px above each point
  const roundTo1 = (v) => Math.round(v * 10) / 10;
  ctx.fillStyle = MINT;
  ctx.font = "11px system-ui";
  ctx.textAlign = "center";
  values.forEach((v, i) => {
    if (!isShownIndex(i)) return;
    ctx.fillText(`${roundTo1(v)}${unit}`, xFor(i), yFor(v) - 8);
  });

  // date labels: centered directly under each shown data point, thinned to
  // at most 6 when there are many, but the first and last are always shown
  if (labels && labels.length) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = STAT_CHART_DATE_FONT;
    ctx.textAlign = "center";
    const labelY = padding.top + plotH + 16;
    labels.forEach((label, i) => {
      if (!isShownIndex(i)) return;
      ctx.fillText(label, xFor(i), labelY);
    });
  }
}

/**
 * Draws a single-series (or, if ever needed, multi-series) line chart
 * sharing one x-axis of date labels — used for every "운동 통계" chart:
 * the single selected equipment's max-weight trend, and the cardio
 * pace/stairmaster charts. After drawing, canvas.__chartPoints holds every
 * plotted point's pixel position plus its source data, for click
 * hit-testing (see attachChartClickHandler).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string[]} dateLabels - shared x-axis labels, index-addressed by each point
 * @param {{name: string, color: string, points: {index: number, value: number, date: string, logId?: number}[]}[]} series
 * @param {{unit?: string}} [options]
 */
export function drawMultiLineChart(canvas, dateLabels, series, options = {}) {
  const unit = options.unit || "";
  const { ctx, width, height } = setupCanvasForDPR(canvas);

  ctx.clearRect(0, 0, width, height);
  canvas.__chartPoints = [];

  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  if (!dateLabels.length || !allValues.length) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = STAT_CHART_EMPTY_FONT;
    ctx.textAlign = "center";
    ctx.fillText("데이터가 없어요", width / 2, height / 2);
    return;
  }

  const padding = STAT_CHART_PADDING;
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const { min, max, step } = computeNiceYRange(allValues);
  const range = max - min || 1;
  const yFor = (v) => padding.top + plotH - ((v - min) / range) * plotH;
  const n = dateLabels.length;
  const xFor = (i) => xForIndex(i, n, plotW, padding.left);

  drawYAxisGrid(ctx, { padding, plotW, width, min, max, step, yFor });

  // an optional dashed reference line (e.g. an ideal cadence of 180spm) —
  // drawn before the data series so real data stays visually on top
  if (options.referenceLine) {
    const { value, label, color } = options.referenceLine;
    const y = yFor(value);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color || TEXT_DIM;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.restore();
    if (label) {
      ctx.fillStyle = color || TEXT_DIM;
      ctx.font = STAT_CHART_AXIS_FONT;
      ctx.textAlign = "left";
      ctx.fillText(label, padding.left + 4, y - 4);
    }
  }

  const hitPoints = [];
  const seriesSorted = series.map((s) => s.points.slice().sort((a, b) => a.index - b.index));

  series.forEach((s, si) => {
    const sorted = seriesSorted[si];
    if (!sorted.length) return;

    ctx.beginPath();
    let started = false;
    sorted.forEach((p) => {
      const x = xFor(p.index);
      const y = yFor(p.value);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    sorted.forEach((p) => {
      const x = xFor(p.index);
      const y = yFor(p.value);
      ctx.beginPath();
      ctx.arc(x, y, STAT_CHART_POINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      hitPoints.push({ x, y, seriesName: s.name, value: p.value, date: p.date, logId: p.logId });
    });
  });

  canvas.__chartPoints = hitPoints;

  // per-point value labels ("60kg") near every point — none are skipped,
  // every point gets its value shown:
  // - alternate above/below by point index so labels on adjacent, closely
  //   spaced points don't run into each other
  // - flip to whichever side actually has room when a point sits right at
  //   the top or bottom of the plot area (so the label can't run into the
  //   axis area above, or the date labels below)
  // - flip from left- to right-anchored when the label would run past the
  //   canvas's right edge (always true for the rightmost/most-recent point)
  ctx.font = STAT_CHART_VALUE_FONT;
  const labelClearance = 10;
  series.forEach((s, si) => {
    seriesSorted[si].forEach((p, pi) => {
      const x = xFor(p.index);
      const y = yFor(p.value);

      let above = pi % 2 === 0;
      if (above && y - labelClearance < padding.top) above = false;
      else if (!above && y + labelClearance > padding.top + plotH) above = true;
      const labelY = above ? y - 6 : y + 14;

      const text = `${p.value}${unit}`;
      const textWidth = ctx.measureText(text).width;
      let labelX = x + 6;
      ctx.textAlign = "left";
      if (labelX + textWidth > width - padding.right) {
        labelX = x - 6;
        ctx.textAlign = "right";
      } else if (labelX < padding.left) {
        labelX = padding.left;
        ctx.textAlign = "left";
      }

      ctx.fillStyle = s.color;
      ctx.fillText(text, labelX, labelY);
    });
  });

  // date labels along shared x-axis, thinned to at most 6
  const maxLabels = 6;
  const step2 = Math.max(1, Math.ceil((n - 1) / (maxLabels - 1)) || 1);
  const isShownIndex = (i) => i === 0 || i === n - 1 || i % step2 === 0;

  ctx.fillStyle = TEXT_DIM;
  ctx.font = STAT_CHART_DATE_FONT;
  ctx.textAlign = "center";
  const labelY = padding.top + plotH + 16;
  dateLabels.forEach((label, i) => {
    if (!isShownIndex(i)) return;
    ctx.fillText(label, xFor(i), labelY);
  });
}

/* heart-rate zone 1~5 colors, shared by every chart/summary that breaks a
   run down by zone */
export const HR_ZONE_COLORS = {
  1: "#4FC3F7", // blue
  2: "#4DB6AC", // teal
  3: "#81C784", // green
  4: "#FFB74D", // orange
  5: "#EF5350", // red
};

const PACE_FAST_COLOR = MINT;
const PACE_SLOW_COLOR = "#ff6b35";

/** "5.5" (minutes, decimal) -> "5'30\"" */
export function formatPaceLabel(paceMinDecimal) {
  if (paceMinDecimal == null || !isFinite(paceMinDecimal)) return "-";
  const totalSeconds = Math.round(paceMinDecimal * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}'${String(s).padStart(2, "0")}"`;
}

/** "5'30\"" or "5:30" -> 5.5 (decimal minutes); null/unparsable -> null */
export function parsePaceLabel(text) {
  if (text == null) return null;
  const match = String(text).match(/(\d+)['\s:]+(\d+)/);
  if (!match) return null;
  const m = Number(match[1]);
  const s = Number(match[2]);
  if (!isFinite(m) || !isFinite(s)) return null;
  return m + s / 60;
}

/** "12:34" (mm:ss) -> 12.5667 (decimal minutes); null/unparsable -> null */
export function parseMinutesSeconds(text) {
  return parsePaceLabel(text);
}

/** 12.5667 (decimal minutes) -> "12:34" (mm:ss) */
export function formatMinutesSeconds(decimalMinutes) {
  if (decimalMinutes == null || !isFinite(decimalMinutes)) return "-";
  const totalSeconds = Math.round(decimalMinutes * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Draws the running pace trend: unlike every other chart here, the y-axis
 * is inverted — a *smaller* pace value (faster) is drawn higher up, since
 * that's the intuitive "better = up" reading for pace. Each point is
 * colored mint when it beats the target pace and orange when it doesn't
 * (or always mint when no target is set); an optional dashed target-pace
 * line is drawn across the chart.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string[]} dateLabels
 * @param {{index: number, value: number, date: string, logId?: number}[]} points - value is pace in decimal minutes/km
 * @param {{targetPace?: number|null}} [options]
 */
export function drawPaceTrendChart(canvas, dateLabels, points, options = {}) {
  const targetPace = options.targetPace ?? null;
  const { ctx, width, height } = setupCanvasForDPR(canvas);

  ctx.clearRect(0, 0, width, height);
  canvas.__chartPoints = [];

  if (!points.length) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = STAT_CHART_EMPTY_FONT;
    ctx.textAlign = "center";
    ctx.fillText("데이터가 없어요", width / 2, height / 2);
    return;
  }

  const padding = STAT_CHART_PADDING;
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const values = points.map((p) => p.value).concat(targetPace != null ? [targetPace] : []);
  const { min, max, step } = computeNiceYRange(values);
  const range = max - min || 1;
  // inverted from every other chart: a smaller (faster) pace sits higher up
  const yFor = (v) => padding.top + ((v - min) / range) * plotH;
  const n = dateLabels.length;
  const xFor = (i) => xForIndex(i, n, plotW, padding.left);

  drawYAxisGrid(ctx, { padding, plotW, width, min, max, step, yFor });

  if (targetPace != null) {
    const y = yFor(targetPace);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = TEXT_DIM;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = TEXT_DIM;
    ctx.font = STAT_CHART_AXIS_FONT;
    ctx.textAlign = "left";
    ctx.fillText(`목표 ${formatPaceLabel(targetPace)}`, padding.left + 4, y - 4);
  }

  const sorted = points.slice().sort((a, b) => a.index - b.index);

  // connecting line stays a neutral color; the points themselves carry the
  // fast/slow color coding
  ctx.beginPath();
  sorted.forEach((p, i) => {
    const x = xFor(p.index);
    const y = yFor(p.value);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = TEXT_DIM;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const hitPoints = [];
  ctx.font = STAT_CHART_VALUE_FONT;
  sorted.forEach((p, pi) => {
    const x = xFor(p.index);
    const y = yFor(p.value);
    const color = targetPace != null ? (p.value <= targetPace ? PACE_FAST_COLOR : PACE_SLOW_COLOR) : PACE_FAST_COLOR;

    ctx.beginPath();
    ctx.arc(x, y, STAT_CHART_POINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    hitPoints.push({ x, y, value: p.value, date: p.date, logId: p.logId });

    const above = pi % 2 === 0;
    const labelY = above ? y - 6 : y + 14;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(formatPaceLabel(p.value), x, labelY);
  });
  canvas.__chartPoints = hitPoints;

  const maxLabels = 6;
  const step2 = Math.max(1, Math.ceil((n - 1) / (maxLabels - 1)) || 1);
  const isShownIndex = (i) => i === 0 || i === n - 1 || i % step2 === 0;
  ctx.fillStyle = TEXT_DIM;
  ctx.font = STAT_CHART_DATE_FONT;
  ctx.textAlign = "center";
  const labelY = padding.top + plotH + 16;
  dateLabels.forEach((label, i) => {
    if (!isShownIndex(i)) return;
    ctx.fillText(label, xFor(i), labelY);
  });
}

/**
 * Generic vertical bar chart (heart-rate zone durations, km splits, ...).
 * Y-axis range: a 0-baseline nice range when options.zeroBaseline is set
 * (duration-style data, where 0 is meaningful), otherwise the same
 * data-range-based nice-step rule used everywhere else (amplifies small
 * differences, e.g. paces that all cluster close together).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{label: string, value: number, color?: string, topLabel?: string}[]} bars
 * @param {{zeroBaseline?: boolean}} [options]
 */
export function drawBarChart(canvas, bars, options = {}) {
  const { ctx, width, height } = setupCanvasForDPR(canvas);
  ctx.clearRect(0, 0, width, height);

  if (!bars.length) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = STAT_CHART_EMPTY_FONT;
    ctx.textAlign = "center";
    ctx.fillText("데이터가 없어요", width / 2, height / 2);
    return;
  }

  const padding = { top: 36, right: 16, bottom: 22, left: 44 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const values = bars.map((b) => b.value);
  const { min, max, step } = options.zeroBaseline ? computeNiceYRange([0, ...values]) : computeNiceYRange(values);
  const range = max - min || 1;
  const yFor = (v) => padding.top + plotH - ((v - min) / range) * plotH;

  drawYAxisGrid(ctx, { padding, plotW, width, min, max, step, yFor });

  const n = bars.length;
  const slot = plotW / n;
  const barWidth = Math.min(slot * 0.5, 40);
  const yZero = yFor(Math.max(min, 0));

  bars.forEach((b, i) => {
    const cx = padding.left + slot * (i + 0.5);
    const yVal = yFor(b.value);
    const barTop = Math.min(yVal, yZero);
    const barH = Math.max(Math.abs(yZero - yVal), 1);

    ctx.fillStyle = b.color || MINT;
    ctx.fillRect(cx - barWidth / 2, barTop, barWidth, barH);

    if (b.topLabel) {
      ctx.fillStyle = TEXT_DIM;
      ctx.font = STAT_CHART_VALUE_FONT;
      ctx.textAlign = "center";
      ctx.fillText(b.topLabel, cx, barTop - 6);
    }

    ctx.fillStyle = TEXT_DIM;
    ctx.font = STAT_CHART_DATE_FONT;
    ctx.textAlign = "center";
    ctx.fillText(b.label, cx, padding.top + plotH + 16);
  });
}

/**
 * Attaches a click handler (once per canvas) that hit-tests the nearest
 * plotted point stored by drawMultiLineChart/drawLineChart-family functions
 * in canvas.__chartPoints, and invokes onPointClick(point) when the click
 * lands within a small pixel radius of one.
 */
export function attachChartClickHandler(canvas, onPointClick) {
  if (canvas.__chartClickAttached) return;
  canvas.__chartClickAttached = true;
  canvas.addEventListener("click", (e) => {
    const points = canvas.__chartPoints || [];
    if (!points.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let closest = null;
    let closestDist = Infinity;
    points.forEach((p) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < closestDist) {
        closestDist = d;
        closest = p;
      }
    });
    if (closest && closestDist <= 16) {
      onPointClick(closest);
    }
  });
}
