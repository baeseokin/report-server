// 로그인 · 세션 · 로그아웃
const { pool, app, request, loginAs } = require("./helpers/app");
const { resetDb } = require("./helpers/fixtures");

beforeAll(() => resetDb(pool));
afterAll(() => pool.end());

test("올바른 비밀번호로 로그인하면 세션에 사용자 정보가 저장된다", async () => {
  const agent = await loginAs("ang001");
  const res = await agent.get("/api/session");
  expect(res.body.success).toBe(true);
  expect(res.body.user).toMatchObject({ userId: "ang001", deptName: "원천엔젤스", deptId: 3 });
  expect(res.body.user.roles.map(r => r.role_name)).toEqual(["회계"]);
});

test("비밀번호가 틀리면 401", async () => {
  const res = await request(app).post("/api/login").send({ userId: "ang001", password: "wrong" });
  expect(res.status).toBe(401);
});

test("없는 ID면 401", async () => {
  const res = await request(app).post("/api/login").send({ userId: "nobody", password: "pw" });
  expect(res.status).toBe(401);
});

test("로그아웃하면 세션이 사라진다", async () => {
  const agent = await loginAs("ang001");
  await agent.post("/api/logout");
  const res = await agent.get("/api/session");
  expect(res.body.success).toBe(false);
});

test.each([
  ["post", "/api/approvalList"],
  ["post", "/api/approval/approve"],
  ["post", "/api/approval/reject"],
  ["delete", "/api/approval/1"],
  ["post", "/api/budget-plans"],
  ["get", "/api/budget-plans/1"],
])("로그인 없이 %s %s → 401", async (method, url) => {
  const res = await request(app)[method](url).send({});
  expect(res.status).toBe(401);
});
