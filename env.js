// config/env.js
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// 1) .env 로드
const ENV_FILE = path.resolve(process.cwd(), ".env");
if (fs.existsSync(ENV_FILE)) dotenv.config({ path: ENV_FILE });

const ENV = (process.env.NODE_ENV || "development").toLowerCase();

/**
 * 환경별 키 선택 로직
 * 우선순위:
 *   1) KEY__{NODE_ENV} (예: DB_HOST__production)
 *   2) KEY (공통)
 *   3) def (기본값)
 */
function envPick(key, def = undefined) {
  const envKey = `${key}__${ENV}`; // 예: DB_HOST__development
  if (process.env[envKey] && process.env[envKey] !== "") return process.env[envKey];
  if (process.env[key] && process.env[key] !== "") return process.env[key];
  return def;
}

// 숫자/불리언 편의 함수
function envNumber(key, def) {
  const v = envPick(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function envBool(key, def) {
  const v = envPick(key);
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["1","true","yes","on"].includes(s)) return true;
    if (["0","false","no","off"].includes(s)) return false;
  }
  return def;
}

module.exports = { envPick, envNumber, envBool, ENV };
