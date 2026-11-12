// 예산편성서: 상신 → 승인 → 재정부 이관 시 예산(budgets)·신규 계정과목 자동 반영
const { pool, loginAs } = require("./helpers/app");
const { resetDb } = require("./helpers/fixtures");

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

const TARGET_YEAR = 2027;

function planBody(overrides = {}) {
  return {
    deptName: "원천엔젤스",
    targetYear: TARGET_YEAR,
    totalAmount: 1500000,
    comment: "2027 예산편성",
    status: "결재진행중",
    items: [
      { id: 1, category_id: "ACC01000000", category_name: "음악비", level: "관", parent_id: null, is_leaf: 0 },
      { id: 2, category_id: "ACC01010000", category_name: "찬양대비", level: "항", parent_id: 1, is_leaf: 0 },
      { id: 3, category_id: "ACC01010100", category_name: "엔젤스운영", level: "목", parent_id: 2, is_leaf: 0 },
      { id: 4, category_id: "ACC01010101", category_name: "악보구입", level: "세목", parent_id: 3,
        is_leaf: 1, prev_amount: 800000, request_amount: 1000000, diff_amount: 200000 },
      // 신규 신청 세목 (화면에서 임시 음수 ID 사용)
      { id: -101, category_id: -101, category_name: "의상구입", level: "세목", parent_id: 3,
        is_leaf: 1, is_new_category: 1, request_amount: 500000, diff_amount: 500000 },
    ],
    ...overrides,
  };
}

async function approveAll(id) {
  for (const user of ["mus002", "mus003", "fin001"]) {
    const res = await (await loginAs(user)).post("/api/approval/approve").send({ requestId: id });
    expect(res.status).toBe(200);
  }
}

test("상신하면 결재선 2단계 결재자에게 넘어간다", async () => {
  const res = await (await loginAs("ang001")).post("/api/budget-plans").send(planBody());
  expect(res.status).toBe(200);

  const [[row]] = await pool.query("SELECT * FROM approval_requests WHERE id = ?", [res.body.requestId]);
  expect(row).toMatchObject({
    document_type: "예산편성서", status: "결재진행중", aliasName: "2027년도 원천엔젤스 예산편성",
    current_approver_user_id: "mus002", current_order_no: 2,
  });
  const [items] = await pool.query("SELECT * FROM budget_plan_items WHERE request_id = ? ORDER BY sort_order", [row.id]);
  expect(items.map(i => i.level)).toEqual(["관", "항", "목", "세목", "세목"]);
});

test("같은 부서·연도의 예산편성서가 진행 중이면 다시 상신할 수 없다", async () => {
  const agent = await loginAs("ang001");
  const first = await agent.post("/api/budget-plans").send(planBody());

  const status = await agent.get("/api/budget-plans/check-status")
    .query({ deptName: "원천엔젤스", targetYear: TARGET_YEAR });
  expect(status.body).toMatchObject({ hasInProgress: true, hasTransferred: false });
  expect(status.body.inProgressItem.id).toBe(first.body.requestId);

  const second = await (await loginAs("out001")).post("/api/budget-plans").send(planBody());
  expect(second.status).toBe(400);
  expect(second.body.code).toBe("ALREADY_IN_PROGRESS");
});

test("재정부 이관 시 예산이 반영되고 신규 계정과목이 코드 채번되어 등록된다", async () => {
  const res = await (await loginAs("ang001")).post("/api/budget-plans").send(planBody());
  const id = res.body.requestId;
  await approveAll(id);

  const [[req]] = await pool.query("SELECT status FROM approval_requests WHERE id = ?", [id]);
  expect(req.status).toBe("재정부이관완료");

  // 신규 세목: 같은 목(ACC01010100) 아래 기존 세목 01 다음 번호 02
  const [[newCat]] = await pool.query("SELECT * FROM account_categories WHERE category_name = '의상구입'");
  expect(newCat).toMatchObject({ category_id: "ACC01010102", parent_id: 3, level: "세목", owner_dept_id: 3 });
  expect(newCat.valid_from).toBe(`${TARGET_YEAR}-01-01`);

  const [[mapping]] = await pool.query(
    "SELECT * FROM account_category_departments WHERE account_category_id = ? AND year = ?", [newCat.id, TARGET_YEAR]
  );
  expect(mapping.dept_id).toBe(3);

  const [budgets] = await pool.query("SELECT category_id, budget_amount FROM budgets WHERE year = ? ORDER BY category_id", [TARGET_YEAR]);
  expect(budgets.map(b => [b.category_id, Number(b.budget_amount)])).toEqual([
    ["ACC01010101", 1000000],
    ["ACC01010102", 500000],
  ]);

  const [planItems] = await pool.query("SELECT * FROM budget_plan_items WHERE request_id = ? AND category_name = '의상구입'", [id]);
  expect(planItems[0]).toMatchObject({ category_id: newCat.id, category_code: "ACC01010102", is_new_category: 0 });

  // 예산편성서는 지출내역(expense_details)을 만들지 않는다
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM expense_details");
  expect(cnt).toBe(0);
});

test("이관 후에는 같은 연도 예산이 기존 값을 덮어쓴다 (재편성)", async () => {
  await pool.query("INSERT INTO budgets (category_id, year, budget_amount) VALUES ('ACC01010101', ?, 1)", [TARGET_YEAR]);
  const res = await (await loginAs("ang001")).post("/api/budget-plans").send(planBody());
  await approveAll(res.body.requestId);

  const [[b]] = await pool.query("SELECT budget_amount FROM budgets WHERE category_id = 'ACC01010101' AND year = ?", [TARGET_YEAR]);
  expect(Number(b.budget_amount)).toBe(1000000);
});
