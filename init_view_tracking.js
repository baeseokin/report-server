const mysql = require("mysql2/promise");
require("dotenv").config();
const { envPick, envNumber } = require("./env");

async function run() {
  const pool = mysql.createPool({
    host: envPick("DB_HOST", "localhost"),
    port: envNumber("DB_PORT", 3306),
    user: envPick("DB_USER", "root"),
    password: envPick("DB_PASSWORD", ""),
    database: envPick("DB_NAME", "test"),
  });

  try {
    console.log("Creating view tracking tables...");
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notice_views (
        user_id VARCHAR(50) NOT NULL,
        notice_id INT NOT NULL,
        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, notice_id),
        FOREIGN KEY (notice_id) REFERENCES notices(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS board_views (
        user_id VARCHAR(50) NOT NULL,
        board_id INT NOT NULL,
        viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, board_id),
        FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log("✅ View tracking tables created successfully.");
  } catch (err) {
    console.error("❌ Error creating view tables:", err);
  } finally {
    await pool.end();
  }
}

run();
