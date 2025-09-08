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

const app = express();
const PORT = 3001;

// ✅ CORS 설정 (.env 기반)
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(o => o.trim())
  : [];

app.use(cors({
  origin: function (origin, callback) {
    console.log("🌍 요청 Origin:", origin); 
    // 개발용: origin 없을 때 (예: Postman) 허용
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn("❌ CORS 차단:", origin);
      callback(new Error("CORS not allowed: " + origin));
    }
  },
  credentials: true
}));


app.use(bodyParser.json());
app.use(
  session({
    secret: "secret-key",
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
  host: "localhost",
  port: 32006,
  user: "reportuser",
  password: "reportpass",
  database: "reportdb",
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

    const { documentType, deptName, author, date, totalAmount, comment, aliasName, items } =
      req.body;

    // approval_requests 저장 (status = 진행중)
    const [result] = await conn.query(
      `INSERT INTO approval_requests 
       (document_type, dept_name, author, request_date, total_amount, comment, aliasName, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, '진행중')`,
      [documentType, deptName, author, date, totalAmount, comment, aliasName]
    );

    const requestId = result.insertId;

    // ✅ 신청자의 approver_order 찾기
    const [applicantRows] = await conn.query(
      `SELECT approver_order 
         FROM dept_approvers 
        WHERE dept_name = ? AND approver_name = ? AND is_active = 1 
        LIMIT 1`,
      [deptName, author]
    );

    let nextApprover = null;

    if (applicantRows.length > 0) {
      const applicantOrder = applicantRows[0].approver_order;
      const [nextRows] = await conn.query(
        `SELECT role, approver_name 
           FROM dept_approvers 
          WHERE dept_name = ? AND approver_order = ? AND is_active = 1 
          LIMIT 1`,
        [deptName, applicantOrder + 1]
      );

      if (nextRows.length > 0) {
        nextApprover = nextRows[0];
      }
    }

    // ✅ approval_requests에 다음 결재자 업데이트
    if (nextApprover) {
      await conn.query(
        `UPDATE approval_requests 
            SET current_approver_role = ?, current_approver_name = ? 
          WHERE id = ?`,
        [nextApprover.role, nextApprover.approver_name, requestId]
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
    const { requestId, approver_role, approver_name, comment } = req.body;
    const signaturePath = req.file ? req.file.filename : null;

    if (!requestId || !approver_name) {
      return res.status(400).json({ success: false, message: "필수 값 누락" });
    }

    await pool.query(
      `INSERT INTO approval_history (request_id, approver_role, approver_name, comment, signature_path, approved_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [requestId, approver_role, approver_name, comment, signaturePath]
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
    const { deptName, documentType, startDate, endDate, status, approverName,page = 1, pageSize = 10 } = req.body;

    let where = "WHERE 1=1";
    const params = [];

    // ✅ 현재 부서 + 하위부서 조회
    let deptList = [];
    if (deptName) {
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
        [deptName]
      );
      deptList = subDepts.map(d => d.dept_name);
    }

    if (deptList.length > 0) {
      where += ` AND ar.dept_name IN (${deptList.map(() => "?").join(",")})`;
      params.push(...deptList);
    }


    // if (deptName) {
    //   where += " AND ar.dept_name LIKE ?";
    //   params.push(`%${deptName}%`);
    // }
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
      where += " AND ar.status = ?";
      params.push(status);
    }

    // ✅ 현재 결재자
    if (approverName) {
      where += " AND ar.current_approver_name = ?";
      params.push(approverName);
    }

    const [[{ count }]] = await pool.query(
      `SELECT COUNT(*) as count FROM approval_requests ar ${where}`,
      params
    );

    const totalPages = Math.ceil(count / pageSize);
    const offset = (page - 1) * pageSize;

    const [rows] = await pool.query(
      `SELECT ar.id, ar.dept_name, ar.document_type, ar.request_date, ar.total_amount, 
              ar.author, ar.aliasName, ar.status, ar.current_approver_role, ar.current_approver_name
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
      `SELECT approver_name, approver_role, comment, signature_path, approved_at
         FROM approval_history
        WHERE request_id = ?
        ORDER BY approved_at ASC`,
      [id]
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
      approvalHistory: history
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
      `SELECT dept_name, current_approver_role, current_approver_name
         FROM approval_requests 
        WHERE id=? FOR UPDATE`,
      [requestId]
    );
    if (reqRows.length === 0) {
      return res.status(404).json({ success: false, message: "결재 요청 없음" });
    }

    const { dept_name, current_approver_role, current_approver_name } = reqRows[0];

    // ✅ 로그인한 사용자가 실제 결재자인지 검증
    if (current_approver_name !== req.session.user.userName) {
      return res.status(403).json({ success: false, message: "현재 결재자가 아닙니다." });
    }

    // ✅ 승인 이력 기록
    await conn.query(
      `INSERT INTO approval_history 
         (request_id, approver_role, approver_name, comment, signature_path, status, approved_at)
       VALUES (?, ?, ?, ?, ?, '승인', CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
      [requestId, current_approver_role, current_approver_name, comment, signaturePath]
    );

    // ✅ 다음 결재자 찾기
    const [[roleRow]] = await conn.query(
      `SELECT order_no FROM approval_line WHERE dept_name=? AND approver_role=?`,
      [dept_name, current_approver_role]
    );
    const currentOrder = roleRow.order_no;

    const [nextRows] = await conn.query(
      `SELECT approver_role, approver_name 
         FROM approval_line 
        WHERE dept_name=? AND order_no=?`,
      [dept_name, currentOrder + 1]
    );

    if (nextRows.length > 0) {
      // 다음 결재자 지정
      await conn.query(
        `UPDATE approval_requests
           SET current_approver_role=?, current_approver_name=?, updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
         WHERE id=?`,
        [nextRows[0].approver_role, nextRows[0].approver_name, requestId]
      );
    } else {
      // 마지막 결재자 → 완료 처리
      await conn.query(
        `UPDATE approval_requests
           SET status='완료', updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
         WHERE id=?`,
        [requestId]
      );
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
      `SELECT current_approver_role, current_approver_name 
         FROM approval_requests 
        WHERE id=? FOR UPDATE`,
      [requestId]
    );
    if (reqRows.length === 0) {
      return res.status(404).json({ success: false, message: "결재 요청 없음" });
    }

    const { current_approver_role, current_approver_name } = reqRows[0];

    // ✅ 로그인한 사용자가 실제 결재자인지 검증
    if (current_approver_name !== req.session.user.userName) {
      return res.status(403).json({ success: false, message: "현재 결재자가 아닙니다." });
    }

    // ✅ 반려 이력 기록
    await conn.query(
      `INSERT INTO approval_history 
         (request_id, approver_role, approver_name, comment, signature_path, status, approved_at)
       VALUES (?, ?, ?, ?, ?, '반려', CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
      [requestId, current_approver_role, current_approver_name, comment, signaturePath]
    );

    // ✅ 결재 요청 반려 처리
    await conn.query(
      `UPDATE approval_requests 
          SET status='반려', updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00'),
              current_approver_role=NULL, current_approver_name=NULL
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

app.get("/api/files/:filename", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }
  const filename = req.params.filename;
  try {
    let filePath = path.join(uploadDir, filename);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);

    const [rows] = await pool.query(
      "SELECT file_path FROM approval_files WHERE file_name = ? LIMIT 1",
      [filename]
    );
    if (rows.length > 0) {
      const dbFilePath = path.join(uploadDir, rows[0].file_path);
      if (fs.existsSync(dbFilePath)) return res.sendFile(dbFilePath);
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

  const [rows] = await pool.query("SELECT * FROM users WHERE user_id = ?", [userId]);
  if (rows.length === 0) {
    console.warn("❌ 로그인 실패: ID 없음", userId);
    return res.status(401).json({ success: false, message: "ID 없음" });
  }

  const user = rows[0];
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
    roles: roles.length > 0 ? roles : [],
  };
  console.log("✅ 로그인 성공:", user.user_id, "→ 세션 저장됨");
  res.json({ success: true, user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get("/api/session", (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false, user: null });
  }
  res.json({ success: true, user: req.session.user });
});

/* ------------------------------------------------
   ✅ 사용자 관리
------------------------------------------------ */
/* ------------------------------------------------
   ✅ 사용자 API (CRUD)
------------------------------------------------ */
// ✅ 사용자 검색 API
app.get("/api/users/search", async (req, res) => {
  const { dept, role, name } = req.query;

  let query = `
    SELECT u.id, u.user_id AS userId, u.user_name AS name, u.email, u.phone, 
           u.dept_name AS dept,
           GROUP_CONCAT(r.id) AS roles
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
    query += " AND r.role_name = ?";
    params.push(role);
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
    res.status(500).json({ success: false });
  }
});

// ✅ 사용자 목록 조회 (roles, dept_name alias 포함)
app.get("/api/users", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.user_id AS userId, u.user_name AS name, u.email, u.phone, 
             u.dept_name AS dept,
             GROUP_CONCAT(r.role_name) AS roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      GROUP BY u.id
    `);
    res.json(rows);
  } catch (err) {
    console.error("사용자 조회 실패:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ 사용자 등록
app.post("/api/users", async (req, res) => {
  if (!req.session.user) return res.status(401).json({ success: false });

  const { userId, name, email, phone, dept, password, roles } = req.body;

  try {
    const regex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*]).{7,}$/;
    if (!regex.test(password)) {
      return res.status(400).json({ success: false, message: "비밀번호 규칙 위반" });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (user_id, user_name, email, phone, dept_name, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
      [userId, name, email, phone, dept, hash]
    );

    const insertedUserId = result.insertId;

    if (roles && roles.length > 0) {
      for (const roleName of roles) {
        const [roleRow] = await pool.query("SELECT id FROM roles WHERE role_name=?", [roleName]);
        if (roleRow.length > 0) {
          await pool.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [
            insertedUserId,
            roleRow[0].id,
          ]);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("사용자 등록 실패:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ 사용자 수정 (비밀번호 변경 포함)
app.put("/api/users/:id", async (req, res) => {
  const { name, email, phone, dept, roles, newPassword } = req.body;

  try {
    // 1. 기본 사용자 정보 업데이트
    await pool.query(
      "UPDATE users SET user_name=?, email=?, phone=?, dept_name=? WHERE id=?",
      [name, email, phone, dept, req.params.id]
    );

    // 2. 비밀번호 변경 처리 (선택적)
    if (newPassword && newPassword.trim() !== "") {
      const regex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*]).{7,}$/;
      if (!regex.test(newPassword)) {
        return res.status(400).json({ success: false, message: "비밀번호 규칙 위반" });
      }

      const hash = await bcrypt.hash(newPassword, 10);
      await pool.query(
        "UPDATE users SET password_hash=? WHERE id=?",
        [hash, req.params.id]
      );
    }

    console.log("roles :", roles);

    // 3. 역할 갱신
    await pool.query("DELETE FROM user_roles WHERE user_id=?", [req.params.id]);
    if (roles && Array.isArray(roles)) {
      for (const roleId of roles) {
        await pool.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [
          req.params.id,
          roleId,
        ]);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("사용자 수정 실패:", err);
    res.status(500).json({ success: false });
  }
});


// ✅ 사용자 삭제
app.delete("/api/users/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM users WHERE id=?", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("사용자 삭제 실패:", err);
    res.status(500).json({ success: false });
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
    const [rows] = await pool.query("SELECT id, dept_name FROM departments ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error("부서 조회 실패:", err);
    res.status(500).json({ error: "부서 조회 실패" });
  }
});


/* ------------------------------------------------
   ✅ 서버 실행
------------------------------------------------ */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
