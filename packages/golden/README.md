# @ga-settle/golden

원수사별 골든 표본 + 기대 결과 (회귀 테스트 데이터). NFR-06 / F-021.

```
fixtures/<insurerId>/<YYYY-MM>/
  source.xlsx        # 원본 표본 (민감정보 마스킹본)
  expected.json      # 기대 원장 스냅샷
  mapping.json       # 확정 매핑 (TemplateVersion 내용)
```

규칙: packages/mapping·rules 수정 시 전체 골든 회귀 통과 필수 (CI 게이트).
S0 룰 워크숍에서 원수사 샘플 확보 즉시 여기에 축적 - 마일스톤 1 "변환 성공률 리포트"가 이 데이터로 산출된다.

⚠ 실데이터 원본은 커밋 금지. 마스킹 처리 후 추가한다.
