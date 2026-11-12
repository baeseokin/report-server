// 공지사항
const express = require("express");
const fs = require("fs");
const { pool } = require("../lib/db");
const { upload } = require("../lib/upload");
const { isAdmin } = require("../lib/auth");

const router = express.Router();


/* ------------------------------------------------
   ✅ 공지사항 (Notice) API
------------------------------------------------ */

// 1. 공지사항 목록 조회 (조회수, 첨부파일 포함 안함, 목록용 데이터만)
router.get("/api/notices", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM notices");

    // 최근 1주일 필터 표시를 위해 등록일 포함
    const [rows] = await pool.query(`
      SELECT id, title, author_id, author_name, view_count, is_popup, created_at
      FROM notices
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    res.json({
      success: true,
      data: rows,
      total: count,
      page,
      totalPages: Math.ceil(count / limit)
    });
  } catch (err) {
    console.error("❌ 공지사항 목록 조회 실패:", err);
    res.status(500).json({ success: false, message: "공지사항 목록 조회 실패" });
  }
});

// 1-1. 활성 팝업 공지사항 조회 (로그인 시 팝업용)
router.get("/api/notices/popups", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, title, content, author_name, view_count, is_popup, created_at
      FROM notices
      WHERE is_popup = 1
      ORDER BY id DESC
    `);

    for (const row of rows) {
      const [files] = await pool.query(
        "SELECT id, original_name, file_name, file_size FROM notice_files WHERE notice_id = ?",
        [row.id]
      );
      row.files = files;
    }

    res.json({
      success: true,
      data: rows
    });
  } catch (err) {
    console.error("❌ 팝업 공지사항 목록 조회 실패:", err);
    res.status(500).json({ success: false, message: "팝업 공지사항 목록 조회 실패" });
  }
});

// 2. 공지사항 상세 조회 (조회수 증가 포함)
router.get("/api/notices/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 조회수 1 증가 (쿠키/세션 기반 중복 방지는 생략하고 단순 증가)
    await pool.query("UPDATE notices SET view_count = view_count + 1 WHERE id = ?", [id]);

    // ✅ 사용자별 읽음 처리
    if (req.session.user) {
      await pool.query(`
        INSERT INTO notice_views (user_id, notice_id) 
        VALUES (?, ?) 
        ON DUPLICATE KEY UPDATE viewed_at = CURRENT_TIMESTAMP
      `, [req.session.user.userId, id]);
    }

    const [notices] = await pool.query("SELECT * FROM notices WHERE id = ?", [id]);
    if (notices.length === 0) {
      return res.status(404).json({ success: false, message: "공지사항을 찾을 수 없습니다." });
    }

    const [files] = await pool.query("SELECT * FROM notice_files WHERE notice_id = ?", [id]);

    res.json({
      success: true,
      data: {
        ...notices[0],
        files
      }
    });
  } catch (err) {
    console.error("❌ 공지사항 상세 조회 실패:", err);
    res.status(500).json({ success: false, message: "공지사항 상세 조회 실패" });
  }
});

// 3. 공지사항 등록 (관리자 및 재정부 가능)
router.post("/api/notices", upload.array("files", 50), async (req, res) => {
  if (!isAdmin(req) && req.session.user?.deptName !== '재정부') {
    return res.status(403).json({ success: false, message: "관리자 또는 재정부 권한이 필요합니다." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { title, content, is_popup } = req.body;
    const author_id = req.session.user.userId;
    const author_name = req.session.user.userName;
    const isPopup = (is_popup === true || is_popup === 'true' || is_popup === 1 || is_popup === '1') ? 1 : 0;

    const [result] = await conn.query(
      "INSERT INTO notices (title, content, author_id, author_name, is_popup) VALUES (?, ?, ?, ?, ?)",
      [title, content, author_id, author_name, isPopup]
    );
    const noticeId = result.insertId;

    if (req.files && req.files.length > 0) {
      const fileData = req.files.map(f => [
        noticeId, f.filename, f.path, f.mimetype, f.size, f.originalname
      ]);
      await conn.query(
        "INSERT INTO notice_files (notice_id, file_name, file_path, mime_type, file_size, original_name) VALUES ?",
        [fileData]
      );
    }

    await conn.commit();
    res.json({ success: true, message: "공지사항이 등록되었습니다.", id: noticeId });
  } catch (err) {
    await conn.rollback();
    console.error("❌ 공지사항 등록 실패:", err);
    res.status(500).json({ success: false, message: "공지사항 등록 실패" });
  } finally {
    conn.release();
  }
});

// 4. 공지사항 수정 (관리자 및 재정부 가능)
router.put("/api/notices/:id", upload.array("files", 50), async (req, res) => {
  if (!isAdmin(req) && req.session.user?.deptName !== '재정부') {
    return res.status(403).json({ success: false, message: "관리자 또는 재정부 권한이 필요합니다." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { id } = req.params;
    const { title, content, deletedFileIds, is_popup } = req.body; // 삭제할 첨부파일 ID들 (JSON string)
    const isPopup = (is_popup === true || is_popup === 'true' || is_popup === 1 || is_popup === '1') ? 1 : 0;

    await conn.query(
      "UPDATE notices SET title = ?, content = ?, is_popup = ? WHERE id = ?",
      [title, content, isPopup, id]
    );

    // 삭제하기로 한 기존 파일 제거
    if (deletedFileIds) {
      let idsToDelete = [];
      try {
        idsToDelete = JSON.parse(deletedFileIds);
      } catch (e) {
        idsToDelete = typeof deletedFileIds === 'string' ? deletedFileIds.split(',') : deletedFileIds;
      }

      if (Array.isArray(idsToDelete) && idsToDelete.length > 0) {
        // 실제 파일 삭제를 원한다면 DB 조회 후 fs.unlink를 해야 함. 여기서는 DB만 지움(고아 리소스 허용 또는 추후 정리)
        await conn.query("DELETE FROM notice_files WHERE id IN (?) AND notice_id = ?", [idsToDelete, id]);
      }
    }

    // 새 파일 추가
    if (req.files && req.files.length > 0) {
      const fileData = req.files.map(f => [
        id, f.filename, f.path, f.mimetype, f.size, f.originalname
      ]);
      await conn.query(
        "INSERT INTO notice_files (notice_id, file_name, file_path, mime_type, file_size, original_name) VALUES ?",
        [fileData]
      );
    }

    await conn.commit();
    res.json({ success: true, message: "공지사항이 수정되었습니다." });
  } catch (err) {
    await conn.rollback();
    console.error("❌ 공지사항 수정 실패:", err);
    res.status(500).json({ success: false, message: "공지사항 수정 실패" });
  } finally {
    conn.release();
  }
});

// 5. 공지사항 삭제 (관리자 및 재정부 가능)
router.delete("/api/notices/:id", async (req, res) => {
  if (!isAdmin(req) && req.session.user?.deptName !== '재정부') {
    return res.status(403).json({ success: false, message: "관리자 또는 재정부 권한이 필요합니다." });
  }

  try {
    const { id } = req.params;
    // FOREIGN KEY ON DELETE CASCADE 가 되어 있으므로 notice_files도 함께 지워짐
    await pool.query("DELETE FROM notices WHERE id = ?", [id]);
    res.json({ success: true, message: "공지사항이 삭제되었습니다." });
  } catch (err) {
    console.error("❌ 공지사항 삭제 실패:", err);
    res.status(500).json({ success: false, message: "공지사항 삭제 실패" });
  }
});

module.exports = router;
