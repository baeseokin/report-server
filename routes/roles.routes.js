// 역할 · 메뉴 접근권한 · 즐겨찾기
const express = require("express");
const { pool } = require("../lib/db");

const router = express.Router();




/* ------------------------------------------------
   ✅ 권한 관리
------------------------------------------------ */
router.get("/api/public/roles", async (req, res) => {
  const { deptId } = req.query;

  // 파라미터 체크
  if (!deptId) {
    return res.status(400).json({ error: "deptId 는 필수입니다." });
  }

  try {
    const [rows] = await pool.query(
      `select distinct r.role_name, r.id as role_id 
        from departments d
        inner join users u on d.dept_name  = u.dept_name
        inner join user_roles ur on u.id = ur.user_id 
        inner join roles r on r.id = ur.role_id 
        where d.id = ? `
      , [deptId]);
    res.json(rows);
  } catch (err) {
    console.error("역할 조회 실패:", err);
    res.status(500).json({ success: false });
  }
});


router.get("/api/roles", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }
  try {
    const [rows] = await pool.query("SELECT id AS role_id, role_name FROM roles");
    res.json(rows);
  } catch (err) {
    console.error("역할 조회 실패:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ 특정 역할의 접근 권한 조회
router.get("/api/access/:roleId", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT menu_name, access_type FROM role_access WHERE role_id = ?",
      [req.params.roleId]
    );
    res.json({ access: rows });
  } catch (err) {
    console.error("권한 조회 실패:", err);
    res.status(500).json({ success: false });
  }
});

// ───────────────────────────────────────────────────────────
// ✅ 사용자 즐겨찾기 메뉴 관리
// ───────────────────────────────────────────────────────────
router.get("/api/user/favorites", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });
  try {
    const [rows] = await pool.query(
      "SELECT menu_name FROM user_favorites WHERE user_id = ? ORDER BY created_at ASC",
      [req.session.user.userId]
    );
    res.json({ success: true, favorites: rows.map(r => r.menu_name) });
  } catch (err) {
    console.error("즐겨찾기 조회 실패:", err);
    res.status(500).json({ success: false });
  }
});

router.post("/api/user/favorites", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });
  const { menus } = req.body; // array of menu names
  const userId = req.session.user.userId;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // 기존 삭제 후 재등록
    await conn.query("DELETE FROM user_favorites WHERE user_id = ?", [userId]);
    if (menus && menus.length > 0) {
      const values = menus.map(m => [userId, m]);
      await conn.query("INSERT INTO user_favorites (user_id, menu_name) VALUES ?", [values]);
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("즐겨찾기 저장 실패:", err);
    res.status(500).json({ success: false });
  } finally {
    conn.release();
  }
});

// ✅ 접근 권한 추가/삭제 (토글)
router.post("/api/access", async (req, res) => {
  const { roleId, menuName, accessType, enabled } = req.body;

  try {
    if (enabled) {
      // 추가 (중복 허용 X → INSERT IGNORE)
      await pool.query(
        "INSERT IGNORE INTO role_access (role_id, menu_name, access_type) VALUES (?, ?, ?)",
        [roleId, menuName, accessType]
      );
    } else {
      // 제거
      await pool.query(
        "DELETE FROM role_access WHERE role_id=? AND menu_name=? AND access_type=?",
        [roleId, menuName, accessType]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("권한 저장 실패:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ 역할별 모든 권한 삭제 (초기화 용도)
router.delete("/api/access/:roleId", async (req, res) => {
  try {
    await pool.query("DELETE FROM role_access WHERE role_id=?", [req.params.roleId]);
    res.json({ success: true });
  } catch (err) {
    console.error("권한 초기화 실패:", err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
