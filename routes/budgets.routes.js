// 계정별 예산
const express = require("express");
const { pool } = require("../lib/db");

const router = express.Router();


// ✅ 계정별 예산 조회 (전사 공통)
router.get("/api/budgets", async (req, res) => {
  try {
    const { year } = req.query;
    // 부서별로 입력된 데이터가 있을 수 있으므로 SUM으로 합산하여 조회
    const [rows] = await pool.query(
      `SELECT category_id, year, SUM(budget_amount) as budget_amount
         FROM budgets
        WHERE year = ?
        GROUP BY category_id, year`,
      [year]
    );
    res.json({ success: true, budgets: rows });
  } catch (err) {
    console.error("❌ budgets 조회 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 예산 입력/수정 (Upsert)
router.post("/api/budgets", async (req, res) => {
  try {
    const { category_id, year, budget_amount } = req.body;
    await pool.query(
      `INSERT INTO budgets (category_id, year, budget_amount)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE budget_amount=?, updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')`,
      [category_id, year, budget_amount, budget_amount]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ budgets 저장 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 일괄 예산 저장 (Upsert)
router.post("/api/budgets/bulk", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const budgets = req.body.budgets;
    if (!Array.isArray(budgets) || budgets.length === 0) {
      conn.release();
      return res.status(400).json({ success: false, error: "예산 데이터 없음" });
    }

    await conn.beginTransaction();

    const values = budgets.map(b => [b.category_id, b.year, b.budget_amount]);

    await conn.query(
      `INSERT INTO budgets (category_id, year, budget_amount)
       VALUES ?
       ON DUPLICATE KEY UPDATE budget_amount = VALUES(budget_amount), updated_at = CONVERT_TZ(NOW(), '+00:00', '+09:00')`,
      [values]
    );

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("❌ bulk 예산 저장 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
