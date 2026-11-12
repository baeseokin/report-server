// 계정과목 관리 · 부서별 매핑
const express = require("express");
const { getSystemToday, getSystemYear } = require("../env");
const { pool } = require("../lib/db");

const router = express.Router();


/* ------------------------------------------------
   ✅ Account Categories API (CRUD)
------------------------------------------------ */

// ✅ 전체 계정과목 조회 (마스터 관리용)
router.get("/api/accountCategories", async (req, res) => {
  try {
    const { date, year } = req.query;
    let query = `
      SELECT id, category_id, parent_id, category_name, level, owner_dept_id,
             DATE_FORMAT(valid_from, '%Y-%m-%d') AS valid_from,
             DATE_FORMAT(valid_to, '%Y-%m-%d') AS valid_to,
             created_at, updated_at
        FROM account_categories
       WHERE 1=1
    `;
    const params = [];
    if (date) {
      query += ` AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)`;
      params.push(date, date);
    } else if (year) {
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      query += ` AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)`;
      params.push(endDate, startDate);
    }
    query += ` ORDER BY category_id`;

    const [rows] = await pool.query(query, params);
    res.json({ success: true, categories: rows });
  } catch (err) {
    console.error("❌ accountCategories 전체 조회 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 특정 부서별 계정과목 조회 (기준일자 및 연도 조건 포함)
router.get("/api/accountCategories/:deptId", async (req, res) => {
  try {
    const deptId = req.params.deptId;
    const { date, year } = req.query;

    let filterStart = null;
    let filterEnd = null;

    if (date) {
      filterStart = date;
      filterEnd = date;
    } else if (year) {
      filterStart = `${year}-01-01`;
      filterEnd = `${year}-12-31`;
    }

    let query = "";
    const params = [];

    if (deptId === "all") {
      query = `
        SELECT ac.id, ac.category_id, ac.parent_id, ac.category_name, ac.level, ac.owner_dept_id,
               DATE_FORMAT(ac.valid_from, '%Y-%m-%d') AS valid_from,
               DATE_FORMAT(ac.valid_to, '%Y-%m-%d') AS valid_to,
               ac.created_at, ac.updated_at
          FROM account_categories ac
         WHERE 1=1
      `;
      if (filterStart && filterEnd) {
        query += ` AND ac.valid_from <= ? AND (ac.valid_to IS NULL OR ac.valid_to >= ?)`;
        params.push(filterEnd, filterStart);
      }
      query += ` ORDER BY ac.category_id`;
    } else {
      // ✅ RECURSIVE CTE를 사용하여 매핑된 계정의 모든 상위(부모) 계정까지 포함
      let initCondition = "";
      const initParams = [deptId];
      if (filterStart && filterEnd) {
        initCondition = ` AND ac.valid_from <= ? AND (ac.valid_to IS NULL OR ac.valid_to >= ?)`;
        initParams.push(filterEnd, filterStart);
      }

      query = `
        WITH RECURSIVE category_tree AS (
          -- 초기항: 직접 매핑된 계정 (유효기간 조건 반영)
          SELECT ac.id, ac.category_id, ac.parent_id, ac.category_name, ac.level, ac.owner_dept_id, ac.valid_from, ac.valid_to, ac.created_at, ac.updated_at
            FROM account_categories ac
            INNER JOIN account_category_departments acd ON ac.id = acd.account_category_id
           WHERE acd.dept_id = ?
           ${initCondition}
          
          UNION
          
          -- 재귀항: 위에서 선택된 계정들의 부모 계정들을 추적
          SELECT p.id, p.category_id, p.parent_id, p.category_name, p.level, p.owner_dept_id, p.valid_from, p.valid_to, p.created_at, p.updated_at
            FROM account_categories p
            INNER JOIN category_tree c ON c.parent_id = p.id
        )
        SELECT DISTINCT ct.id, ct.category_id, ct.parent_id, ct.category_name, ct.level, ct.owner_dept_id,
               DATE_FORMAT(ct.valid_from, '%Y-%m-%d') AS valid_from,
               DATE_FORMAT(ct.valid_to, '%Y-%m-%d') AS valid_to,
               ct.created_at, ct.updated_at,
               (SELECT GROUP_CONCAT(dept_id) FROM account_category_departments WHERE account_category_id = ct.id) AS dept_ids
          FROM category_tree ct
         WHERE 1=1
      `;
      params.push(...initParams);

      if (filterStart && filterEnd) {
        query += ` AND ct.valid_from <= ? AND (ct.valid_to IS NULL OR ct.valid_to >= ?)`;
        params.push(filterEnd, filterStart);
      }
      query += ` ORDER BY ct.category_id`;
    }

    const [rows] = await pool.query(query, params);

    res.json({ success: true, categories: rows });
  } catch (err) {
    console.error("❌ accountCategories 조회 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 계정과목 추가
router.post("/api/accountCategories", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { category_id, parent_id, category_name, level, valid_from } = req.body;

    const [result] = await conn.query(
      `INSERT INTO account_categories (category_id, parent_id, category_name, level, valid_from)
       VALUES (?, ?, ?, ?, ?)`,
      [category_id, parent_id || null, category_name, level, valid_from || getSystemToday()]
    );

    await conn.commit();
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    await conn.rollback();
    console.error("❌ accountCategories 추가 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// 계정과목 수정
router.put("/api/accountCategories/:id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { category_name, owner_dept_id } = req.body;
    await conn.query(
      `UPDATE account_categories 
          SET category_name=?, owner_dept_id=?, updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
        WHERE id=?`,
      [category_name, owner_dept_id, req.params.id]
    );

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("❌ accountCategories 수정 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// 계정과목 종료(valid_to 업데이트)
router.put("/api/accountCategories/:id/expire", async (req, res) => {
  try {
    const { valid_to } = req.body;
    await pool.query(
      `UPDATE account_categories 
          SET valid_to=?, updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
        WHERE id=?`,
      [valid_to || getSystemToday(), req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ accountCategories 종료 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 계정과목 삭제
router.delete("/api/accountCategories/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM account_categories WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ accountCategories 삭제 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ 부서별 계정과목 매핑 저장 (일괄 갱신)
router.post("/api/departments/:deptId/account-mapping", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const deptId = req.params.deptId;
    const { categoryIds, year } = req.body; // [1, 2, 5, ...], 2026
    const targetYear = year ? parseInt(year, 10) : getSystemYear();

    // 기존 매핑 삭제 (연도별)
    await conn.query("DELETE FROM account_category_departments WHERE dept_id = ? AND year = ?", [deptId, targetYear]);

    // 신규 매핑 추가
    if (Array.isArray(categoryIds) && categoryIds.length > 0) {
      const values = categoryIds.map(catId => [targetYear, catId, deptId]);
      await conn.query(
        `INSERT INTO account_category_departments (year, account_category_id, dept_id) VALUES ?`,
        [values]
      );
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("❌ 매핑 저장 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
