// 예산 · 지출 현황 조회
const express = require("express");
const { getSystemYear } = require("../env");
const { pool } = require("../lib/db");

const router = express.Router();



/* ------------------------------------------------
   📊 부서별 예산 & 지출 합계 조회 API
   GET /api/expenses/summary?deptId=1&year=2025
------------------------------------------------ */
router.get("/api/expenses/summary", async (req, res) => {
  try {
    const { deptId, year } = req.query;
    console.log("deptId :", deptId);

    if (!deptId || !year) {
      return res.status(400).json({ success: false, message: "deptId, year 필요" });
    }

    // ✅ 최상위 계정(관) 가져오기
    const [rootRows] = await pool.query(
      `SELECT ac.category_id 
         FROM account_categories ac
         JOIN account_category_departments acd ON ac.id = acd.account_category_id
        WHERE ac.parent_id IS NULL AND ac.level='관' AND acd.dept_id=?
        LIMIT 1`,
      [deptId]
    );
    console.log("rootRows :", rootRows);

    if (rootRows.length === 0) {
      return res.json({ success: true, totalBudget: 0, totalExpense: 0 });
    }
    const rootCategoryId = rootRows[0].category_id;
    console.log("rootCategoryId :", rootCategoryId);

    // ✅ 예산 총액 (budgets) - 부서 조건 제거 (전사 예산)
    const [[budgetRow]] = await pool.query(
      `WITH RECURSIVE sub_cats (id, category_id) AS (
          SELECT id, category_id FROM account_categories WHERE category_id = ?
          UNION ALL
          SELECT ac.id, ac.category_id FROM account_categories ac
          INNER JOIN sub_cats sc ON ac.parent_id = sc.id
       )
       SELECT COALESCE(SUM(b.budget_amount),0) AS totalBudget
       FROM budgets b
       JOIN sub_cats sc ON b.category_id = sc.category_id
       WHERE b.year=?`,
      [rootCategoryId, year]
    );
    console.log("budgetRow :", budgetRow);

    // ✅ 지출 총액 (expense_details)
    const [[expenseRow]] = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS totalExpense
         FROM expense_details
        WHERE dept_id=? AND year=?`,
      [deptId, year]
    );

    res.json({
      success: true,
      totalBudget: budgetRow.totalBudget,
      totalExpense: expenseRow.totalExpense,
    });
  } catch (err) {
    console.error("❌ /api/expenses/summary 오류:", err);
    res.status(500).json({ success: false, message: "조회 실패" });
  }
});

/* ------------------------------------------------
   🔍 지출내역(detail) 자동완성 이력 조회 API
   GET /api/expenses/history/details
------------------------------------------------ */
router.get("/api/expenses/history/details", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const deptId = req.session.user.deptId;
    if (!deptId) {
      return res.json({ success: true, details: [] });
    }

    const [rows] = await pool.query(
      `SELECT DISTINCT detail 
       FROM approval_items
       WHERE dept_id = ?
         AND detail IS NOT NULL 
         AND TRIM(detail) != ''
       ORDER BY detail ASC
       LIMIT 50`,
      [deptId]
    );

    res.json({ success: true, details: rows.map(r => r.detail) });
  } catch (err) {
    console.error("❌ /api/expenses/history/details 오류:", err);
    res.status(500).json({ success: false, message: "조회 실패" });
  }
});

/* ------------------------------------------------
   📊 부서 + '항' 기준 예산/지출/잔액 조회 API (직접 매핑만)
   GET /api/expenses/summaryByCategory?deptId=1&year=2025&hangCategoryId=2001

   - hangCategoryId: account_categories.category_id (level='항'의 category_id)
   - 예산(budgets): category_id = hangCategoryId 합계만
   - 지출(expense_details): category_id = hangCategoryId 합계만
------------------------------------------------ */
router.get("/api/expenses/summaryByCategory", async (req, res) => {
  try {
    const { deptId, year, hangCategoryId } = req.query;

    if (!deptId || !year || !hangCategoryId) {
      return res
        .status(400)
        .json({ success: false, message: "deptId, year, hangCategoryId 필요" });
    }

    // ✅ 1. 항(Hang) 정보 조회 (ID, Owner)
    const [[hangNode]] = await pool.query(
      "SELECT id, owner_dept_id FROM account_categories WHERE category_id = ?",
      [hangCategoryId]
    );

    let targetCategoryId = hangCategoryId;

    // ✅ 2. Owner가 일치하지 않으면 하위 계정(Mok) 중 Owner가 일치하는 것 조회
    if (hangNode && String(hangNode.owner_dept_id) !== String(deptId)) {
      const [children] = await pool.query(
        "SELECT category_id FROM account_categories WHERE parent_id = ? AND owner_dept_id = ? LIMIT 1",
        [hangNode.id, deptId]
      );

      if (children.length > 0) {
        targetCategoryId = children[0].category_id;
      }
    }

    console.log("targetCategoryId :", targetCategoryId);

    // ✅ 3. 예산 합계: targetCategoryId 사용
    const [[budgetRow]] = await pool.query(
      `WITH RECURSIVE sub_cats (id, category_id) AS (
          SELECT id, category_id FROM account_categories WHERE category_id = ?
          UNION ALL
          SELECT ac.id, ac.category_id FROM account_categories ac
          INNER JOIN sub_cats sc ON ac.parent_id = sc.id
       )
       SELECT COALESCE(SUM(b.budget_amount), 0) AS totalBudget
       FROM budgets b
       JOIN sub_cats sc ON b.category_id = sc.category_id
       WHERE b.year = ?`,
      [targetCategoryId, year]
    );

    console.log("budgetRow :", budgetRow);

    // ✅ 4. 지출 합계: targetCategoryId 사용
    const [[expenseRow]] = await pool.query(
      `WITH RECURSIVE sub_cats (id, category_id) AS (
          SELECT id, category_id FROM account_categories WHERE category_id = ?
          UNION ALL
          SELECT ac.id, ac.category_id FROM account_categories ac
          INNER JOIN sub_cats sc ON ac.parent_id = sc.id
       )
       SELECT COALESCE(SUM(ed.amount), 0) AS totalExpense
         FROM expense_details ed
         JOIN sub_cats sc ON ed.category_id = sc.category_id
        WHERE ed.dept_id = ?
          AND ed.year = ?`,
      [hangCategoryId, deptId, year]
    );

    console.log("expenseRow :", expenseRow);

    const totalBudget = Number(budgetRow.totalBudget) || 0;
    const totalExpense = Number(expenseRow.totalExpense) || 0;

    return res.json({
      success: true,
      totalBudget,
      totalExpense,
      remainingBudget: totalBudget - totalExpense,
    });
  } catch (err) {
    console.error("❌ /api/expenses/summaryByCategory 오류:", err);
    return res.status(500).json({ success: false, message: "조회 실패" });
  }
});



/* ------------------------------------------------
   📊 부서별 전체 예산/지출/잔액 조회 API
   GET /api/budget-status?year=2025
------------------------------------------------ */
router.get("/api/budget-status", async (req, res) => {
  try {
    const year = req.query.year || getSystemYear();

    // ✅ [전체 계정 모드] 기존 로직 유지
    const conditions = ["d.parent_dept_id IS NOT NULL"];
    const params = [year, year];

    // ✅ 부서/관/항 기준 예산 & 지출 합계
    const [rows] = await pool.query(
      `
      WITH RECURSIVE category_descendants (root_id, root_category_id, id, category_id) AS (
          SELECT id, category_id, id, category_id FROM account_categories
          UNION ALL
          SELECT cd.root_id, cd.root_category_id, ac.id, ac.category_id
          FROM account_categories ac
          JOIN category_descendants cd ON ac.parent_id = cd.id
      ),
      budget_agg AS (
          SELECT cd.root_category_id, SUM(b.budget_amount) as total_budget
          FROM category_descendants cd
          JOIN budgets b ON cd.category_id = b.category_id
          WHERE b.year = ?
          GROUP BY cd.root_category_id
      ),
      expense_agg AS (
          SELECT cd.root_category_id, ed.dept_id, SUM(ed.amount) as total_expense
          FROM category_descendants cd
          JOIN expense_details ed ON cd.category_id = ed.category_id
          WHERE ed.year = ?
          GROUP BY cd.root_category_id, ed.dept_id
      )
      SELECT 
          d.id AS dept_id,
          d.dept_name,
          d.dept_cd,
          gwan.category_id AS gwan_category_id,
          gwan.category_name AS gwan_name,
          hang.category_id AS hang_category_id,
          hang.category_name AS hang_name,
          hang.owner_dept_id,
          owner_d.dept_name AS owner_dept_name,
          SUM(COALESCE(b.total_budget,0)) as total_budget,
          MAX(COALESCE(b_full.total_budget,0)) as hang_total_budget,
          MAX(COALESCE(ev.total_expense,0)) as total_expense,
          SUM(COALESCE(b.total_budget,0)) - MAX(COALESCE(ev.total_expense,0)) AS remaining_amount
      FROM departments d
      INNER JOIN account_category_departments acd ON acd.dept_id = d.id
      INNER JOIN account_categories hang
        ON hang.id = acd.account_category_id
       AND hang.level = '항'
      INNER JOIN account_categories gwan
        ON gwan.id = hang.parent_id
       AND gwan.level = '관'
      LEFT JOIN departments owner_d ON hang.owner_dept_id = owner_d.id
      LEFT JOIN account_categories child_cat
        ON child_cat.parent_id = hang.id
       AND child_cat.owner_dept_id = d.id
      LEFT JOIN budget_agg b
        ON b.root_category_id = COALESCE(child_cat.category_id, hang.category_id)
      LEFT JOIN budget_agg b_full
        ON b_full.root_category_id = hang.category_id
      LEFT JOIN expense_agg ev
        ON ev.dept_id = d.id
       AND ev.root_category_id = hang.category_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY 
          d.id, d.dept_name, d.dept_cd,
          gwan.category_id, gwan.category_name,
          hang.category_id, hang.category_name, hang.owner_dept_id,
          owner_d.dept_name
      ORDER BY d.id, gwan.category_id, hang.category_id
      `,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ /api/budget-status 오류:", err);
    res.status(500).json({ success: false, message: "예산 현황 조회 실패" });
  }
});

/* ------------------------------------------------
   📊 부서 예산집행 현황 API (DeptBudgetStatus.vue용)
   GET /api/dept-budget-status?deptId=1&year=2025
------------------------------------------------ */
router.get("/api/dept-budget-status", async (req, res) => {
  try {
    const { deptId, year } = req.query;
    if (!deptId || !year) {
      return res.status(400).json({ success: false, message: "deptId, year 필요" });
    }

    // 1. 예산 조회 (BudgetsGrid와 동일 로직: 전사 예산)
    //    단, 여기서는 부서별 예산 현황이므로 해당 부서가 Owner인 계정만 필터링하는 것은 프론트엔드 로직을 따름.
    //    서버에서는 전체 예산을 내려주거나, 필요한 경우 필터링.
    //    BudgetsGrid는 /api/budgets (전체)를 호출하고 프론트에서 매핑함.
    //    여기서도 동일하게 전체 예산을 가져갑니다.
    const [budgetRows] = await pool.query(
      `SELECT category_id, SUM(budget_amount) as budget_amount
         FROM budgets
        WHERE year = ?
        GROUP BY category_id`,
      [year]
    );

    // 2. 지출 조회: "해당 부서에 배정된 계정과목"으로 집행된 지출만 포함 (결재 신청 부서 무관)
    //    - 세목(semok)이 ACC로 시작하면: semok이 이 부서 배정 계정인 건
    //    - 세목이 커스텀/비ACC면: 목(mok)이 이 부서 배정 계정인 건
    //    -> 부서="관리부"일 때도 ACC04130202에 회우부가 신청한 지출이 표시됨
    const [expenseRows] = await pool.query(
      `SELECT ai.gwan, ai.hang, ai.mok, ai.semok, ai.amount
         FROM approval_items ai
         JOIN approval_requests ar ON ai.request_id = ar.id
        WHERE ai.year = ?
          AND ar.status = '재정부이관완료'
          AND (
            -- 1. 해당 부서가 신청(기안)한 지출 (ar.dept_name으로 조인)
            EXISTS (SELECT 1 FROM departments d WHERE d.dept_name = ar.dept_name AND d.id = ?)
            OR
            -- 2. 해당 부서가 관리(배정)하는 계정으로 집행된 지출
            EXISTS (
              SELECT 1 FROM account_category_departments acd
              INNER JOIN account_categories ac ON ac.id = acd.account_category_id
              WHERE acd.dept_id = ? 
                AND (ac.category_id = ai.semok OR ac.category_id = ai.mok OR ac.category_id = ai.hang OR ac.category_id = ai.gwan)
            )
          )`,
      [year, deptId, deptId]
    );

    res.json({
      success: true,
      budgets: budgetRows,
      expenses: expenseRows
    });
  } catch (err) {
    console.error("❌ 부서 예산집행 현황 조회 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
