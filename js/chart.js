const MINT = "#00e5a0";
const GRID = "#2a2a2a";
const TEXT_DIM = "#9a9a9a";

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
  // center each point within its own slot instead of pinning the first/last
  // point to the plot edges (which would touch the y-axis)
  const xFor = (i) => padding.left + ((i + 0.5) / n) * plotW;

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
