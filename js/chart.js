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

  const padding = { top: 16, right: 14, bottom: 22, left: 14 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const min = Math.min(...values);
  const max = Math.max(...values);
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

  // min/max labels
  ctx.fillStyle = TEXT_DIM;
  ctx.font = "11px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(`${max}${unit}`, padding.left, padding.top - 4);
  ctx.fillText(`${min}${unit}`, padding.left, height - 6);

  // first/last date labels
  if (labels && labels.length) {
    const labelY = padding.top + plotH + 16;
    ctx.textAlign = "left";
    ctx.fillText(labels[0], padding.left, labelY);
    ctx.textAlign = "right";
    ctx.fillText(labels[labels.length - 1], width - padding.right, labelY);
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

  const padding = { top: 20, right: 14, bottom: 24, left: 14 };
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

  // max label
  ctx.fillStyle = TEXT_DIM;
  ctx.font = "11px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(`${Math.round(max)}${unit}`, padding.left, padding.top - 6);

  // x labels
  if (labels && labels.length) {
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    labels.forEach((label, i) => {
      const x = padding.left + i * (barWidth + barGap) + barWidth / 2;
      ctx.fillText(label, x, height - 6);
    });
  }
}
