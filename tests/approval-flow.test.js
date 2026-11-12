// 결재 흐름: 상신 → 순차 승인 → 결재완료 → 재정부 이관 / 반려 / 결재선 예외
const mysql = require("mysql2/promise");
const cfg = require("./testDbConfig");
const { pool, request, app, loginAs } = require("./helpers/app");
const { resetDb, claimBody, submitClaim, getRequest } = require("./helpers/fixtures");

beforeEach(() => resetDb(pool));

// 요청이 거부된 뒤에도 문서 행 잠금(SELECT ... FOR UPDATE)이 남아 있으면 안 된다.
// 풀과 무관한 별도 연결에서 NOWAIT 으로 잠금을 시도해 확인한다.
async function isRowLocked(id) {
  const conn = await mysql.createConnection(cfg);
  try {
    await conn.beginTransaction();
    await conn.query("SELECT id FROM approval_requests WHERE id = ? FOR UPDATE NOWAIT", [id]);
    return false;
  } catch (e) {
    if (e.code === "ER_LOCK_WAIT_TIMEOUT" || /lock/i.test(e.message)) return true;
    throw e;
  } finally {
    await conn.rollback().catch(() => {});
    await conn.end();
  }
}
afterAll(() => pool.end());

describe("상신 → 순차 승인 → 최종 완료", () => {
  test("결재선 순서대로 진행되고, 재정부 이관 시 지출내역이 기록된다", async () => {
    const drafter = await loginAs("ang001");
    const id = await submitClaim(drafter);

    let row = await getRequest(pool, id);
    expect(row.status).toBe("결재진행중");
    expect(row.current_approver_user_id).toBe("mus002");
    expect(row.current_order_no).toBe(2);

    const manager = await loginAs("mus002");
    let res = await manager.post("/api/approval/approve").send({ requestId: id, comment: "확인" });
    expect(res.status).toBe(200);
    row = await getRequest(pool, id);
    expect(row.status).toBe("결재진행중");
    expect(row.current_approver_user_id).toBe("mus003");
    expect(row.current_order_no).toBe(3);

    const chair = await loginAs("mus003");
    res = await chair.post("/api/approval/approve").send({ requestId: id });
    expect(res.status).toBe(200);
    row = await getRequest(pool, id);
    expect(row.status).toBe("결재완료");

    const finance = await loginAs("fin001");
    res = await finance.post("/api/approval/approve").send({ requestId: id });
    expect(res.status).toBe(200);
    row = await getRequest(pool, id);
    expect(row.status).toBe("재정부이관완료");

    const [history] = await pool.query(
      "SELECT approver_user_id, status FROM approval_history WHERE request_id = ? ORDER BY id", [id]
    );
    expect(history.map(h => h.approver_user_id)).toEqual(["ang001", "mus002", "mus003", "fin001"]);
    expect(history.every(h => h.status === "승인")).toBe(true);

    const [expenses] = await pool.query("SELECT * FROM expense_details WHERE approval_request_id = ?", [id]);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ category_id: "ACC01010000", year: 2026, dept_id: 3 });
    expect(Number(expenses[0].amount)).toBe(50000);
  });

  test("결재완료 건은 재정부만 이관 승인할 수 있다", async () => {
    const drafter = await loginAs("ang001");
    const id = await submitClaim(drafter);
    await (await loginAs("mus002")).post("/api/approval/approve").send({ requestId: id });
    await (await loginAs("mus003")).post("/api/approval/approve").send({ requestId: id });

    const res = await (await loginAs("mus003")).post("/api/approval/approve").send({ requestId: id });
    expect(res.status).toBe(403);
    expect((await getRequest(pool, id)).status).toBe("결재완료");
    expect(await isRowLocked(id)).toBe(false);
  });

  test("현재 결재자가 아니면 승인할 수 없고, 이후 실제 결재자는 바로 승인할 수 있다", async () => {
    const drafter = await loginAs("ang001");
    const id = await submitClaim(drafter);

    const res = await (await loginAs("mus003")).post("/api/approval/approve").send({ requestId: id });
    expect(res.status).toBe(403);
    expect((await getRequest(pool, id)).current_approver_user_id).toBe("mus002");
    expect(await isRowLocked(id)).toBe(false);

    const ok = await (await loginAs("mus002")).post("/api/approval/approve").send({ requestId: id });
    expect(ok.status).toBe(200);
  }, 10000);
});

