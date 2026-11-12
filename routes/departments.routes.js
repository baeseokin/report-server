// 부서 관리
const express = require("express");
const { pool } = require("../lib/db");

const router = express.Router();


// 부서 목록 조회
router.get("/api/departments", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, dept_name, dept_cd, parent_dept_id, account_info FROM departments ORDER BY id"
    );
    res.json(rows);
  } catch (err) {
    console.error("부서 조회 실패:", err);
    res.status(500).json({ error: "부서 조회 실패" });
  }
});

// 부서 추가
router.post("/api/departments", async (req, res) => {
  try {
    const { dept_name, dept_cd, parent_dept_id, account_info } = req.body;

    if (!dept_name || !dept_cd) {
      return res.status(400).json({ error: "부서명과 코드가 필요합니다." });
    }

    const [result] = await pool.query(
      "INSERT INTO departments (dept_name, dept_cd, parent_dept_id, account_info) VALUES (?, ?, ?, ?)",
      [dept_name, dept_cd, parent_dept_id || null, account_info || null]
    );

    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error("부서 추가 실패:", err);
    res.status(500).json({ error: "부서 추가 실패" });
  }
});

// 부서 수정
router.put("/api/departments/:id", async (req, res) => {
  try {
    const { dept_name, dept_cd, parent_dept_id, account_info } = req.body;
    const deptId = req.params.id;

    if (!dept_name || !dept_cd) {
      return res.status(400).json({ error: "부서명과 코드가 필요합니다." });
    }

    const [result] = await pool.query(
      "UPDATE departments SET dept_name = ?, dept_cd = ?, parent_dept_id = ?, account_info = ? WHERE id = ?",
      [dept_name, dept_cd, parent_dept_id || null, account_info || null, deptId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "해당 부서를 찾을 수 없습니다." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("부서 수정 실패:", err);
    res.status(500).json({ error: "부서 수정 실패" });
  }
});

// 부서 삭제
router.delete("/api/departments/:id", async (req, res) => {
  try {
    const deptId = req.params.id;
    const [result] = await pool.query("DELETE FROM departments WHERE id = ?", [deptId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "해당 부서를 찾을 수 없습니다." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("부서 삭제 실패:", err);
    res.status(500).json({ error: "부서 삭제 실패" });
  }
});

module.exports = router;
