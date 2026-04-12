const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkSchema() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306
  });

  try {
    const [rows] = await connection.query('DESCRIBE approval_requests');
    console.log('--- Columns in approval_requests ---');
    rows.forEach(row => console.log(`${row.Field}: ${row.Type}`));
    
    const hasPayee = rows.some(row => row.Field === 'payee');
    if (!hasPayee) {
      console.log('\n❌ payee column is MISSING!');
      console.log('Attempting to add column...');
      await connection.query('ALTER TABLE approval_requests ADD COLUMN payee VARCHAR(100) AFTER author');
      console.log('✅ Column added successfully.');
    } else {
      console.log('\n✅ payee column EXISTS.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await connection.end();
  }
}

checkSchema();
