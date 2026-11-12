// 서버 실행 진입점
const { ENV } = require("./env"); // .env 로드 + NODE_ENV 확정 (가장 먼저)
const { dbConfig, runStartupMigrations } = require("./lib/db");
const app = require("./app");

const PORT = Number(process.env.PORT) || 3001;

console.log(`🌍 NODE_ENV: ${process.env.NODE_ENV}  (ENV helper: ${ENV})`);
console.log(`📦 DB → ${dbConfig.host}:${dbConfig.port} / ${dbConfig.database}`);

runStartupMigrations();

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on 0.0.0.0:${PORT} (${ENV})`);
});

// ✅ 대용량 파일 업로드 및 느린 네트워크를 위한 서버 타임아웃 (5분 = 300,000ms)
server.timeout = 300000;
server.requestTimeout = 300000;
server.keepAliveTimeout = 65000; // Nginx 프록시 keepalive(60s)보다 약간 길게
server.headersTimeout = 66000;
