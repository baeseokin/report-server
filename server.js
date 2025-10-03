const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcrypt");
require("dotenv").config();   // ✅ .env 불러오기
const { envPick, envNumber, ENV } = require("./env");

const app = express();
const PORT = 3001;

// ✅ CORS 설정 (.env 기반)
const allowedOrigins = (envPick("CORS_ORIGIN", "") || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    //console.log("🌍 요청 Origin:", origin); 
    // 개발용: origin 없을 때 (예: Postman) 허용
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      //console.warn("❌ CORS 차단:", origin);
      callback(new Error("CORS not allowed: " + origin));
    }
  },
  credentials: true
}));


app.use(bodyParser.json());
app.use(
  session({
    secret: envPick("SESSION_SECRET", "secret-key"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,       // HTTPS 아니면 false
      sameSite: "lax"      // 모바일에서도 안전하게 동작
    }
  })
);

// ✅ DB 연결 설정
const pool = mysql.createPool({
  host: envPick("DB_HOST", "localhost"),
  port: envNumber("DB_PORT", 3306),
  user: envPick("DB_USER", "root"),
  password: envPick("DB_PASSWORD", ""),
  database: envPick("DB_NAME", "test"),
  waitForConnections: true,
  connectionLimit: envNumber("DB_CONN_LIMIT", 10),
  queueLimit: 0,
  dateStrings: true,
  timezone: envPick("DB_TIMEZONE", "Z")
});

// 업로드 폴더 생성
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// multer 스토리지 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// ✅ 서명 파일 저장소 (캔버스 → PNG 업로드용)
const SIGN_BASE_DIR = path.join(uploadDir, "signatures");
fs.mkdirSync(SIGN_BASE_DIR, { recursive: true });

const signatureStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SIGN_BASE_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = (file.originalname || "signature.png").replace(/[^\w.\-]/g, "_");
    cb(null, `${ts}_${safe}`);
  }
});
const uploadSignature = multer({
  storage: signatureStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype)) {
      return cb(new Error("이미지 파일만 업로드 가능합니다."), false);
    }
    cb(null, true);
  }
});

// ───────────────────────────────────────────────────────────
// 공통 유틸 & 권한 헬퍼
// ───────────────────────────────────────────────────────────
function getLoginUser(req) {
  return req.session?.user || null;
}
function isAdmin(req) {
  const u = getLoginUser(req);
  return Array.isArray(u?.roles) && u.roles.some(r => r.role_name === "관리자");
}
function assertSelfOrAdmin(req, targetUserId) {
  const u = getLoginUser(req);
  // userId는 문자열(로그인 ID), DB user_signatures.user_id와 동일 타입
  if (!u) return false;
  if (isAdmin(req)) return true;
  return String(u.userId) === String(targetUserId);
}

// 파일 URL 생성: /api/files/:filename 엔드포인트에 맞춰 인코딩
function makeSignatureUrl(filePath) {
  // filePath 예: "signatures/1727952435_signature.png"
  return `/api/files/${encodeURIComponent(filePath)}`;
}


