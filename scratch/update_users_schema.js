require('dotenv').config({ path: '/Users/baeseokin/report-server/.env' });
const mysql = require('mysql2/promise');

async function run() {
  const isProd = process.env.NODE_ENV === 'production';
  const pool = mysql.createPool({
    host: isProd ? process.env.DB_HOST__production : process.env.DB_HOST__development,
    port: isProd ? process.env.DB_PORT__production : process.env.DB_PORT__development,
    user: isProd ? process.env.DB_USER__production : process.env.DB_USER__development,
    password: isProd ? process.env.DB_PASSWORD__production : process.env.DB_PASSWORD__development,
    database: isProd ? process.env.DB_NAME__production : process.env.DB_NAME__development,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });

  try {
    console.log("Checking users table schema...");
    const [columns] = await pool.query("SHOW COLUMNS FROM users LIKE 'require_password_change'");
    if (columns.length === 0) {
      console.log("Adding require_password_change column...");
      await pool.query("ALTER TABLE users ADD COLUMN require_password_change TINYINT(1) DEFAULT 0;");
      console.log("Column added successfully.");
    } else {
      console.log("Column require_password_change already exists.");
    }
  } catch (err) {
    console.error("Error updating schema:", err);
  } finally {
    pool.end();
  }
}

run();
