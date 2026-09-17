const MODEL = "gemini-3.6-flash";
const GENERATE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const ZERO_WIDTH_CHARS_PATTERN = "​‌‍﻿";
const SANITIZE_PATTERN = new RegExp(`[\\s${ZERO_WIDTH_CHARS_PATTERN}]`, "g");

// Strips whitespace (\s covers spaces/tabs/newlines/NBSP) plus zero-width
// characters that a plain .trim() won't catch when a key is copy-pasted
// from another app (chat clients, PDFs, etc. sometimes inject these).
export function sanitizeApiKey(raw) {
  return (raw || "").replace(SANITIZE_PATTERN, "");
}

function requireApiKey(apiKey) {
  const key = sanitizeApiKey(apiKey);
  if (!key) {
    throw new Error("Gemini API 키가 설정되지 않았습니다. 설정 탭에서 입력해주세요.");
  }
  return key;
}

/** Reads a File (image) into the {mime_type, data} shape Gemini's inline_data expects. */
export function imageFileToInlineData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      resolve({ mime_type: file.type || "image/jpeg", data: base64 });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function callGemini(apiKey, parts, { responseMimeType, temperature = 0.3, maxOutputTokens = 2048 } = {}) {
  const key = requireApiKey(apiKey);

  const generationConfig = { temperature, maxOutputTokens };
  if (responseMimeType) generationConfig.responseMimeType = responseMimeType;

  const res = await fetch(GENERATE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const keyPreview = key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : key;
    throw new Error(`Gemini API 오류 (${res.status}, 키: ${keyPreview}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text.trim()) {
    throw new Error("Gemini 응답을 받지 못했습니다.");
  }
  return text.trim();
}

/* strips ```json ... ``` / ``` ... ``` fences a model sometimes wraps JSON
   in even when asked not to, before JSON.parse */
function stripCodeFence(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

const VISION_PROMPT = `이 Apple Fitness 운동 기록 이미지들에서 다음 데이터를 추출해서 JSON으로만 반환해줘.
다른 텍스트 없이 JSON만:
{
  "date": null, "location": null, "duration": null, "elapsed_time": null,
  "distance_km": null, "active_calories": null, "total_calories": null,
  "avg_pace": null, "avg_heart_rate": null, "avg_power": null, "avg_cadence": null,
  "intensity_level": null, "intensity_text": null, "elevation_gain": null,
  "heart_rate_zones": [{ "zone": 1, "duration": null, "bpm_range": null }],
  "splits": [{ "km": 1, "time": null, "pace": null, "heart_rate": null, "power": null }]
}
값을 이미지에서 찾을 수 없으면 null로 둬. 여러 이미지에 걸쳐 있는 정보(요약, 스플릿, 심박수 영역 등)를 모두 종합해서 하나의 JSON으로 합쳐줘.`;

/**
 * Sends one or more fitness-app screenshots to Gemini Vision and asks it to
 * extract structured running data as JSON (see VISION_PROMPT for the exact
 * shape). Throws if the API call fails or the response isn't valid JSON.
 *
 * @param {string} apiKey
 * @param {File[]} imageFiles
 * @returns {Promise<object>} parsed running data, field names per VISION_PROMPT
 */
export async function parseRunningImages(apiKey, imageFiles) {
  if (!imageFiles.length) {
    throw new Error("분석할 이미지를 먼저 선택해주세요.");
  }
  const inlineImages = await Promise.all(imageFiles.map(imageFileToInlineData));
  const parts = [{ text: VISION_PROMPT }, ...inlineImages.map((img) => ({ inline_data: img }))];

  const text = await callGemini(apiKey, parts, { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 4096 });

  try {
    return JSON.parse(stripCodeFence(text));
  } catch {
    throw new Error("Gemini 응답을 JSON으로 해석하지 못했습니다. 이미지를 다시 확인해주세요.");
  }
}

/**
 * Asks Gemini for a short (<=200자) Korean feedback + next-training tip
 * comment on a just-saved run, given the run itself, the previous run for
 * comparison, and the user's latest body weight / running goals.
 *
 * @param {string} apiKey
 * @param {{ run: object, previousRun: object|null, bodyWeightKg: number|null, goals: object|null }} context
 * @returns {Promise<string>}
 */
export async function generateRunningComment(apiKey, { run, previousRun, bodyWeightKg, goals }) {
  const fmt = (v, unit = "") => (v === null || v === undefined || v === "" ? "정보 없음" : `${v}${unit}`);

  const runText = [
    `거리 ${fmt(run.distance, "km")}`,
    `시간 ${fmt(run.duration, "분")}`,
    `페이스 ${fmt(run.pace, "분/km")}`,
    `평균 심박수 ${fmt(run.avg_heart_rate, "bpm")}`,
    `평균 파워 ${fmt(run.avg_power, "W")}`,
    `평균 케이던스 ${fmt(run.avg_cadence, "spm")}`,
    run.splits?.length ? `스플릿 ${run.splits.length}개` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const prevText = previousRun
    ? [
        `거리 ${fmt(previousRun.distance, "km")}`,
        `페이스 ${fmt(previousRun.pace, "분/km")}`,
        `평균 심박수 ${fmt(previousRun.avg_heart_rate, "bpm")}`,
      ].join(", ")
    : "이전 러닝 기록 없음";

  const goalsText = goals
    ? [
        goals.targetPaceLabel ? `목표 페이스 ${goals.targetPaceLabel}/km` : null,
        goals.targetWeeklyKm ? `주간 목표 거리 ${goals.targetWeeklyKm}km` : null,
        goals.targetZone3PlusPct ? `영역3 이상 비율 목표 ${goals.targetZone3PlusPct}%` : null,
      ]
        .filter(Boolean)
        .join(", ") || "설정된 목표 없음"
    : "설정된 목표 없음";

  const prompt = `너는 러닝 코치야. 아래 이번 러닝 기록을 분석해서 피드백과 다음 훈련 팁을 한국어로 200자 이내로 답변해줘. 다른 설명 없이 피드백 본문만 답변해.

[이번 러닝] ${runText}
[이전 러닝] ${prevText}
[체중] ${fmt(bodyWeightKg, "kg")}
[목표] ${goalsText}`;

  return callGemini(apiKey, [{ text: prompt }], { temperature: 0.6, maxOutputTokens: 512 });
}
