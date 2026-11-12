// 테스트 공통 기초 데이터 (부서·역할·사용자·결재선·계정과목)
const bcrypt = require("bcrypt");

const TABLES = [
  "account_categories", "account_category_departments", "approval_files", "approval_history",
  "approval_items", "approval_line", "approval_requests", "board_comments", "board_files",
  "board_views", "boards", "budget_plan_items", "budget_request_items", "budget_requests",
  "budgets", "departments", "expense_details", "notice_files", "notice_views", "notices",
  "role_access", "roles", "user_favorites", "user_roles", "user_signatures", "users",
];

const ROLES = { 관리자: 1, 당회장: 2, 대장: 3, 부장: 4, 위원장: 5, 재정부: 6, 회계: 7 };

// [id, dept_name, parent_dept_id]
const DEPTS = [
  [1, "교회", null],
  [2, "음악부", 1],
  [3, "원천엔젤스", 2],
  [4, "재정부", 1],
  [5, "교육부", 1],
  [6, "청년부", 5],
  [7, "공백부", 1],       // 결재선 순번에 공백이 있는 부서 (1 → 5)
  [8, "위원장없음부", 1],  // 위원장 결재선이 없는 부서
];

// [user_id, user_name, dept_name, role, phone]
const USERS = [
  ["ang001", "엔젤스회계", "원천엔젤스", "회계", "010-1111-0001"],
  ["out001", "결재선미등록", "원천엔젤스", "회계"],
  ["mus002", "음악부장", "음악부", "부장", "010-1111-0002"],
  ["mus003", "음악위원장", "음악부", "위원장", "010-1111-0003"],
  ["you001", "청년회계", "청년부", "회계"],
  ["gap001", "공백회계", "공백부", "회계"],
  ["gap005", "공백부장", "공백부", "부장"],
  ["noc001", "위원장없음회계", "위원장없음부", "회계"],
  ["fin001", "재정담당", "재정부", "재정부"],
  ["adm001", "관리자", "교회", "관리자"],
  ["nod001", "부서없음", null, "회계"],
];

// [dept_name, role, user_id, order_no]
const APPROVAL_LINES = [
  ["원천엔젤스", "회계", "ang001", 1],
  ["원천엔젤스", "부장", "mus002", 2],
  ["원천엔젤스", "위원장", "mus003", 3],
  ["청년부", "회계", "you001", 1],
  ["청년부", "부장", "mus002", 2],
  ["공백부", "회계", "gap001", 1],
  ["공백부", "부장", "gap005", 5],
  ["위원장없음부", "회계", "noc001", 1],
  ["위원장없음부", "부장", "mus002", 2],
];

// 계정과목: 관 > 항 > 목 > 세목  [id, code, parent_id, level, name]
const CATEGORIES = [
  [1, "ACC01000000", null, "관", "음악비"],
  [2, "ACC01010000", 1, "항", "찬양대비"],
  [3, "ACC01010100", 2, "목", "엔젤스운영"],
  [4, "ACC01010101", 3, "세목", "악보구입"],
];

let passwordHash;

async function resetDb(pool) {
  const conn = await pool.getConnection();
  try {
    await conn.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of TABLES) await conn.query(`TRUNCATE TABLE \`${t}\``);
    await conn.query("SET FOREIGN_KEY_CHECKS=1");

    passwordHash = passwordHash || (await bcrypt.hash("pw", 4));

    await conn.query("INSERT INTO roles (id, role_name) VALUES ?", [Object.entries(ROLES).map(([n, id]) => [id, n])]);
    await conn.query("INSERT INTO departments (id, dept_name, parent_dept_id) VALUES ?", [DEPTS]);

    for (const [userId, name, dept, role, phone = null] of USERS) {
      const [r] = await conn.query(
        "INSERT INTO users (user_id, user_name, dept_name, phone, password_hash) VALUES (?, ?, ?, ?, ?)",
        [userId, name, dept, phone, passwordHash]
      );
      await conn.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [r.insertId, ROLES[role]]);
    }

    await conn.query(
      "INSERT INTO approval_line (dept_name, approver_role, approver_user_id, order_no) VALUES ?",
      [APPROVAL_LINES]
    );

    await conn.query(
      "INSERT INTO account_categories (id, category_id, parent_id, level, category_name, valid_from) VALUES ?",
      [CATEGORIES.map(c => [...c, "2020-01-01"])]
    );
  } finally {
    conn.release();
  }
}

/** 청구서 상신 요청 본문 */
function claimBody(overrides = {}) {
  return {
    documentType: "청구서",
    deptName: "원천엔젤스",
    author: "엔젤스회계",
    userId: "ang001",
    date: "2026-03-10",
    totalAmount: 50000,
    comment: "악보 구입",
    aliasName: "3월 악보 구입",
    selectedGwan: "ACC01000000",
    selectedHang: "ACC01010000",
    items: [{ gwan: "ACC01000000", hang: "ACC01010000", mok: "ACC01010100", semok: "ACC01010101", detail: "악보", amount: 50000 }],
    ...overrides,
  };
}

/** 상신 + (UI와 동일하게) 기안자 이력 기록까지 수행하고 요청 ID 반환 */
async function submitClaim(agent, overrides = {}) {
  const body = claimBody(overrides);
  const res = await agent.post("/api/approval").send(body);
  if (res.status !== 200) throw new Error(`상신 실패: ${res.status} ${JSON.stringify(res.body)}`);
  await agent.post("/api/approval/history").send({
    requestId: res.body.id, approver_role: "회계", approver_user_id: body.userId, comment: "기안",
  });
  return res.body.id;
}

async function getRequest(pool, id) {
  const [[row]] = await pool.query("SELECT * FROM approval_requests WHERE id = ?", [id]);
  return row;
}

module.exports = { resetDb, claimBody, submitClaim, getRequest, ROLES, DEPTS };
