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
// ✅ 날짜 시뮬레이션(Mock Date) 헬퍼
function getSystemDate() {
  const mockDate = envPick("MOCK_DATE");
  if (mockDate && /^\d{4}-\d{2}-\d{2}/.test(mockDate)) {
    return new Date(mockDate);
  }
  return new Date();
}

function getSystemToday() {
  const mockDate = envPick("MOCK_DATE");
  if (mockDate && /^\d{4}-\d{2}-\d{2}/.test(mockDate)) {
    return mockDate.substring(0, 10);
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getSystemYear() {
  return parseInt(getSystemToday().substring(0, 4), 10);
}

module.exports = {
  envPick,
  envNumber,
  envBool,
  ENV,
  getSystemDate,
  getSystemToday,
  getSystemYear,
};
