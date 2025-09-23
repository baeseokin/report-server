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
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


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
) ENGINE=InnoDB AUTO_INCREMENT=97 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


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
) ENGINE=InnoDB AUTO_INCREMENT=59 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


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
) ENGINE=InnoDB AUTO_INCREMENT=49 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


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
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


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
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.budgets definition

CREATE TABLE `budgets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `dept_id` int(11) NOT NULL COMMENT '부서 ID (FK)',
  `category_id` int(11) NOT NULL COMMENT 'account_categories.id 참조',
  `year` year(4) NOT NULL COMMENT '회계연도',
  `budget_amount` decimal(15,2) NOT NULL COMMENT '예산 금액',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_budget_dept` (`dept_id`),
  KEY `fk_budget_category` (`category_id`),
  CONSTRAINT `fk_budget_category` FOREIGN KEY (`category_id`) REFERENCES `account_categories` (`id`),
  CONSTRAINT `fk_budget_dept` FOREIGN KEY (`dept_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.expense_details definition

CREATE TABLE `expense_details` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '지출내역 ID',
  `dept_id` int(11) NOT NULL COMMENT '부서 ID',
  `category_id` int(11) NOT NULL COMMENT '회계 카테고리 ID (관/항/목/세목)',
  `budget_id` int(11) DEFAULT NULL COMMENT '참조 예산 ID (선택)',
  `expense_date` date NOT NULL COMMENT '지출일자',
  `amount` decimal(15,2) NOT NULL COMMENT '지출 금액',
  `description` varchar(255) DEFAULT NULL COMMENT '지출 내역 설명',
  `created_at` timestamp NULL DEFAULT current_timestamp() COMMENT '생성일시',
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp() COMMENT '수정일시',
  PRIMARY KEY (`id`),
  KEY `idx_expense_dept` (`dept_id`),
  KEY `idx_expense_category` (`category_id`),
  KEY `idx_expense_budget` (`budget_id`),
  CONSTRAINT `fk_expense_budget` FOREIGN KEY (`budget_id`) REFERENCES `budgets` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_expense_category` FOREIGN KEY (`category_id`) REFERENCES `account_categories` (`id`),
  CONSTRAINT `fk_expense_department` FOREIGN KEY (`dept_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;



-- reportdb.account_categories_hierarchy_view source

CREATE OR REPLACE
ALGORITHM = UNDEFINED VIEW `account_categories_hierarchy_view` AS with recursive category_hierarchy as (
select
    `ac`.`id` AS `id`,
    `ac`.`dept_id` AS `dept_id`,
    `ac`.`category_name` AS `category_name`,
    `ac`.`level` AS `level`,
    `ac`.`parent_id` AS `parent_id`,
    `ac`.`valid_from` AS `valid_from`,
    `ac`.`valid_to` AS `valid_to`,
    cast(`ac`.`category_name` as char(500) charset utf8mb4) AS `full_path`,
    1 AS `depth`
from
    `account_categories` `ac`
where
    `ac`.`parent_id` is null
union all
select
    `child`.`id` AS `id`,
    `child`.`dept_id` AS `dept_id`,
    `child`.`category_name` AS `category_name`,
    `child`.`level` AS `level`,
    `child`.`parent_id` AS `parent_id`,
    `child`.`valid_from` AS `valid_from`,
    `child`.`valid_to` AS `valid_to`,
    concat(`ch`.`full_path`, ' > ', `child`.`category_name`) AS `full_path`,
    `ch`.`depth` + 1 AS `depth`
from
    (`account_categories` `child`
join `category_hierarchy` `ch` on
    (`child`.`parent_id` = `ch`.`id`))
)select
    `d`.`dept_name` AS `dept_name`,
    `ch`.`id` AS `category_id`,
    `ch`.`category_name` AS `category_name`,
    `ch`.`level` AS `category_level`,
    `ch`.`parent_id` AS `parent_id`,
    `ch`.`valid_from` AS `valid_from`,
    `ch`.`valid_to` AS `valid_to`,
    `ch`.`full_path` AS `full_path`,
    `ch`.`depth` AS `depth`,
    `ch`.`dept_id` AS `dept_id`
from
    (`category_hierarchy` `ch`
join `departments` `d` on
    (`d`.`id` = `ch`.`dept_id`))
order by
    `ch`.`parent_id`,
    `ch`.`id`;


-- reportdb.budgets_view source

CREATE OR REPLACE
ALGORITHM = UNDEFINED VIEW `budgets_view` AS
select
    `b`.`id` AS `budget_id`,
    `b`.`year` AS `year`,
    `b`.`budget_amount` AS `budget_amount`,
    `d`.`id` AS `dept_id`,
    `d`.`dept_name` AS `dept_name`,
    `ac`.`id` AS `category_id`,
    `ac`.`category_name` AS `category_name`,
    `ac`.`level` AS `category_level`,
    `ac`.`parent_id` AS `parent_id`,
    `ac`.`valid_from` AS `valid_from`,
    `ac`.`valid_to` AS `valid_to`,
    coalesce(sum(`e`.`amount`), 0) AS `used_amount`,
    `b`.`budget_amount` - coalesce(sum(`e`.`amount`), 0) AS `remaining_amount`,
    `b`.`created_at` AS `created_at`,
    `b`.`updated_at` AS `updated_at`
from
    (((`budgets` `b`
join `departments` `d` on
    (`b`.`dept_id` = `d`.`id`))
join `account_categories` `ac` on
    (`b`.`category_id` = `ac`.`id` and `b`.`dept_id` = `ac`.`dept_id`))
left join `expense_details` `e` on
    (`e`.`budget_id` = `b`.`id` and `e`.`dept_id` = `b`.`dept_id` and `e`.`category_id` = `b`.`category_id`))
group by
    `b`.`id`,
    `b`.`year`,
    `b`.`budget_amount`,
    `d`.`id`,
    `d`.`dept_name`,
    `ac`.`id`,
    `ac`.`category_name`,
    `ac`.`level`,
    `ac`.`parent_id`,
    `ac`.`valid_from`,
    `ac`.`valid_to`,
    `b`.`created_at`,
    `b`.`updated_at`;


-- reportdb.expenses_view source

CREATE OR REPLACE
ALGORITHM = UNDEFINED VIEW `expenses_view` AS
select
    `e`.`id` AS `expense_id`,
    `e`.`expense_date` AS `expense_date`,
    `e`.`amount` AS `amount`,
    `e`.`description` AS `description`,
    `d`.`id` AS `dept_id`,
    `d`.`dept_name` AS `dept_name`,
    `ac`.`id` AS `category_id`,
    `ac`.`category_name` AS `category_name`,
    `ac`.`level` AS `category_level`,
    `ac`.`parent_id` AS `parent_id`,
    `ac`.`valid_from` AS `valid_from`,
    `ac`.`valid_to` AS `valid_to`,
    `b`.`year` AS `budget_year`,
    `b`.`budget_amount` AS `budget_amount`,
    `e`.`created_at` AS `created_at`,
    `e`.`updated_at` AS `updated_at`
from
    (((`expense_details` `e`
join `departments` `d` on
    (`e`.`dept_id` = `d`.`id`))
join `account_categories` `ac` on
    (`e`.`category_id` = `ac`.`id` and `e`.`dept_id` = `ac`.`dept_id`))
left join `budgets` `b` on
    (`e`.`budget_id` = `b`.`id` and `e`.`dept_id` = `b`.`dept_id` and `e`.`category_id` = `b`.`category_id`));