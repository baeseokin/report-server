-- ============================================================
-- 🚀 [2026-10-17 ~ 2026-10-18] 서버 DB 반영용 DDL 및 마이그레이션 스크립트
-- 대상 DB: reportdb
-- ============================================================

-- 1. [10/18 반영] 공지사항 테이블(notices)에 팝업 공지 여부 컬럼 추가
--    (※ 이미 운영 중인 DB에서 notices 테이블에 is_popup 컬럼을 신규 추가합니다)
ALTER TABLE `notices`
  ADD COLUMN `is_popup` TINYINT(1) DEFAULT 0 AFTER `view_count`;


-- 2. [10/17 반영] 차기 회계연도 예산편성서 상세 항목 테이블(budget_plan_items) 신설
--    (※ 결재문서 approval_requests 와 1:N 관계, 결재 삭제 시 CASCADE 삭제)
CREATE TABLE IF NOT EXISTS `budget_plan_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `request_id` INT NOT NULL COMMENT 'approval_requests 테이블 ID',
  `category_id` INT NOT NULL COMMENT 'account_categories 테이블 ID (마스터 ID 또는 임시 음수 ID)',
  `category_code` VARCHAR(50) DEFAULT NULL COMMENT '계정코드 (ACC... 또는 신규)',
  `category_name` VARCHAR(100) NOT NULL COMMENT '계정과목명',
  `level` ENUM('관','항','목','세목') NOT NULL COMMENT '계층 단계',
  `parent_id` INT DEFAULT NULL COMMENT '상위 계정 ID',
  `owner_dept_id` INT DEFAULT NULL COMMENT '관리 부서 ID',
  `is_leaf` TINYINT(1) DEFAULT 0 COMMENT '최하위 계정 여부 (1: 입력대상, 0: 소계합산)',
  `is_new_category` TINYINT(1) DEFAULT 0 COMMENT '신규 신청 계정과목 여부',
  `prev_amount` BIGINT DEFAULT 0 COMMENT '당해연도 예산액',
  `request_amount` BIGINT NOT NULL DEFAULT 0 COMMENT '차기년도 편성요청액',
  `diff_amount` BIGINT DEFAULT 0 COMMENT '전년 대비 증감액',
  `calc_basis` VARCHAR(500) DEFAULT NULL COMMENT '산출 근거 설명',
  `sort_order` INT DEFAULT 0 COMMENT '정렬 순서',
  INDEX `idx_req` (`request_id`),
  CONSTRAINT `budget_plan_items_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `approval_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 3. [10/18 데이터 보정 (선택)] "겨울캠프" 계정코드 오기입 수정 (ACC13010001 -> ACC00120302)
--    운영 DB에 '겨울캠프'가 이미 등록되어 잘못된 코드로 생성되어 있는 경우 아래 쿼리로 정상화합니다.
UPDATE account_categories SET category_id = 'ACC00120302' WHERE category_id = 'ACC13010001';
UPDATE budgets SET category_id = 'ACC00120302' WHERE category_id = 'ACC13010001';
UPDATE budget_plan_items SET category_code = 'ACC00120302' WHERE category_code = 'ACC13010001';
