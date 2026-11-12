// E2E(화면) 테스트용 데이터 준비
//   - 단위/통합 테스트 기초 데이터(fixtures.resetDb) + 화면에 필요한 데이터
//     (부서코드, 메뉴 권한, 부서별 계정과목 매핑, 예산)
//   - report-form-ui 의 Playwright 테스트가 각 시나리오 시작 전에 호출합니다.
const mysql = require("mysql2/promise");
const cfg = require("../testDbConfig");
const { resetDb, ROLES } = require("../helpers/fixtures");

const YEAR = new Date().getFullYear();

// 일반 사용자 메뉴
const COMMON_MENUS = [
  "지출결의서 작성", "예산편성서 작성", "청구목록 조회", "내결재목록 조회",
  "지출내역 조회", "예산집행 현황", "부서 예산집행 현황",
];
// 재정부·관리자 추가 메뉴
const FINANCE_MENUS = [
  ...COMMON_MENUS, "가청구건 등록", "재정부 일괄결재", "계정과목 관리", "예산 관리",
  "결재선 관리", "부서 관리", "사용자 관리", "권한 관리",
];

const DEPT_CODES = {
  1: "CH", 2: "MU", 3: "ANG", 4: "FIN", 5: "EDU", 6: "YOU", 7: "GAP", 8: "NOC",
};

async function seedForE2E() {
  const pool = mysql.createPool({ ...cfg, connectionLimit: 2, dateStrings: true });
  try {
    await resetDb(pool);

    for (const [id, code] of Object.entries(DEPT_CODES)) {
      await pool.query("UPDATE departments SET dept_cd = ? WHERE id = ?", [code, id]);
    }
    await pool.query("UPDATE departments SET account_info = '국민 123-45-6789 원천엔젤스' WHERE id = 3");

    const access = [];
    for (const [roleName, roleId] of Object.entries(ROLES)) {
      const menus = roleName === "관리자" || roleName === "재정부" ? FINANCE_MENUS : COMMON_MENUS;
      for (const m of menus) access.push([roleId, m]);
    }
    await pool.query("INSERT INTO role_access (role_id, menu_name) VALUES ?", [access]);

    // 세목 '악보구입'(id 4)을 기안 부서들에 매핑 (올해)
    await pool.query(
      "INSERT INTO account_category_departments (account_category_id, dept_id, year) VALUES ?",
      [[3, 6, 7, 8].map(deptId => [4, deptId, YEAR])]
    );
    await pool.query("UPDATE account_categories SET owner_dept_id = 3 WHERE id IN (2, 3, 4)");

    // 올해 예산
    await pool.query(
      "INSERT INTO budgets (category_id, year, budget_amount) VALUES ('ACC01010101', ?, 1000000)",
      [YEAR]
    );
  } finally {
    await pool.end();
  }
}

/** 테스트 확인용 조회 */
async function query(sql, params = []) {
  const conn = await mysql.createConnection({ ...cfg, dateStrings: true });
  try {
    const [rows] = await conn.query(sql, params);
    return rows;
  } finally {
    await conn.end();
  }
}

module.exports = { seedForE2E, query, YEAR };

if (require.main === module) {
  seedForE2E().then(() => console.log("✅ E2E 데이터 준비 완료")).catch(e => { console.error(e); process.exit(1); });
}
