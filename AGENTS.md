# AGENTS.md

비 Claude 에이전트/도구용 최소 안내. 상세 규칙은 CLAUDE.md와 dot-claude/rules/ 참고.

- SoT: SPEC.md (F-item 단위 작업, Status 갱신 필수)
- 검증: pnpm typecheck && pnpm test 통과 전 커밋 금지
- 도메인 불변식: dot-claude/rules/domain-invariants.md 6개 항목 위반 금지
- 커밋: conventional commits (feat/fix/chore/test/docs + F-item ID 언급)
