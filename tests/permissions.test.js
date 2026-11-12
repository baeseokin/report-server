// 권한별 목록 조회 · 수정 · 삭제
const { pool, loginAs } = require("./helpers/app");
const { resetDb, claimBody, submitClaim, getRequest } = require("./helpers/fixtures");

beforeEach(() => resetDb(pool));
afterAll(() => pool.end());

async function listIds(agent, body = {}) {
  const res = await agent.post("/api/approvalList").send({ pageSize: 100, ...body });
  expect(res.status).toBe(200);
  return res.body.rows.map(r => r.id).sort((a, b) => a - b);
}

describe("결재 목록 조회 권한", () => {
  let angelsId, youthId;

  beforeEach(async () => {
    angelsId = await submitClaim(await loginAs("ang001"));
    youthId = await submitClaim(await loginAs("you001"), {
      deptName: "청년부", author: "청년회계", userId: "you001",
    });
  });

  test("일반 사용자는 부서를 지정하지 않으면 소속 부서 문서만 본다", async () => {
    expect(await listIds(await loginAs("ang001"))).toEqual([angelsId]);
    expect(await listIds(await loginAs("you001"))).toEqual([youthId]);
  });

  test("상위 부서 사용자는 하위 부서 문서도 본다", async () => {
    // 음악부장은 음악부 > 원천엔젤스 문서를 볼 수 있고, 청년부 문서는 보지 못한다
    expect(await listIds(await loginAs("mus002"))).toEqual([angelsId]);
  });

  test("재정부와 관리자는 전체 문서를 본다", async () => {
    expect(await listIds(await loginAs("fin001"))).toEqual([angelsId, youthId]);
    expect(await listIds(await loginAs("adm001"))).toEqual([angelsId, youthId]);
  });

  test("결재대기 필터는 내가 현재 결재자인 문서만 보여준다", async () => {
    const manager = await loginAs("mus002");
    expect(await listIds(manager, { status: "결재대기" })).toEqual([angelsId]);
    await manager.post("/api/approval/approve").send({ requestId: angelsId });
    expect(await listIds(manager, { status: "결재대기" })).toEqual([]);
    expect(await listIds(await loginAs("mus003"), { status: "결재대기" })).toEqual([angelsId]);
  });

  test("재정부의 결재대기는 결재완료(이관 대상) 문서이다", async () => {
    const finance = await loginAs("fin001");
    expect(await listIds(finance, { status: "결재대기" })).toEqual([]);
    await (await loginAs("mus002")).post("/api/approval/approve").send({ requestId: angelsId });
    await (await loginAs("mus003")).post("/api/approval/approve").send({ requestId: angelsId });
    expect(await listIds(finance, { status: "결재대기" })).toEqual([angelsId]);
  });
});

describe("수정 권한", () => {
  test("결재가 시작되지 않은 문서는 기안자가 수정할 수 있다", async () => {
    const agent = await loginAs("ang001");
    const id = await submitClaim(agent);
    const res = await agent.post("/api/approval").send(claimBody({ id, totalAmount: 70000 }));
    expect(res.status).toBe(200);
    expect(Number((await getRequest(pool, id)).total_amount)).toBe(70000);
  });

  test("결재가 진행된 문서는 수정할 수 없다", async () => {
    const agent = await loginAs("ang001");
    const id = await submitClaim(agent);
    await (await loginAs("mus002")).post("/api/approval/approve").send({ requestId: id });

    const res = await agent.post("/api/approval").send(claimBody({ id, totalAmount: 70000 }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/이미 결재가 진행/);
    expect(Number((await getRequest(pool, id)).total_amount)).toBe(50000);
  });

  test("기안자가 아니면 수정할 수 없다", async () => {
    const id = await submitClaim(await loginAs("ang001"));
    const res = await (await loginAs("you001")).post("/api/approval").send(
      claimBody({ id, deptName: "청년부", author: "청년회계", userId: "you001" })
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/수정 권한/);
  });
});

describe("삭제 권한", () => {
  test("기안자는 결재 전 문서를 삭제할 수 있다", async () => {
    const agent = await loginAs("ang001");
    const id = await submitClaim(agent);
    const res = await agent.delete(`/api/approval/${id}`);
    expect(res.status).toBe(200);
    expect(await getRequest(pool, id)).toBeUndefined();
  });

  test("다른 사용자는 삭제할 수 없다", async () => {
    const id = await submitClaim(await loginAs("ang001"));
    const res = await (await loginAs("you001")).delete(`/api/approval/${id}`);
    expect(res.body.success).toBe(false);
    expect(await getRequest(pool, id)).toBeDefined();
  });

  test("결재가 진행된 문서는 기안자도 삭제할 수 없다", async () => {
    const agent = await loginAs("ang001");
    const id = await submitClaim(agent);
    await (await loginAs("mus002")).post("/api/approval/approve").send({ requestId: id });
    const res = await agent.delete(`/api/approval/${id}`);
    expect(res.body.success).toBe(false);
    expect(await getRequest(pool, id)).toBeDefined();
  });

  test("재정부는 결재완료 문서도 삭제할 수 있다", async () => {
    const id = await submitClaim(await loginAs("ang001"));
    await (await loginAs("mus002")).post("/api/approval/approve").send({ requestId: id });
    await (await loginAs("mus003")).post("/api/approval/approve").send({ requestId: id });

    const res = await (await loginAs("fin001")).delete(`/api/approval/${id}`);
    expect(res.status).toBe(200);
    expect(await getRequest(pool, id)).toBeUndefined();
  });
});
