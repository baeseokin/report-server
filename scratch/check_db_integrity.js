const mysql = require('mysql2/promise');
const { envPick, envNumber } = require('../env');

async function checkDatabaseState() {
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
    console.log("=========================================");
    console.log("🔍 DB 결재 데이터 무결성 정밀 진단");
    console.log("=========================================\n");

    // 1. 결재진행중인데 다음 결재자 정보가 없거나 이상한 건 확인
    const [stuckList] = await pool.query(`
      SELECT id, document_type, dept_name, author, request_date, status, 
             current_approver_role, current_approver_user_id, current_order_no
        FROM approval_requests
       WHERE status = '결재진행중' 
         AND (current_approver_user_id IS NULL OR current_approver_user_id = '' OR current_order_no IS NULL)
       ORDER BY id DESC
    `);

    console.log(`1️⃣ 다음 결재자가 비어있는 '결재진행중' 문서: ${stuckList.length}건`);
    if (stuckList.length > 0) {
      console.log(JSON.stringify(stuckList, null, 2));
    } else {
      console.log("   -> 결재자가 누락된 결재진행중 문서는 없습니다.");
    }

    console.log("\n-----------------------------------------");

    // 2. 현재 모든 '결재진행중' 문서 목록 현황
    const [activeList] = await pool.query(`
      SELECT id, document_type, dept_name, author, status, 
             current_approver_role, current_approver_user_id, current_order_no
        FROM approval_requests
       WHERE status = '결재진행중'
       ORDER BY id DESC
    `);
    console.log(`2️⃣ 현재 '결재진행중' 상태인 전체 문서: ${activeList.length}건`);
    if (activeList.length > 0) {
      console.table(activeList);
    }

    console.log("\n-----------------------------------------");

    // 3. 결재선(approval_line) 설정 현황 점검
    // - 회계(1번)가 없는 부서
    // - 결재자가 1명 이하인 부서
    const [lineSummary] = await pool.query(`
      SELECT dept_name, 
             COUNT(*) as approver_count,
             GROUP_CONCAT(CONCAT(order_no, ':', approver_role, '(', approver_user_id, ')') ORDER BY order_no SEPARATOR ' -> ') as flow
        FROM approval_line
       GROUP BY dept_name
       ORDER BY dept_name
    `);
    console.log(`3️⃣ 부서별 결재선 설정 현황 (총 ${lineSummary.length}개 부서):`);
    console.table(lineSummary);

    // 4. 부서는 존재하는데 approval_line이 아예 없는 부서 확인
    const [deptsWithoutLines] = await pool.query(`
      SELECT d.id, d.dept_name 
        FROM departments d
        LEFT JOIN approval_line al ON d.dept_name = al.dept_name
       WHERE al.id IS NULL
       ORDER BY d.id
    `);
    console.log(`\n4️⃣ 결재선이 아예 등록되지 않은 부서: ${deptsWithoutLines.length}개`);
    if (deptsWithoutLines.length > 0) {
      console.table(deptsWithoutLines);
    }

  } catch (err) {
    console.error("진단 중 오류 발생:", err);
  } finally {
    process.exit();
  }
}

checkDatabaseState();
