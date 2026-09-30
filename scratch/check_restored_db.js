const mysql = require('mysql2/promise');
const { envPick, envNumber } = require('../env');

async function checkRestoredDatabase() {
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
    console.log("===============================================================");
    console.log("🔍 [Restore 완료 후] DB 정밀 무결성 점검 보고서");
    console.log("===============================================================\n");

    // 1. 상태별 문서 수 확인
    const [statusCounts] = await pool.query(`
      SELECT status, COUNT(*) as count 
        FROM approval_requests 
       GROUP BY status
    `);
    console.log("1️⃣ 문서 상태별 건수:");
    console.table(statusCounts);

    // 2. 결재진행중 문서 점검 (결재자 누락, 이상 데이터)
    const [stuckList] = await pool.query(`
      SELECT id, document_type, dept_name, author, request_date, status, 
             current_approver_role, current_approver_user_id, current_order_no
        FROM approval_requests
       WHERE status = '결재진행중' 
         AND (current_approver_user_id IS NULL OR current_approver_user_id = '' OR current_order_no IS NULL)
       ORDER BY id DESC
    `);
    console.log(`2️⃣ 다음 결재자가 누락/NULL인 '결재진행중' 문서: ${stuckList.length}건`);
    if (stuckList.length > 0) {
      console.table(stuckList);
    }

    // 3. 결재진행중 문서 전체 목록 및 결재선 일치 여부 확인
    const [activeList] = await pool.query(`
      SELECT ar.id, ar.dept_name, ar.author, ar.request_date,
             ar.current_approver_role, ar.current_approver_user_id, ar.current_order_no,
             (SELECT COUNT(*) FROM approval_history WHERE request_id = ar.id) as history_count
        FROM approval_requests ar
       WHERE ar.status = '결재진행중'
       ORDER BY ar.id DESC
    `);
    console.log(`\n3️⃣ 현재 '결재진행중'인 모든 문서 상세 (${activeList.length}건):`);
    if (activeList.length > 0) {
      console.table(activeList);
    }

    // 4. 결재진행중 문서의 current_approver_user_id가 users 테이블에 실제로 있는지
    const [invalidApprovers] = await pool.query(`
      SELECT ar.id, ar.dept_name, ar.author, ar.current_approver_user_id
        FROM approval_requests ar
       WHERE ar.status = '결재진행중'
         AND ar.current_approver_user_id NOT IN (SELECT user_id FROM users)
    `);
    console.log(`\n4️⃣ 결재진행중 문서 중 결재자 ID가 users 테이블에 없는 비정상 문서: ${invalidApprovers.length}건`);
    if (invalidApprovers.length > 0) {
      console.table(invalidApprovers);
    }

    // 5. approval_line 점검: users 테이블에 없는 approver_user_id가 있는지
    const [invalidLineUsers] = await pool.query(`
      SELECT al.id, al.dept_name, al.approver_role, al.approver_user_id, al.order_no
        FROM approval_line al
        LEFT JOIN users u ON al.approver_user_id = u.user_id
       WHERE u.user_id IS NULL
    `);
    console.log(`\n5️⃣ 결재선(approval_line) 중 존재하지 않는 사용자 ID 등록건: ${invalidLineUsers.length}건`);
    if (invalidLineUsers.length > 0) {
      console.table(invalidLineUsers);
    }

    // 6. approval_line 점검: 부서별 동일 order_no 중복 등록 여부
    const [duplicateOrders] = await pool.query(`
      SELECT dept_name, order_no, COUNT(*) as cnt, GROUP_CONCAT(approver_role) as roles, GROUP_CONCAT(approver_user_id) as user_ids
        FROM approval_line
       GROUP BY dept_name, order_no
      HAVING COUNT(*) > 1
    `);
    console.log(`\n6️⃣ 결재선 내 동일 순번(order_no) 중복 등록 여부 (공동결재 여부): ${duplicateOrders.length}건`);
    if (duplicateOrders.length > 0) {
      console.table(duplicateOrders);
    }

    // 7. approval_line 점검: 부서별 전체 결재선 흐름 목록
    const [lineFlows] = await pool.query(`
      SELECT dept_name, 
             COUNT(*) as approver_count,
             MIN(order_no) as min_order,
             MAX(order_no) as max_order,
             GROUP_CONCAT(CONCAT(order_no, ':', approver_role, '(', approver_user_id, ')') ORDER BY order_no SEPARATOR ' -> ') as flow
        FROM approval_line
       GROUP BY dept_name
       ORDER BY dept_name
    `);
    console.log(`\n7️⃣ 부서별 결재선 흐름 현황 (총 ${lineFlows.length}개 부서):`);
    console.table(lineFlows);

  } catch (err) {
    console.error("진단 중 에러 발생:", err);
  } finally {
    process.exit();
  }
}

checkRestoredDatabase();
