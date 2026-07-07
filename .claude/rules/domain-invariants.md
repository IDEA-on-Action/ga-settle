# ga-settle 도메인 불변식 (위반 PR 금지)

1. commission_records에 upload_id + row_no 없는 insert 금지 (역추적 불변식)
2. status='closed'인 settlement_run 관련 테이블 UPDATE/DELETE 금지 - API 검사 + D1 트리거 이중
3. LLM 출력이 금액 계산에 직접 들어가는 경로 금지 - AI는 매핑 후보/설명/초안만
4. adjustments.reason 없는 보정 금지, 모든 쓰기는 audit_logs 동반
5. LLM 전송 페이로드에 비마스킹 인적정보/전체 행 데이터 금지 (헤더 + 마스킹 표본 8개 한정)
6. packages/mapping, packages/rules 수정 시 골든 회귀 테스트 통과 필수
