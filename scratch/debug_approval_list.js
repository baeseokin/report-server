const mysql = require('mysql2/promise');
require('dotenv').config({ path: '/Users/baeseokin/report-server/.env' });

async function debug() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  try {
    console.log("--- ID 85 Data ---");
    const [req85] = await pool.query("SELECT * FROM approval_requests WHERE id = 85");
    console.log(JSON.stringify(req85, null, 2));

    if (req85.length > 0) {
      const hang = req85[0].category_hang;
      console.log(`\n--- Category ${hang} Data ---`);
      const [cat] = await pool.query("SELECT * FROM account_categories WHERE category_id = ?", [hang]);
      console.log(JSON.stringify(cat, null, 2));
    }

    console.log("\n--- '관리부' Dept Data ---");
    const [dept] = await pool.query("SELECT * FROM departments WHERE dept_name = '관리부'");
    console.log(JSON.stringify(dept, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
debug();