/* ------------------------------------------------
   ✅ 결재 요청 등록 API (결재자 라인 반영)
------------------------------------------------ */
app.post("/api/approval", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { documentType, deptName, author, userId, date, totalAmount, comment, aliasName, items } =
      req.body;

    // approval_requests 저장 (status = 진행중)
    const [result] = await conn.query(
      `INSERT INTO approval_requests 
       (document_type, dept_name, author, request_date, total_amount, comment, aliasName, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, '진행중')`,
      [documentType, deptName, author, date, totalAmount, comment, aliasName]
    );

    const requestId = result.insertId;
    //console.log("approval > requestId :", requestId);

    // ✅ 신청자의 approver_order 찾기
    const [applicantRows] = await conn.query(
      `SELECT order_no 
         FROM approval_line 
        WHERE dept_name = ? AND approver_user_id = ?
        LIMIT 1`,
      [deptName, userId]
    );

    //console.log("approval > deptName :", deptName);
    //console.log("approval > userId :", userId);
    //console.log("approval > applicantRows :", applicantRows);

    let nextApprover = null;

    if (applicantRows.length > 0) {
      const applicantOrder = applicantRows[0].order_no;
      const [nextRows] = await conn.query(
        `SELECT approver_role, approver_user_id 
           FROM approval_line 
          WHERE dept_name = ? AND order_no = ?
          LIMIT 1`,
        [deptName, applicantOrder + 1]
      );

      if (nextRows.length > 0) {
        nextApprover = nextRows[0];
      }
    }

    //console.log("approval > nextApprover :", nextApprover);

    // ✅ approval_requests에 다음 결재자 업데이트
    if (nextApprover) {
      await conn.query(
        `UPDATE approval_requests 
            SET current_approver_role = ?, current_approver_user_id = ? 
          WHERE id = ?`,
        [nextApprover.approver_role, nextApprover.approver_user_id, requestId]
      );
    }
    // ❌ else 제거 → 자동 완료 금지

    // approval_items 저장
    if (items && items.length > 0) {
      const itemInserts = items.map((i) => [
        requestId,
        i.gwan || null,
        i.hang || null,
        i.mok || null,
        i.semok || null,
        i.detail || null,
        i.amount || null,
      ]);

      await conn.query(
        `INSERT INTO approval_items 
         (request_id, gwan, hang, mok, semok, detail, amount) 
         VALUES ?`,
        [itemInserts]
      );
    }

    await conn.commit();
    res.json({ success: true, id: requestId });
  } catch (err) {
    await conn.rollback();
    console.error("❌ DB Insert Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});


// ✅ 결재 히스토리 저장 API
app.post("/api/approval/history", upload.single("signature"), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { requestId, approver_role, approver_user_id, comment } = req.body;
    const signaturePath = req.file ? req.file.filename : null;

    if (!requestId || !approver_user_id) {
      return res.status(400).json({ success: false, message: "필수 값 누락" });
    }

    await pool.query(
      `INSERT INTO approval_history (request_id, approver_role, approver_user_id, comment, signature_path, approved_at)
       VALUES (?, ?, ?, ?, ?, CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
      [requestId, approver_role, approver_user_id, comment, signaturePath]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ approval_history 저장 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});



/* ------------------------------------------------
   ✅ 결재 목록 조회 API
------------------------------------------------ */
app.post("/api/approvalList", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { deptName, documentType, startDate, endDate, status, approverUserId, page = 1, pageSize = 10 } = req.body;

    let where = "WHERE 1=1";
    const params = [];

    // ✅ 현재 부서 + 하위부서 조회
    let deptList = [];
    const effectiveDeptName = deptName === "재정부" ? "교회" : deptName;
    if (effectiveDeptName) {
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
        [effectiveDeptName]
      );
      deptList = subDepts.map(d => d.dept_name);
    }

    if (deptList.length > 0) {
      where += ` AND ar.dept_name IN (${deptList.map(() => "?").join(",")})`;
      params.push(...deptList);
    }

    if (documentType) {
      where += " AND ar.document_type = ?";
      params.push(documentType);
    }
    if (startDate) {
      where += " AND ar.request_date >= ?";
      params.push(startDate);
    }
    if (endDate) {
      where += " AND ar.request_date <= ?";
      params.push(endDate);
    }
    // ✅ 진행상태
    if (status) {
      if (status != "전체") {
        where += " AND ar.status = ?";
        params.push(status);
      }
    }

    // ✅ 현재 결재자
    if (approverUserId) {
      where += " AND ar.current_approver_user_id = ?";
      params.push(approverUserId);
    }

    const [[{ count }]] = await pool.query(
      `SELECT COUNT(*) as count FROM approval_requests ar ${where}`,
      params
    );

    //console.log("where :", where);

    const totalPages = Math.ceil(count / pageSize);
    const offset = (page - 1) * pageSize;

    const [rows] = await pool.query(
      `SELECT ar.id, ar.dept_name, ar.document_type, ar.request_date, ar.total_amount, 
              ar.author, ar.aliasName, ar.status, ar.current_approver_role, ar.current_approver_user_id
       FROM approval_requests ar
       ${where}
       ORDER BY ar.request_date DESC, ar.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({ success: true, rows, totalPages });
  } catch (err) {
    console.error("❌ DB Select Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------
   ✅ 결재요청 상세 조회 (detail 버전)
------------------------------------------------ */
app.get("/api/approval/detail/:id", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { id } = req.params;

    const [requests] = await pool.query("SELECT * FROM approval_requests WHERE id = ?", [id]);
    if (requests.length === 0) {
      return res.status(404).json({ success: false, message: "데이터 없음" });
    }

    const request = requests[0];

    // 항목 정보
    const [items] = await pool.query(
      "SELECT gwan, hang, mok, semok, detail, amount FROM approval_items WHERE request_id = ?",
      [id]
    );

    // ✅ 첨부파일 정보 포함
    const [files] = await pool.query(
      "SELECT id, file_name, file_path, mime_type, file_size, alias_name FROM approval_files WHERE request_id = ?",
      [id]
    );

    // ✅ 결재 이력
    const [history] = await pool.query(
      `SELECT approver_user_id, approver_role, comment, signature_path, approved_at, status
         FROM approval_history
        WHERE request_id = ?
        ORDER BY approved_at ASC`,
      [id]
    );

    // ✅ 결재선 (approval_line) - 부서 기준 + 재정부 규칙 + order_no 정렬
    const [approvalLine] = await pool.query(
      `
      SELECT id, dept_name, approver_role, approver_user_id, order_no
        FROM approval_line
       WHERE dept_name = ?
         and not (dept_name <> '재정부' AND approver_role = '재정부')
       ORDER BY order_no ASC, id ASC
      `,
      [request.dept_name]
    );

    // (옵션) 프론트에서 편하게 쓰도록 역할만 뽑은 배열도 함께 내려줌
    const approverRoles = Array.from(
      new Set(approvalLine.map(l => l.approver_role))
    );

    res.json({
      id: request.id,
      document_type: request.document_type,
      dept_name: request.dept_name,
      author: request.author,
      request_date: request.request_date,
      total_amount: request.total_amount,
      comment: request.comment,
      aliasName: request.aliasName,
      items,
      attachedFiles: files,
      approvalHistory: history,
      approvalLine,
      approverRoles
    });
  } catch (err) {
    console.error("❌ 상세조회 오류:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------
   ✅ 결재 승인 API
------------------------------------------------ */
app.post("/api/approval/approve", upload.single("signature"), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { requestId, comment } = req.body;
  const signaturePath = req.file ? req.file.filename : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [reqRows] = await conn.query(
      `SELECT dept_name, current_approver_role, current_approver_user_id
         FROM approval_requests 
        WHERE id=? FOR UPDATE`,
      [requestId]
    );
    if (reqRows.length === 0) {
      return res.status(404).json({ success: false, message: "결재 요청 없음" });
    }

    const { dept_name, current_approver_role, current_approver_user_id } = reqRows[0];

    // ✅ 로그인한 사용자가 실제 결재자인지 검증
    if (current_approver_user_id !== req.session.user.userId) {
      return res.status(403).json({ success: false, message: "현재 결재자가 아닙니다." });
    }

    // ✅ 승인 이력 기록
    await conn.query(
      `INSERT INTO approval_history 
         (request_id, approver_role, approver_user_id, comment, signature_path, status, approved_at)
       VALUES (?, ?, ?, ?, ?, '승인', CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
      [requestId, current_approver_role, current_approver_user_id, comment, signaturePath]
    );

    // ✅ 다음 결재자 찾기
    const [[roleRow]] = await conn.query(
      `SELECT order_no FROM approval_line WHERE dept_name=? AND approver_role=?`,
      [dept_name, current_approver_role]
    );
    const currentOrder = roleRow.order_no;

    const [nextRows] = await conn.query(
      `SELECT approver_role, approver_user_id
         FROM approval_line 
        WHERE dept_name=? AND order_no=?`,
      [dept_name, currentOrder + 1]
    );

    if (nextRows.length > 0) {
      // 다음 결재자 지정
      await conn.query(
        `UPDATE approval_requests
           SET current_approver_role=?, current_approver_user_id=?, updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
         WHERE id=?`,
        [nextRows[0].approver_role, nextRows[0].approver_user_id, requestId]
      );
    } else {
      // 마지막 결재자 → 완료 처리
      await conn.query(
        `UPDATE approval_requests
           SET status='완료', updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
         WHERE id=?`,
        [requestId]
      );

      // ✅ 신청 총액 가져오기
      const [[{ totalAmount }]] = await conn.query(
        `SELECT SUM(amount) AS totalAmount FROM approval_items WHERE request_id=?`,
        [requestId]
      );

      // ✅ dept_id 조회
      const [[deptRow]] = await conn.query(
        `SELECT id FROM departments WHERE dept_name=?`,
        [dept_name]
      );

      // ✅ 최상위 계정(category_id: 관) 찾기
      const [[categoryRow]] = await conn.query(
        `SELECT id, category_id FROM account_categories 
          WHERE dept_id=? AND parent_id IS NULL 
          ORDER BY id LIMIT 1`,
        [deptRow.id]
      );

      if (categoryRow && totalAmount > 0) {
        await conn.query(
          `INSERT INTO expense_details 
             (dept_id, category_id, year, expense_date, amount, description, approval_request_id) 
           VALUES (?, ?, YEAR(CURDATE()), CURDATE(), ?, ?, ?)`,
          [
            deptRow.id,
            categoryRow.category_id,
            totalAmount,
            `결재 ID ${requestId} 최종 승인 합계`,
            requestId
          ]
        );
      }

    }

    await conn.commit();
    res.json({ success: true, message: "결재가 완료되었습니다." });
  } catch (error) {
    await conn.rollback();
    console.error("❌ 결재 처리 오류:", error);
    res.status(500).json({ success: false, message: "결재 처리 실패" });
  } finally {
    conn.release();
  }
});


/* ------------------------------------------------
   ✅ 결재 반려 API
------------------------------------------------ */
app.post("/api/approval/reject", upload.single("signature"), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { requestId, comment } = req.body;
  const signaturePath = req.file ? req.file.filename : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [reqRows] = await conn.query(
      `SELECT current_approver_role, current_approver_user_id
         FROM approval_requests 
        WHERE id=? FOR UPDATE`,
      [requestId]
    );
    if (reqRows.length === 0) {
      return res.status(404).json({ success: false, message: "결재 요청 없음" });
    }

    const { current_approver_role, current_approver_user_id } = reqRows[0];

    // ✅ 로그인한 사용자가 실제 결재자인지 검증
    if (current_approver_user_id !== req.session.user.userId) {
      return res.status(403).json({ success: false, message: "현재 결재자가 아닙니다." });
    }

    // ✅ 반려 이력 기록
    await conn.query(
      `INSERT INTO approval_history 
         (request_id, approver_role, approver_user_id, comment, signature_path, status, approved_at)
       VALUES (?, ?, ?, ?, ?, '반려', CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
      [requestId, current_approver_role, current_approver_user_id, comment, signaturePath]
    );

    // ✅ 결재 요청 반려 처리
    await conn.query(
      `UPDATE approval_requests 
          SET status='반려', updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00'),
              current_approver_role=NULL, current_approver_user_id=NULL
        WHERE id=?`,
      [requestId]
    );

    await conn.commit();
    res.json({ success: true, message: "결재가 반려되었습니다." });
  } catch (error) {
    await conn.rollback();
    console.error("❌ 결재 반려 오류:", error);
    res.status(500).json({ success: false, message: "결재 반려 실패" });
  } finally {
    conn.release();
  }
});



/* ------------------------------------------------
   ✅ 파일 업로드/다운로드 API
------------------------------------------------ */
app.post("/api/approval/:id/files", upload.array("files", 10), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { id } = req.params;
  try {
    const aliasNames = req.body.aliasNames ? JSON.parse(req.body.aliasNames) : [];
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

app.get("/api/approval/:id/files", async (req, res) => {
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
app.get("/api/files/:filename", async (req, res) => {
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

    // 1) 물리 파일 있으면 바로 응답
    if (fs.existsSync(absPath)) {
      return res.sendFile(absPath);
    }

    // 2) 첨부파일 테이블 fallback
    let dbPath = null;
    {
      const [rows] = await pool.query(
        "SELECT file_path FROM approval_files WHERE file_path = ? LIMIT 1",
        [relPath]
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

    if (dbPath && fs.existsSync(dbPath)) {
      return res.sendFile(dbPath);
    }

    return res.status(404).json({ error: "File not found" });
  } catch (err) {
    console.error("❌ File Fetch Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});



/* ------------------------------------------------
   ✅ 로그인/로그아웃/세션
------------------------------------------------ */
app.post("/api/login", async (req, res) => {
  const { userId, password } = req.body;
  console.log("📥 로그인 시도:", userId, "IP:", req.ip);

  try {
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

      //console.log("user:", user);

      const match = await bcrypt.compare(password, user.password_hash);
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
        deptName: user.dept_name,
        deptId: user.dept_id,
        roles: roles.length > 0 ? roles : [],
      };
      console.log("✅ 로그인 성공:", user.user_id, "→ 세션 저장됨");
      //console.log("✅ req.session.user :", req.session.user );
      res.json({ success: true, user: req.session.user });

  } catch (error) {
    console.error("❌ 로그인 처리 오류:", error);
    res.status(500).json({ success: false, message: "로그인 처리 실패" });
  }

});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get("/api/session", (req, res) => {
  //console.log("req.session.user :", req.session.user);
  if (!req.session.user) {
    return res.json({ success: false, user: null });
  }
  res.json({ success: true, user: req.session.user });
});

/* ------------------------------------------------
   ✅ 사용자 관리
------------------------------------------------ */
// ✅ 사용자 검색 API (roleIds/roleNames 동시 제공) - FIXED
app.get("/api/users/search", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { dept, role, name } = req.query;

  let query = `
    SELECT 
      u.id, 
      u.user_id AS userId, 
      u.user_name AS name, 
      u.email, 
      u.phone, 
      u.dept_name AS dept,
      GROUP_CONCAT(DISTINCT r.id ORDER BY r.id SEPARATOR ',') AS roleIds,
      GROUP_CONCAT(DISTINCT r.role_name ORDER BY r.role_name SEPARATOR ',') AS roleNames
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    WHERE 1=1
  `;
  const params = [];

  if (dept) {
    query += " AND u.dept_name LIKE ?";
    params.push(`%${dept}%`);
  }

  if (role) {
    // 숫자면 role_id로, 아니면 role_name으로 필터
    if (/^\d+$/.test(role)) {
      query += " AND r.id = ?";
      params.push(Number(role));
    } else {
      query += " AND r.role_name = ?";
      params.push(role);
    }
  }

  if (name) {
    query += " AND u.user_name LIKE ?";
    params.push(`%${name}%`);
  }

  query += " GROUP BY u.id";

  try {
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("검색 실패:", err);
    res.status(500).json({ success: false, message: "검색 중 오류가 발생했습니다." });
  }
});


// ✅ 사용자 목록 조회 (roleIds/roleNames 모두 제공)
app.get("/api/users", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const [rows] = await pool.query(`
      SELECT 
        u.id, u.user_id AS userId, u.user_name AS name, u.email, u.phone, u.dept_name AS dept,
        GROUP_CONCAT(DISTINCT r.id) AS roleIds,
        GROUP_CONCAT(DISTINCT r.role_name) AS roleNames
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      GROUP BY u.id
    `);
    res.json(rows);
  } catch (err) {
    console.error("사용자 조회 실패:", err);
    res.status(500).json({ success: false, message: "조회 중 오류가 발생했습니다." });
  }
});


// ✅ 사용자 등록 (roles: ID 배열 권장, 이름 배열도 허용) + 트랜잭션
app.post("/api/users", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false, message: "로그인이 필요합니다." });

  const { userId, name, email, phone, dept, password, roles } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // user_id 중복 체크
    const [dup] = await conn.query("SELECT 1 FROM users WHERE user_id=?", [userId]);
    if (dup.length > 0) {
      await conn.rollback();
      return res.status(409).json({ success: false, message: "이미 존재하는 사용자ID입니다." });
    }

    // ✅ 비밀번호 규칙 (영문/숫자/모든 특수문자 포함, 7자 이상)
    const regex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{7,}$/;
    if (!regex.test(password)) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "비밀번호 규칙 위반(영문/숫자/특수문자 포함, 7자 이상)",
      });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await conn.query(
      "INSERT INTO users (user_id, user_name, email, phone, dept_name, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, name, email, phone, dept, hash]
    );
    const insertedUserId = result.insertId;

    // ✅ roles 처리: ID 배열 우선, 이름 배열도 허용(혼합 가능)
    let roleIds = Array.isArray(roles) ? roles.slice() : [];
    if (roleIds.length > 0) {
      const numeric = roleIds.filter(r => /^\d+$/.test(String(r))).map(r => Number(r));
      const nonNumeric = roleIds.filter(r => !/^\d+$/.test(String(r)));

      // 이름으로 온 것들 id 매핑
      if (nonNumeric.length > 0) {
        const placeholders = nonNumeric.map(() => "?").join(",");
        const [rrows] = await conn.query(
          `SELECT id FROM roles WHERE role_name IN (${placeholders})`,
          nonNumeric
        );
        const mapped = rrows.map(r => r.id);
        roleIds = [...numeric, ...mapped];
      } else {
        roleIds = numeric;
      }

      if (roleIds.length > 0) {
        const values = roleIds.map(rid => [insertedUserId, rid]);
        await conn.query("INSERT INTO user_roles (user_id, role_id) VALUES ?", [values]);
      }
    }

    await conn.commit();
    res.json({ success: true, id: insertedUserId });
  } catch (err) {
    await conn.rollback();
    console.error("사용자 등록 실패:", err);
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "이미 존재하는 사용자ID입니다." });
    }
    res.status(500).json({ success: false, message: "등록 중 오류가 발생했습니다." });
  } finally {
    conn.release();
  }
});


// ✅ 사용자 수정 (비밀번호 변경 포함) + 트랜잭션
app.put("/api/users/:id", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { name, email, phone, dept, roles, newPassword } = req.body;
  const userId = req.params.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1) 기본 정보
    await conn.query(
      "UPDATE users SET user_name=?, email=?, phone=?, dept_name=? WHERE id=?",
      [name, email, phone, dept, userId]
    );

    // 2) 비밀번호 (선택) — 모든 특수문자 허용 + 7자 이상
    if (newPassword && newPassword.trim() !== "") {
      const regex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{7,}$/;
      if (!regex.test(newPassword)) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: "비밀번호 규칙 위반(영문/숫자/특수문자 포함, 7자 이상)",
        });
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await conn.query("UPDATE users SET password_hash=? WHERE id=?", [hash, userId]);
    }

    // 3) 역할 갱신 (전체 삭제 후 재삽입)
    await conn.query("DELETE FROM user_roles WHERE user_id=?", [userId]);

    if (roles && Array.isArray(roles) && roles.length > 0) {
      let roleIds = roles.slice();

      const numeric = roleIds.filter(r => /^\d+$/.test(String(r))).map(r => Number(r));
      const nonNumeric = roleIds.filter(r => !/^\d+$/.test(String(r)));

      if (nonNumeric.length > 0) {
        const placeholders = nonNumeric.map(() => "?").join(",");
        const [rrows] = await conn.query(
          `SELECT id FROM roles WHERE role_name IN (${placeholders})`,
          nonNumeric
        );
        const mapped = rrows.map(r => r.id);
        roleIds = [...numeric, ...mapped];
      } else {
        roleIds = numeric;
      }

      if (roleIds.length > 0) {
        const values = roleIds.map(rid => [userId, rid]);
        await conn.query("INSERT INTO user_roles (user_id, role_id) VALUES ?", [values]);
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("사용자 수정 실패:", err);
    res.status(500).json({ success: false, message: "업데이트 중 오류가 발생했습니다." });
  } finally {
    conn.release();
  }
});

