// 가청구건(초기 기지출액) 등록
//   시스템 도입 이전에 이미 지출한 금액을 계정(항)별로 일괄 입력하는 재정부용 기능입니다.
//   화면: InitialExpenseInput(PC/모바일)
const express = require("express");
const { getSystemYear } = require("../env");
const { pool } = require("../lib/db");
const { isAdmin, isFinance } = require("../lib/auth");

const router = express.Router();

const MENU_NAME = "가청구건 등록";

/**
 * 사용 권한: 재정부 · 관리자, 또는 관리자가 '가청구건 등록' 메뉴 권한을 준 역할
 */
async function requireInitialExpenseAccess(req, res, next) {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }
  if (isFinance(req) || isAdmin(req) || user.roles?.some(r => r.role_name === "재정부")) {
    return next();
  }
  try {
    const roleIds = (user.roles || []).map(r => r.id).filter(Boolean);
    if (roleIds.length > 0) {
      const [rows] = await pool.query(
        `SELECT 1 FROM role_access WHERE role_id IN (?) AND menu_name = ? AND access_type = 'all' LIMIT 1`,
        [roleIds, MENU_NAME]
      );
      if (rows.length > 0) return next();
    }
    return res.status(403).json({ success: false, message: "접근 권한이 없습니다." });
  } catch (err) {
    console.error("❌ 가청구건 권한 확인 실패:", err);
    return res.status(500).json({ success: false, message: "권한 확인 중 오류가 발생했습니다." });
  }
}

/* ------------------------------------------------
   가청구건(기지출액) 전체 항목 조회 API (전사)
   GET /api/initial-expenses?year=2025
   (이전 경로 /api/initial-expenses-data 는 화면 배포 전까지 호환용으로 유지)
------------------------------------------------ */
router.get(["/api/initial-expenses", "/api/initial-expenses-data"], requireInitialExpenseAccess, async (req, res) => {
  try {
    const year = req.query.year || getSystemYear();
    const [rows] = await pool.query(
      `WITH RECURSIVE category_descendants (root_category_id, id, category_id) AS (
           SELECT category_id, id, category_id FROM account_categories WHERE level = '항'
           UNION ALL
           SELECT cd.root_category_id, ac.id, ac.category_id
           FROM account_categories ac
           JOIN category_descendants cd ON ac.parent_id = cd.id
       ),
       budget_agg AS (
           SELECT cd.root_category_id, SUM(b.budget_amount) as budget_amount
           FROM category_descendants cd
           JOIN budgets b ON cd.category_id = b.category_id
           WHERE b.year = ?
           GROUP BY cd.root_category_id
       ),
       expense_agg AS (
           SELECT cd.root_category_id, 
                  SUM(CASE WHEN ed.description = '초기 기지출액' THEN ed.amount ELSE 0 END) as initial_expense,
                  SUM(CASE WHEN ed.description != '초기 기지출액' THEN ed.amount ELSE 0 END) as system_expense
           FROM category_descendants cd
           JOIN expense_details ed ON cd.category_id = ed.category_id
           WHERE ed.year = ?
           GROUP BY cd.root_category_id
       )
       SELECT h.category_id, h.category_name, h.parent_id, g.category_name as gwan_name, h.owner_dept_id, d.dept_name as owner_dept_name,
              COALESCE(b.budget_amount, 0) as budget,
              COALESCE(e.system_expense, 0) as system_expense,
              COALESCE(e.initial_expense, 0) as initial_expense
       FROM account_categories h
       LEFT JOIN account_categories g ON h.parent_id = g.id AND g.level = '관'
       LEFT JOIN departments d ON h.owner_dept_id = d.id
       LEFT JOIN budget_agg b ON h.category_id = b.root_category_id
       LEFT JOIN expense_agg e ON h.category_id = e.root_category_id
       WHERE h.level = '항'
       ORDER BY h.category_id`,
      [year, year]
    );
    res.json({ success: true, categories: rows });
  } catch (err) {
    console.error("❌ 가청구건 조회 실패:", err);
    res.status(500).json({ success: false, message: "데이터 조회 중 오류가 발생했습니다." });
  }
});

