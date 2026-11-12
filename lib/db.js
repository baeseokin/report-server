// DB 연결 풀 및 서버 시작 시 스키마 보정
const mysql = require("mysql2/promise");
const { envPick, envNumber } = require("../env");

const dbConfig = {
  host: envPick("DB_HOST", "localhost"),
  port: envNumber("DB_PORT", 3306),
  user: envPick("DB_USER", "root"),
  password: envPick("DB_PASSWORD", ""),
  database: envPick("DB_NAME", "test"),
};

const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: envNumber("DB_CONN_LIMIT", 10),
  queueLimit: 0,
  dateStrings: true,
  timezone: envPick("DB_TIMEZONE", "Z"),
});

// ✅ DB 스키마 자동 보정 (payee 컬럼 누락 시 추가 등) — 서버 시작 시 1회 실행
async function runStartupMigrations() {
  try {
    const [rows] = await pool.query("DESCRIBE approval_requests");
    const hasPayee = rows.some(r => r.Field === 'payee');
    if (!hasPayee) {
      console.log("🛠 [Migration] approval_requests 테이블에 payee 컬럼이 없어 추가합니다.");
      await pool.query("ALTER TABLE approval_requests ADD COLUMN payee VARCHAR(100) AFTER author");
      console.log("✅ [Migration] payee 컬럼 추가 완료");
    }
    const hasRemarks = rows.some(r => r.Field === 'remarks');
    if (!hasRemarks) {
      console.log("🛠 [Migration] approval_requests 테이블에 remarks 컬럼이 없어 추가합니다.");
      await pool.query("ALTER TABLE approval_requests ADD COLUMN remarks TEXT AFTER comment");
      console.log("✅ [Migration] remarks 컬럼 추가 완료");
    }

    // 메뉴명 변경 보정: '지급내역 조회' -> '지출내역 조회'
    await pool.query("UPDATE IGNORE role_access SET menu_name = '지출내역 조회' WHERE menu_name = '지급내역 조회'");
    await pool.query("DELETE FROM role_access WHERE menu_name = '지급내역 조회'");
    await pool.query("UPDATE IGNORE user_favorites SET menu_name = '지출내역 조회' WHERE menu_name = '지급내역 조회'");
    await pool.query("DELETE FROM user_favorites WHERE menu_name = '지급내역 조회'");
  } catch (err) {
    console.error("❌ [Migration] 스키마 확인 중 오류:", err.message);
  }
}

module.exports = { pool, dbConfig, runStartupMigrations };
