const mysql = require('mysql2/promise');
const { envPick, envNumber } = require('../env');

async function runTests() {
  const pool = mysql.createPool({
    host: envPick("DB_HOST", "localhost"),
    port: envNumber("DB_PORT", 3306),
    user: envPick("DB_USER", "root"),
    password: envPick("DB_PASSWORD", ""),
    database: envPick("DB_NAME", "test"),
    waitForConnections: true,
    connectionLimit: envNumber("DB_CONN_LIMIT", 5),
    queueLimit: 0,
    dateStrings: true,
  });

  const conn = await pool.getConnection();

  console.log("=========================================");
  console.log("🧪 결재선 로직 및 예외 처리 검증 테스트 시작");
  console.log("=========================================\n");

  let passed = 0;
  let failed = 0;

  try {
    // ----------------------------------------------------------------
    // 테스트 1: 기안자가 결재선에 없는 경우 에러 발생 확인
    // ----------------------------------------------------------------
    console.log("▶ [Test 1] 기안자가 결재선에 등록되어 있지 않은 경우");
    try {
      const deptName = "음악부";
      const ghostUserId = "non_existent_user_999";
      const author = "미등록기안자";

      const [applicantRows] = await conn.query(
        `SELECT order_no 
           FROM approval_line 
          WHERE dept_name = ? AND approver_user_id = ?
          LIMIT 1`,
        [deptName, ghostUserId]
      );

      if (applicantRows.length === 0) {
        throw new Error(`${deptName} 부서의 결재선에 기안자(${author || ghostUserId})가 등록되어 있지 않습니다. 결재선 관리에서 담당자 등록 후 다시 시도해 주세요.`);
      }

      console.log("❌ Test 1 실패: 에러가 발생하지 않음");
      failed++;
    } catch (err) {
      if (err.message.includes("결재선에 기안자")) {
        console.log("✅ Test 1 성공: 의도한 에러 정상 발생 ->", err.message);
        passed++;
      } else {
        console.log("❌ Test 1 실패: 예상과 다른 에러 발생 ->", err.message);
        failed++;
      }
    }

    console.log("\n-------------------------------------------------");

    // ----------------------------------------------------------------
    // 테스트 2: 정상 기안자가 상신할 때 다음 결재자 탐색 (음악부 회계 mus001)
    // ----------------------------------------------------------------
    console.log("▶ [Test 2] 정상 기안자가 상신할 때 다음 결재자(부장) 지정 확인");
    try {
      const deptName = "음악부";
      const userId = "mus001"; // 회계 (order_no: 1)

      const [applicantRows] = await conn.query(
        `SELECT order_no 
           FROM approval_line 
          WHERE dept_name = ? AND approver_user_id = ?
          LIMIT 1`,
        [deptName, userId]
      );

      if (applicantRows.length === 0) {
        throw new Error("기안자 미등록");
      }

      const applicantOrder = applicantRows[0].order_no;

      const [[nextOrderRow]] = await conn.query(
        `SELECT MIN(order_no) AS next_order_no
           FROM approval_line
          WHERE dept_name = ? AND order_no > ?`,
        [deptName, applicantOrder]
      );

      const nextOrderNo = nextOrderRow?.next_order_no;
      const [nextRows] = await conn.query(
        `SELECT approver_role, approver_user_id, order_no 
           FROM approval_line 
          WHERE dept_name = ? AND order_no = ?`,
        [deptName, nextOrderNo]
      );

      console.log(`   기안자 순번: ${applicantOrder} (회계)`);
      console.log(`   다음 결재 순번: ${nextOrderNo}`);
      console.log(`   다음 결재자:`, nextRows.map(r => `${r.approver_role}(${r.approver_user_id})`).join(', '));

      if (nextOrderNo === 2 && nextRows.some(r => r.approver_role === "부장")) {
        console.log("✅ Test 2 성공: 회계 상신 후 다음 결재자로 부장이 정상 지정됨");
        passed++;
      } else {
        console.log("❌ Test 2 실패: 다음 결재자 지정 불일치");
        failed++;
      }
    } catch (err) {
      console.log("❌ Test 2 실패:", err.message);
      failed++;
    }

    console.log("\n-------------------------------------------------");

    // ----------------------------------------------------------------
    // 테스트 3: 순번 공백(갭) 건너뛰기 테스트 (순번 1 다음 바로 3이 있는 가상 시나리오)
    // ----------------------------------------------------------------
    console.log("▶ [Test 3] 순번 공백(갭: 1번 다음 3번) 건너뛰기 탐색 확인");
    try {
      await conn.beginTransaction();

      // 임시 테스트 부서 및 결재선 (1번, 3번만 존재)
      const testDept = "__TEST_GAP_DEPT__";
      await conn.query("DELETE FROM approval_line WHERE dept_name = ?", [testDept]);
      await conn.query(
        `INSERT INTO approval_line (dept_name, approver_role, approver_user_id, order_no)
         VALUES (?, '회계', 'test_acc', 1), (?, '위원장', 'test_chair', 3)`,
        [testDept, testDept]
      );

      // 1번(회계)이 상신할 때
      const currentOrder = 1;
      const [[nextOrderRow]] = await conn.query(
        `SELECT MIN(order_no) AS next_order_no
           FROM approval_line
          WHERE dept_name = ? AND order_no > ?`,
        [testDept, currentOrder]
      );

      const nextOrderNo = nextOrderRow?.next_order_no;
      const [nextRows] = await conn.query(
        `SELECT approver_role, approver_user_id 
           FROM approval_line 
          WHERE dept_name = ? AND order_no = ?`,
        [testDept, nextOrderNo]
      );

      console.log(`   순번: 1번 다음 바로 존재하는 순번 -> ${nextOrderNo}`);
      console.log(`   조회된 결재자:`, nextRows.map(r => `${r.approver_role}(${r.approver_user_id})`).join(', '));

      if (nextOrderNo === 3 && nextRows[0]?.approver_role === "위원장") {
        console.log("✅ Test 3 성공: 2번이 비어있어도 3번(위원장)을 정상적으로 찾아 지정함");
        passed++;
      } else {
        console.log("❌ Test 3 실패: 갭 건너뛰기 실패");
        failed++;
      }

      await conn.rollback(); // 테스트 데이터 원복
    } catch (err) {
      await conn.rollback();
      console.log("❌ Test 3 실패:", err.message);
      failed++;
    }

    console.log("\n-------------------------------------------------");

    // ----------------------------------------------------------------
    // 테스트 4: Owner 부서 위원장 직행 시 위원장 미등록 에러 검증
    // ----------------------------------------------------------------
    console.log("▶ [Test 4] Owner 부서 위원장 직행 시 위원장 부재 에러 확인");
    try {
      await conn.beginTransaction();

      const testNoChairDept = "__TEST_NO_CHAIR_DEPT__";
      await conn.query("DELETE FROM approval_line WHERE dept_name = ?", [testNoChairDept]);
      await conn.query(
        `INSERT INTO approval_line (dept_name, approver_role, approver_user_id, order_no)
         VALUES (?, '회계', 'test_acc', 1), (?, '부장', 'test_dir', 2)`,
        [testNoChairDept, testNoChairDept]
      );

      const [chairmanRows] = await conn.query(
        `SELECT approver_role, approver_user_id, order_no
           FROM approval_line 
          WHERE dept_name = ? AND approver_role = '위원장'`,
        [testNoChairDept]
      );

      if (chairmanRows.length === 0) {
        throw new Error(`${testNoChairDept} 부서에 '위원장' 결재선이 등록되어 있지 않습니다. 결재선 설정을 확인해 주세요.`);
      }

      console.log("❌ Test 4 실패: 에러가 발생하지 않음");
      failed++;
      await conn.rollback();
    } catch (err) {
      await conn.rollback();
      if (err.message.includes("'위원장' 결재선이 등록되어 있지 않습니다")) {
        console.log("✅ Test 4 성공: 위원장 부재 시 의도한 에러 정상 발생 ->", err.message);
        passed++;
      } else {
        console.log("❌ Test 4 실패: 예상과 다른 에러 발생 ->", err.message);
        failed++;
      }
    }

    console.log("\n=========================================");
    console.log(`📊 테스트 결과: ${passed}개 성공 / ${failed}개 실패`);
    console.log("=========================================");

  } finally {
    conn.release();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