/* ------------------------------------------------
   가청구건(기지출액) 일괄 업데이트 API (전사)
   POST /api/initial-expenses/bulk
   (이전 경로 /api/dummy-claims-bulk 는 화면 배포 전까지 호환용으로 유지)
------------------------------------------------ */
router.post(["/api/initial-expenses/bulk", "/api/dummy-claims-bulk"], requireInitialExpenseAccess, async (req, res) => {
  const { year, request_date, items } = req.body;
  if (!year || !Array.isArray(items)) {
    return res.status(400).json({ success: false, message: "잘못된 요청 파라미터입니다." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const totalAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    // 이전에 생성된 같은 연도의 '전사 기지출 일괄등록' 더미 결재문서를 찾거나 새로 생성
    const [existingReq] = await conn.query(
      `SELECT id FROM approval_requests 
       WHERE document_type = '가청구건' AND author = '시스템_마이그레이션' AND YEAR(request_date) = ? LIMIT 1`,
      [year]
    );

    let requestId;
    if (existingReq.length > 0) {
      requestId = existingReq[0].id;
      // 문서 갱신 시간만 우선 업데이트 (총액은 모든 아이템 처리 후 재계산)
      await conn.query(
        `UPDATE approval_requests SET updated_at = NOW() WHERE id = ?`,
        [requestId]
      );
    } else {
      const [reqResult] = await conn.query(
        `INSERT INTO approval_requests 
          (document_type, dept_name, author, request_date, total_amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        ["가청구건", "전체", "시스템_마이그레이션", request_date || new Date().toISOString().split("T")[0], 0, "재정부이관완료"]
      );
      requestId = reqResult.insertId;
    }

    // items에 대해 처리
    for (const item of items) {
      // 1. 기존 기지출액 삭제 (해당 연도, 해당 계정, 초기 기지출액)
      await conn.query(
        `DELETE FROM expense_details WHERE category_id = ? AND year = ? AND description = '초기 기지출액'`,
        [item.category_id, year]
      );
      await conn.query(
        `DELETE FROM approval_items WHERE hang = ? AND year = ? AND detail = '초기 기지출액'`,
        [item.category_id, year]
      );

      // 2. 새로운 기지출액 삽입 (금액이 0보다 큰 경우에만)
      if (item.amount > 0) {
        const itemDeptId = item.owner_dept_id || 1; // 주관부서 없으면 기본값 1(교회/재정부 등)

        await conn.query(
          `INSERT INTO approval_items 
            (request_id, gwan, hang, mok, semok, detail, amount, dept_id, year)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [requestId, item.parent_id || '-', item.category_id, '-', '-', '초기 기지출액', item.amount, itemDeptId, year]
        );

        await conn.query(
          `INSERT INTO expense_details
            (dept_id, category_id, year, expense_date, amount, description, approval_request_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [itemDeptId, item.category_id, year, request_date || new Date().toISOString().split("T")[0], item.amount, '초기 기지출액', requestId]
        );
      }
    }

    // 3. approval_requests의 총액을 실제 DB에 저장된 approval_items의 합계로 정확히 재계산하여 업데이트
    await conn.query(
      `UPDATE approval_requests 
       SET total_amount = (SELECT COALESCE(SUM(amount), 0) FROM approval_items WHERE request_id = ?),
           updated_at = NOW()
       WHERE id = ?`,
      [requestId, requestId]
    );

    await conn.commit();
    res.json({ success: true, message: "가청구건 일괄 업데이트가 완료되었습니다." });
  } catch (err) {
    await conn.rollback();
    console.error("❌ 가청구건 일괄 업데이트 실패:", err);
    res.status(500).json({ success: false, message: "일괄 업데이트 중 오류가 발생했습니다." });
  } finally {
    conn.release();
  }
});

module.exports = router;
