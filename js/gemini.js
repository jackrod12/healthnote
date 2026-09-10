const MODEL = "gemini-3.6-flash";
const STREAM_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`;

const ZERO_WIDTH_CHARS_PATTERN = "​‌‍﻿";
const SANITIZE_PATTERN = new RegExp(`[\\s${ZERO_WIDTH_CHARS_PATTERN}]`, "g");

// Strips whitespace (\s covers spaces/tabs/newlines/NBSP) plus zero-width
// characters that a plain .trim() won't catch when a key is copy-pasted
// from another app (chat clients, PDFs, etc. sometimes inject these).
export function sanitizeApiKey(raw) {
  return (raw || "").replace(SANITIZE_PATTERN, "");
}

const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

function groupEquipmentByCategory(equipmentList) {
  if (!equipmentList.length) return "등록된 기구 없음";
  const byCategory = {};
  for (const e of equipmentList) {
    if (!byCategory[e.category]) byCategory[e.category] = [];
    byCategory[e.category].push(e.name);
  }
  return Object.entries(byCategory)
    .map(([category, names]) => `${category}: ${names.join(", ")}`)
    .join("\n");
}

function buildPrompt({ equipmentList, recentLogs, goals, latestInbody, gymDays, runDays }) {
  const equipmentText = groupEquipmentByCategory(equipmentList);

  const logsByDate = {};
  for (const log of recentLogs) {
    if (!logsByDate[log.date]) logsByDate[log.date] = [];
    if (log.type === "weight") {
      const setsText = log.sets
        .map((s) => (s.unit === "none" ? `무게없음 x ${s.reps}회` : `${s.weight}${s.unit} x ${s.reps}회`))
        .join(", ");
      logsByDate[log.date].push(`${log.equipmentName}: ${setsText}`);
    } else {
      logsByDate[log.date].push(`러닝: ${log.distance}km / ${log.duration}분 (페이스 ${log.pace}분/km)`);
    }
  }

  const historyText = Object.keys(logsByDate).length
    ? Object.entries(logsByDate)
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([date, items]) => `${date}: ${items.join(", ")}`)
        .join("\n")
    : "운동 기록 없음";

  const goalsText =
    goals && (goals.targetWeight || goals.targetBodyFat || goals.targetMuscleMass)
      ? [
          goals.targetWeight ? `체중 ${goals.targetWeight}kg` : null,
          goals.targetBodyFat ? `체지방률 ${goals.targetBodyFat}%` : null,
          goals.targetMuscleMass ? `골격근량 ${goals.targetMuscleMass}kg` : null,
        ]
          .filter(Boolean)
          .join(", ")
      : "목표 없음";

  const inbodyText = latestInbody
    ? `체중 ${latestInbody.weight}kg, 체지방률 ${latestInbody.bodyFat}%, 골격근량 ${latestInbody.muscleMass}kg`
    : "인바디 기록 없음";

  const gymSet = new Set(gymDays);
  const runSet = new Set(runDays);
  const restDays = DAY_ORDER.filter((d) => !gymSet.has(d) && !runSet.has(d));

  const gymDaysText = gymDays.length ? gymDays.join(", ") : "없음";
  const runDaysText = runDays.length ? runDays.join(", ") : "없음";
  const restDaysText = restDays.length ? restDays.join(", ") : "없음";

  return `너는 개인 트레이너야. 아래 정보로 이번 주(월~일) 운동 루틴을 짜줘.

[기구 목록]
${equipmentText}

[인바디] ${inbodyText}
[최근 3일 기록] ${historyText}
[목표] ${goalsText}

[요일 배정]
헬스장: ${gymDaysText}
러닝: ${runDaysText}
휴식: ${restDaysText}

[규칙]
- 헬스장 요일은 반드시 [기구 목록] 안에서만 운동을 선택해. 맨몸운동(푸시업, 런지 등)은 기구가 없을 때만 보조로 사용해.
- 러닝 요일은 거리/페이스 목표만 제시해.
- 휴식 요일은 "휴식" 한 단어만 써.
- 목표와 인바디, 최근 기록을 고려해서 부위 배분과 강도를 정해.
- 월~일 7줄, "요일: 내용" 형식으로만 간결하게 답변해. 다른 설명은 붙이지 마.

월:
화:
수:
목:
금:
토:
일:`;
}

/**
 * Streams the weekly routine recommendation from Gemini, invoking `onChunk`
 * with each incremental piece of text as it arrives (SSE) so the caller can
 * render a typewriter-style live update. Resolves with the final full text.
 *
 * @param {string} apiKey
 * @param {object} context - same shape as buildPrompt's argument
 * @param {(delta: string, fullTextSoFar: string) => void} [onChunk]
 */
export async function streamRoutineRecommendation(apiKey, context, onChunk = () => {}) {
  const key = sanitizeApiKey(apiKey);
  if (!key) {
    throw new Error("Gemini API 키가 설정되지 않았습니다. 설정 탭에서 입력해주세요.");
  }

  const prompt = buildPrompt(context);

  const res = await fetch(STREAM_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const keyPreview = key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : key;
    throw new Error(`Gemini API 오류 (${res.status}, 키: ${keyPreview}): ${errBody.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (!rawEvent.startsWith("data:")) continue;

      const jsonStr = rawEvent.slice(5).trim();
      if (!jsonStr) continue;

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        continue;
      }

      const delta = parsed?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
      if (delta) {
        fullText += delta;
        onChunk(delta, fullText);
      }
    }
  }

  const text = fullText.trim();
  if (!text) {
    throw new Error("Gemini 응답을 받지 못했습니다.");
  }

  return text;
}
