const mysql = require('mysql2/promise');
const config = require('./config/db.config.js');
async function run() {
  const pool = mysql.createPool({ ...config, database: 'reportdb' });
  const [rows] = await pool.query(`SELECT r.id, r.role_name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = 1`);
  console.log("ROLES for user 1:", rows);
  process.exit(0);
}
run();
