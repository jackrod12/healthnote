const MODEL = "gemini-2.5-flash";
const GENERATE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 503 means the model is overloaded, not that anything about our request was
// wrong — worth a couple of delayed retries. Every other error status (bad
// key, bad request, quota) will just fail the same way again immediately,
// so those aren't retried.
const RETRY_DELAYS_MS = [2000, 5000];
const MAX_ATTEMPTS = 1 + RETRY_DELAYS_MS.length;

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

/**
 * @param {string} apiKey
 * @param {object[]} parts
 * @param {{responseMimeType?: string, temperature?: number, maxOutputTokens?: number,
 *   onRetry?: (nextAttempt: number, maxAttempts: number) => void}} [options] -
 *   onRetry fires right before each delayed retry (only on a 503), so the
 *   caller can show "재시도 N/3" while callGemini itself sleeps and retries.
 */
async function callGemini(apiKey, parts, options = {}) {
  const { responseMimeType, temperature = 0.3, maxOutputTokens = 2048, onRetry } = options;
  const key = requireApiKey(apiKey);

  const generationConfig = { temperature, maxOutputTokens };
  if (responseMimeType) generationConfig.responseMimeType = responseMimeType;

  let lastStatus = null;
  let lastErrorBody = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(GENERATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      if (!text.trim()) {
        throw new Error("Gemini 응답을 받지 못했습니다.");
      }
      return text.trim();
    }

    lastStatus = res.status;
    lastErrorBody = await res.text().catch(() => "");

    if (res.status !== 503 || attempt === MAX_ATTEMPTS) break;

    const nextAttempt = attempt + 1;
    onRetry?.(nextAttempt, MAX_ATTEMPTS);
    await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }

  if (lastStatus === 503) {
    const err = new Error("Gemini 서버가 혼잡해요. 잠시 후 다시 시도해주세요.");
    err.code = "GEMINI_OVERLOADED";
    throw err;
  }
  const keyPreview = key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : key;
  throw new Error(`Gemini API 오류 (${lastStatus}, 키: ${keyPreview}): ${lastErrorBody.slice(0, 200)}`);
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
 * @param {(nextAttempt: number, maxAttempts: number) => void} [onRetry]
 * @returns {Promise<object>} parsed running data, field names per VISION_PROMPT
 */
export async function parseRunningImages(apiKey, imageFiles, onRetry) {
  if (!imageFiles.length) {
    throw new Error("분석할 이미지를 먼저 선택해주세요.");
  }
  const inlineImages = await Promise.all(imageFiles.map(imageFileToInlineData));
  const parts = [{ text: VISION_PROMPT }, ...inlineImages.map((img) => ({ inline_data: img }))];

  const text = await callGemini(apiKey, parts, {
    responseMimeType: "application/json",
    temperature: 0.1,
    maxOutputTokens: 4096,
    onRetry,
  });

  try {
    return JSON.parse(stripCodeFence(text));
  } catch {
    throw new Error("Gemini 응답을 JSON으로 해석하지 못했습니다. 이미지를 다시 확인해주세요.");
  }
}

/**
 * Asks Gemini to analyze a run — overall assessment, what went well, what to
 * improve, and a next-training suggestion — given the run itself, the
 * previous run for comparison, and the user's latest body weight / running
 * goals.
 *
 * @param {string} apiKey
 * @param {{ run: object, previousRun: object|null, bodyWeightKg: number|null, goals: object|null }} context
 * @param {(nextAttempt: number, maxAttempts: number) => void} [onRetry]
 * @returns {Promise<string>}
 */
export async function generateRunningComment(apiKey, { run, previousRun, bodyWeightKg, goals }, onRetry) {
  const fmt = (v, unit = "") => (v === null || v === undefined || v === "" ? "정보 없음" : `${v}${unit}`);

  const runText = [
    `거리 ${fmt(run.distance, "km")}`,
    `시간 ${fmt(run.duration, "분")}`,
    `페이스 ${fmt(run.pace, "분/km")}`,
    `평균 심박수 ${fmt(run.avg_heart_rate, "bpm")}`,
    `평균 파워 ${fmt(run.avg_power, "W")}`,
    `평균 케이던스 ${fmt(run.avg_cadence, "spm")}`,
    `운동강도 ${fmt(run.intensity_text)}`,
    `등반고도 ${fmt(run.elevation_gain, "m")}`,
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

  const prompt = `이 러닝 데이터를 분석해서 한국어로 알려줘:
1. 이번 러닝 총평 (페이스, 심박수, 파워 종합)
2. 잘한 점
3. 개선할 점
4. 다음 훈련 추천
최대 300자로 간결하게. 다른 설명 없이 본문만 답변해.

[이번 러닝] ${runText}
[이전 러닝] ${prevText}
[체중] ${fmt(bodyWeightKg, "kg")}
[목표] ${goalsText}`;

  return callGemini(apiKey, [{ text: prompt }], { temperature: 0.6, maxOutputTokens: 512, onRetry });
}
