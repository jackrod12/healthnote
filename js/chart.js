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
 * @param {{color?: string, unit?: string}} [options]
 */
export function drawLineChart(canvas, labels, values, options = {}) {
  const color = options.color || MINT;
  const unit = options.unit || "";
  const { ctx, width, height } = setupCanvasForDPR(canvas);

  ctx.clearRect(0, 0, width, height);

  if (!values || values.length === 0) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("데이터가 없어요", width / 2, height / 2);
    return;
  }

  const padding = { top: 28, right: 20, bottom: 22, left: 20 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const autoRange = computeAutoYRange(values);
  const min = options.yMin !== undefined && options.yMin !== null ? options.yMin : autoRange.min;
  const max = options.yMax !== undefined && options.yMax !== null ? options.yMax : autoRange.max;
  const range = max - min || 1;
  const yFor = (v) => padding.top + plotH - ((v - min) / range) * plotH;
  const xFor = (i) =>
    values.length === 1
      ? padding.left + plotW / 2
      : padding.left + (i / (values.length - 1)) * plotW;

  // grid lines
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = padding.top + (plotH / 2) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
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
  const last = values.length - 1;
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
  const n = values.length;
  const maxLabels = 6;
  const step = Math.max(1, Math.ceil((n - 1) / (maxLabels - 1)) || 1);
  const isShownIndex = (i) => i === 0 || i === n - 1 || i % step === 0;

  // per-point value labels, sitting 8px above each point
  const roundTo1 = (v) => Math.round(v * 10) / 10;
  ctx.fillStyle = MINT;
  ctx.font = "11px system-ui";
  values.forEach((v, i) => {
    if (!isShownIndex(i)) return;
    const x = xFor(i);
    const y = yFor(v);
    if (i === 0) ctx.textAlign = "left";
    else if (i === values.length - 1) ctx.textAlign = "right";
    else ctx.textAlign = "center";
    ctx.fillText(`${roundTo1(v)}${unit}`, x, y - 8);
  });

  // date labels: only under actual data points, thinned to at most 6 when
  // there are many, but the first and last are always shown
  if (labels && labels.length) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "13px system-ui";
    const labelY = padding.top + plotH + 16;
    labels.forEach((label, i) => {
      if (!isShownIndex(i)) return;
      if (i === 0) ctx.textAlign = "left";
      else if (i === n - 1) ctx.textAlign = "right";
      else ctx.textAlign = "center";
      ctx.fillText(label, xFor(i), labelY);
    });
  }
}

/**
 * Draws a simple bar chart on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {string[]} labels - x-axis labels
 * @param {number[]} values - y values
 * @param {{color?: string, unit?: string}} [options]
 */
export function drawBarChart(canvas, labels, values, options = {}) {
  const color = options.color || MINT;
  const unit = options.unit || "";
  const { ctx, width, height } = setupCanvasForDPR(canvas);

  ctx.clearRect(0, 0, width, height);

  if (!values || values.length === 0 || values.every((v) => !v)) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("데이터가 없어요", width / 2, height / 2);
    return;
  }

  const padding = { top: 24, right: 14, bottom: 24, left: 14 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const max = Math.max(...values, 1);
  const barGap = 8;
  const barWidth = (plotW - barGap * (values.length - 1)) / values.length;

  // grid lines
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = padding.top + (plotH / 2) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  values.forEach((v, i) => {
    const barHeight = Math.max(1, (v / max) * plotH);
    const x = padding.left + i * (barWidth + barGap);
    const y = padding.top + plotH - barHeight;
    const r = Math.min(4, barWidth / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + barWidth - r, y);
    ctx.arcTo(x + barWidth, y, x + barWidth, y + r, r);
    ctx.lineTo(x + barWidth, padding.top + plotH);
    ctx.lineTo(x, padding.top + plotH);
    ctx.closePath();
    ctx.fill();
  });

  // per-bar value labels: 11px white, inside near the top of tall bars,
  // just above the bar when it is too short to fit the label inside
  const LABEL_INSIDE_MIN_HEIGHT = 24;
  ctx.font = "11px system-ui";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  values.forEach((v, i) => {
    if (!v) return;
    const barHeight = Math.max(1, (v / max) * plotH);
    const barTop = padding.top + plotH - barHeight;
    const x = padding.left + i * (barWidth + barGap) + barWidth / 2;
    const label = `${Math.round(v)}${unit}`;
    if (barHeight >= LABEL_INSIDE_MIN_HEIGHT) {
      ctx.textBaseline = "top";
      ctx.fillText(label, x, barTop + 10);
    } else {
      ctx.textBaseline = "alphabetic";
      ctx.fillText(label, x, barTop - 4);
    }
  });
  ctx.textBaseline = "alphabetic";

  // x labels (skip evenly if they would overlap at this font size; always keep the last one)
  if (labels && labels.length) {
    ctx.font = "13px system-ui";
    ctx.textAlign = "center";
    const slot = barWidth + barGap;
    const maxLabelWidth = Math.max(...labels.map((l) => ctx.measureText(l).width));
    const step = maxLabelWidth + 6 > slot ? Math.ceil((maxLabelWidth + 6) / slot) : 1;
    labels.forEach((label, i) => {
      if (i % step !== 0 && i !== labels.length - 1) return;
      const x = padding.left + i * slot + barWidth / 2;
      ctx.fillText(label, x, height - 6);
    });
  }
}
