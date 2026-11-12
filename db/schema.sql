-- reportdb 기준 스키마 (2026-11-12, 운영 DB에서 mariadb-dump --no-data 로 추출)
-- 신규 환경 구축·테스트 DB 생성에 사용합니다. 이후 변경은 db/migrations/ 에 추가하세요.
SET FOREIGN_KEY_CHECKS=0;
CREATE TABLE `account_categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category_id` varchar(11) NOT NULL,
  `parent_id` int(11) DEFAULT NULL COMMENT '상위 계정 ID',
  `level` enum('관','항','목','세목') NOT NULL COMMENT '계정 단계',
  `category_name` varchar(100) NOT NULL COMMENT '계정명',
  `valid_from` date NOT NULL DEFAULT curdate(),
  `valid_to` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `owner_dept_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `account_categories_unique` (`category_id`),
  KEY `fk_account_parent` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `account_category_departments` (
  `account_category_id` int(11) NOT NULL COMMENT '계정과목 ID',
  `dept_id` int(11) NOT NULL COMMENT '부서 ID',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `year` int(11) NOT NULL,
  PRIMARY KEY (`year`,`account_category_id`,`dept_id`),
  KEY `fk_acd_dept` (`dept_id`),
  CONSTRAINT `fk_acd_dept` FOREIGN KEY (`dept_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='계정과목-부서 매핑';
