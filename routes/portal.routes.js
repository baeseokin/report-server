// 포털(홈) 요약
const express = require("express");
const { pool } = require("../lib/db");

const router = express.Router();


/* ------------------------------------------------
   ✅ 포탈 초화면 요약 API
------------------------------------------------ */
router.get("/api/portal/summary", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }
  try {
    const userId = req.session.user.userId;
    const isFinance = req.session.user?.deptName === "재정부";
    const deptName = req.session.user?.deptName;
    const { startDate, endDate } = req.query;

    // 날짜 조건 생성 (조회조건이 있으면 반영, 없으면 기본 1개월 전부터 현재까지)
    let dateWhere = "";
    const dateParams = [];

    if (startDate) {
      dateWhere += " AND ar.request_date >= ?";
      dateParams.push(startDate);
    } else {
      dateWhere += " AND ar.request_date >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)";
    }

    if (endDate) {
      dateWhere += " AND ar.request_date <= CONCAT(?, ' 23:59:59')";
      dateParams.push(endDate);
    }

    // 소속 부서 ID 확보
    const [[deptInfo]] = await pool.query("SELECT id FROM departments WHERE dept_name = ?", [deptName]);
    const requestedDeptId = deptInfo?.id;

    // 1. 공통 부서 및 기간 정보 확보
    const effectiveRoot = isFinance ? "교회" : deptName;
    const [subDepts] = await pool.query(
      `WITH RECURSIVE sub_depts AS (
        SELECT id, dept_name, parent_dept_id FROM departments WHERE dept_name = ?
        UNION ALL
        SELECT d.id, d.dept_name, d.parent_dept_id FROM departments d
        INNER JOIN sub_depts sd ON d.parent_dept_id = sd.id
      ) SELECT dept_name FROM sub_depts`,
      [effectiveRoot]
    );

    const deptList = subDepts.map((d) => d.dept_name);
    const deptPlaceholder = deptList.map(() => "?").join(",");

    // 2. 전체 청구 건수 (날짜 필터 + 조직 기반 + 예산 할당 기반)
    let baseWhere = `(ar.dept_name IN (${deptPlaceholder})`;
    let baseParams = [...deptList];

    if (requestedDeptId) {
      baseWhere += ` OR ar.category_hang IN (
        SELECT ac.category_id FROM account_categories ac
        JOIN account_category_departments acd ON ac.id = acd.account_category_id
        WHERE acd.dept_id = ?
      )`;
      baseParams.push(requestedDeptId);
    }
    baseWhere += ") AND ar.document_type != '가청구건'";

    const [[{ approvalCount }]] = await pool.query(
      `SELECT COUNT(*) AS approvalCount FROM approval_requests ar 
       WHERE ${baseWhere} ${dateWhere}`,
      [...baseParams, ...dateParams]
    );

    // 3. 내 결재 대기 건수 및 최근 목록 (상세 페이지의 필터링 로직과 동기화)
    let myApprovalWhere = "";
    let myApprovalParams = [];

    if (isFinance) {
      // 재정부: (전체 건 중 결재진행중/결재완료) + (타부서 건 중 결재완료)
      // (이미 baseWhere가 교회 전체를 포함하고 있으므로 필터만 적용)
      myApprovalWhere = `
        WHERE ${baseWhere}
        AND (
          (ar.dept_name = '재정부' AND ar.status IN ('결재진행중', '결재완료'))
          OR (ar.dept_name != '재정부' AND ar.status = '결재완료')
        )
      `;
      myApprovalParams = [...baseParams];
    } else {
      // 일반: 소속 부서군 내 본인이 현재 결재자인 건 (다중 결재자 지원)
      myApprovalWhere = `
        WHERE ${baseWhere}
        AND FIND_IN_SET(?, ar.current_approver_user_id) > 0 
        AND ar.status = '결재진행중'
      `;
      myApprovalParams = [...baseParams, userId];
    }

    const [[{ myApprovalCount }]] = await pool.query(
      `SELECT COUNT(*) AS myApprovalCount FROM approval_requests ar ${myApprovalWhere} ${dateWhere}`,
      [...myApprovalParams, ...dateParams]
    );

    const [myApprovalRecent] = await pool.query(
      `SELECT ar.id, ar.dept_name, ar.document_type, ar.request_date, ar.total_amount, ar.status, ar.author, ar.aliasName
       FROM approval_requests ar 
       ${myApprovalWhere} ${dateWhere}
       ORDER BY ar.request_date DESC, ar.id DESC LIMIT 5`,
      [...myApprovalParams, ...dateParams]
    );

    // 읽지 않은 공지사항 카운트
    const [[{ unreadNoticeCount }]] = await pool.query(`
      SELECT COUNT(*) AS unreadNoticeCount 
      FROM notices n
      WHERE n.id NOT IN (SELECT notice_id FROM notice_views WHERE user_id = ?)
    `, [userId]);
    const [noticeRecent] = await pool.query(
      "SELECT id, title, created_at FROM notices ORDER BY created_at DESC LIMIT 5"
    );

    // 읽지 않은 게시글 카운트
    const [[{ unreadBoardCount }]] = await pool.query(`
      SELECT COUNT(*) AS unreadBoardCount 
      FROM boards b
      WHERE b.id NOT IN (SELECT board_id FROM board_views WHERE user_id = ?)
    `, [userId]);
    const [boardRecent] = await pool.query(
      `SELECT b.id, b.title, b.author_name, b.created_at,
              (SELECT COUNT(*) FROM board_comments WHERE board_id = b.id) AS comment_count
       FROM boards b ORDER BY b.created_at DESC LIMIT 5`
    );

    // 청구목록 최근5개 (날짜 필터 + 조직 기반)
    const [approvalRecent] = await pool.query(
      `SELECT ar.id, ar.dept_name, ar.document_type, ar.request_date, ar.total_amount, ar.status 
       FROM approval_requests ar 
       WHERE ar.dept_name IN (${deptPlaceholder}) ${dateWhere}
       ORDER BY ar.request_date DESC, ar.id DESC LIMIT 5`,
      [...deptList, ...dateParams]
    );

    res.json({
      success: true,
      data: {
        approvalCount,
        myApprovalCount,
        unreadNoticeCount,
        unreadBoardCount,
        noticeRecent,
        boardRecent,
        approvalRecent,
        myApprovalRecent,
      }
    });
  } catch (err) {
    console.error("❌ 포탈 요약 조회 실패:", err);
    res.status(500).json({ success: false, message: "포탈 요약 조회 실패" });
  }
});

module.exports = router;
