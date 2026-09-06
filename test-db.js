const mysql = require('mysql2/promise');
require('dotenv').config();
async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '1234',
    database: process.env.DB_NAME || 'reportdb',
  });
  try {
    const [rows] = await pool.query(`WITH RECURSIVE parent_depts AS (
         SELECT id, dept_name, parent_dept_id FROM departments WHERE dept_name = ?
         UNION ALL
         SELECT d.id, d.dept_name, d.parent_dept_id FROM departments d
         INNER JOIN parent_depts pd ON d.id = pd.parent_dept_id
       ) SELECT dept_name FROM parent_depts`, ['재정부']);
    console.log(rows);
  } catch(e) {
    console.error(e);
  }
  process.exit();
}
run();
