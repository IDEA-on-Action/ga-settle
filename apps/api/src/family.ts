import { norm, parseDate } from "@ga-settle/mapping";

// 가족계약 감지 (F-011). 계약자 성명+생년월일이 설계사와 일치 = 자기/가족계약 후보.
// 순수 함수. 후보(candidate)만 생성하고 확정은 하지 않는다(HITL, FR-14).
export type FamilyContract = { contractNo: string; agentId: string; holderName: string; holderBirth: string };
export type FamilyAgent = { id: string; name: string; birth: string | null };
export type FamilyCandidate = { contractNo: string; agentId: string; matchedName: string; matchedAgentId: string };

const birthKey = (b: string | null | undefined): string => {
  if (!b) return "";
  const p = parseDate(b);
  return p.ok ? p.value : "";
};

export function findFamilyCandidates(contracts: FamilyContract[], agents: FamilyAgent[]): FamilyCandidate[] {
  const idx = new Map<string, FamilyAgent[]>();
  for (const a of agents) {
    const bk = birthKey(a.birth);
    if (!bk) continue; // 생년월일 없으면 오탐 방지 위해 매칭 제외
    const key = `${norm(a.name)}|${bk}`;
    const list = idx.get(key) ?? [];
    list.push(a);
    idx.set(key, list);
  }
  const out: FamilyCandidate[] = [];
  for (const ct of contracts) {
    const bk = birthKey(ct.holderBirth);
    if (!bk) continue;
    const key = `${norm(ct.holderName)}|${bk}`;
    for (const a of idx.get(key) ?? []) {
      out.push({ contractNo: ct.contractNo, agentId: ct.agentId, matchedName: ct.holderName, matchedAgentId: a.id });
    }
  }
  return out;
}
