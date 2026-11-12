// 가청구건(초기 기지출액) 등록 API — 재정부·관리자(또는 메뉴 권한을 받은 역할)만 사용
const { pool, app, request, loginAs } = require("./helpers/app");
const { resetDb, ROLES } = require("./helpers/fixtures");

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

const bulkBody = {
  year: 2026,
  request_date: "2026-01-02",
  items: [{ category_id: "ACC01010000", parent_id: "ACC01000000", owner_dept_id: 3, amount: 300000 }],
};

describe.each([
  ["/api/initial-expenses/bulk"],
  ["/api/dummy-claims-bulk"], // 이전 경로 (화면 배포 전까지 호환 유지)
])("POST %s", (url) => {
  test("재정부는 기지출액을 등록할 수 있다", async () => {
    const res = await (await loginAs("fin001")).post(url).send(bulkBody);
    expect(res.status).toBe(200);

    const [expenses] = await pool.query("SELECT * FROM expense_details WHERE description = '초기 기지출액'");
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ category_id: "ACC01010000", year: 2026, dept_id: 3 });
    const [[doc]] = await pool.query("SELECT * FROM approval_requests WHERE document_type = '가청구건'");
    expect(Number(doc.total_amount)).toBe(300000);
  });

  test("같은 연도에 다시 등록하면 기존 값을 대체한다", async () => {
    const agent = await loginAs("adm001");
    await agent.post(url).send(bulkBody);
    await agent.post(url).send({ ...bulkBody, items: [{ ...bulkBody.items[0], amount: 100000 }] });

    const [expenses] = await pool.query("SELECT amount FROM expense_details");
    expect(expenses.map(e => Number(e.amount))).toEqual([100000]);
    const [docs] = await pool.query("SELECT total_amount FROM approval_requests WHERE document_type = '가청구건'");
    expect(docs.map(d => Number(d.total_amount))).toEqual([100000]);
  });

  test("일반 사용자는 403", async () => {
    const res = await (await loginAs("ang001")).post(url).send(bulkBody);
    expect(res.status).toBe(403);
    const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM expense_details");
    expect(cnt).toBe(0);
  });

  test("'가청구건 등록' 메뉴 권한을 받은 역할은 사용할 수 있다", async () => {
    await pool.query("INSERT INTO role_access (role_id, menu_name) VALUES (?, '가청구건 등록')", [ROLES["회계"]]);
    const res = await (await loginAs("ang001")).post(url).send(bulkBody);
    expect(res.status).toBe(200);
  });

  test("로그인하지 않으면 401", async () => {
    const res = await request(app).post(url).send(bulkBody);
    expect(res.status).toBe(401);
  });
});

describe.each([
  ["/api/initial-expenses"],
  ["/api/initial-expenses-data"], // 이전 경로
])("GET %s", (url) => {
  test("재정부는 항 단위 예산·지출 현황을 조회한다", async () => {
    const res = await (await loginAs("fin001")).get(url).query({ year: 2026 });
    expect(res.status).toBe(200);
    expect(res.body.categories.map(c => c.category_id)).toEqual(["ACC01010000"]);
  });

  test("로그인하지 않으면 401, 일반 사용자는 403", async () => {
    expect((await request(app).get(url)).status).toBe(401);
    expect((await (await loginAs("ang001")).get(url)).status).toBe(403);
  });
});

test("사용하지 않는 구버전 개별 등록 API(/api/dummy-claims)는 제거되었다", async () => {
  const res = await (await loginAs("fin001")).post("/api/dummy-claims").send({});
  expect(res.status).toBe(404);
});