// ✅ 사용자 삭제 (FK 대비: user_roles 먼저 삭제) + 트랜잭션
app.delete("/api/users/:id", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const userId = req.params.id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM user_signatures WHERE user_id = ?", [userId]);
    await conn.query("DELETE FROM user_roles WHERE user_id=?", [userId]);
    await conn.query("DELETE FROM users WHERE id=?", [userId]);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    console.error("사용자 삭제 실패:", err);
    res.status(500).json({ success: false, message: "삭제 중 오류가 발생했습니다." });
  } finally {
    conn.release();
  }
});

// ── ✅ 사용자 기본 서명 조회
app.get("/api/users/:id/signature/default", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: "로그인이 필요합니다." });

  const targetUserId = req.params.id;

  // (선택) 관리자 또는 본인만 허용
  const isAdmin = Array.isArray(req.session.user.roles) &&
    req.session.user.roles.some(r => r.role_name === "관리자");
  if (!isAdmin && String(req.session.user.id) !== String(targetUserId)) {
    return res.status(403).json({ message: "권한 없음" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT id, file_path, is_default, created_at FROM user_signatures WHERE user_id=? AND is_default=1 LIMIT 1",
      [targetUserId]
    );
    res.json(rows[0] || { id: null, file_path: null, is_default: 0 });
  } catch (e) {
    console.error("❌ 기본 서명 조회 실패:", e);
    res.status(500).json({ message: "server error" });
  }
});

