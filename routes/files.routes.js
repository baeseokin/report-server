// 첨부파일 업로드·다운로드
const express = require("express");
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { upload, uploadDir, SIGN_BASE_DIR } = require("../lib/upload");

const router = express.Router();




/* ------------------------------------------------
   ✅ 파일 업로드/다운로드 API
------------------------------------------------ */
router.post("/api/approval/:id/files", upload.array("files", 50), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { id } = req.params;
  try {
    const aliasNames = req.body.aliasNames ? JSON.parse(req.body.aliasNames) : [];
    const isEdit = req.body.isEdit === "true";
    const existingFileIds = req.body.existingFileIds ? JSON.parse(req.body.existingFileIds) : [];

    if (isEdit) {
      if (existingFileIds.length > 0) {
        // 기존 파일 중 목록에서 제외된 파일들 삭제
        await pool.query("DELETE FROM approval_files WHERE request_id = ? AND id NOT IN (?)", [id, existingFileIds]);
      } else {
        // 모든 기존 파일 삭제
        await pool.query("DELETE FROM approval_files WHERE request_id = ?", [id]);
      }
    }

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const aliasName = aliasNames[i] || file.originalname;
      await pool.query(
        `INSERT INTO approval_files 
         (request_id, file_name, file_path, mime_type, file_size, alias_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, file.originalname, file.filename, file.mimetype, file.size, aliasName]
      );
    }
    res.json({ success: true, files: req.files });
  } catch (err) {
    console.error("❌ File Upload Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/api/approval/:id/files", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT id, file_name, file_path, mime_type, file_size, alias_name, created_at 
       FROM approval_files WHERE request_id = ?`,
      [id]
    );
    res.json({ success: true, files: rows });
  } catch (err) {
    console.error("❌ File List Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ 안전하게 file_path 기준으로 찾기 (단일 세그먼트 + 디코드 + 보안가드)
router.get("/api/files/:filename", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    // 예: "signatures%2Fabc.png" → "signatures/abc.png"
    const encoded = req.params.filename || "";
    const relPath = decodeURIComponent(encoded)
      .replace(/^[/\\]+/, "")        // 선행 슬래시 제거
      .replace(/\\/g, "/")           // 백슬래시 → 슬래시
      .replace(/\.\.(\/|\\)/g, "_"); // 상위경로 차단

    const absPath = path.join(uploadDir, relPath);
    if (!absPath.startsWith(uploadDir)) {
      return res.status(400).json({ error: "Invalid path" });
    }

    // 1) 물리 파일 있으면 바로 응답 (uploadDir 기준)
    if (fs.existsSync(absPath)) {
      if (req.query.downloadName) {
        return res.download(absPath, req.query.downloadName);
      }
      return res.sendFile(absPath);
    }

    // 1-1) 서명 디렉터리(SIGN_BASE_DIR) 물리 파일 확인
    const signAbsPath = path.join(SIGN_BASE_DIR, path.basename(relPath));
    if (fs.existsSync(signAbsPath)) {
      if (req.query.downloadName) {
        return res.download(signAbsPath, req.query.downloadName);
      }
      return res.sendFile(signAbsPath);
    }

    // 2) 첨부파일 테이블 fallback
    let dbPath = null;
    {
      const [rows] = await pool.query(
        "SELECT file_path FROM approval_files WHERE file_path = ? OR file_name = ? LIMIT 1",
        [relPath, path.basename(relPath)]
      );
      if (rows.length) dbPath = path.join(uploadDir, rows[0].file_path);
    }

    // 3) 사용자 서명 테이블 fallback
    if (!dbPath) {
      const [srows] = await pool.query(
        "SELECT file_path FROM user_signatures WHERE file_path IN (?, ?) LIMIT 1",
        [relPath, `signatures/${relPath}`]
      );
      if (srows.length) dbPath = path.join(uploadDir, srows[0].file_path);
    }

    // 3-1) 결재 이력(approval_history) 서명 테이블 fallback
    if (!dbPath) {
      const [ahrows] = await pool.query(
        "SELECT signature_path FROM approval_history WHERE signature_path IN (?, ?) LIMIT 1",
        [relPath, path.basename(relPath)]
      );
      if (ahrows.length && ahrows[0].signature_path) {
        const candidate1 = path.join(SIGN_BASE_DIR, path.basename(ahrows[0].signature_path));
        const candidate2 = path.join(uploadDir, ahrows[0].signature_path);
        if (fs.existsSync(candidate1)) dbPath = candidate1;
        else if (fs.existsSync(candidate2)) dbPath = candidate2;
      }
    }

    if (dbPath && fs.existsSync(dbPath)) {
      if (req.query.downloadName) {
        return res.download(dbPath, req.query.downloadName);
      }
      return res.sendFile(dbPath);
    }

    return res.status(404).json({ error: "File not found" });
  } catch (err) {
    console.error("❌ File Fetch Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
