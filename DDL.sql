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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.approval_history definition

CREATE TABLE `approval_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `request_id` int(11) NOT NULL,
  `approver_role` varchar(50) NOT NULL,
  `approver_name` varchar(100) NOT NULL,
  `comment` text DEFAULT NULL,
  `signature_path` varchar(255) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `request_id` (`request_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


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
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


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
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- reportdb.user_roles definition

CREATE TABLE `user_roles` (
  `user_id` int(11) NOT NULL,
  `role_id` int(11) NOT NULL,
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `role_id` (`role_id`),
  CONSTRAINT `user_roles_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_roles_ibfk_2` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

INSERT INTO reportdb.approval_line (dept_name,approver_role,approver_name,order_no) VALUES
	 ('원천엔젤스','회계','배석인',1),
	 ('원천엔젤스','부장','김개욱',2),
	 ('원천엔젤스','위원장','이종민',3);

INSERT INTO reportdb.departments (dept_name,parent_dept_id,created_at,updated_at) VALUES
	 ('교회',NULL,'2025-09-06 07:35:33','2025-09-06 07:35:33'),
	 ('음악부',1,'2025-09-06 07:35:34','2025-09-06 07:35:34'),
	 ('교육부',1,'2025-09-06 07:35:34','2025-09-06 07:35:34'),
	 ('재정부',1,'2025-09-06 07:35:34','2025-09-06 07:35:34'),
	 ('원천엔젤스',2,'2025-09-06 07:35:38','2025-09-06 07:35:38'),
	 ('할렐루야찬양대',2,'2025-09-06 07:35:38','2025-09-06 07:35:38'),
	 ('임마누엘찬양대',2,'2025-09-06 07:35:38','2025-09-06 07:35:38'),
	 ('샬롬찬양대',2,'2025-09-06 07:35:38','2025-09-06 07:35:38'),
	 ('청년부',3,'2025-09-06 07:35:41','2025-09-06 07:35:41');

INSERT INTO reportdb.dept_approvers (dept_name,`role`,approver_name,approver_user_id,approver_order,is_active,created_at) VALUES
	 ('원천엔젤스','담당','배석인','user02',1,1,'2025-09-05 12:05:45'),
	 ('원천엔젤스','부장','김개욱','user03',2,1,'2025-09-05 12:06:46'),
	 ('원천엔젤스','위원장','이종민','user04',3,1,'2025-09-05 12:06:48');

INSERT INTO reportdb.role_access (role_id,menu_name,access_type) VALUES
	 (1,'권한 관리','all'),
	 (1,'내결재목록 조회','all'),
	 (1,'보고서 작성','all'),
	 (1,'사용자 관리','all'),
	 (1,'청구목록 조회','all'),
	 (2,'내결재목록 조회','all'),
	 (2,'보고서 작성','all'),
	 (2,'청구목록 조회','all'),
	 (3,'내결재목록 조회','all'),
	 (3,'청구목록 조회','all');
INSERT INTO reportdb.role_access (role_id,menu_name,access_type) VALUES
	 (4,'내결재목록 조회','all'),
	 (4,'청구목록 조회','all'),
	 (5,'내결재목록 조회','all'),
	 (5,'청구목록 조회','all'),
	 (6,'내결재목록 조회','all'),
	 (6,'보고서 작성','all'),
	 (6,'청구목록 조회','all');

INSERT INTO reportdb.roles (role_name) VALUES
	 ('관리자'),
	 ('당회장'),
	 ('부장'),
	 ('위원장'),
	 ('재정부'),
	 ('회계');

INSERT INTO reportdb.user_roles (user_id,role_id) VALUES
	 (1,1),
	 (3,2),
	 (4,3),
	 (5,4),
	 (8,6);

INSERT INTO reportdb.users (user_id,user_name,email,phone,dept_name,password_hash,created_at) VALUES
	 ('user01','관리자','2222@naver.com','1','교회','$2b$10$PY2LIFazvdE0DL4BG4YHhu76Zc5SSsApp.qIdFNBVBUWi/.lr82K6','2025-09-04 12:06:35'),
	 ('user02','배석인','','','원천엔젤스','$2b$10$RdUwLN765Y/.TwU5reKSI.AsnMFD4F0xUDnePgxY8nficBw5inJrC','2025-09-04 12:49:28'),
	 ('user03','김개욱','2222@ee.com','','음악부','$2b$10$ous4ef/ISKhaiqa08hwpfOIOYveBa9s/6Yo0RkTbBpc/grKJsuu3O','2025-09-05 12:20:09'),
	 ('user04','이종민','','','음악부','$2b$10$HyUcMFCuyTL5T2TLb6QY/eVHssikD3RSJQ2yd/f5JGbuWThogsrOa','2025-09-05 12:20:49'),
	 ('user05','재정부','','','재정부','$2b$10$Kt6.tcqzEDaid95P2MApmuMczv.MEtlpGH11aisgRrMi1IIE4pMqi','2025-09-05 14:01:21');

