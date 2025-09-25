-- reportdb.approval_files definition

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
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.approval_history definition

CREATE TABLE `approval_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `request_id` int(11) NOT NULL,
  `approver_role` varchar(50) NOT NULL,
  `approver_name` varchar(100) NOT NULL,
  `comment` text DEFAULT NULL,
  `signature_path` varchar(255) DEFAULT NULL,
  `status` enum('승인','반려') NOT NULL DEFAULT '승인',
  `approved_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `request_id` (`request_id`)
) ENGINE=InnoDB AUTO_INCREMENT=111 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.approval_items definition

CREATE TABLE `approval_items` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `request_id` bigint(20) NOT NULL,
  `gwan` varchar(100) DEFAULT NULL,
  `hang` varchar(100) DEFAULT NULL,
  `mok` varchar(100) DEFAULT NULL,
  `semok` varchar(100) DEFAULT NULL,
  `detail` varchar(255) DEFAULT NULL,
  `amount` bigint(20) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `request_id` (`request_id`)
) ENGINE=InnoDB AUTO_INCREMENT=69 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.approval_line definition

CREATE TABLE `approval_line` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `dept_name` varchar(100) NOT NULL,
  `approver_role` varchar(50) NOT NULL,
  `approver_name` varchar(100) NOT NULL,
  `order_no` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.approval_progress definition

CREATE TABLE `approval_progress` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `request_id` int(11) NOT NULL COMMENT '청구요청 ID (approval_requests.id)',
  `approver_name` varchar(100) NOT NULL COMMENT '결재자명',
  `role` enum('담당','부장','위원장','당회장') NOT NULL COMMENT '결재 역할',
  `status` enum('대기','승인','반려') DEFAULT '대기' COMMENT '결재 상태',
  `comment` varchar(500) DEFAULT NULL COMMENT '결재 의견',
  `approved_at` timestamp NULL DEFAULT NULL COMMENT '결재일시',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.approval_requests definition

CREATE TABLE `approval_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `document_type` varchar(100) NOT NULL,
  `dept_name` varchar(100) NOT NULL,
  `author` varchar(100) NOT NULL,
  `request_date` date NOT NULL,
  `total_amount` decimal(15,0) NOT NULL,
  `comment` text DEFAULT NULL,
  `aliasName` varchar(100) DEFAULT NULL,
  `status` enum('진행중','완료','반려') DEFAULT '진행중',
  `current_approver_role` varchar(50) DEFAULT NULL,
  `current_approver_name` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=59 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.dept_approvers definition

CREATE TABLE `dept_approvers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `dept_name` varchar(100) NOT NULL COMMENT '부서명',
  `role` enum('담당','부장','위원장','당회장') NOT NULL COMMENT '결재 역할',
  `approver_name` varchar(100) NOT NULL COMMENT '결재자명',
  `approver_user_id` varchar(50) DEFAULT NULL COMMENT '결재자 시스템 계정 (선택)',
  `approver_order` int(11) NOT NULL COMMENT '결재 순서 (1=담당, 2=부장, 3=위원장, 4=당회장)',
  `is_active` tinyint(1) DEFAULT 1 COMMENT '활성 여부',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.roles definition

CREATE TABLE `roles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `role_name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_name` (`role_name`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.users definition

CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(50) NOT NULL,
  `user_name` varchar(100) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `dept_name` varchar(100) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.departments definition

CREATE TABLE `departments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `dept_name` varchar(100) NOT NULL COMMENT '부서명',
  `parent_dept_id` int(11) DEFAULT NULL COMMENT '상위 부서 ID',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `dept_cd` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_parent_dept` (`parent_dept_id`),
  CONSTRAINT `fk_parent_dept` FOREIGN KEY (`parent_dept_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.role_access definition

CREATE TABLE `role_access` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `role_id` int(11) NOT NULL,
  `menu_name` varchar(100) NOT NULL,
  `access_type` enum('all') DEFAULT 'all',
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_id` (`role_id`,`menu_name`,`access_type`),
  CONSTRAINT `role_access_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=28 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.user_roles definition

CREATE TABLE `user_roles` (
  `user_id` int(11) NOT NULL,
  `role_id` int(11) NOT NULL,
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `role_id` (`role_id`),
  CONSTRAINT `user_roles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_roles_ibfk_2` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.account_categories definition

CREATE TABLE `account_categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `dept_id` int(11) NOT NULL COMMENT '부서 ID (FK)',
  `parent_id` int(11) DEFAULT NULL COMMENT '상위 계정 ID',
  `level` enum('관','항','목','세목') NOT NULL COMMENT '계정 단계',
  `category_name` varchar(100) NOT NULL COMMENT '계정명',
  `valid_from` date NOT NULL DEFAULT curdate(),
  `valid_to` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_account_parent` (`parent_id`),
  KEY `fk_account_dept` (`dept_id`),
  CONSTRAINT `fk_account_dept` FOREIGN KEY (`dept_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_account_parent` FOREIGN KEY (`parent_id`) REFERENCES `account_categories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.budgets definition

CREATE TABLE `budgets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `dept_id` int(11) NOT NULL COMMENT '부서 ID (FK)',
  `category_id` int(11) NOT NULL COMMENT 'account_categories.id 참조',
  `year` year(4) NOT NULL COMMENT '회계연도',
  `budget_amount` decimal(15,0) NOT NULL COMMENT '예산 금액',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_budgets` (`dept_id`,`category_id`,`year`),
  KEY `fk_budget_dept` (`dept_id`),
  KEY `fk_budget_category` (`category_id`),
  CONSTRAINT `fk_budget_category` FOREIGN KEY (`category_id`) REFERENCES `account_categories` (`id`),
  CONSTRAINT `fk_budget_dept` FOREIGN KEY (`dept_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=86 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.expense_details definition

CREATE TABLE `expense_details` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '지출내역 ID',
  `dept_id` int(11) NOT NULL COMMENT '부서 ID',
  `category_id` int(11) NOT NULL COMMENT '회계 카테고리 ID (관/항/목/세목)',
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
  CONSTRAINT `fk_expense_approval` FOREIGN KEY (`approval_request_id`) REFERENCES `approval_requests` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_expense_category` FOREIGN KEY (`category_id`) REFERENCES `account_categories` (`id`),
  CONSTRAINT `fk_expense_department` FOREIGN KEY (`dept_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;