CREATE TABLE `approval_files` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `request_id` bigint(20) NOT NULL COMMENT 'approval_requests.id',
  `file_name` varchar(255) NOT NULL,
  `file_path` varchar(500) NOT NULL,
  `mime_type` varchar(100) NOT NULL,
  `file_size` bigint(20) NOT NULL,
  `alias_name` varchar(255) DEFAULT NULL,
  `uploaded_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `approval_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `request_id` int(11) NOT NULL,
  `approver_role` varchar(50) NOT NULL,
  `approver_user_id` varchar(100) NOT NULL,
  `comment` text DEFAULT NULL,
  `signature_path` varchar(255) DEFAULT NULL,
  `status` enum('승인','반려') NOT NULL DEFAULT '승인',
  `approved_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `request_id` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `approval_items` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `request_id` bigint(20) NOT NULL,
  `gwan` varchar(100) DEFAULT NULL,
  `hang` varchar(100) DEFAULT NULL,
  `mok` varchar(100) DEFAULT NULL,
  `semok` varchar(100) DEFAULT NULL,
  `detail` varchar(255) DEFAULT NULL,
  `amount` bigint(20) DEFAULT NULL,
  `dept_id` int(11) NOT NULL COMMENT '부서 ID',
  `year` year(4) NOT NULL COMMENT '회계연도',
  PRIMARY KEY (`id`),
  KEY `request_id` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `approval_line` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `dept_name` varchar(100) NOT NULL,
  `approver_role` varchar(50) NOT NULL,
  `approver_user_id` varchar(100) NOT NULL,
  `order_no` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_approval_line_dept_order` (`dept_name`,`order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `approval_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `document_type` varchar(100) NOT NULL,
  `dept_name` varchar(100) NOT NULL,
  `author` varchar(100) NOT NULL,
  `payee` varchar(100) DEFAULT NULL,
  `request_date` date NOT NULL,
  `total_amount` decimal(15,0) NOT NULL,
  `comment` text DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `aliasName` varchar(100) DEFAULT NULL,
  `status` enum('임시저장','작성중','결재진행중','결재완료','결재반려','재정부이관완료') DEFAULT '결재진행중',
  `category_gwan` varchar(100) DEFAULT NULL,
  `category_hang` varchar(100) DEFAULT NULL,
  `current_approver_role` varchar(50) DEFAULT NULL,
  `current_approver_user_id` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `account_info` varchar(255) DEFAULT NULL COMMENT '청구계좌정보 (수정 가능)',
  `requester_phone` varchar(50) DEFAULT NULL COMMENT '청구자 전화번호',
  `current_order_no` int(11) DEFAULT NULL COMMENT '현재 진행 중인 결재 순번(단계)',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `board_comments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `board_id` int(11) NOT NULL,
  `parent_id` int(11) DEFAULT NULL,
  `author_id` varchar(50) NOT NULL,
  `author_name` varchar(100) NOT NULL,
  `content` text NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `board_id` (`board_id`),
  KEY `parent_id` (`parent_id`),
  CONSTRAINT `board_comments_ibfk_1` FOREIGN KEY (`board_id`) REFERENCES `boards` (`id`) ON DELETE CASCADE,
  CONSTRAINT `board_comments_ibfk_2` FOREIGN KEY (`parent_id`) REFERENCES `board_comments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `board_files` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `board_id` int(11) NOT NULL,
  `original_name` varchar(255) NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `file_size` int(11) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `board_id` (`board_id`),
  CONSTRAINT `board_files_ibfk_1` FOREIGN KEY (`board_id`) REFERENCES `boards` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `board_views` (
  `user_id` varchar(50) NOT NULL,
  `board_id` int(11) NOT NULL,
  `viewed_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`user_id`,`board_id`),
  KEY `board_id` (`board_id`),
  CONSTRAINT `board_views_ibfk_1` FOREIGN KEY (`board_id`) REFERENCES `boards` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `boards` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `content` mediumtext NOT NULL,
  `author_id` varchar(50) NOT NULL,
  `author_name` varchar(100) NOT NULL,
  `view_count` int(11) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `budget_plan_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `request_id` int(11) NOT NULL,
  `category_id` int(11) NOT NULL,
  `category_code` varchar(50) DEFAULT NULL,
  `category_name` varchar(100) NOT NULL,
  `level` enum('관','항','목','세목') NOT NULL,
  `parent_id` int(11) DEFAULT NULL,
  `owner_dept_id` int(11) DEFAULT NULL,
  `is_leaf` tinyint(1) DEFAULT 0,
  `is_new_category` tinyint(1) DEFAULT 0,
  `prev_amount` bigint(20) DEFAULT 0,
  `request_amount` bigint(20) NOT NULL DEFAULT 0,
  `diff_amount` bigint(20) DEFAULT 0,
  `calc_basis` varchar(500) DEFAULT NULL,
  `sort_order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_req` (`request_id`),
  CONSTRAINT `budget_plan_items_ibfk_1` FOREIGN KEY (`request_id`) REFERENCES `approval_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `budget_request_items` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `budget_request_id` int(11) NOT NULL,
  `category_id` varchar(11) DEFAULT NULL,
  `level` varchar(20) DEFAULT '목',
  `gwan` varchar(100) NOT NULL,
  `hang` varchar(100) NOT NULL,
  `mok` varchar(100) DEFAULT NULL,
  `semok` varchar(100) DEFAULT NULL,
  `base_amount` decimal(15,0) DEFAULT 0,
  `request_amount` decimal(15,0) DEFAULT 0,
  `diff_amount` decimal(15,0) DEFAULT 0,
  `calculation_basis` text DEFAULT NULL,
  `order_no` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_budget_request_id` (`budget_request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `budget_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `approval_request_id` int(11) DEFAULT NULL,
  `dept_id` int(11) NOT NULL,
  `dept_name` varchar(100) NOT NULL,
  `target_year` int(11) NOT NULL,
  `base_year` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `status` varchar(50) DEFAULT '작성중',
  `total_base_amount` decimal(15,0) DEFAULT 0,
  `total_request_amount` decimal(15,0) DEFAULT 0,
  `total_diff_amount` decimal(15,0) DEFAULT 0,
  `author_id` varchar(100) NOT NULL,
  `author_name` varchar(100) NOT NULL,
  `current_approver_role` varchar(50) DEFAULT NULL,
  `current_approver_user_id` varchar(100) DEFAULT NULL,
  `current_order_no` int(11) DEFAULT NULL,
  `reject_reason` text DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dept_target_year` (`dept_id`,`target_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `budgets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category_id` varchar(11) NOT NULL,
  `year` year(4) NOT NULL COMMENT '회계연도',
  `budget_amount` decimal(15,0) NOT NULL COMMENT '예산 금액',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_category_year` (`category_id`,`year`),
  KEY `fk_budget_category` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `departments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `dept_name` varchar(100) NOT NULL COMMENT '부서명',
  `parent_dept_id` int(11) DEFAULT NULL COMMENT '상위 부서 ID',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `dept_cd` varchar(10) DEFAULT NULL,
  `account_info` varchar(255) DEFAULT NULL COMMENT '부서 기본 청구계좌정보',
  PRIMARY KEY (`id`),
  KEY `fk_parent_dept` (`parent_dept_id`),
  CONSTRAINT `fk_parent_dept` FOREIGN KEY (`parent_dept_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `expense_details` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '지출내역 ID',
  `dept_id` int(11) NOT NULL COMMENT '부서 ID',
  `category_id` varchar(11) NOT NULL COMMENT '회계 카테고리 ID (관/항/목/세목)',
  `year` year(4) NOT NULL COMMENT '회계연도',
  `expense_date` date NOT NULL COMMENT '지출일자',
  `amount` decimal(15,0) NOT NULL COMMENT '지출 금액',
  `description` varchar(255) DEFAULT NULL COMMENT '지출 내역 설명',
  `created_at` timestamp NULL DEFAULT current_timestamp() COMMENT '생성일시',
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '수정일시',
  `approval_request_id` int(11) DEFAULT NULL COMMENT '결재요청 ID',
  PRIMARY KEY (`id`),
  KEY `idx_expense_dept` (`dept_id`),
  KEY `idx_expense_category` (`category_id`),
  KEY `fk_expense_approval` (`approval_request_id`),
  CONSTRAINT `fk_expense_department` FOREIGN KEY (`dept_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `notice_files` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `notice_id` int(11) NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `mime_type` varchar(100) DEFAULT NULL,
  `file_size` int(11) DEFAULT NULL,
  `original_name` varchar(255) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `notice_id` (`notice_id`),
  CONSTRAINT `notice_files_ibfk_1` FOREIGN KEY (`notice_id`) REFERENCES `notices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `notice_views` (
  `user_id` varchar(50) NOT NULL,
  `notice_id` int(11) NOT NULL,
  `viewed_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`user_id`,`notice_id`),
  KEY `notice_id` (`notice_id`),
  CONSTRAINT `notice_views_ibfk_1` FOREIGN KEY (`notice_id`) REFERENCES `notices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `notices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `content` longtext NOT NULL,
  `author_id` varchar(50) NOT NULL,
  `author_name` varchar(100) NOT NULL,
  `view_count` int(11) DEFAULT 0,
  `is_popup` tinyint(1) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE `role_access` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `role_id` int(11) NOT NULL,
  `menu_name` varchar(100) NOT NULL,
  `access_type` enum('all') DEFAULT 'all',
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_id` (`role_id`,`menu_name`,`access_type`),
  CONSTRAINT `role_access_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `roles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `role_name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_name` (`role_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `user_favorites` (
  `user_id` varchar(50) NOT NULL,
  `menu_name` varchar(100) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`user_id`,`menu_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `user_roles` (
  `user_id` int(11) NOT NULL,
  `role_id` int(11) NOT NULL,
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `role_id` (`role_id`),
  CONSTRAINT `user_roles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_roles_ibfk_2` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `user_signatures` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(100) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_signatures_user` (`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(50) NOT NULL,
  `user_name` varchar(100) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `dept_name` varchar(100) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `require_password_change` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
SET FOREIGN_KEY_CHECKS=1;
