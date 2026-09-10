const MODEL = "gemini-2.5-pro";
const ENDPOINT = (apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

function buildPrompt({ equipmentList, recentLogs, goals, latestInbody, weeklyGymDays, weeklyRunDays }) {
  const equipmentText = equipmentList.length
    ? equipmentList.map((e) => `- ${e.name} (${e.category})`).join("\n")
    : "등록된 기구 없음";

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
        .map(([date, items]) => `${date}\n  ${items.join("\n  ")}`)
        .join("\n")
    : "최근 7일간 기록 없음";

  const goalsText =
    goals && (goals.currentWeight || goals.targetWeight || goals.targetBodyFat || goals.targetMuscleMass || goals.note)
      ? [
          goals.currentWeight ? `현재 체중: ${goals.currentWeight}kg` : null,
          goals.targetWeight ? `목표 체중: ${goals.targetWeight}kg` : null,
          goals.targetBodyFat ? `목표 체지방률: ${goals.targetBodyFat}%` : null,
          goals.targetMuscleMass ? `목표 골격근량: ${goals.targetMuscleMass}kg` : null,
          goals.note ? `메모: ${goals.note}` : null,
        ]
          .filter(Boolean)
          .join("\n")
      : "설정된 목표 없음";

  const inbodyText = latestInbody
    ? `${latestInbody.date} 기준 - 체중 ${latestInbody.weight}kg, 체지방률 ${latestInbody.bodyFat}%, 골격근량 ${latestInbody.muscleMass}kg, BMI ${latestInbody.bmi}, 내장지방레벨 ${latestInbody.visceralFat}`
    : "인바디 기록 없음";

  return `너는 개인 트레이너야. 아래 정보를 참고해서 이번 주(월~일) 운동 루틴을 요일별로 추천해줘.

[보유 헬스장 기구 목록]
${equipmentText}

[최근 7일 운동 기록]
${historyText}

[나의 목표]
${goalsText}

[최근 인바디 기록]
${inbodyText}

[이번 주 계획]
- 헬스장: 주 ${weeklyGymDays}회
- 러닝: 주 ${weeklyRunDays}회

[요청사항]
- 위에 나열된 기구 목록 안에서만 웨이트 운동을 추천해줘 (없는 기구는 추천하지 마).
- 헬스장 ${weeklyGymDays}회, 러닝 ${weeklyRunDays}회를 일주일 안에 적절히 배분하고, 나머지 요일은 휴식으로 표시해줘.
- 목표와 최근 인바디 상태를 고려해서 부위 배분과 강도를 판단해줘.
- 반드시 아래 형식처럼 월~일 7줄로만 간결하게 작성해줘. 각 줄에 운동 종목/부위와 세트x횟수 또는 거리를 간단히 포함해줘.

월: (내용)
화: (내용)
수: (내용)
목: (내용)
금: (내용)
토: (내용)
일: (내용)`;
}

export async function getRoutineRecommendation(apiKey, context) {
  if (!apiKey) {
    throw new Error("Gemini API 키가 설정되지 않았습니다. 설정 탭에서 입력해주세요.");
  }

  const prompt = buildPrompt(context);

  const res = await fetch(ENDPOINT(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Gemini API 오류 (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";

  if (!text) {
    throw new Error("Gemini 응답을 받지 못했습니다.");
  }

  return text.trim();
}