test("없는 문서를 승인·반려하면 404", async () => {
  const agent = await loginAs("mus002");
  expect((await agent.post("/api/approval/approve").send({ requestId: 9999 })).status).toBe(404);
  expect((await agent.post("/api/approval/reject").send({ requestId: 9999 })).status).toBe(404);
});

describe("반려", () => {
  test("현재 결재자가 반려하면 결재반려 상태와 반려 이력이 남는다", async () => {
    const id = await submitClaim(await loginAs("ang001"));
    const res = await (await loginAs("mus002")).post("/api/approval/reject").send({ requestId: id, comment: "영수증 누락" });
    expect(res.status).toBe(200);

    const row = await getRequest(pool, id);
    expect(row.status).toBe("결재반려");
    const [[last]] = await pool.query(
      "SELECT * FROM approval_history WHERE request_id = ? ORDER BY id DESC LIMIT 1", [id]
    );
    expect(last).toMatchObject({ status: "반려", approver_user_id: "mus002", approver_role: "부장", comment: "영수증 누락" });
  });

  test("현재 결재자가 아니면 반려할 수 없다", async () => {
    const id = await submitClaim(await loginAs("ang001"));
    const res = await (await loginAs("you001")).post("/api/approval/reject").send({ requestId: id });
    expect(res.status).toBe(403);
    expect((await getRequest(pool, id)).status).toBe("결재진행중");
    expect(await isRowLocked(id)).toBe(false);
  }, 10000);
});

describe("결재선 예외 처리", () => {
  test("결재선 순번에 공백이 있으면 다음 순번으로 건너뛴다", async () => {
    const id = await submitClaim(await loginAs("gap001"), {
      deptName: "공백부", author: "공백회계", userId: "gap001",
    });
    let row = await getRequest(pool, id);
    expect(row.current_approver_user_id).toBe("gap005");
    expect(row.current_order_no).toBe(5);

    await (await loginAs("gap005")).post("/api/approval/approve").send({ requestId: id });
    row = await getRequest(pool, id);
    expect(row.status).toBe("결재완료");
  });

  test("기안자가 결재선에 없으면 상신이 거부된다", async () => {
    const agent = await loginAs("out001");
    const res = await agent.post("/api/approval").send(claimBody({ author: "결재선미등록", userId: "out001" }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/결재선에 기안자/);
    const [[{ cnt }]] = await pool.query("SELECT COUNT(*) cnt FROM approval_requests");
    expect(cnt).toBe(0);
  });

  test("위원장 직행 선택 시 위원장에게 바로 넘어간다", async () => {
    const res = await (await loginAs("ang001")).post("/api/approval").send(claimBody({ selectedChoice: "owner" }));
    expect(res.status).toBe(200);
    const row = await getRequest(pool, res.body.id);
    expect(row.current_approver_user_id).toBe("mus003");
    expect(row.current_order_no).toBe(3);
  });

  test("위원장 직행 선택 시 위원장 결재선이 없으면 거부된다", async () => {
    const res = await (await loginAs("noc001")).post("/api/approval").send(
      claimBody({ deptName: "위원장없음부", author: "위원장없음회계", userId: "noc001", selectedChoice: "owner" })
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/위원장/);
  });

  test("재정부가 기안하면 결재선 없이 즉시 결재완료된다", async () => {
    const res = await (await loginAs("fin001")).post("/api/approval").send(
      claimBody({ author: "재정담당", userId: "fin001" })
    );
    expect(res.status).toBe(200);
    const row = await getRequest(pool, res.body.id);
    expect(row.status).toBe("결재완료");
    expect(row.dept_name).toBe("원천엔젤스");
    expect(row.current_approver_user_id).toBeNull();
  });

  test("부서 정보가 없으면 400이고, 이후 요청도 정상 처리된다", async () => {
    const res = await (await loginAs("nod001")).post("/api/approval").send(
      claimBody({ deptName: "", author: "부서없음", userId: "nod001" })
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/부서 정보/);
    // 연결이 이중 반납되면 이후 요청이 같은 연결을 동시에 쓰게 된다
    const ids = await Promise.all([0, 1, 2].map(async () => submitClaim(await loginAs("ang001"))));
    expect(new Set(ids).size).toBe(3);
  });

  test("로그인하지 않으면 상신할 수 없다", async () => {
    const res = await request(app).post("/api/approval").send(claimBody());
    expect(res.status).toBe(401);
  });
});
