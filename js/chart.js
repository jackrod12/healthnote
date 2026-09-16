const MINT = "#00e5a0";
const GRID = "#2a2a2a";
const TEXT_DIM = "#9a9a9a";

/* single source of truth for multi-series chart colors: both the line drawn
   for a series (drawMultiLineChart) and its legend swatch (rendered by the
   caller) must index into this exact same array, never a separate copy. */
export const CHART_LINE_COLORS = [
  "#00e5a0", "#ff6b6b", "#4dabf7", "#ffd43b", "#c084fc",
  "#ff922b", "#66d9e8", "#f783ac", "#94d82d", "#748ffc", "#e64980", "#20c997",
];

/* Fixed 8%/84%/8% x-axis layout: the first point sits 8% of the plot width
   in from the left, the last sits 8% in from the right, and points between
   are spaced evenly across the remaining 84% — instead of a margin that
   shrinks as more points are added. */
const X_EDGE_MARGIN_FRAC = 0.08;

function xForIndex(i, n, plotW, plotLeft) {
  if (n <= 1) return plotLeft + 0.5 * plotW;
  return plotLeft + (X_EDGE_MARGIN_FRAC + (i / (n - 1)) * (1 - 2 * X_EDGE_MARGIN_FRAC)) * plotW;
}

function setupCanvasForDPR(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = rect.width || canvas.width;
  const cssHeight = rect.height || canvas.height;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: cssWidth, height: cssHeight };
}

/**
 * Auto-computed y-axis range so the data sits well inside the plot area
 * instead of touching the top/bottom edges.
 */
function computeAutoYRange(values) {
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  if (values.length === 1) {
    const pad = Math.abs(dataMin) * 0.1 || 1;
    return { min: dataMin - pad, max: dataMax + pad };
  }
  const range = dataMax - dataMin;
  if (range === 0) {
    return { min: dataMin - 5, max: dataMax + 5 };
  }
  const pad = range * 0.2;
  return { min: dataMin - pad, max: dataMax + pad };
}

/**
 * Draws a simple line chart on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {string[]} labels - x-axis labels (dates)
 * @param {number[]} values - y values
 * @param {{color?: string, unit?: string, yMin?: number, yMax?: number, yAxisLabels?: boolean}} [options]
 */
export function drawLineChart(canvas, labels, values, options = {}) {
  const color = options.color || MINT;
  const unit = options.unit || "";
  const showYAxisLabels = !!options.yAxisLabels;
  const { ctx, width, height } = setupCanvasForDPR(canvas);

  ctx.clearRect(0, 0, width, height);

  if (!values || values.length === 0) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("데이터가 없어요", width / 2, height / 2);
    return;
  }

  // generous side padding so the first/last points sit inset from the plot
  // edges rather than flush against them; left grows further when axis
  // value labels need room
  const padding = { top: 28, right: 40, bottom: 22, left: showYAxisLabels ? 50 : 40 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const autoRange = computeAutoYRange(values);
  const min = options.yMin !== undefined && options.yMin !== null ? options.yMin : autoRange.min;
  const max = options.yMax !== undefined && options.yMax !== null ? options.yMax : autoRange.max;
  const range = max - min || 1;
  const yFor = (v) => padding.top + plotH - ((v - min) / range) * plotH;
  const n = values.length;
  // fixed 8% edge margins so the first/last points sit inset from the plot
  // edges rather than flush against them, with the rest evenly spaced
  const xFor = (i) => xForIndex(i, n, plotW, padding.left);

  // grid lines: 5 evenly spaced ticks
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  const tickCount = 5;
  for (let i = 0; i < tickCount; i++) {
    const y = padding.top + (plotH / (tickCount - 1)) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // y-axis value labels: numbers only, no unit
  if (showYAxisLabels) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "11px system-ui";
    ctx.textAlign = "right";
    for (let i = 0; i < tickCount; i++) {
      const y = padding.top + (plotH / (tickCount - 1)) * i;
      const tickValue = max - ((max - min) / (tickCount - 1)) * i;
      const rounded = Math.round(tickValue * 10) / 10;
      ctx.fillText(`${rounded}`, padding.left - 8, y + 4);
    }
  }

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
  const step = Math.max(1, Math.ceil((n - 1) / (maxLabels - 1)) || 1);
  const isShownIndex = (i) => i === 0 || i === n - 1 || i % step === 0;

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
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    const labelY = padding.top + plotH + 16;
    labels.forEach((label, i) => {
      if (!isShownIndex(i)) return;
      ctx.fillText(label, xFor(i), labelY);
    });
  }
}

/**
 * Draws a multi-series line chart sharing one x-axis of date labels.
 * Each series can have gaps (gets a broken line, not interpolated).
 * After drawing, canvas.__chartPoints holds every plotted point's pixel
 * position plus its source data, for click hit-testing (see attachChartClickHandler).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string[]} dateLabels - shared x-axis labels, index-addressed by each point
 * @param {{name: string, color: string, points: {index: number, value: number, date: string, logId?: number}[]}[]} series
 * @param {{unit?: string}} [options]
 */
export function drawMultiLineChart(canvas, dateLabels, series, options = {}) {
  const { ctx, width, height } = setupCanvasForDPR(canvas);

  ctx.clearRect(0, 0, width, height);
  canvas.__chartPoints = [];

  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  if (!dateLabels.length || !allValues.length) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("데이터가 없어요", width / 2, height / 2);
    return;
  }

  const padding = { top: 28, right: 16, bottom: 22, left: 44 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const autoRange = computeAutoYRange(allValues);
  const min = autoRange.min;
  const max = autoRange.max;
  const range = max - min || 1;
  const yFor = (v) => padding.top + plotH - ((v - min) / range) * plotH;
  const n = dateLabels.length;
  const xFor = (i) => xForIndex(i, n, plotW, padding.left);

  // grid lines
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  const tickCount = 5;
  for (let i = 0; i < tickCount; i++) {
    const y = padding.top + (plotH / (tickCount - 1)) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // y-axis value labels
  ctx.fillStyle = TEXT_DIM;
  ctx.font = "11px system-ui";
  ctx.textAlign = "right";
  for (let i = 0; i < tickCount; i++) {
    const y = padding.top + (plotH / (tickCount - 1)) * i;
    const tickValue = max - ((max - min) / (tickCount - 1)) * i;
    const rounded = Math.round(tickValue * 10) / 10;
    ctx.fillText(`${rounded}`, padding.left - 8, y + 4);
  }

  const hitPoints = [];

  series.forEach((s) => {
    if (!s.points.length) return;
    const sorted = s.points.slice().sort((a, b) => a.index - b.index);

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
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      hitPoints.push({ x, y, seriesName: s.name, value: p.value, date: p.date, logId: p.logId });
    });
  });

  canvas.__chartPoints = hitPoints;

  // date labels along shared x-axis, thinned to at most 6
  const maxLabels = 6;
  const step = Math.max(1, Math.ceil((n - 1) / (maxLabels - 1)) || 1);
  const isShownIndex = (i) => i === 0 || i === n - 1 || i % step === 0;

  ctx.fillStyle = TEXT_DIM;
  ctx.font = "13px system-ui";
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
