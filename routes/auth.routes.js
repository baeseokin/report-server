// 로그인 · 로그아웃 · 세션
const express = require("express");
const bcrypt = require("bcrypt");
const { pool } = require("../lib/db");

const router = express.Router();




/* ------------------------------------------------
   ✅ 로그인/로그아웃/세션
------------------------------------------------ */
router.post("/api/login", async (req, res) => {
  try {
    const { userId, password } = req.body || {};
    if (!userId || password === undefined) {
      return res.status(400).json({ success: false, message: "아이디와 비밀번호를 입력하세요." });
    }
    console.log("📥 로그인 시도:", userId, "IP:", req.ip);

    const [rows] = await pool.query(
      `SELECT u.*, d.id AS dept_id, d.dept_name
        FROM users u
        LEFT JOIN departments d ON u.dept_name = d.dept_name
        WHERE u.user_id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      console.warn("❌ 로그인 실패: ID 없음", userId);
      return res.status(401).json({ success: false, message: "ID 없음" });
    }

    const user = rows[0];

    if (!user.password_hash) {
      console.warn("❌ 로그인 실패: 비밀번호 미설정", userId);
      return res.status(401).json({ success: false, message: "비밀번호가 설정되지 않은 계정입니다." });
    }

    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) {
      console.warn("❌ 로그인 실패: 비밀번호 불일치", userId);
      return res.status(401).json({ success: false, message: "비밀번호 불일치" });
    }

    const [roles] = await pool.query(
      `SELECT r.id, r.role_name 
       FROM roles r 
       JOIN user_roles ur ON r.id = ur.role_id 
       WHERE ur.user_id = ?`,
      [user.id]
    );

    req.session.user = {
      id: user.id,
      userId: user.user_id,
      userName: user.user_name,
      email: user.email,
      phone: user.phone,
      deptName: user.dept_name,
      deptId: user.dept_id,
      roles: roles.length > 0 ? roles : [],
      requirePasswordChange: user.require_password_change === 1,
    };
    console.log("✅ 로그인 성공:", user.user_id, "→ 세션 저장됨");
    return res.json({ success: true, user: req.session.user });
  } catch (error) {
    console.error("❌ 로그인 처리 오류:", error.message || error);
    return res.status(500).json({ success: false, message: "로그인 처리 실패" });
  }
});

router.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get("/api/session", (req, res) => {
  //console.log("req.session.user :", req.session.user);
  if (!req.session.user) {
    return res.json({ success: false, user: null });
  }
  res.json({ success: true, user: req.session.user });
});

module.exports = router;
