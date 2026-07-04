const mysql = require('mysql2/promise');
const config = require('./config/db.config.js');

async function run() {
  const pool = mysql.createPool({ ...config, database: 'reportdb' });
  const requestId = 1; // Assuming there is a dummy request
  const [result] = await pool.query(
      `UPDATE approval_requests 
       SET total_amount = (SELECT COALESCE(SUM(amount), 0) FROM approval_items WHERE request_id = ?),
           updated_at = NOW()
       WHERE id = ?`,
      [requestId, requestId]
    );
  console.log(result);
  process.exit(0);
}
run();
