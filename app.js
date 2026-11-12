// Express 앱 구성 (미들웨어 · 라우트 · 에러 핸들러)
// 서버 실행은 server.js, 테스트는 이 모듈을 직접 불러 사용합니다.
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const session = require("express-session");

const { envPick, ENV } = require("./env");
const { pool } = require("./lib/db");
const { upload } = require("./lib/upload");

const app = express();

// ✅ CORS 설정 (.env 기반)
const allowedOrigins = (envPick("CORS_ORIGIN", "") || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // 개발용: origin 없을 때 (예: Postman) 허용
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
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

// ───────────────────────────────────────────────────────────
// 라우트 (기존 server.js 등록 순서 유지)
// ───────────────────────────────────────────────────────────
app.use(require("./routes/system.routes"));
app.use(require("./routes/approval.routes"));
app.use(require("./routes/approval-list.routes"));
app.use(require("./routes/files.routes"));
app.use(require("./routes/auth.routes"));
app.use(require("./routes/users.routes"));
app.use(require("./routes/roles.routes"));
app.use(require("./routes/departments.routes"));
app.use(require("./routes/approval-lines.routes"));
app.use(require("./routes/accounts.routes"));
app.use(require("./routes/budgets.routes"));
app.use(require("./routes/budget-plans.routes"));
app.use(require("./routes/initial-expenses.routes"));
app.use(require("./routes/expenses.routes"));
app.use(require("./routes/notices.routes"));
app.use("/api/boards", require("./routes/board.routes")(pool, upload));
app.use(require("./routes/portal.routes"));

// ✅ 전역 에러 핸들러 (Multer 오류 등 처리)
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    console.error("Multer Error:", err.message, err.code, err.field);
    return res.status(400).json({
      success: false,
      message: err.code === 'LIMIT_UNEXPECTED_FILE'
        ? "첨부파일이 너무 많거나 잘못된 파일 필드입니다."
        : `파일 업로드 오류: ${err.message}`
    });
  }
  next(err);
});

module.exports = app;
