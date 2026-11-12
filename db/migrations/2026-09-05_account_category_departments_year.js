// [적용 완료] account_category_departments 에 회계연도(year) 컬럼 추가 및 PK 변경
// 실행: node db/migrations/2026-09-05_account_category_departments_year.js  (.env 의 DB 설정 사용)
const { pool } = require("../../lib/db");

async function migrate() {
  
  const conn = await pool.getConnection();
  try {
    console.log("Starting DB migration...");
    
    // 1. Add year column if it doesn't exist (Catch error if it exists)
    try {
      await conn.query(`ALTER TABLE account_category_departments ADD COLUMN year INT;`);
      console.log("Column 'year' added.");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("Column 'year' already exists, continuing...");
      } else {
        throw e;
      }
    }

    // 2. Update existing rows to 2026 where year is null
    const [result] = await conn.query(`UPDATE account_category_departments SET year = 2026 WHERE year IS NULL;`);
    console.log(`Updated ${result.affectedRows} rows to year 2026.`);

    // 3. Make year column NOT NULL
    try {
        await conn.query(`ALTER TABLE account_category_departments MODIFY COLUMN year INT NOT NULL;`);
        console.log("Column 'year' set to NOT NULL.");
    } catch(e) {
        console.log(e);
    }
    

    // 4. Update Primary Key
    try {
      await conn.query(`ALTER TABLE account_category_departments DROP PRIMARY KEY;`);
    } catch (e) {
      console.log("No existing primary key or drop failed, continuing...");
    }
    
    try {
      await conn.query(`ALTER TABLE account_category_departments ADD PRIMARY KEY (year, account_category_id, dept_id);`);
      console.log("Primary key updated to include year.");
    } catch (e) {
       console.log("Primary key might already exist, ignoring...", e.message);
    }
    
    console.log("Migration complete.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
