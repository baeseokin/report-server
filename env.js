// config/env.js
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const os = require("os");

// 1) .env 로드
const ENV_FILE = path.resolve(process.cwd(), ".env");
if (fs.existsSync(ENV_FILE)) dotenv.config({ path: ENV_FILE });

// 2) NODE_ENV 자동 감지 (로컬=development, Pod/컨테이너=production)
//    - 명시적으로 NODE_ENV가 있으면 그 값을 우선 사용
//    - K8s 환경 변수(KUBERNETES_SERVICE_HOST) 또는 hostname 패턴으로 감지
if (!process.env.NODE_ENV) {
  const isK8s = !!process.env.KUBERNETES_SERVICE_HOST || /pod|deploy|stateful|sts/i.test(os.hostname());
  process.env.NODE_ENV = isK8s ? "production" : "development";
}

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
//    MOCK_DATE=YYYY-MM-DD 를 설정하면 해당 일자를 시스템 기준일자로 사용합니다. (개발·테스트용)
//    운영(production)에서는 실수로 설정되어 있어도 무시합니다.
let mockDateWarned = false;
function getMockDate() {
  const mockDate = envPick("MOCK_DATE");
  if (!mockDate || !/^\d{4}-\d{2}-\d{2}/.test(mockDate)) return null;
  if (ENV === "production") {
    if (!mockDateWarned) {
      console.warn(`⚠️ 운영 환경에서는 MOCK_DATE(${mockDate})를 무시하고 실제 날짜를 사용합니다.`);
      mockDateWarned = true;
    }
    return null;
  }
  return mockDate;
}

function isDateMocked() {
  return getMockDate() !== null;
}

function getSystemDate() {
  const mockDate = getMockDate();
  return mockDate ? new Date(mockDate) : new Date();
}

function getSystemToday() {
  const mockDate = getMockDate();
  if (mockDate) return mockDate.substring(0, 10);
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
  isDateMocked,
  getSystemDate,
  getSystemToday,
  getSystemYear,
};