// ── ✅ 사용자 서명 업로드(캔버스→PNG) + 기본지정 옵션
// FormData: file=<blob>, isDefault=1|0
app.post("/api/users/:id/signatures", uploadSignature.single("file"), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ message: "로그인이 필요합니다." });

  const targetUserId = req.params.id;
  const isDefault = req.body.isDefault === "1" ? 1 : 0;

  // (선택) 관리자 또는 본인만 허용
  const isAdmin = Array.isArray(req.session.user.roles) &&
    req.session.user.roles.some(r => r.role_name === "관리자");
  if (!isAdmin && String(req.session.user.id) !== String(targetUserId)) {
    return res.status(403).json({ message: "권한 없음" });
  }
  if (!req.file) return res.status(400).json({ message: "파일이 없습니다." });

  // 저장 경로는 uploads/signatures/파일명 → DB/클라이언트에는 "signatures/파일명"
  const relPath = path.posix.join("signatures", req.file.filename);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (isDefault) {
      await conn.query("UPDATE user_signatures SET is_default=0 WHERE user_id=?", [targetUserId]);
    }
    await conn.query(
      "INSERT INTO user_signatures (user_id, file_path, is_default) VALUES (?, ?, ?)",
      [targetUserId, relPath, isDefault]
    );

    await conn.commit();
    res.json({ success: true, file_path: relPath });
  } catch (e) {
    await conn.rollback();
    console.error("❌ 서명 저장 실패:", e);
    res.status(500).json({ message: "server error" });
  } finally {
    conn.release();
  }
});

