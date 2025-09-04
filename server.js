const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcrypt");
const app = express();
const PORT = 3001;

app.use(cors({ origin: "http://localhost:5174", credentials: true }));
app.use(bodyParser.json());
app.use(
  session({
    secret: "secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
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
   ✅ 결재 요청 등록 API
------------------------------------------------ */
app.post("/api/approval", async (req, res) => {

  // 세션에 user 정보가 없으면 로그인 안 된 상태
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { documentType, deptName, author, date, totalAmount, comment, aliasName, items } =
      req.body;

    // approval_requests 저장
    const [result] = await conn.query(
      `INSERT INTO approval_requests 
       (document_type, dept_name, author, request_date, total_amount, comment, aliasName) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [documentType, deptName, author, date, totalAmount, comment, aliasName]
    );

    const requestId = result.insertId;

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

/* ------------------------------------------------
   ✅ 결재 목록 조회 API
------------------------------------------------ */
app.post("/api/approvalList", async (req, res) => {
  
  // 세션에 user 정보가 없으면 로그인 안 된 상태
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { deptName, documentType, startDate, endDate, page = 1, pageSize = 10 } = req.body;

    let where = "WHERE 1=1";
    const params = [];

    if (deptName) {
      where += " AND ar.dept_name LIKE ?";
      params.push(`%${deptName}%`);
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

    const [[{ count }]] = await pool.query(
      `SELECT COUNT(*) as count FROM approval_requests ar ${where}`,
      params
    );

    const totalPages = Math.ceil(count / pageSize);
    const offset = (page - 1) * pageSize;

    const [rows] = await pool.query(
      `SELECT ar.id, ar.dept_name, ar.document_type, ar.request_date, ar.total_amount, ar.author, ar.aliasName
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
   ✅ 결재요청 상세 조회
------------------------------------------------ */
app.get("/api/approval/:id", async (req, res) => {

  // 세션에 user 정보가 없으면 로그인 안 된 상태
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

    // ✅ 첨부파일 정보도 포함
    const [files] = await pool.query(
      "SELECT id, file_name, file_path, mime_type, file_size, alias_name FROM approval_files WHERE request_id = ?",
      [id]
    );

    res.json({
      id: request.id,
      documentType: request.document_type,
      deptName: request.dept_name,
      author: request.author,
      date: request.request_date,
      totalAmount: request.total_amount,
      comment: request.comment,
      aliasName: request.aliasName,
      items,
      attachedFiles: files   // ✅ 첨부파일 함께 반환
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------
   ✅ 파일 업로드 API (aliasName 지원)
------------------------------------------------ */
app.post("/api/approval/:id/files", upload.array("files", 10), async (req, res) => {

// 세션에 user 정보가 없으면 로그인 안 된 상태
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

/* ------------------------------------------------
   ✅ 첨부파일 목록 조회 API
------------------------------------------------ */
app.get("/api/approval/:id/files", async (req, res) => {

// 세션에 user 정보가 없으면 로그인 안 된 상태
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT id, file_name, file_path, mime_type, file_size, alias_name, created_at 
       FROM approval_files 
       WHERE request_id = ?`,
      [id]
    );
    res.json({ success: true, files: rows });
  } catch (err) {
    console.error("❌ File List Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------
   ✅ 파일 다운로드 & 미리보기
   - file_path / file_name 둘 다 지원
   - sendFile() 사용 → 이미지, PDF 미리보기 가능
------------------------------------------------ */
app.get("/api/files/:filename", async (req, res) => {

// 세션에 user 정보가 없으면 로그인 안 된 상태
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const filename = req.params.filename;

  try {
    // 1) uploads/ 안에서 직접 찾기 (file_path 기준)
    let filePath = path.join(uploadDir, filename);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }

    // 2) DB에서 file_name 으로 검색 후 file_path 찾기
    const [rows] = await pool.query(
      "SELECT file_path FROM approval_files WHERE file_name = ? LIMIT 1",
      [filename]
    );
    if (rows.length > 0) {
      const dbFilePath = path.join(uploadDir, rows[0].file_path);
      if (fs.existsSync(dbFilePath)) {
        return res.sendFile(dbFilePath);
      }
    }

    return res.status(404).json({ error: "File not found" });
  } catch (err) {
    console.error("❌ File Fetch Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------------------- 로그인 ----------------------
app.post("/api/login", async (req, res) => {
  const { userId, password } = req.body;
  const [rows] = await pool.query("SELECT * FROM users WHERE user_id = ?", [userId]);
  if (rows.length === 0)
    return res.status(401).json({ success: false, message: "ID 없음" });

  const user = rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match)
    return res.status(401).json({ success: false, message: "비밀번호 불일치" });

  // ✅ 사용자 권한 항상 배열로
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
    deptName: user.dept_name,   // ✅ 추가됨
    // ✅ roles: 무조건 배열 (없으면 빈 배열)
    roles: roles.length > 0 ? roles : [],
  };

  res.json({ success: true, user: req.session.user });
});

// ---------------------- 로그아웃 ----------------------
app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ---------------------- 세션 ----------------------
app.get("/api/session", (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false, user: null }); // ✅ 200 응답
  }
  res.json({ success: true, user: req.session.user });
});

// ---------------------- 사용자 관리 ----------------------
app.get("/api/users", async (req, res) => {

  // 세션에 user 정보가 없으면 로그인 안 된 상태
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const [rows] = await pool.query("SELECT id, user_id, user_name, email, phone, dept_name FROM users");
  res.json({ users: rows });
});

app.post("/api/users", async (req, res) => {

  // 세션에 user 정보가 없으면 로그인 안 된 상태
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { userId, userName, email, phone, deptName, password, roles } = req.body;

  // 비밀번호 규칙 체크
  const regex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*]).{7,}$/;
  if (!regex.test(password)) {
    return res.status(400).json({ success: false, message: "비밀번호 규칙 위반" });
  }

  const hash = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    "INSERT INTO users (user_id, user_name, email, phone, dept_name, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, userName, email, phone, deptName, hash]
  );
  const userIdInserted = result.insertId;

  if (roles && roles.length > 0) {
    for (const roleId of roles) {
      await pool.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [
        userIdInserted,
        roleId,
      ]);
    }
  }

  res.json({ success: true });
});


// ---------------------- 권한 목록 ----------------------
app.get("/api/roles", async (req, res) => {

  // 세션에 user 정보가 없으면 로그인 안 된 상태
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const [rows] = await pool.query("SELECT * FROM roles");
  res.json({ roles: rows });
});

// ---------------------- 권한별 접근 관리 ----------------------
// 특정 역할(roleId)의 접근 목록 조회
app.get("/api/access/:roleId", async (req, res) => {

// 세션에 user 정보가 없으면 로그인 안 된 상태
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { roleId } = req.params;
  const [rows] = await pool.query(
    "SELECT menu_name, access_type FROM access_controls WHERE role_id = ?",
    [roleId]
  );
  res.json({ access: rows });
});

// 권한 추가/삭제
app.post("/api/access", async (req, res) => {

  // 세션에 user 정보가 없으면 로그인 안 된 상태
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { roleId, menuName, accessType, enabled } = req.body;

  if (enabled) {
    await pool.query(
      "INSERT IGNORE INTO access_controls (role_id, menu_name, access_type) VALUES (?, ?, ?)",
      [roleId, menuName, accessType]
    );
  } else {
    await pool.query(
      "DELETE FROM access_controls WHERE role_id = ? AND menu_name = ? AND access_type = ?",
      [roleId, menuName, accessType]
    );
  }

  res.json({ success: true });
});

// 권한 체크 미들웨어
async function checkAccess(roleIds, menu, type) {

  // 세션에 user 정보가 없으면 로그인 안 된 상태
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const [rows] = await pool.query(
    "SELECT 1 FROM access_controls WHERE role_id IN (?) AND menu_name=? AND access_type=?",
    [roleIds, menu, type]
  );
  return rows.length > 0;
}




/* ------------------------------------------------
   ✅ 서버 실행
------------------------------------------------ */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
