const mysql = require('mysql2/promise');
require('dotenv').config();
const { envPick, envNumber } = require("./env");

async function initDB() {
  const pool = mysql.createPool({
    host: envPick("DB_HOST", "localhost"),
    port: envNumber("DB_PORT", 3306),
    user: envPick("DB_USER", "root"),
    password: envPick("DB_PASSWORD", ""),
    database: envPick("DB_NAME", "test"),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS boards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content MEDIUMTEXT NOT NULL,
        author_id VARCHAR(50) NOT NULL,
        author_name VARCHAR(100) NOT NULL,
        view_count INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS board_files (
        id INT AUTO_INCREMENT PRIMARY KEY,
        board_id INT NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        file_size INT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS board_comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        board_id INT NOT NULL,
        parent_id INT DEFAULT NULL,
        author_id VARCHAR(50) NOT NULL,
        author_name VARCHAR(100) NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES board_comments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log("게시판(boards), 첨부파일(board_files), 댓글(board_comments) 테이블 생성 완료");
  } catch (error) {
    console.error("테이블 생성 오류:", error);
  } finally {
    await pool.end();
  }
}

initDB();
