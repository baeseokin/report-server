// 결재 목록 · 지출내역 조회
const express = require("express");
const { pool } = require("../lib/db");
const { isAdmin } = require("../lib/auth");

const router = express.Router();




/* ------------------------------------------------
   ✅ 결재 목록 조회 API
------------------------------------------------ */
router.post("/api/approvalList", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { deptName: rawDeptName, documentType, startDate, endDate, status, keyword, selectedGwan, selectedHang, page = 1, pageSize = 10 } = req.body;
    const deptName = rawDeptName?.trim();

    let where = "WHERE 1=1";
    const params = [];

    if (keyword) {
      const k = `%${keyword}%`;
      where += ` AND (
        ar.aliasName LIKE ? OR 
        ar.author LIKE ? OR 
        ar.payee LIKE ? OR 
        EXISTS (SELECT 1 FROM approval_items ai WHERE ai.request_id = ar.id AND ai.detail LIKE ?)
      )`;
      params.push(k, k, k, k);
    }

    // ✅ 1. 검색 대상 부서의 ID 및 정확한 부서명 조회
    const [[deptInfo]] = await pool.query("SELECT id, dept_name FROM departments WHERE dept_name = ?", [deptName]);
    const requestedDeptId = deptInfo?.id;
    const requestedDeptName = deptInfo?.dept_name || deptName;

    // ✅ 2. 전체 조회 권한 확인 (로그인 사용자 기준: 재정부, 교회, 관리자)
    const sessionDeptName = req.session.user?.deptName;
    const currentUserName = req.session.user?.userName;
    const isFullAccessUser = (sessionDeptName === "교회" || sessionDeptName === "재정부" || isAdmin(req));

    // 검색 대상 부서가 "교회", "재정부"이거나 없는 경우 전체 조회로 간주
    const isSearchAll = !requestedDeptName || requestedDeptName === "전체" || requestedDeptName === "교회" || requestedDeptName === "재정부";

    let deptList = [];
    if (!isSearchAll) {
      // 특정 부서가 지정된 경우: 해당 부서 + 하위부서 재귀 조회
      const [subDepts] = await pool.query(
        `WITH RECURSIVE sub_depts AS (
          SELECT id, dept_name, parent_dept_id
          FROM departments
          WHERE dept_name = ?
          UNION ALL
          SELECT d.id, d.dept_name, d.parent_dept_id
          FROM departments d
          INNER JOIN sub_depts sd ON d.parent_dept_id = sd.id
        )
        SELECT dept_name FROM sub_depts`,
        [requestedDeptName]
      );
      deptList = subDepts.map(d => d.dept_name);
    } else if (!isFullAccessUser && sessionDeptName) {
      // 일반 사용자가 부서를 지정하지 않은 경우: 본인 소속 부서 + 하위부서로 제한
      const [subDepts] = await pool.query(
        `WITH RECURSIVE sub_depts AS (
          SELECT id, dept_name, parent_dept_id
          FROM departments
          WHERE dept_name = ?
          UNION ALL
          SELECT d.id, d.dept_name, d.parent_dept_id
          FROM departments d
          INNER JOIN sub_depts sd ON d.parent_dept_id = sd.id
        )
        SELECT dept_name FROM sub_depts`,
        [sessionDeptName]
      );
      deptList = subDepts.map(d => d.dept_name);
    }

    let whereParts = [];

    // ✅ 3. 부서 및 하위부서 조건 추가
    if (deptList.length > 0) {
      whereParts.push(`ar.dept_name IN (${deptList.map(() => "?").join(",")})`);
      params.push(...deptList);
    }

    // ✅ 본인이 작성한 건(ar.author = ?)도 함께 조회되도록 OR 조건 부여 (일반 사용자만)
    if (!isFullAccessUser && currentUserName) {
      whereParts.push("ar.author = ?");
      params.push(currentUserName);
    }

    // ✅ 4. 부서 관련 조건들을 하나로 처리
    if (whereParts.length > 0) {
      where += ` AND (${whereParts.join(" OR ")})`;
    }

    if (documentType) {
      where += " AND ar.document_type = ?";
      params.push(documentType);
    } else {
      where += " AND ar.document_type != '가청구건'";
    }
    if (startDate) {
      where += " AND ar.request_date >= ?";
      params.push(startDate);
    }
    if (endDate) {
      // ✅ 종료일의 밤 11:59:59까지 포함하도록 처리 (DATETIME 필드 대응)
      where += " AND ar.request_date <= CONCAT(?, ' 23:59:59')";
      params.push(endDate);
    }

    // ✅ 관/항 검색 조건 추가
    if (selectedGwan) {
      where += " AND ar.category_gwan = ?";
      params.push(selectedGwan);
    }
    if (selectedHang) {
      where += " AND ar.category_hang = ?";
      params.push(selectedHang);
    }

    // ✅ 진행상태 및 권한별 필터링 (홈 화면 summary 로직과 동기화)
    const isFinance = req.session.user?.deptName === "재정부";
    const userId = req.session.user?.userId;

    if (status === "결재대기") {
      // 상세 화면 최초 진입 시 홈 화면 배지와 동일한 '결재 대기' 항목만 조회
      if (isFinance) {
        where += ` AND (
          (ar.dept_name = '재정부' AND ar.status IN ('결재진행중', '결재완료'))
          OR (ar.dept_name != '재정부' AND ar.status = '결재완료')
        )`;
      } else {
        where += " AND FIND_IN_SET(?, ar.current_approver_user_id) > 0 AND ar.status = '결재진행중'";
        params.push(userId);
      }
    } else if (status && status !== "전체") {
      where += " AND ar.status = ?";
      params.push(status);
    } else {
      // ✅ 전체 조회 시: 결재 상신 전인 임시저장(작성중) 건은 청구목록에 노출하지 않음
      where += " AND ar.status NOT IN ('작성중', '임시저장')";
    }

    const [[{ count, totalAmount }]] = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(ar.total_amount), 0) as totalAmount FROM approval_requests ar ${where}`,
      params
    );

    console.log("where :", where);

    const totalPages = Math.ceil(count / pageSize);
    const offset = (page - 1) * pageSize;

    const [rows] = await pool.query(
      `SELECT ar.id, ar.dept_name, ar.document_type, ar.request_date, ar.total_amount, 
              ar.author, ar.payee, ar.aliasName, ar.status, ar.current_approver_role, ar.current_approver_user_id, 
              ar.category_gwan as selectedGwan, ar.category_hang as selectedHang,
              cg.category_name as gwanName, ch.category_name as hangName,
              (SELECT COUNT(*) FROM approval_history WHERE request_id = ar.id) as historyCount,
              (SELECT COUNT(*) FROM approval_files WHERE request_id = ar.id) as fileCount
       FROM approval_requests ar
       LEFT JOIN account_categories cg ON ar.category_gwan = cg.category_id
       LEFT JOIN account_categories ch ON ar.category_hang = ch.category_id
       ${where}
       ORDER BY ar.request_date DESC, ar.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({ success: true, rows, totalPages, totalCount: count, totalAmount: Number(totalAmount || 0) });
  } catch (err) {
    console.error("❌ DB Select Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------
   ✅ 지출내역 조회 API (재정부이관완료 건 대상)
------------------------------------------------ */
router.post("/api/paymentHistory", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const {
      deptName: rawDeptName,
      startDate,
      endDate,
      selectedGwan,
      selectedHang,
      keyword,
      page = 1,
      pageSize = 15,
      isExcel = false
    } = req.body;

    const deptName = rawDeptName?.trim();

    // 재정부이관완료 건 대상 (예산편성서 제외)
    let where = "WHERE ar.status = '재정부이관완료' AND ar.document_type != '예산편성서'";
    const params = [];

    // ✅ 권한 확인: 재정부, 교회, 관리자는 전체 또는 특정 부서 선택 가능, 그 외 사용자는 본인 부서로 한정
    const sessionDeptName = req.session.user?.deptName;
    const isFullAccessUser = (sessionDeptName === "교회" || sessionDeptName === "재정부" || isAdmin(req));

    let targetDeptName = deptName;
    if (!isFullAccessUser) {
      targetDeptName = sessionDeptName;
    }

    const isSearchAll = isFullAccessUser && (!targetDeptName || targetDeptName === "전체" || targetDeptName === "교회");

    if (!isSearchAll && targetDeptName) {
      // 특정 부서가 지정된 경우: 해당 부서 + 하위부서 재귀 조회
      const [subDepts] = await pool.query(
        `WITH RECURSIVE sub_depts AS (
          SELECT id, dept_name, parent_dept_id
          FROM departments
          WHERE dept_name = ?
          UNION ALL
          SELECT d.id, d.dept_name, d.parent_dept_id
          FROM departments d
          INNER JOIN sub_depts sd ON d.parent_dept_id = sd.id
        )
        SELECT dept_name FROM sub_depts`,
        [targetDeptName]
      );
      const deptList = subDepts.map(d => d.dept_name);
      if (deptList.length > 0) {
        where += ` AND ar.dept_name IN (${deptList.map(() => "?").join(",")})`;
        params.push(...deptList);
      } else {
        where += " AND ar.dept_name = ?";
        params.push(targetDeptName);
      }
    } else if (!isFullAccessUser && sessionDeptName) {
      where += " AND ar.dept_name = ?";
      params.push(sessionDeptName);
    }

    // 날짜 조건 (신청일자)
    if (startDate) {
      where += " AND ar.request_date >= ?";
      params.push(startDate);
    }
    if (endDate) {
      where += " AND ar.request_date <= CONCAT(?, ' 23:59:59')";
      params.push(endDate);
    }

    // 관 / 항 조건
    if (selectedGwan) {
      where += " AND (ai.gwan = ? OR ar.category_gwan = ?)";
      params.push(selectedGwan, selectedGwan);
    }
    if (selectedHang) {
      where += " AND (ai.hang = ? OR ar.category_hang = ?)";
      params.push(selectedHang, selectedHang);
    }

    // 검색어 조건 (지급내역, 신청자)
    if (keyword && keyword.trim()) {
      const k = `%${keyword.trim()}%`;
      where += " AND (ai.detail LIKE ? OR ar.author LIKE ?)";
      params.push(k, k);
    }

    // 건수 및 합계 금액
    const [[{ count, totalAmount }]] = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(ai.amount), 0) as totalAmount
       FROM approval_items ai
       JOIN approval_requests ar ON ai.request_id = ar.id
       ${where}`,
      params
    );

    let rows = [];
    let totalPages = 1;

    const baseSelectSql = `
      SELECT ai.id as item_id, ai.request_id, ai.detail, ai.amount,
             ai.mok, ai.semok,
             ar.dept_name, ar.request_date, ar.author, ar.status, ar.payee, ar.aliasName,
             COALESCE(cg.category_name, ai.gwan, ar.category_gwan) as gwan_name,
             COALESCE(ch.category_name, ai.hang, ar.category_hang) as hang_name,
             COALESCE(cm.category_name, ai.mok) as mok_name,
             COALESCE(cs.category_name, ai.semok) as semok_name
      FROM approval_items ai
      JOIN approval_requests ar ON ai.request_id = ar.id
      LEFT JOIN account_categories cg ON COALESCE(ai.gwan, ar.category_gwan) = cg.category_id
      LEFT JOIN account_categories ch ON COALESCE(ai.hang, ar.category_hang) = ch.category_id
      LEFT JOIN account_categories cm ON ai.mok = cm.category_id
      LEFT JOIN account_categories cs ON ai.semok = cs.category_id
      ${where}
      ORDER BY ar.request_date DESC, ai.id DESC
    `;

    if (isExcel) {
      [rows] = await pool.query(baseSelectSql, params);
      totalPages = 1;
    } else {
      const limit = Number(pageSize) || 15;
      const currentPage = Math.max(1, Number(page) || 1);
      totalPages = Math.ceil(count / limit) || 1;
      const offset = (currentPage - 1) * limit;

      [rows] = await pool.query(`${baseSelectSql} LIMIT ? OFFSET ?`, [...params, limit, offset]);
    }

    res.json({
      success: true,
      rows,
      totalPages,
      totalCount: count,
      totalAmount: Number(totalAmount || 0)
    });
  } catch (err) {
    console.error("❌ /api/paymentHistory 에러:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
