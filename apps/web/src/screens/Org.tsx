import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface OrgNode {
  id: string;
  name: string;
  kind: string;
  children: OrgNode[];
}

const KIND_LABEL: Record<string, string> = {
  headquarters: "본부",
  division: "사업단",
  team: "팀",
};

const inputSelectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function flattenTree(nodes: OrgNode[], depth = 0): { id: string; label: string }[] {
  return nodes.flatMap((n) => [
    { id: n.id, label: `${"　".repeat(depth)}${n.name}` },
    ...flattenTree(n.children, depth + 1),
  ]);
}

function OrgTreeView({ nodes, depth = 0 }: { nodes: OrgNode[]; depth?: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      {nodes.map((n) => (
        <div key={n.id}>
          <div className="flex items-center gap-2 rounded px-2 py-1 text-sm" style={{ paddingLeft: depth * 16 + 8 }}>
            <span className={depth === 0 ? "font-semibold" : "text-axis-text-secondary"}>{n.name}</span>
            <Badge variant="outline" className="text-[10px]">
              {KIND_LABEL[n.kind] ?? n.kind}
            </Badge>
          </div>
          {n.children.length > 0 && <OrgTreeView nodes={n.children} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

export default function Org() {
  const { auth } = useAuth();
  const isAdmin = auth?.role === "admin";
  const qc = useQueryClient();

  const treeQuery = useQuery({
    queryKey: ["org-tree"],
    queryFn: () => apiFetch<OrgNode[]>("/api/org/tree"),
  });
  const parentOptions = useMemo(() => flattenTree(treeQuery.data ?? []), [treeQuery.data]);

  // ── 조직 단위 등록 ──
  const [unitName, setUnitName] = useState("");
  const [unitKind, setUnitKind] = useState<"headquarters" | "division" | "team">("team");
  const [unitParentId, setUnitParentId] = useState("");
  const unitMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/api/org/units", {
        method: "POST",
        body: JSON.stringify({ name: unitName, kind: unitKind, parentId: unitParentId || null }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org-tree"] });
      setUnitName("");
    },
  });
  function submitUnit(e: FormEvent) {
    e.preventDefault();
    unitMutation.mutate();
  }

  // ── 설계사 등록 ──
  const [agentCode, setAgentCode] = useState("");
  const [agentName, setAgentName] = useState("");
  const agentMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; code: string; name: string }>("/api/agents", {
        method: "POST",
        body: JSON.stringify({ code: agentCode, name: agentName }),
      }),
    onSuccess: () => {
      setAgentCode("");
      setAgentName("");
    },
  });
  function submitAgent(e: FormEvent) {
    e.preventDefault();
    agentMutation.mutate();
  }

  // ── 설계사 시점별 소속 조회 ──
  const [lookupAgentId, setLookupAgentId] = useState("");
  const [lookupDate, setLookupDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lookupTrigger, setLookupTrigger] = useState<{ agentId: string; date: string } | null>(null);
  const lookupQuery = useQuery({
    queryKey: ["agent-org", lookupTrigger?.agentId, lookupTrigger?.date],
    queryFn: () =>
      apiFetch<{ agentId: string; date: string; orgUnitId: string }>(
        `/api/agents/${lookupTrigger!.agentId}/org?date=${lookupTrigger!.date}`,
      ),
    enabled: !!lookupTrigger,
    retry: false,
  });
  function submitLookup(e: FormEvent) {
    e.preventDefault();
    setLookupTrigger({ agentId: lookupAgentId.trim(), date: lookupDate });
  }

  // ── 계정 생성 (admin 게이트) ──
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<"admin" | "manager" | "staff" | "viewer">("staff");
  const [userOrgUnitId, setUserOrgUnitId] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const userMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; email: string; role: string; orgUnitId: string | null }>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          email: userEmail,
          name: userName,
          role: userRole,
          orgUnitId: userOrgUnitId || null,
          password: userPassword,
        }),
      }),
    onSuccess: () => {
      setUserEmail("");
      setUserName("");
      setUserPassword("");
    },
  });
  function submitUser(e: FormEvent) {
    e.preventDefault();
    userMutation.mutate();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-axis-text-primary">조직 · 계정</h1>
        <p className="text-sm text-axis-text-secondary">조직 트리 · 설계사 소속 · 계정 RBAC (F-009, F-017)</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-axis-border-default py-3">
            <CardTitle className="text-sm">조직도</CardTitle>
            <CardDescription>본부 &gt; 사업단 &gt; 팀</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[420px] overflow-y-auto py-3">
            {treeQuery.isLoading && <p className="text-sm text-axis-text-tertiary">불러오는 중...</p>}
            {treeQuery.isError && (
              <p className="text-sm text-axis-text-error">
                {treeQuery.error instanceof ApiError ? treeQuery.error.message : "조직도를 불러오지 못했어요"}
              </p>
            )}
            {treeQuery.data && treeQuery.data.length === 0 && (
              <p className="text-sm text-axis-text-tertiary">등록된 조직 단위가 없어요.</p>
            )}
            {treeQuery.data && <OrgTreeView nodes={treeQuery.data} />}
          </CardContent>
          <form onSubmit={submitUnit} className="flex flex-col gap-2 border-t border-axis-border-default p-3">
            <Label htmlFor="unit-name" className="text-xs">
              새 조직 단위
            </Label>
            <Input
              id="unit-name"
              placeholder="이름 (예: 강남 1팀)"
              value={unitName}
              onChange={(e) => setUnitName(e.target.value)}
              required
            />
            <div className="flex gap-2">
              <select
                className={inputSelectClass}
                value={unitKind}
                onChange={(e) => setUnitKind(e.target.value as typeof unitKind)}
              >
                <option value="headquarters">본부</option>
                <option value="division">사업단</option>
                <option value="team">팀</option>
              </select>
              <select className={inputSelectClass} value={unitParentId} onChange={(e) => setUnitParentId(e.target.value)}>
                <option value="">상위 없음(최상위)</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" disabled={unitMutation.isPending || unitName.trim().length === 0}>
              {unitMutation.isPending ? "등록 중..." : "조직 단위 등록"}
            </Button>
            {unitMutation.isError && (
              <p className="text-xs text-axis-text-error">
                {unitMutation.error instanceof ApiError ? unitMutation.error.message : "등록에 실패했어요"}
              </p>
            )}
          </form>
        </Card>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">설계사 등록</CardTitle>
                <CardDescription>ERP 코드 + 성명 (소속 배정은 별도)</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitAgent} className="flex flex-col gap-2">
                  <Label htmlFor="agent-code" className="text-xs">
                    설계사 코드
                  </Label>
                  <Input id="agent-code" value={agentCode} onChange={(e) => setAgentCode(e.target.value)} required />
                  <Label htmlFor="agent-name" className="text-xs">
                    성명
                  </Label>
                  <Input id="agent-name" value={agentName} onChange={(e) => setAgentName(e.target.value)} required />
                  <Button type="submit" size="sm" className="mt-1" disabled={agentMutation.isPending}>
                    {agentMutation.isPending ? "등록 중..." : "등록"}
                  </Button>
                  {agentMutation.isError && (
                    <p className="text-xs text-axis-text-error">
                      {agentMutation.error instanceof ApiError ? agentMutation.error.message : "등록에 실패했어요"}
                    </p>
                  )}
                  {agentMutation.isSuccess && (
                    <p className="text-xs text-axis-text-success">
                      등록됨 · id <span className="font-mono">{agentMutation.data.id}</span>
                    </p>
                  )}
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">시점별 소속 조회</CardTitle>
                <CardDescription>[validFrom, validTo) 구간 해석 (FR-11)</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitLookup} className="flex flex-col gap-2">
                  <Label htmlFor="lookup-agent" className="text-xs">
                    설계사 ID
                  </Label>
                  <Input id="lookup-agent" value={lookupAgentId} onChange={(e) => setLookupAgentId(e.target.value)} required />
                  <Label htmlFor="lookup-date" className="text-xs">
                    기준일
                  </Label>
                  <Input id="lookup-date" type="date" value={lookupDate} onChange={(e) => setLookupDate(e.target.value)} required />
                  <Button type="submit" size="sm" className="mt-1" disabled={lookupAgentId.trim().length === 0}>
                    조회
                  </Button>
                  {lookupTrigger && lookupQuery.isFetching && <p className="text-xs text-axis-text-tertiary">조회 중...</p>}
                  {lookupTrigger && lookupQuery.isError && (
                    <p className="text-xs text-axis-text-error">
                      {lookupQuery.error instanceof ApiError ? lookupQuery.error.message : "해당 시점 소속이 없어요"}
                    </p>
                  )}
                  {lookupQuery.data && (
                    <p className="text-xs text-axis-text-success">
                      소속: <span className="font-mono">{lookupQuery.data.orgUnitId}</span>
                    </p>
                  )}
                </form>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">계정 생성</CardTitle>
              <CardDescription>
                {isAdmin
                  ? "관리자 권한으로 계정을 만들어요."
                  : "관리자 계정만 생성할 수 있어요 (최초 계정은 허용된 IP에서만 부트스트랩)."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitUser} className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="user-email" className="text-xs">
                    이메일
                  </Label>
                  <Input id="user-email" type="email" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} required />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="user-name" className="text-xs">
                    이름
                  </Label>
                  <Input id="user-name" value={userName} onChange={(e) => setUserName(e.target.value)} required />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="user-role" className="text-xs">
                    역할
                  </Label>
                  <select
                    id="user-role"
                    className={inputSelectClass}
                    value={userRole}
                    onChange={(e) => setUserRole(e.target.value as typeof userRole)}
                  >
                    <option value="admin">admin</option>
                    <option value="manager">manager</option>
                    <option value="staff">staff</option>
                    <option value="viewer">viewer</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="user-org" className="text-xs">
                    조직 스코프
                  </Label>
                  <select id="user-org" className={inputSelectClass} value={userOrgUnitId} onChange={(e) => setUserOrgUnitId(e.target.value)}>
                    <option value="">전사(null)</option>
                    {parentOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1 md:col-span-2">
                  <Label htmlFor="user-password" className="text-xs">
                    임시 비밀번호
                  </Label>
                  <Input
                    id="user-password"
                    type="password"
                    minLength={4}
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" size="sm" disabled={userMutation.isPending}>
                    {userMutation.isPending ? "생성 중..." : "계정 생성"}
                  </Button>
                  {userMutation.isError && (
                    <p className="mt-1 text-xs text-axis-text-error">
                      {userMutation.error instanceof ApiError ? userMutation.error.message : "계정 생성에 실패했어요"}
                    </p>
                  )}
                  {userMutation.isSuccess && (
                    <p className="mt-1 text-xs text-axis-text-success">
                      생성됨 · {userMutation.data.email} ({userMutation.data.role})
                    </p>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
