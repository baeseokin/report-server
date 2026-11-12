-- ⚠️ 위험: 결재·지출·서명 데이터를 모두 삭제합니다. (개발 DB 초기화 전용, 운영 DB에서 절대 실행 금지)
-- 실행 전 대상 DB가 맞는지 반드시 확인하세요.

truncate table approval_files;
truncate table approval_items;
truncate table approval_requests;
truncate table expense_details;
truncate table approval_history;
truncate table user_signatures;

ALTER TABLE reportdb.approval_files AUTO_INCREMENT=1;
ALTER TABLE reportdb.approval_items AUTO_INCREMENT=1;
ALTER TABLE reportdb.approval_requests AUTO_INCREMENT=1;
ALTER TABLE reportdb.expense_details AUTO_INCREMENT=1;
ALTER TABLE reportdb.approval_history AUTO_INCREMENT=1;
ALTER TABLE reportdb.user_signatures AUTO_INCREMENT=1;



