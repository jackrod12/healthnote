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

function drawYAxisGrid(ctx, { padding, plotW, plotH, width, min, max, step }) {
  const tickCount = Math.round((max - min) / step) + 1;

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.fillStyle = TEXT_DIM;
  ctx.font = STAT_CHART_AXIS_FONT;
  ctx.textAlign = "right";

  for (let i = 0; i < tickCount; i++) {
    const value = min + step * i;
    const y = padding.top + plotH - ((value - min) / (max - min || 1)) * plotH;

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

  drawYAxisGrid(ctx, { padding, plotW, plotH, width, min, max, step });

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

  drawYAxisGrid(ctx, { padding, plotW, plotH, width, min, max, step });

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
