// 앱 모듈을 불러오기 전에 테스트용 환경변수를 지정합니다. (env.js 는 KEY__{NODE_ENV} 를 우선 사용)
const os = require("os");
const path = require("path");
const fs = require("fs");
const cfg = require("./testDbConfig");

process.env.NODE_ENV = "test";
process.env.DB_HOST__test = cfg.host;
process.env.DB_PORT__test = String(cfg.port);
process.env.DB_USER__test = cfg.user;
process.env.DB_PASSWORD__test = cfg.password;
process.env.DB_NAME__test = cfg.database;
process.env.DB_CONN_LIMIT__test = "5";
process.env.SESSION_SECRET__test = "test-session-secret";
process.env.MOCK_DATE__test = "";

// 업로드 파일은 임시 폴더에 저장 (실제 uploads/ 오염 방지)
const tmpUpload = path.join(os.tmpdir(), "report-server-test-uploads");
fs.mkdirSync(tmpUpload, { recursive: true });
process.env.UPLOAD_DIR = tmpUpload;
