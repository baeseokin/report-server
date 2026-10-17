const mysql = require('mysql2/promise');
const { envPick, envNumber } = require('../env');

async function initBudgetPlanTable() {
  const pool = mysql.createPool({
    host: envPick("DB_HOST", "localhost"),
    port: envNumber("DB_PORT", 3306),
    user: envPick("DB_USER", "root"),
    password: envPick("DB_PASSWORD", ""),
    database: envPick("DB_NAME", "test"),
    waitForConnections: true,
    connectionLimit: 1,
    dateStrings: true,
  });

  try {
    console.log("🚀 Creating budget_plan_items table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS budget_plan_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NOT NULL,
        category_id INT NOT NULL,
        category_code VARCHAR(50) NULL,
        category_name VARCHAR(100) NOT NULL,
        level ENUM('관', '항', '목', '세목') NOT NULL,
        parent_id INT NULL,
        owner_dept_id INT NULL,
        is_leaf TINYINT(1) DEFAULT 0,
        prev_amount BIGINT DEFAULT 0,
        request_amount BIGINT NOT NULL DEFAULT 0,
        diff_amount BIGINT DEFAULT 0,
        calc_basis VARCHAR(500) NULL,
        sort_order INT DEFAULT 0,
        INDEX idx_req (request_id),
        FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ budget_plan_items table created successfully.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to create table:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initBudgetPlanTable();