// ───────────────────────────────────────────────────────────
// GET /api/users/me/signature
// 기본 서명(최신 is_default=1) 조회 → { signature: "/api/files/..." | null }
// ───────────────────────────────────────────────────────────
app.get("/api/users/me/signature", async (req, res) => {
  const u = getLoginUser(req);
  if (!u) return res.status(401).json({ message: "Unauthorized" });

  try {
    const [rows] = await pool.query(
      `SELECT file_path 
         FROM user_signatures 
        WHERE user_id = ? AND is_default = 1 
        ORDER BY created_at DESC 
        LIMIT 1`,
      [u.id] // 문자열 사용자아이디
    );

    if (!rows.length) return res.json({ signature: null });

    const url = makeSignatureUrl(rows[0].file_path);
    return res.json({ signature: url });
  } catch (e) {
    console.error("GET /api/users/me/signature error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

// ───────────────────────────────────────────────────────────
// PUT /api/users/me/signature
// body: { signature: "data:image/png;base64,..." }
// 저장: 파일 디코드 → uploads/signatures/ 에 저장 → user_signatures에 INSERT + is_default=1
// ───────────────────────────────────────────────────────────
app.put("/api/users/me/signature", async (req, res) => {
  const u = getLoginUser(req);
  if (!u) return res.status(401).json({ message: "Unauthorized" });

  try {
    const { signature } = req.body;
    if (typeof signature !== "string" || !signature.startsWith("data:image/png;base64,")) {
      return res.status(400).json({ message: "Invalid signature format" });
    }

    // 크기 제한(옵션)
    const base64Data = signature.replace(/^data:image\/png;base64,/, "");
    const buf = Buffer.from(base64Data, "base64");
    if (buf.length > 2 * 1024 * 1024) { // 2MB
      return res.status(413).json({ message: "Signature too large (>2MB)" });
    }

    // 파일로 저장
    const ts = Date.now();
    const filename = `${ts}_signature.png`;
    const absPath = path.join(SIGN_BASE_DIR, filename);
    fs.writeFileSync(absPath, buf);

    const relPath = path.posix.join("signatures", filename);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 기존 기본서명 해제
      await conn.query(
        "UPDATE user_signatures SET is_default = 0 WHERE user_id = ? AND is_default = 1",
        [u.id]
      );

      // 새 레코드 삽입 (기본서명)
      await conn.query(
        "INSERT INTO user_signatures (user_id, file_path, is_default) VALUES (?, ?, 1)",
        [u.id, relPath]
      );

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      console.error("PUT /api/users/me/signature tx error:", e);
      return res.status(500).json({ message: "Server error" });
    } finally {
      conn.release();
    }

    return res.json({ ok: true, file_path: relPath, url: makeSignatureUrl(relPath) });
  } catch (e) {
    console.error("PUT /api/users/me/signature error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});



/* ------------------------------------------------
   ✅ 권한 관리
------------------------------------------------ */
app.get("/api/roles", async (req, res) => {
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
app.get("/api/access/:roleId", async (req, res) => {
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

// ✅ 접근 권한 추가/삭제 (토글)
app.post("/api/access", async (req, res) => {
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
app.delete("/api/access/:roleId", async (req, res) => {
  try {
    await pool.query("DELETE FROM role_access WHERE role_id=?", [req.params.roleId]);
    res.json({ success: true });
  } catch (err) {
    console.error("권한 초기화 실패:", err);
    res.status(500).json({ success: false });
  }
});

// 부서 목록 조회
app.get("/api/departments", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, dept_name, dept_cd FROM departments ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error("부서 조회 실패:", err);
    res.status(500).json({ error: "부서 조회 실패" });
  }
});


/* ------------------------------------------------
   ✅ Account Categories API (CRUD)
------------------------------------------------ */

// 특정 부서별 계정과목 조회 (기준일자 조건 포함)
app.get("/api/accountCategories/:deptId", async (req, res) => {
  try {
    const deptId = req.params.deptId;
    const { date } = req.query;

    let query = `
      SELECT id, category_id, dept_id, parent_id, category_name, level, valid_from, valid_to, created_at, updated_at
        FROM account_categories
       WHERE dept_id = ?
    `;
    const params = [deptId];

    // ✅ 기준일자가 있으면 유효기간 조건 추가
    if (date) {
      query += ` AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)`;
      params.push(date, date);
    }

    query += ` ORDER BY category_id`;

    const [rows] = await pool.query(query, params);

    res.json({ success: true, categories: rows });
  } catch (err) {
    console.error("❌ accountCategories 조회 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 계정과목 추가
app.post("/api/accountCategories", async (req, res) => {
  try {
    const { category_id, dept_id, parent_id, category_name, level, valid_from} = req.body;
    const [result] = await pool.query(
      `INSERT INTO account_categories (category_id, dept_id, parent_id, category_name, level, valid_from)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [category_id, dept_id, parent_id || null, category_name, level, valid_from || new Date()]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error("❌ accountCategories 추가 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 계정과목 수정
app.put("/api/accountCategories/:id", async (req, res) => {
  try {
    const { category_name, level, parent_id, valid_from, valid_to } = req.body;
    await pool.query(
      `UPDATE account_categories 
          SET category_name=?, updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
        WHERE id=?`,
      [category_name, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ accountCategories 수정 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 계정과목 종료(valid_to 업데이트)
app.put("/api/accountCategories/:id/expire", async (req, res) => {
  try {
    const { valid_to } = req.body;
    await pool.query(
      `UPDATE account_categories 
          SET valid_to=?, updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
        WHERE id=?`,
      [valid_to || new Date(), req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ accountCategories 종료 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 계정과목 삭제
app.delete("/api/accountCategories/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM account_categories WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ accountCategories 삭제 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// 부서별 예산 조회
app.get("/api/budgets/:deptId", async (req, res) => {
  try {
    const { year } = req.query;
    const [rows] = await pool.query(
      `SELECT id, dept_id, category_id, year, budget_amount
         FROM budgets
        WHERE dept_id = ? AND year = ?`,
      [req.params.deptId, year]
    );
    res.json({ success: true, budgets: rows });
  } catch (err) {
    console.error("❌ budgets 조회 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 예산 입력/수정 (Upsert)
app.post("/api/budgets", async (req, res) => {
  try {
    const { dept_id, category_id, year, budget_amount } = req.body;
    await pool.query(
      `INSERT INTO budgets (dept_id, category_id, year, budget_amount)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE budget_amount=?, updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')`,
      [dept_id, category_id, year, budget_amount, budget_amount]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ budgets 저장 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 일괄 예산 저장 (Upsert)
app.post("/api/budgets/bulk", async (req, res) => {
  try {
    const budgets = req.body.budgets;
    if (!Array.isArray(budgets) || budgets.length === 0) {
      return res.status(400).json({ success: false, error: "예산 데이터 없음" });
    }

    const values = budgets.map(b => [b.dept_id, b.category_id, b.year, b.budget_amount]);

    await pool.query(
      `INSERT INTO budgets (dept_id, category_id, year, budget_amount)
       VALUES ?
       ON DUPLICATE KEY UPDATE budget_amount = VALUES(budget_amount), updated_at = CONVERT_TZ(NOW(), '+00:00', '+09:00')`,
      [values]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ bulk 예산 저장 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


/* ------------------------------------------------
   📊 부서별 예산 & 지출 합계 조회 API
   GET /api/expenses/summary?deptId=1&year=2025
------------------------------------------------ */
app.get("/api/expenses/summary", async (req, res) => {
  try {
    const { deptId, year } = req.query;
    console.log("deptId :",deptId);

    if (!deptId || !year) {
      return res.status(400).json({ success: false, message: "deptId, year 필요" });
    }

    // ✅ 최상위 계정(관) 가져오기
    const [rootRows] = await pool.query(
      `SELECT category_id 
         FROM account_categories 
        WHERE parent_id IS NULL AND level='관' AND dept_id=?
        LIMIT 1`,
        [deptId]
    );
    console.log("rootRows :",rootRows);

    if (rootRows.length === 0) {
      return res.json({ success: true, totalBudget: 0, totalExpense: 0 });
    }
    const rootCategoryId = rootRows[0].category_id;
    console.log("rootCategoryId :",rootCategoryId);

    // ✅ 예산 총액 (budgets)
    const [[budgetRow]] = await pool.query(
      `SELECT COALESCE(SUM(budget_amount),0) AS totalBudget
         FROM budgets
        WHERE dept_id=? AND year=? AND category_id=?`,
      [deptId, year, rootCategoryId]
    );
    console.log("budgetRow :",budgetRow);

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
   📊 부서별 전체 예산/지출/잔액 조회 API
   GET /api/budget-status?year=2025
------------------------------------------------ */
app.get("/api/budget-status", async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();

    // ✅ 부서별 예산 & 지출 합계
    const [rows] = await pool.query(
      `
      SELECT 
          d.id AS dept_id,
          d.dept_name,
          COALESCE(b.budget_amount,0) as total_budget,
          COALESCE(ev.expense_amount,0) as total_expense,
          COALESCE(b.budget_amount,0) - COALESCE(ev.expense_amount,0) AS remaining_amount
      FROM departments d
      LEFT JOIN ( select b.id, b.dept_id, b.category_id , b.year , b.budget_amount  
			      from budgets b 
			      INNER JOIN account_categories ac 
			      	 ON b.dept_id = ac.dept_id and ac.category_id = b.category_id and ac.parent_id is NULL
			      where b.year = ?
      ) b on d.id = b.dept_id
	    LEFT JOIN ( select e.dept_id, COALESCE(sum(e.amount),0) as expense_amount 
			      from expense_details e 
			      where e.year = ?
			      group by e.dept_id
      ) ev on d.id = ev.dept_id
      where d.parent_dept_id is not null 
      `,
      [year, year]
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ /api/budget-status 오류:", err);
    res.status(500).json({ success: false, message: "예산 현황 조회 실패" });
  }
});


/* ------------------------------------------------
   ✅ 서버 실행
------------------------------------------------ */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
