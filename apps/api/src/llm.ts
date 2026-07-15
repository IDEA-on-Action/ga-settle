import {
  ONTOLOGY, RELATION_DESC, buildProfilePrompt, localMap, runConsistency, applyEvidence,
  type ColumnProfile, type Cell, type CandidateMap, type Evidence, type OntologyField,
} from "@ga-settle/mapping";
import type { Env } from "./types";

// 매핑 후보는 LLM이 제안(후보/근거만), 확정 숫자는 결정적 코드가 계산 (도메인 불변식 3).
const MODEL = "claude-sonnet-5";

export type MappingResult = { candidates: CandidateMap; evidence: Evidence[]; engine: "ai" | "local" };

/**
 * L2: 온톨로지 + 컬럼 프로파일(마스킹 표본 8개 한정)을 Claude API에 전달해
 * 매핑 후보(field->ci)+신뢰도+근거를 tool_use JSON으로 수신 (REQ-008, REQ-010).
 * 실패(키 없음/HTTP 오류/빈 응답)는 throw -> 호출자가 규칙 엔진으로 폴백.
 */
export async function aiMap(
  profiles: ColumnProfile[], apiKey: string,
  ontology: OntologyField[] = ONTOLOGY, relationDesc: string = RELATION_DESC,
): Promise<CandidateMap> {
  const ontologyDesc = ontology.map(
    (f) => `- ${f.key} (${f.type}${f.required ? ", 필수" : ""}): ${f.desc} [동의어: ${f.syn.join(", ")}]`,
  ).join("\n");
  const system =
    "너는 보험 원수사 수수료 엑셀의 컬럼 헤더를 표준 온톨로지 필드에 매핑하는 전문가다. " +
    "헤더 이름뿐 아니라 값의 타입 분포와 표본을 근거로 판단하라. 확신이 없으면 낮은 신뢰도를 매겨라. " +
    "매핑은 후보일 뿐이며 최종 확정은 별도 정합성 검증과 사람이 한다.";
  const user =
    `# 표준 온톨로지\n${ontologyDesc}\n\n# 핵심 관계\n${relationDesc}\n\n` +
    `# 업로드 컬럼 프로파일 (표본은 마스킹됨)\n${buildProfilePrompt(profiles, true)}\n\n` +
    "각 온톨로지 필드에 가장 잘 맞는 열 번호(ci)와 신뢰도(0~1), 한 줄 근거를 map 도구로 제출하라. 매칭 열이 없으면 생략하라.";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system,
      tools: [{
        name: "map",
        description: "컬럼 -> 온톨로지 필드 매핑 후보 목록",
        input_schema: {
          type: "object",
          properties: {
            mappings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string", description: "온톨로지 필드 key" },
                  ci: { type: "integer", description: "열 번호(0-base)" },
                  confidence: { type: "number", description: "0~1" },
                  reason: { type: "string" },
                },
                required: ["field", "ci", "confidence"],
              },
            },
          },
          required: ["mappings"],
        },
      }],
      tool_choice: { type: "tool", name: "map" },
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);

  const data = (await res.json()) as { content?: Array<{ type: string; name?: string; input?: unknown }> };
  const tool = data.content?.find((b) => b.type === "tool_use" && b.name === "map");
  const mappings = (tool?.input as { mappings?: Array<{ field: string; ci: number; confidence: number; reason?: string }> })?.mappings;
  if (!mappings?.length) throw new Error("빈 매핑 응답");

  const valid = new Set(ontology.map((f) => f.key));
  const out: CandidateMap = {};
  for (const m of mappings) {
    if (!valid.has(m.field) || typeof m.ci !== "number") continue;
    out[m.field] = {
      ci: m.ci,
      confidence: Math.max(0, Math.min(1, m.confidence)),
      reason: m.reason ?? "AI 매핑",
      source: "ai",
    };
  }
  if (!Object.keys(out).length) throw new Error("유효 매핑 없음");
  return out;
}

/**
 * L2~L4 오케스트레이션: AI 시도 -> 장애 시 규칙 엔진 강등(REQ-009) -> L3 정합성 교차검증
 * -> L4 신뢰도 등급. engine 태그로 자동확정 정책 분기(applyEvidence).
 */
export async function resolveMapping(
  profiles: ColumnProfile[], rows: Cell[][], env: Env, learned: Record<string, string> = {},
  ontology: OntologyField[] = ONTOLOGY, relationDesc: string = RELATION_DESC,
): Promise<MappingResult> {
  let candidates: CandidateMap;
  let engine: "ai" | "local";
  try {
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY 없음");
    candidates = await aiMap(profiles, env.ANTHROPIC_API_KEY, ontology, relationDesc);
    engine = "ai";
  } catch (e) {
    console.warn("AI 매핑 실패, 규칙 엔진 폴백:", String(e));
    candidates = localMap(profiles, learned, ontology);
    engine = "local";
  }
  const evidence = runConsistency(candidates, profiles, rows, ontology);
  applyEvidence(candidates, evidence, engine, ontology);
  return { candidates, evidence, engine };
}
