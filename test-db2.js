const mysql = require('mysql2/promise');
async function run() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'reportuser',
    password: 'reportpass',
    database: 'reportdb',
  });
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query("DESCRIBE users");
    console.log(rows);
  } catch(e) {
    console.error("ERROR", e);
  } finally {
    conn.release();
    process.exit();
  }
}
run();
