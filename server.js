const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcrypt");
const os = require("os");
require("dotenv").config();   // ✅ .env 불러오기 (가장 먼저)

const { sendApprovalAlimTalk } = require("./services/sendApprovalAlimTalk");

// ───────────────────────────────────────────────────────────
// ✅ NODE_ENV 자동 감지 (로컬=development, Pod/컨테이너=production)
//    - 명시적으로 NODE_ENV가 있으면 그 값을 우선 사용
//    - K8s 환경 변수(KUBERNETES_SERVICE_HOST) 또는 hostname 패턴으로 감지
// ───────────────────────────────────────────────────────────

if (!process.env.NODE_ENV) {
  const isK8s = !!process.env.KUBERNETES_SERVICE_HOST || /pod|deploy|stateful|sts/i.test(os.hostname());
  console.log("isK8s:", isK8s);
  console.log("!!process.env.KUBERNETES_SERVICE_HOST:", !!process.env.KUBERNETES_SERVICE_HOST);
  console.log("/pod|deploy|stateful|sts/i.test(os.hostname()):", /pod|deploy|stateful|sts/i.test(os.hostname()));
  process.env.NODE_ENV = isK8s ? "production" : "development";
}

console.error("process.env.NODE_ENV:", process.env.NODE_ENV);

// ✅ NODE_ENV 확정 후 env 헬퍼 로드 (순서 중요!)
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
// 프록시(로드밸런서/Ingress) 뒤에 있을 수 있으므로 운영에서는 trust proxy 설정
if (ENV === "production") {
  app.set("trust proxy", 1);
}
// app.use("/api/email", emailRoutes);

