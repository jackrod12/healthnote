// Variables used by Scriptable.
// icon-color: deep-green; icon-glyph: heartbeat;
//
// 헬스노트 - 오늘의 링 위젯 (Scriptable)
//
// !! 중요 !!
// Scriptable은 앱 샌드박스 정책상 HealthKit(건강 앱 데이터)에 직접 접근할 수 없습니다.
// 따라서 아래 순서로 "단축어(Shortcuts) 자동화"를 한 번 설정해두면, 이 위젯은
// 단축어가 저장해둔 최신 값을 읽어서 표시합니다.
//
// [단축어 설정 방법]
// 1. 단축어 앱 > 새 단축어 생성 (예: "헬스노트 링 동기화")
// 2. "건강 샘플 가져오기" 액션을 3번 추가해서 각각 가져오기:
//      - 활동 에너지(움직이기) 오늘 합계 (kcal)
//      - 운동 시간(Apple Exercise Time) 오늘 합계 (분)
//      - 일어서기 시간(Apple Stand Hour) 오늘 합계/개수 (시간)
// 3. "사전(Dictionary)" 액션으로 아래 키에 맞춰 값 구성:
//      { "move": <kcal>, "exercise": <분>, "stand": <시간>,
//        "moveGoal": 500, "exerciseGoal": 30, "standGoal": 12 }
// 4. "Run Script" (Scriptable) 액션 추가 → 스크립트로 이 파일(healthnote-widget) 선택
//    → 입력값(Input)으로 3번의 사전을 그대로 전달
// 5. 자동화 탭에서 "매일 정해진 시각" 또는 "앱을 연 후" 트리거를 추가해서
//    이 단축어가 주기적으로 자동 실행되도록 설정
// 6. 홈 화면에 Scriptable 위젯(중간 크기 추천)을 추가하고, 위젯 설정에서
//    스크립트로 이 파일을 선택하면 캐시된 최신 값이 표시됩니다.
//
// 단축어를 아직 설정하지 않았다면 위젯에는 안내 문구가 표시됩니다.

const BG_COLOR = new Color("#0f0f0f");
const MINT = new Color("#00e5a0");
const MINT_DIM_1 = new Color("#00e5a0", 0.7);
const MINT_DIM_2 = new Color("#00e5a0", 0.4);
const TRACK_COLOR = new Color("#2a2a2a");
const TEXT_DIM = new Color("#9a9a9a");
const TEXT_MAIN = Color.white();

const CACHE_PATH = FileManager.local().joinPath(
  FileManager.local().documentsDirectory(),
  "healthnote-rings-cache.json"
);

function loadCache() {
  const fm = FileManager.local();
  if (!fm.fileExists(CACHE_PATH)) return null;
  try {
    return JSON.parse(fm.readString(CACHE_PATH));
  } catch (e) {
    return null;
  }
}

function saveCache(data) {
  FileManager.local().writeString(CACHE_PATH, JSON.stringify(data));
}

function parseShortcutParameter(param) {
  if (!param) return null;
  if (typeof param === "string") {
    try {
      return JSON.parse(param);
    } catch (e) {
      return null;
    }
  }
  return param;
}

function getRingData() {
  const fromShortcut = parseShortcutParameter(args.shortcutParameter);
  if (fromShortcut) {
    const data = {
      move: Number(fromShortcut.move ?? 0),
      moveGoal: Number(fromShortcut.moveGoal ?? 500),
      exercise: Number(fromShortcut.exercise ?? 0),
      exerciseGoal: Number(fromShortcut.exerciseGoal ?? 30),
      stand: Number(fromShortcut.stand ?? 0),
      standGoal: Number(fromShortcut.standGoal ?? 12),
      updatedAt: Date.now(),
    };
    saveCache(data);
    return data;
  }
  return loadCache();
}

function drawArcPath(ctx, center, radius, startAngle, endAngle, color, lineWidth) {
  const path = new Path();
  const steps = 64;
  const totalAngle = endAngle - startAngle;
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + (totalAngle * i) / steps;
    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);
    if (i === 0) path.move(new Point(x, y));
    else path.addLine(new Point(x, y));
  }
  ctx.addPath(path);
  ctx.setStrokeColor(color);
  ctx.setLineWidth(lineWidth);
  ctx.strokePath();
}

function drawRingsImage(data) {
  const size = 220;
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const center = size / 2;
  const ringWidth = 15;
  const gap = 6;

  const rings = [
    { value: data.move, goal: data.moveGoal, color: MINT },
    { value: data.exercise, goal: data.exerciseGoal, color: MINT_DIM_1 },
    { value: data.stand, goal: data.standGoal, color: MINT_DIM_2 },
  ];

  rings.forEach((ring, i) => {
    const radius = center - ringWidth / 2 - i * (ringWidth + gap);
    const rect = new Rect(center - radius, center - radius, radius * 2, radius * 2);

    ctx.setStrokeColor(TRACK_COLOR);
    ctx.setLineWidth(ringWidth);
    ctx.strokeEllipse(rect);

    const pct = ring.goal > 0 ? Math.min(1, ring.value / ring.goal) : 0;
    if (pct > 0) {
      const start = -Math.PI / 2;
      const end = start + pct * 2 * Math.PI;
      drawArcPath(ctx, center, radius, start, end, ring.color, ringWidth);
    }
  });

  return ctx.getImage();
}

function addLegendRow(container, label, value, color) {
  const row = container.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const dot = row.addText("●");
  dot.font = Font.systemFont(10);
  dot.textColor = color;

  row.addSpacer(4);

  const labelText = row.addText(label);
  labelText.font = Font.systemFont(11);
  labelText.textColor = TEXT_DIM;

  row.addSpacer();

  const valueText = row.addText(value);
  valueText.font = Font.mediumSystemFont(11);
  valueText.textColor = TEXT_MAIN;

  container.addSpacer(6);
}

async function createWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = BG_COLOR;
  widget.setPadding(14, 14, 14, 14);

  const data = getRingData();

  const header = widget.addText("헬스노트");
  header.font = Font.boldSystemFont(13);
  header.textColor = MINT;
  widget.addSpacer(6);

  if (!data) {
    widget.addSpacer();
    const msg = widget.addText("단축어 자동화 설정이 필요해요");
    msg.font = Font.systemFont(12);
    msg.textColor = TEXT_DIM;
    const sub = widget.addText("스크립트 상단 주석 참고");
    sub.font = Font.systemFont(10);
    sub.textColor = TEXT_DIM;
    widget.addSpacer();
    return widget;
  }

  const row = widget.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  const image = drawRingsImage(data);
  const imgWidget = row.addImage(image);
  imgWidget.imageSize = new Size(110, 110);
  row.addSpacer();

  widget.addSpacer(10);

  const legend = widget.addStack();
  legend.layoutVertically();
  addLegendRow(legend, "움직이기", `${Math.round(data.move)}/${data.moveGoal}kcal`, MINT);
  addLegendRow(legend, "운동", `${Math.round(data.exercise)}/${data.exerciseGoal}분`, MINT_DIM_1);
  addLegendRow(legend, "일어서기", `${Math.round(data.stand)}/${data.standGoal}시간`, MINT_DIM_2);

  const updated = new Date(data.updatedAt);
  const updatedText = widget.addText(
    `업데이트: ${updated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
  );
  updatedText.font = Font.systemFont(9);
  updatedText.textColor = TEXT_DIM;

  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  return widget;
}

const widget = await createWidget();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}

Script.complete();