app.use(
  session({
    secret: envPick("SESSION_SECRET", "secret-key"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // ✅ HTTPS일 때만 Secure 자동 적용(프록시 고려)
      //    - Ingress가 TLS 종료하면 req.secure=true로 인식됨(trust proxy 필요)
      secure: "auto",
      sameSite: "lax"
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
console.log(`🌍 NODE_ENV: ${process.env.NODE_ENV}  (ENV helper: ${ENV})`);
console.log(`📦 DB → ${envPick("DB_HOST", "localhost")}:${envNumber("DB_PORT", 3306)} / ${envPick("DB_NAME", "test")}`);


// 업로드 폴더 생성
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// multer 스토리지 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // 한글 등 유니코드 파일명 깨짐 방지: latin1 -> utf8 로 전환
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});
const upload = multer({
  storage,
  limits: { fieldSize: 50 * 1024 * 1024 } // 50MB (base64 문자열 허용 위함)
});

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

// 세션에서 1차 역할 뽑기 (role_name 우선, 없으면 원시값)
function getUserPrimaryRole(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  // 우선순위가 있다면 여기에 배열로 두고 가장 먼저 매칭되는 것을 사용
  const priority = ["부장", "팀장", "회계", "담당"];

  const roleNames = roles
    .map(r => r?.role_name ?? r)
    .filter(Boolean);

  // 우선순위 매칭
  for (const p of priority) {
    if (roleNames.includes(p)) return p;
  }
  // 없으면 첫 번째
  return roleNames[0] ?? null;
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

    const { documentType, author, userId, date, totalAmount, comment, aliasName, items, selectedGwan, selectedHang } =
      req.body;
    // ✅ 클라이언트가 선택한 부서명 사용 (재정부 등이 다른 부서 선택 시). body 문자열이 있으면 무조건 사용, 없을 때만 세션
    const bodyDeptName = req.body.deptName ?? req.body.dept_name;
    const deptName =
      typeof bodyDeptName === "string" && bodyDeptName.trim() !== ""
        ? bodyDeptName.trim()
        : req.session?.user?.deptName ?? null;
    console.log("POST /api/approval body.deptName:", req.body.deptName, "body.dept_name:", req.body.dept_name, "→ deptName:", deptName);
    if (!deptName) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ success: false, message: "부서 정보가 없습니다." });
    }

    // ✅ 재정부 권한 사용자가 타부서 결재요청 시 진행상태를 결재완료로 바로 처리
    const userDeptName = req.session?.user?.deptName ?? "";
    const isFinanceUserRequestingOtherDept = userDeptName === "재정부" && deptName !== "재정부";
    const initialStatus = isFinanceUserRequestingOtherDept ? "결재완료" : "결재진행중";

    // ✅ 1. 부서 ID 조회 및 연도 추출 (approval_items 저장용)
    const [[deptRow]] = await conn.query("SELECT id FROM departments WHERE dept_name = ?", [deptName]);
    if (!deptRow) {
      throw new Error(`부서 정보를 찾을 수 없습니다: ${deptName}`);
    }
    const deptId = deptRow.id;
    const requestYear = new Date(date).getFullYear();


    // approval_requests 저장 (재정부→타부서 요청 시 status = 결재완료, 그 외 결재진행중)
    const [result] = await conn.query(
      `INSERT INTO approval_requests 
       (document_type, dept_name, author, request_date, total_amount, comment, aliasName, status, category_gwan, category_hang) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [documentType, deptName, author, date, totalAmount, comment, aliasName, initialStatus, selectedGwan, selectedHang]
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

    // ✅ approval_requests에 다음 결재자 업데이트 (결재진행중일 때만)
    if (initialStatus === "결재진행중" && nextApprover) {
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
        deptId,      // ✅ 추가
        requestYear  // ✅ 추가
      ]);

      await conn.query(
        `INSERT INTO approval_items 
         (request_id, gwan, hang, mok, semok, detail, amount, dept_id, year) 
         VALUES ?`,
        [itemInserts]
      );
    }

    await conn.commit();
    res.json({ success: true, id: requestId });

    // ✅ 커밋 후 비동기 발송 (결재진행중일 때만 다음 결재자에게 이관 메일 발송)
    if (initialStatus === "결재진행중") {
      setImmediate(async () => {
        try {
          // 다음 결재자 정보 조회 (휴대폰)
          const [[nextUser]] = await pool.query(
            `SELECT user_name, phone FROM users WHERE user_id = ? LIMIT 1`,
            [nextApprover?.approver_user_id]
          );
          const toPhone = nextUser?.phone;
          console.log("/api/approval - nextUser:", nextUser);
          console.log("/api/approval - toPhone:", toPhone);

          // ✅ 알림톡 발송
          if (toPhone) {
            await sendApprovalAlimTalk({
              to: toPhone,
              templateCode: process.env.SENDON_TEMPLATE_ID,
              deptName,
              author,
              requestDate: date,
              totalAmount,
              comment,
              urlPath: "approvalStatus"
            });
          }
        } catch (e) {
          console.error("❌ approval notification send error:", e.message);
        }
      });
    }

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
    // ✅ 진행상태 및 권한별 필터링 (홈 화면 summary 로직과 동기화)
    const isFinance = req.session.user?.deptName === "재정부";
    const userId = req.session.user?.userId;

    if (status === "결재대기") {
      // 상세 화면 최초 진입 시 홈 화면 배지와 동일한 '결재 대기' 항목만 조회
      if (isFinance) {
        where += ` AND (
          (ar.dept_name = '재정부' AND ar.status IN ('결재진행중', '결재완료'))
          OR (ar.dept_name != '재정부' AND ar.status = '결재완료')
        )`;
      } else {
        where += " AND ar.current_approver_user_id = ? AND ar.status = '결재진행중'";
        params.push(userId);
      }
    } else if (status && status !== "전체") {
      where += " AND ar.status = ?";
      params.push(status);

      if (status === "결재진행중") {
        if (approverUserId) {
          where += " AND ar.current_approver_user_id = ?";
          params.push(approverUserId);
        } else if (!isFinance) {
          where += " AND ar.current_approver_user_id = ?";
          params.push(userId);
        }
      }
    }

    const [[{ count }]] = await pool.query(
      `SELECT COUNT(*) as count FROM approval_requests ar ${where}`,
      params
    );

    console.log("where :", where);

    const totalPages = Math.ceil(count / pageSize);
    const offset = (page - 1) * pageSize;

    const [rows] = await pool.query(
      `SELECT ar.id, ar.dept_name, ar.document_type, ar.request_date, ar.total_amount, 
              ar.author, ar.aliasName, ar.status, ar.current_approver_role, ar.current_approver_user_id, 
              ar.category_gwan as selectedGwan, ar.category_hang as selectedHang,
              cg.category_name as gwanName, ch.category_name as hangName
       FROM approval_requests ar
       LEFT JOIN account_categories cg ON ar.category_gwan = cg.category_id
       LEFT JOIN account_categories ch ON ar.category_hang = ch.category_id
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

    // ✅ 요청 정보 + 관/항 명칭 조회
    const [requests] = await pool.query(`
      SELECT ar.*, 
             cg.category_name as gwan_name, 
             ch.category_name as hang_name
      FROM approval_requests ar
      LEFT JOIN account_categories cg ON ar.category_gwan = cg.category_id
      LEFT JOIN account_categories ch ON ar.category_hang = ch.category_id
      WHERE ar.id = ?
    `, [id]);

    if (requests.length === 0) {
      return res.status(404).json({ success: false, message: "데이터 없음" });
    }

    const request = requests[0];

    // ✅ 항목 정보 + 목/세목 명칭 조회
    const [items] = await pool.query(`
      SELECT ai.gwan, ai.hang, ai.mok, ai.semok, ai.detail, ai.amount,
             cm.category_name as mok_name,
             cs.category_name as semok_name
      FROM approval_items ai
      LEFT JOIN account_categories cm ON ai.mok = cm.category_id
      LEFT JOIN account_categories cs ON ai.semok = cs.category_id
      WHERE ai.request_id = ?
    `, [id]);

    // ✅ 첨부파일 정보 포함
    const [files] = await pool.query(
      "SELECT id, file_name, file_path, mime_type, file_size, alias_name FROM approval_files WHERE request_id = ?",
      [id]
    );

    // ✅ 결재 이력 (처리자 이름: users JOIN)
    const [history] = await pool.query(
      `SELECT ah.approver_user_id, ah.approver_role, ah.comment, ah.signature_path, ah.approved_at, ah.status,
              u.user_name AS approver_user_name
         FROM approval_history ah
         LEFT JOIN users u ON ah.approver_user_id = u.user_id
        WHERE ah.request_id = ?
        ORDER BY ah.approved_at ASC`,
      [id]
    );

    // ✅ 결재선 (approval_line) - 부서 기준 + order_no 정렬 (재정부 포함)
    const [approvalLine] = await pool.query(
      `
      SELECT id, dept_name, approver_role, approver_user_id, order_no
        FROM approval_line
       WHERE dept_name = ?
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
      selectedGwan: request.category_gwan,
      selectedHang: request.category_hang,
      gwanName: request.gwan_name, // 명칭 추가
      hangName: request.hang_name, // 명칭 추가
      items: items.map(i => ({
        ...i,
        mokName: i.mok_name,     // 명칭 추가
        semokName: i.semok_name  // 명칭 추가
      })),
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
  // 메일 발송 계획(커밋 후 비동기 실행)
  let mailPlan = null;

  try {
    await conn.beginTransaction();

    const [reqRows] = await conn.query(
      `SELECT dept_name, current_approver_role, current_approver_user_id, document_type, author, request_date, status, total_amount, category_hang
         FROM approval_requests 
        WHERE id=? FOR UPDATE`,
      [requestId]
    );
    if (reqRows.length === 0) {
      return res.status(404).json({ success: false, message: "결재 요청 없음" });
    }

    const reqRow = reqRows[0];
    const { dept_name, current_approver_role, current_approver_user_id, status, total_amount, category_hang } = reqRow;

    //console.log("/api/approval/approve - status :", status);
    if (status === "결재진행중") {

      // ✅ 결재진행중인 경우, 로그인한 사용자가 실제 결재자인지 검증
      const isFinance = req.session.user.deptName === '재정부';
      if (current_approver_user_id !== req.session.user.userId && !isFinance) {
        return res.status(403).json({ success: false, message: "현재 결재자가 아닙니다." });
      }

      // ✅ 실제 결재자 정보 (대결 시 본인 정보 기록)
      const actualApproverId = req.session.user.userId;
      // [수정] 대결(Proxy)이더라도, 결재 이력에는 '현재 결재 단계의 역할'을 기록해야
      // 결재선 UI에서 해당 칸에 서명이 올바르게 매핑됩니다.
      const actualApproverRole = current_approver_role;

      // ✅ 승인 이력 기록
      await conn.query(
        `INSERT INTO approval_history 
          (request_id, approver_role, approver_user_id, comment, signature_path, status, approved_at)
        VALUES (?, ?, ?, ?, ?, '승인', CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
        [requestId, actualApproverRole, actualApproverId, comment, signaturePath]
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

      //console.log("/api/approval/approve - nextRows :", nextRows);

      if (nextRows.length > 0) {
        // 다음 결재자 지정
        await conn.query(
          `UPDATE approval_requests
            SET current_approver_role=?, current_approver_user_id=?, updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
          WHERE id=?`,
          [nextRows[0].approver_role, nextRows[0].approver_user_id, requestId]
        );

        // 메일 발송 계획 (다음 결재자에게)
        mailPlan = {
          type: "handoff",
          requestId,
          docType: reqRow.document_type,
          deptName: reqRow.dept_name,
          author: reqRow.author,
          requestDate: reqRow.request_date,
          amount: reqRow.total_amount,
          approverUserId: nextRows[0].approver_user_id, // 다음 결재자
          applicantName: reqRow.author,
          approvedBy: req.session.user.userName,
          comment: comment || "",
        };

      } else {
        // 마지막 결재자 → 결재완료 처리
        await conn.query(
          `UPDATE approval_requests
            SET status='결재완료', updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
          WHERE id=?`,
          [requestId]
        );
        // 메일 발송 계획 (신청자에게 최종 승인 완료)
        mailPlan = {
          type: "completed",
          requestId,
          docType: reqRow.document_type,
          deptName: reqRow.dept_name,
          author: reqRow.author,
          requestDate: reqRow.request_date,
          amount: reqRow.total_amount,
          approvedBy: req.session.user.userName,
          comment: comment || "",
        };

      }

    } else if (status === "결재완료") {

      // ✅ 승인 이력 기록: 이 블록은 재정부가 '결재완료' 건을 이관 승인할 때만 진입하므로, 항상 로그인 사용자(재정부) 정보로 기록
      const historyApproverRole = req.session.user.roles?.[0]?.role_name ?? "재정부";
      const historyApproverUserId = req.session.user.userId;
      await conn.query(
        `INSERT INTO approval_history 
          (request_id, approver_role, approver_user_id, comment, signature_path, status, approved_at)
        VALUES (?, ?, ?, ?, ?, '승인', CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
        [requestId, historyApproverRole, historyApproverUserId, comment, signaturePath]
      );
      // 재정부 결재자 → 재정부이관완료 처리
      await conn.query(
        `UPDATE approval_requests
            SET status='재정부이관완료', updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
          WHERE id=?`,
        [requestId]
      );

      // ✅ dept_id 조회 (부서명 기준)
      const [[deptObj]] = await conn.query("SELECT id FROM departments WHERE dept_name = ?", [dept_name]);

      // ✅ expense_details에 지출 내역 저장 (request의 category_hang 사용)
      // year는 결재일자가 아닌 '요청(보고) 연도'를 사용해야 budget-status(기준년도)와 dept-budget-status(approval_items.year)가 일치함
      if (deptObj && category_hang && total_amount > 0) {
        const [[yrRow]] = await conn.query("SELECT year FROM approval_items WHERE request_id = ? LIMIT 1", [requestId]);
        const expenseYear = yrRow?.year != null ? yrRow.year : new Date().getFullYear();

        await conn.query(
          `INSERT INTO expense_details 
              (dept_id, category_id, year, expense_date, amount, description, approval_request_id) 
            VALUES (?, ?, ?, CURDATE(), ?, ?, ?)`,
          [
            deptObj.id,
            category_hang,
            expenseYear,
            total_amount,
            `결재 ID ${requestId} 최종 승인 합계`,
            requestId
          ]
        );
      }
    }

    await conn.commit();
    res.json({ success: true, message: "결재가 완료되었습니다." });

    // ───────────────────────────────────────────────────────────
    // ✅ 커밋 후 비동기 알림톡 발송
    // ───────────────────────────────────────────────────────────
    setImmediate(async () => {
      if (!mailPlan) return;

      try {
        if (mailPlan.type === "handoff") {
          // 다음 결재자 정보 조회 (휴대폰)
          const [[nextUser]] = await pool.query(
            `SELECT user_name, phone FROM users WHERE user_id=? LIMIT 1`,
            [mailPlan.approverUserId]
          );
          const toPhone = nextUser?.phone;

          if (!toPhone) {
            console.warn(`📭 approval #${mailPlan.requestId}: no next approver contact info`);
            return;
          }

          if (toPhone) {
            await sendApprovalAlimTalk({
              to: toPhone,
              templateCode: process.env.SENDON_TEMPLATE_ID,
              deptName: mailPlan.deptName,
              author: mailPlan.author,
              requestDate: mailPlan.requestDate,
              totalAmount: mailPlan.amount,
              comment: mailPlan.comment,
              urlPath: "approvalStatus"
            });
            console.log(`📱 [handoff alimtalk] #${mailPlan.requestId} → ${toPhone}`);
          }
        } else if (mailPlan.type === "completed") {
          // 신청자 정보 조회 (휴대폰)
          const [[applicant]] = await pool.query(
            `SELECT phone FROM users WHERE user_name=? LIMIT 1`,
            [mailPlan.author]
          );
          const toPhone = applicant?.phone;
          //const cc = process.env.MAIL_CC;

          if (toPhone) {
            await sendApprovalAlimTalk({
              to: toPhone,
              templateCode: process.env.SENDON_TEMPLATE_ID, //TODO 결재완료 템플릿으로 발송
              deptName: mailPlan.deptName,
              author: mailPlan.author,
              requestDate: mailPlan.requestDate,
              totalAmount: mailPlan.amount,
              comment: mailPlan.comment,
              urlPath: "approvalList"
            });
            console.log(`📱 [completed alimtalk] #${mailPlan.requestId} → ${toPhone}`);
          }
        }
      } catch (alimtalkErr) {
        console.error("❌ approval approve alimtalk error:", alimtalkErr);
      }
    });

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

  const { requestId, comment, login_user_id } = req.body;
  const signaturePath = req.file ? req.file.filename : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [reqRows] = await conn.query(
      `SELECT current_approver_role, current_approver_user_id, status, author, dept_name, request_date, document_type, total_amount
         FROM approval_requests 
        WHERE id=? FOR UPDATE`,
      [requestId]
    );
    if (reqRows.length === 0) {
      return res.status(404).json({ success: false, message: "결재 요청 없음" });
    }

    const { current_approver_role, current_approver_user_id, status, author, dept_name, request_date, document_type, total_amount } = reqRows[0];

    // ✅ 로그인한 사용자가 실제 결재자인지 검증
    const isFinance = req.session.user.deptName === '재정부';
    if (status === "결재진행중" && current_approver_user_id !== req.session.user.userId && !isFinance) {
      return res.status(403).json({ success: false, message: "현재 결재자가 아닙니다." });
    }

    // ✅ current_approver_role이 NULL일 수 있음(예: 재정부 이관 전) → 세션 사용
    const approverRole = current_approver_role != null ? current_approver_role : (req.session.user.roles?.[0]?.role_name ?? "재정부");
    const approverUserId = current_approver_user_id != null ? current_approver_user_id : req.session.user.userId;

    // ✅ 결재반려 이력 기록
    await conn.query(
      `INSERT INTO approval_history 
         (request_id, approver_role, approver_user_id, comment, signature_path, status, approved_at)
       VALUES (?, ?, ?, ?, ?, '반려', CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
      [requestId, approverRole, approverUserId, comment, signaturePath]
    );

    // ✅ 결재 요청 반려 처리
    await conn.query(
      `UPDATE approval_requests 
          SET status='결재반려', updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00'),
              current_approver_role=?, current_approver_user_id=?
        WHERE id=?`,
      [approverRole, approverUserId, requestId]
    );

    await conn.commit();
    res.json({ success: true, message: "결재가 반려되었습니다." });


    // ───────────────────────────────────────────────────────────
    // ✅ 커밋 후 비동기 알림톡 발송
    // ───────────────────────────────────────────────────────────
    setImmediate(async () => {
      try {

        // 신청자 정보 조회 (휴대폰)
        const [[applicant]] = await pool.query(
          `SELECT phone FROM users WHERE user_name=? LIMIT 1`,
          [author]
        );
        const toPhone = applicant?.phone;

        if (toPhone) {
          await sendApprovalAlimTalk({
            to: toPhone,
            status: "반려",
            templateCode: process.env.SENDON_TEMPLATE_ID,  //TODO 템플릿 변경
            deptName,
            author,
            requestDate: request_date,
            totalAmount: total_amount,
            comment: `${comment || "없음"}`,
            urlPath: "approvalList"
          });
          console.log(`📱 [reject alimtalk] #${requestId} → ${toPhone}`);
        }

      } catch (alimtalkErr) {
        console.error("❌ approval reject alimtalk error:", alimtalkErr);
      }
    });

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
      if (req.query.downloadName) {
        return res.download(absPath, req.query.downloadName);
      }
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
      deptName: user.dept_name,
      deptId: user.dept_id,
      roles: roles.length > 0 ? roles : [],
    };
    console.log("✅ 로그인 성공:", user.user_id, "→ 세션 저장됨");
    return res.json({ success: true, user: req.session.user });
  } catch (error) {
    console.error("❌ 로그인 처리 오류:", error.message || error);
    return res.status(500).json({ success: false, message: "로그인 처리 실패" });
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

// server.js 또는 routes 파일 내에 추가
app.get("/api/public/users", async (req, res) => {
  const { deptId, roleId } = req.query;

  // 파라미터 체크
  if (!deptId || !roleId) {
    return res.status(400).json({ error: "deptId와 roleId는 필수입니다." });
  }

  try {
    const [rows] = await pool.query(
      `
      SELECT 
        u.user_id   AS userId,
        u.user_name AS userName,
        d.dept_name AS deptName,
        r.role_name AS roleName
      FROM users u
      JOIN departments d ON u.dept_name = d.dept_name
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON ur.role_id = r.id
      WHERE d.id = ? 
        AND ur.role_id = ?
      ORDER BY u.user_name
      `,
      [deptId, roleId]
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/public/users 조회 실패:", err);
    res.status(500).json({ error: "사용자 조회 실패" });
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

    // ✅ 비밀번호 규칙 (4자 이상)
    const regex = /^.{4,}$/;
    if (!regex.test(password)) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "비밀번호 규칙 위반(4자 이상)",
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

    // 2) 비밀번호 (선택) — 4자 이상
    if (newPassword && newPassword.trim() !== "") {
      const regex = /^.{4,}$/;
      if (!regex.test(newPassword)) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          message: "비밀번호 규칙 위반(4자 이상)",
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

  // (선택) 관리자, 재정부 또는 본인만 허용
  const isAuthorized = Array.isArray(req.session.user.roles) &&
    req.session.user.roles.some(r => r.role_name === "관리자" || r.role_name === "재정부");
  if (!isAuthorized && String(req.session.user.id) !== String(targetUserId)) {
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

  // (선택) 관리자, 재정부 또는 본인만 허용
  const isAuthorized = Array.isArray(req.session.user.roles) &&
    req.session.user.roles.some(r => r.role_name === "관리자" || r.role_name === "재정부");
  if (!isAuthorized && String(req.session.user.id) !== String(targetUserId)) {
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
app.get("/api/public/roles", async (req, res) => {
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

// ───────────────────────────────────────────────────────────
// ✅ 사용자 즐겨찾기 메뉴 관리
// ───────────────────────────────────────────────────────────
app.get("/api/user/favorites", async (req, res) => {
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

app.post("/api/user/favorites", async (req, res) => {
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
app.get("/api/departments", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, dept_name, dept_cd, parent_dept_id FROM departments ORDER BY id"
    );
    res.json(rows);
  } catch (err) {
    console.error("부서 조회 실패:", err);
    res.status(500).json({ error: "부서 조회 실패" });
  }
});

// 부서 추가
app.post("/api/departments", async (req, res) => {
  try {
    const { dept_name, dept_cd, parent_dept_id } = req.body;

    if (!dept_name || !dept_cd) {
      return res.status(400).json({ error: "부서명과 코드가 필요합니다." });
    }

    const [result] = await pool.query(
      "INSERT INTO departments (dept_name, dept_cd, parent_dept_id) VALUES (?, ?, ?)",
      [dept_name, dept_cd, parent_dept_id || null]
    );

    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    console.error("부서 추가 실패:", err);
    res.status(500).json({ error: "부서 추가 실패" });
  }
});

// 부서 수정
app.put("/api/departments/:id", async (req, res) => {
  try {
    const { dept_name, dept_cd, parent_dept_id } = req.body;
    const deptId = req.params.id;

    if (!dept_name || !dept_cd) {
      return res.status(400).json({ error: "부서명과 코드가 필요합니다." });
    }

    const [result] = await pool.query(
      "UPDATE departments SET dept_name = ?, dept_cd = ?, parent_dept_id = ? WHERE id = ?",
      [dept_name, dept_cd, parent_dept_id || null, deptId]
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
app.delete("/api/departments/:id", async (req, res) => {
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

/* ------------------------------------------------
   ✅ 결재선 관리 (ApprovalLineManagement.vue 대응)
------------------------------------------------ */
// 부서별 결재선 조회
app.get("/api/approval-lines", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { deptName } = req.query;

    let query = `
      SELECT al.id, al.dept_name, al.approver_role, al.approver_user_id, al.order_no,
             u.user_name AS approver_user_name
        FROM approval_line al
        LEFT JOIN users u ON al.approver_user_id = u.user_id
    `;
    const params = [];

    if (deptName) {
      query += " WHERE al.dept_name = ?";
      params.push(deptName);
    }

    query += " ORDER BY al.dept_name ASC, al.order_no ASC, al.id ASC";

    const [rows] = await pool.query(query, params);
    // 프론트에서 배열을 바로 받을 수 있도록 success 래퍼 없이 반환
    res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error("❌ 결재선 조회 실패:", err);
    res.status(500).json({ success: false, message: "결재선 조회 실패" });
  }
});

// 부서별 결재선 저장 (전체 덮어쓰기)
app.post("/api/approval-lines", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { deptName, lines } = req.body;

  if (!deptName || !Array.isArray(lines)) {
    return res.status(400).json({ success: false, message: "deptName과 lines는 필수입니다." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 기존 결재선 제거 후 재삽입
    await conn.query("DELETE FROM approval_line WHERE dept_name = ?", [deptName]);

    const values = lines
      // ✅ camelCase / snake_case 모두 허용
      .map((line, idx) => ({
        approverRole: line?.approver_role ?? line?.approverRole,
        approverUserId: line?.approver_user_id ?? line?.approverUserId,
        orderNo: line?.order_no ?? line?.orderNo ?? idx + 1,
      }))
      .filter((line) => line.approverRole && line.approverUserId)
      .map((line) => [deptName, line.approverRole, line.approverUserId, line.orderNo]);

    if (values.length > 0) {
      await conn.query(
        "INSERT INTO approval_line (dept_name, approver_role, approver_user_id, order_no) VALUES ?",
        [values]
      );
    }

    await conn.commit();
    res.json({ success: true, count: values.length });
  } catch (err) {
    await conn.rollback();
    console.error("❌ 결재선 저장 실패:", err);
    res.status(500).json({ success: false, message: "결재선 저장 실패" });
  } finally {
    conn.release();
  }
});

// 단일 결재선 수정
app.put("/api/approval-lines/:id", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const approvalLineId = req.params.id;
  // camelCase, snake_case 모두 허용
  const deptName = req.body.deptName ?? req.body.dept_name;
  const approverRole = req.body.approverRole ?? req.body.approver_role;
  const approverUserId = req.body.approverUserId ?? req.body.approver_user_id;
  const orderNo = req.body.orderNo ?? req.body.order_no;

  const updateFields = [];
  const params = [];

  if (deptName) {
    updateFields.push("dept_name = ?");
    params.push(deptName);
  }
  if (approverRole) {
    updateFields.push("approver_role = ?");
    params.push(approverRole);
  }
  if (approverUserId) {
    updateFields.push("approver_user_id = ?");
    params.push(approverUserId);
  }
  if (orderNo !== undefined) {
    updateFields.push("order_no = ?");
    params.push(orderNo);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ success: false, message: "수정할 필드가 없습니다." });
  }

  try {
    const [result] = await pool.query(
      `UPDATE approval_line SET ${updateFields.join(", ")} WHERE id = ?`,
      [...params, approvalLineId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "해당 결재선을 찾을 수 없습니다." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ 결재선 수정 실패:", err);
    res.status(500).json({ success: false, message: "결재선 수정 실패" });
  }
});

// 단일 결재선 삭제
app.delete("/api/approval-lines/:id", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const approvalLineId = req.params.id;

  try {
    const [result] = await pool.query("DELETE FROM approval_line WHERE id = ?", [approvalLineId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "해당 결재선을 찾을 수 없습니다." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ 결재선 삭제 실패:", err);
    res.status(500).json({ success: false, message: "결재선 삭제 실패" });
  }
});

/* ------------------------------------------------
   ✅ Account Categories API (CRUD)
------------------------------------------------ */

// ✅ 전체 계정과목 조회 (마스터 관리용)
app.get("/api/accountCategories", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, category_id, parent_id, category_name, level, owner_dept_id, valid_from, valid_to, created_at, updated_at
         FROM account_categories
        ORDER BY category_id`
    );
    res.json({ success: true, categories: rows });
  } catch (err) {
    console.error("❌ accountCategories 전체 조회 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 특정 부서별 계정과목 조회 (기준일자 조건 포함)
app.get("/api/accountCategories/:deptId", async (req, res) => {
  try {
    const deptId = req.params.deptId;
    const { date } = req.query;

    // ✅ RECURSIVE CTE를 사용하여 매핑된 계정 및 지출이 있는 계정의 모든 상위(부모) 계정까지 포함
    let query = `
      WITH RECURSIVE category_tree AS (
        -- 초기항: 직접 매핑되었거나 지출 내역이 있는 계정
        SELECT ac.id, ac.category_id, ac.parent_id, ac.category_name, ac.level, ac.owner_dept_id, ac.valid_from, ac.valid_to, ac.created_at, ac.updated_at
          FROM account_categories ac
          LEFT JOIN account_category_departments acd ON ac.id = acd.account_category_id
         WHERE acd.dept_id = ?
            OR ac.category_id IN (
               SELECT DISTINCT ai.semok FROM approval_items ai JOIN approval_requests ar ON ai.request_id = ar.id JOIN departments d ON ar.dept_name = d.dept_name WHERE d.id = ?
               UNION SELECT ai.mok FROM approval_items ai JOIN approval_requests ar ON ai.request_id = ar.id JOIN departments d ON ar.dept_name = d.dept_name WHERE d.id = ?
               UNION SELECT ai.hang FROM approval_items ai JOIN approval_requests ar ON ai.request_id = ar.id JOIN departments d ON ar.dept_name = d.dept_name WHERE d.id = ?
               UNION SELECT ai.gwan FROM approval_items ai JOIN approval_requests ar ON ai.request_id = ar.id JOIN departments d ON ar.dept_name = d.dept_name WHERE d.id = ?
            )
        
        UNION
        
        -- 재귀항: 위에서 선택된 계정들의 부모 계정들을 추적
        SELECT p.id, p.category_id, p.parent_id, p.category_name, p.level, p.owner_dept_id, p.valid_from, p.valid_to, p.created_at, p.updated_at
          FROM account_categories p
          INNER JOIN category_tree c ON c.parent_id = p.id
      )
      SELECT DISTINCT ct.*,
             (SELECT GROUP_CONCAT(dept_id) FROM account_category_departments WHERE account_category_id = ct.id) AS dept_ids
        FROM category_tree ct
       WHERE 1=1
    `;
    const params = [deptId, deptId, deptId, deptId, deptId];

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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { category_id, parent_id, category_name, level, valid_from } = req.body;

    const [result] = await conn.query(
      `INSERT INTO account_categories (category_id, parent_id, category_name, level, valid_from)
       VALUES (?, ?, ?, ?, ?)`,
      [category_id, parent_id || null, category_name, level, valid_from || new Date()]
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
app.put("/api/accountCategories/:id", async (req, res) => {
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

// ✅ 부서별 계정과목 매핑 저장 (일괄 갱신)
app.post("/api/departments/:deptId/account-mapping", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const deptId = req.params.deptId;
    const { categoryIds } = req.body; // [1, 2, 5, ...]

    // 기존 매핑 삭제
    await conn.query("DELETE FROM account_category_departments WHERE dept_id = ?", [deptId]);

    // 신규 매핑 추가
    if (Array.isArray(categoryIds) && categoryIds.length > 0) {
      const values = categoryIds.map(catId => [catId, deptId]);
      await conn.query(
        `INSERT INTO account_category_departments (account_category_id, dept_id) VALUES ?`,
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

// ✅ 계정별 예산 조회 (전사 공통)
app.get("/api/budgets", async (req, res) => {
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
app.post("/api/budgets", async (req, res) => {
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
app.post("/api/budgets/bulk", async (req, res) => {
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


/* ------------------------------------------------
   📊 부서별 예산 & 지출 합계 조회 API
   GET /api/expenses/summary?deptId=1&year=2025
------------------------------------------------ */
app.get("/api/expenses/summary", async (req, res) => {
  try {
    const { deptId, year } = req.query;
    console.log("deptId :", deptId);

    if (!deptId || !year) {
      return res.status(400).json({ success: false, message: "deptId, year 필요" });
    }

    // ✅ 최상위 계정(관) 가져오기
    const [rootRows] = await pool.query(
      `SELECT ac.category_id 
         FROM account_categories ac
         JOIN account_category_departments acd ON ac.id = acd.account_category_id
        WHERE ac.parent_id IS NULL AND ac.level='관' AND acd.dept_id=?
        LIMIT 1`,
      [deptId]
    );
    console.log("rootRows :", rootRows);

    if (rootRows.length === 0) {
      return res.json({ success: true, totalBudget: 0, totalExpense: 0 });
    }
    const rootCategoryId = rootRows[0].category_id;
    console.log("rootCategoryId :", rootCategoryId);

    // ✅ 예산 총액 (budgets) - 부서 조건 제거 (전사 예산)
    const [[budgetRow]] = await pool.query(
      `WITH RECURSIVE sub_cats (id, category_id) AS (
          SELECT id, category_id FROM account_categories WHERE category_id = ?
          UNION ALL
          SELECT ac.id, ac.category_id FROM account_categories ac
          INNER JOIN sub_cats sc ON ac.parent_id = sc.id
       )
       SELECT COALESCE(SUM(b.budget_amount),0) AS totalBudget
       FROM budgets b
       JOIN sub_cats sc ON b.category_id = sc.category_id
       WHERE b.year=?`,
      [rootCategoryId, year]
    );
    console.log("budgetRow :", budgetRow);

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
   📊 부서 + '항' 기준 예산/지출/잔액 조회 API (직접 매핑만)
   GET /api/expenses/summaryByCategory?deptId=1&year=2025&hangCategoryId=2001

   - hangCategoryId: account_categories.category_id (level='항'의 category_id)
   - 예산(budgets): category_id = hangCategoryId 합계만
   - 지출(expense_details): category_id = hangCategoryId 합계만
------------------------------------------------ */
app.get("/api/expenses/summaryByCategory", async (req, res) => {
  try {
    const { deptId, year, hangCategoryId } = req.query;

    if (!deptId || !year || !hangCategoryId) {
      return res
        .status(400)
        .json({ success: false, message: "deptId, year, hangCategoryId 필요" });
    }

    // ✅ 1. 항(Hang) 정보 조회 (ID, Owner)
    const [[hangNode]] = await pool.query(
      "SELECT id, owner_dept_id FROM account_categories WHERE category_id = ?",
      [hangCategoryId]
    );

    let targetCategoryId = hangCategoryId;

    // ✅ 2. Owner가 일치하지 않으면 하위 계정(Mok) 중 Owner가 일치하는 것 조회
    if (hangNode && String(hangNode.owner_dept_id) !== String(deptId)) {
      const [children] = await pool.query(
        "SELECT category_id FROM account_categories WHERE parent_id = ? AND owner_dept_id = ? LIMIT 1",
        [hangNode.id, deptId]
      );

      if (children.length > 0) {
        targetCategoryId = children[0].category_id;
      }
    }

    console.log("targetCategoryId :", targetCategoryId);

    // ✅ 3. 예산 합계: targetCategoryId 사용
    const [[budgetRow]] = await pool.query(
      `WITH RECURSIVE sub_cats (id, category_id) AS (
          SELECT id, category_id FROM account_categories WHERE category_id = ?
          UNION ALL
          SELECT ac.id, ac.category_id FROM account_categories ac
          INNER JOIN sub_cats sc ON ac.parent_id = sc.id
       )
       SELECT COALESCE(SUM(b.budget_amount), 0) AS totalBudget
       FROM budgets b
       JOIN sub_cats sc ON b.category_id = sc.category_id
       WHERE b.year = ?`,
      [targetCategoryId, year]
    );

    console.log("budgetRow :", budgetRow);

    // ✅ 4. 지출 합계: targetCategoryId 사용
    const [[expenseRow]] = await pool.query(
      `WITH RECURSIVE sub_cats (id, category_id) AS (
          SELECT id, category_id FROM account_categories WHERE category_id = ?
          UNION ALL
          SELECT ac.id, ac.category_id FROM account_categories ac
          INNER JOIN sub_cats sc ON ac.parent_id = sc.id
       )
       SELECT COALESCE(SUM(ed.amount), 0) AS totalExpense
         FROM expense_details ed
         JOIN sub_cats sc ON ed.category_id = sc.category_id
        WHERE ed.dept_id = ?
          AND ed.year = ?`,
      [hangCategoryId, deptId, year]
    );

    console.log("expenseRow :", expenseRow);

    const totalBudget = Number(budgetRow.totalBudget) || 0;
    const totalExpense = Number(expenseRow.totalExpense) || 0;

    return res.json({
      success: true,
      totalBudget,
      totalExpense,
      remainingBudget: totalBudget - totalExpense,
    });
  } catch (err) {
    console.error("❌ /api/expenses/summaryByCategory 오류:", err);
    return res.status(500).json({ success: false, message: "조회 실패" });
  }
});



/* ------------------------------------------------
   📊 부서별 전체 예산/지출/잔액 조회 API
   GET /api/budget-status?year=2025
------------------------------------------------ */
app.get("/api/budget-status", async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();

    // ✅ [전체 계정 모드] 기존 로직 유지
    const conditions = ["d.parent_dept_id IS NOT NULL"];
    const params = [year, year];

    // ✅ 부서/관/항 기준 예산 & 지출 합계
    const [rows] = await pool.query(
      `
      WITH RECURSIVE category_descendants (root_id, root_category_id, id, category_id) AS (
          SELECT id, category_id, id, category_id FROM account_categories
          UNION ALL
          SELECT cd.root_id, cd.root_category_id, ac.id, ac.category_id
          FROM account_categories ac
          JOIN category_descendants cd ON ac.parent_id = cd.id
      ),
      budget_agg AS (
          SELECT cd.root_category_id, SUM(b.budget_amount) as total_budget
          FROM category_descendants cd
          JOIN budgets b ON cd.category_id = b.category_id
          WHERE b.year = ?
          GROUP BY cd.root_category_id
      ),
      expense_agg AS (
          SELECT cd.root_category_id, ed.dept_id, SUM(ed.amount) as total_expense
          FROM category_descendants cd
          JOIN expense_details ed ON cd.category_id = ed.category_id
          WHERE ed.year = ?
          GROUP BY cd.root_category_id, ed.dept_id
      )
      SELECT 
          d.id AS dept_id,
          d.dept_name,
          d.dept_cd,
          gwan.category_id AS gwan_category_id,
          gwan.category_name AS gwan_name,
          hang.category_id AS hang_category_id,
          hang.category_name AS hang_name,
          hang.owner_dept_id,
          owner_d.dept_name AS owner_dept_name,
          SUM(COALESCE(b.total_budget,0)) as total_budget,
          MAX(COALESCE(b_full.total_budget,0)) as hang_total_budget,
          MAX(COALESCE(ev.total_expense,0)) as total_expense,
          SUM(COALESCE(b.total_budget,0)) - MAX(COALESCE(ev.total_expense,0)) AS remaining_amount
      FROM departments d
      INNER JOIN account_category_departments acd ON acd.dept_id = d.id
      INNER JOIN account_categories hang
        ON hang.id = acd.account_category_id
       AND hang.level = '항'
      INNER JOIN account_categories gwan
        ON gwan.id = hang.parent_id
       AND gwan.level = '관'
      LEFT JOIN departments owner_d ON hang.owner_dept_id = owner_d.id
      LEFT JOIN account_categories child_cat
        ON child_cat.parent_id = hang.id
       AND child_cat.owner_dept_id = d.id
      LEFT JOIN budget_agg b
        ON b.root_category_id = COALESCE(child_cat.category_id, hang.category_id)
      LEFT JOIN budget_agg b_full
        ON b_full.root_category_id = hang.category_id
      LEFT JOIN expense_agg ev
        ON ev.dept_id = d.id
       AND ev.root_category_id = hang.category_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY 
          d.id, d.dept_name, d.dept_cd,
          gwan.category_id, gwan.category_name,
          hang.category_id, hang.category_name, hang.owner_dept_id,
          owner_d.dept_name
      ORDER BY d.id, gwan.category_id, hang.category_id
      `,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error("❌ /api/budget-status 오류:", err);
    res.status(500).json({ success: false, message: "예산 현황 조회 실패" });
  }
});

/* ------------------------------------------------
   📊 부서 예산집행 현황 API (DeptBudgetStatus.vue용)
   GET /api/dept-budget-status?deptId=1&year=2025
------------------------------------------------ */
app.get("/api/dept-budget-status", async (req, res) => {
  try {
    const { deptId, year } = req.query;
    if (!deptId || !year) {
      return res.status(400).json({ success: false, message: "deptId, year 필요" });
    }

    // 1. 예산 조회 (BudgetsGrid와 동일 로직: 전사 예산)
    //    단, 여기서는 부서별 예산 현황이므로 해당 부서가 Owner인 계정만 필터링하는 것은 프론트엔드 로직을 따름.
    //    서버에서는 전체 예산을 내려주거나, 필요한 경우 필터링.
    //    BudgetsGrid는 /api/budgets (전체)를 호출하고 프론트에서 매핑함.
    //    여기서도 동일하게 전체 예산을 가져갑니다.
    const [budgetRows] = await pool.query(
      `SELECT category_id, SUM(budget_amount) as budget_amount
         FROM budgets
        WHERE year = ?
        GROUP BY category_id`,
      [year]
    );

    // 2. 지출 조회: "해당 부서에 배정된 계정과목"으로 집행된 지출만 포함 (결재 신청 부서 무관)
    //    - 세목(semok)이 ACC로 시작하면: semok이 이 부서 배정 계정인 건
    //    - 세목이 커스텀/비ACC면: 목(mok)이 이 부서 배정 계정인 건
    //    -> 부서="관리부"일 때도 ACC04130202에 회우부가 신청한 지출이 표시됨
    const [expenseRows] = await pool.query(
      `SELECT ai.gwan, ai.hang, ai.mok, ai.semok, ai.amount
         FROM approval_items ai
         JOIN approval_requests ar ON ai.request_id = ar.id
        WHERE ai.year = ?
          AND ar.status = '재정부이관완료'
          AND (
            -- 1. 해당 부서가 신청(기안)한 지출 (ar.dept_name으로 조인)
            EXISTS (SELECT 1 FROM departments d WHERE d.dept_name = ar.dept_name AND d.id = ?)
            OR
            -- 2. 해당 부서가 관리(배정)하는 계정으로 집행된 지출
            EXISTS (
              SELECT 1 FROM account_category_departments acd
              INNER JOIN account_categories ac ON ac.id = acd.account_category_id
              WHERE acd.dept_id = ? 
                AND (ac.category_id = ai.semok OR ac.category_id = ai.mok OR ac.category_id = ai.hang OR ac.category_id = ai.gwan)
            )
          )`,
      [year, deptId, deptId]
    );

    res.json({
      success: true,
      budgets: budgetRows,
      expenses: expenseRows
    });
  } catch (err) {
    console.error("❌ 부서 예산집행 현황 조회 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------
   ✅ 공지사항 (Notice) API
------------------------------------------------ */

// 1. 공지사항 목록 조회 (조회수, 첨부파일 포함 안함, 목록용 데이터만)
app.get("/api/notices", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM notices");

    // 최근 1주일 필터 표시를 위해 등록일 포함
    const [rows] = await pool.query(`
      SELECT id, title, author_id, author_name, view_count, created_at
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

// 2. 공지사항 상세 조회 (조회수 증가 포함)
app.get("/api/notices/:id", async (req, res) => {
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
app.post("/api/notices", upload.array("files", 10), async (req, res) => {
  if (!isAdmin(req) && req.session.user?.deptName !== '재정부') {
    return res.status(403).json({ success: false, message: "관리자 또는 재정부 권한이 필요합니다." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { title, content } = req.body;
    const author_id = req.session.user.userId;
    const author_name = req.session.user.userName;

    const [result] = await conn.query(
      "INSERT INTO notices (title, content, author_id, author_name) VALUES (?, ?, ?, ?)",
      [title, content, author_id, author_name]
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
app.put("/api/notices/:id", upload.array("files", 10), async (req, res) => {
  if (!isAdmin(req) && req.session.user?.deptName !== '재정부') {
    return res.status(403).json({ success: false, message: "관리자 또는 재정부 권한이 필요합니다." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { id } = req.params;
    const { title, content, deletedFileIds } = req.body; // 삭제할 첨부파일 ID들 (JSON string)

    await conn.query(
      "UPDATE notices SET title = ?, content = ? WHERE id = ?",
      [title, content, id]
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
app.delete("/api/notices/:id", async (req, res) => {
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

/* ───────────────────────────────────────────────────────────
   의사소통 게시판(Boards) CRUD 라우트 연결
─────────────────────────────────────────────────────────── */
const boardRoutes = require("./routes/board.routes")(pool, upload);
app.use("/api/boards", boardRoutes);

/* ------------------------------------------------
   ✅ 포탈 초화면 요약 API
------------------------------------------------ */
app.get("/api/portal/summary", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }
  try {
    const userId = req.session.user.userId;
    const isFinance = req.session.user?.deptName === "재정부";
    const deptName = req.session.user?.deptName;
    const { startDate, endDate } = req.query;

    // 날짜 조건 생성 (조회조건이 있으면 반영, 없으면 기본 1개월 전부터 현재까지)
    let dateWhere = "";
    const dateParams = [];

    if (startDate) {
      dateWhere += " AND ar.request_date >= ?";
      dateParams.push(startDate);
    } else {
      dateWhere += " AND ar.request_date >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)";
    }

    if (endDate) {
      dateWhere += " AND ar.request_date <= ?";
      dateParams.push(endDate);
    }

    // 1. 공통 부서 및 기간 정보 확보
    const effectiveRoot = isFinance ? "교회" : deptName;
    const [subDepts] = await pool.query(
      `WITH RECURSIVE sub_depts AS (
        SELECT id, dept_name, parent_dept_id FROM departments WHERE dept_name = ?
        UNION ALL
        SELECT d.id, d.dept_name, d.parent_dept_id FROM departments d
        INNER JOIN sub_depts sd ON d.parent_dept_id = sd.id
      ) SELECT dept_name FROM sub_depts`,
      [effectiveRoot]
    );

    const deptList = subDepts.map((d) => d.dept_name);
    const deptPlaceholder = deptList.map(() => "?").join(",");

    // 2. 전체 청구 건수 (날짜 필터 + 조직 기반)
    const [[{ approvalCount }]] = await pool.query(
      `SELECT COUNT(*) AS approvalCount FROM approval_requests ar 
       WHERE ar.dept_name IN (${deptPlaceholder}) ${dateWhere}`,
      [...deptList, ...dateParams]
    );

    // 3. 내 결재 대기 건수 및 최근 목록 (상세 페이지의 필터링 로직과 동기화)
    let myApprovalWhere = "";
    let myApprovalParams = [];

    if (isFinance) {
      // 재정부: (재정부 건 중 결재진행중/결재완료) + (타부서 건 중 결재완료)
      myApprovalWhere = `
        WHERE ar.dept_name IN (${deptPlaceholder})
        AND (
          (ar.dept_name = '재정부' AND ar.status IN ('결재진행중', '결재완료'))
          OR (ar.dept_name != '재정부' AND ar.status = '결재완료')
        )
      `;
      myApprovalParams = [...deptList];
    } else {
      // 일반: 소속 부서군 내 본인이 현재 결재자인 건
      myApprovalWhere = `
        WHERE ar.dept_name IN (${deptPlaceholder})
        AND ar.current_approver_user_id = ? 
        AND ar.status = '결재진행중'
      `;
      myApprovalParams = [...deptList, userId];
    }

    const [[{ myApprovalCount }]] = await pool.query(
      `SELECT COUNT(*) AS myApprovalCount FROM approval_requests ar ${myApprovalWhere} ${dateWhere}`,
      [...myApprovalParams, ...dateParams]
    );

    const [myApprovalRecent] = await pool.query(
      `SELECT ar.id, ar.dept_name, ar.document_type, ar.request_date, ar.total_amount, ar.status, ar.author, ar.aliasName
       FROM approval_requests ar 
       ${myApprovalWhere} ${dateWhere}
       ORDER BY ar.request_date DESC, ar.id DESC LIMIT 5`,
      [...myApprovalParams, ...dateParams]
    );

    // 읽지 않은 공지사항 카운트
    const [[{ unreadNoticeCount }]] = await pool.query(`
      SELECT COUNT(*) AS unreadNoticeCount 
      FROM notices n
      WHERE n.id NOT IN (SELECT notice_id FROM notice_views WHERE user_id = ?)
    `, [userId]);
    const [noticeRecent] = await pool.query(
      "SELECT id, title, created_at FROM notices ORDER BY created_at DESC LIMIT 5"
    );

    // 읽지 않은 게시글 카운트
    const [[{ unreadBoardCount }]] = await pool.query(`
      SELECT COUNT(*) AS unreadBoardCount 
      FROM boards b
      WHERE b.id NOT IN (SELECT board_id FROM board_views WHERE user_id = ?)
    `, [userId]);
    const [boardRecent] = await pool.query(
      `SELECT b.id, b.title, b.author_name, b.created_at,
              (SELECT COUNT(*) FROM board_comments WHERE board_id = b.id) AS comment_count
       FROM boards b ORDER BY b.created_at DESC LIMIT 5`
    );

    // 청구목록 최근5개 (날짜 필터 + 조직 기반)
    const [approvalRecent] = await pool.query(
      `SELECT ar.id, ar.dept_name, ar.document_type, ar.request_date, ar.total_amount, ar.status 
       FROM approval_requests ar 
       WHERE ar.dept_name IN (${deptPlaceholder}) ${dateWhere}
       ORDER BY ar.request_date DESC, ar.id DESC LIMIT 5`,
      [...deptList, ...dateParams]
    );

    res.json({
      success: true,
      data: {
        approvalCount,
        myApprovalCount,
        unreadNoticeCount,
        unreadBoardCount,
        noticeRecent,
        boardRecent,
        approvalRecent,
        myApprovalRecent,
      }
    });
  } catch (err) {
    console.error("❌ 포탈 요약 조회 실패:", err);
    res.status(500).json({ success: false, message: "포탈 요약 조회 실패" });
  }
});

/* ------------------------------------------------
   ✅ 서버 실행
------------------------------------------------ */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on 0.0.0.0:${PORT} (${ENV})`);
});
