// 결재 알림톡 발송 대상 (실제 발송은 setupAfterEnv 에서 mock 처리)
const { sendApprovalAlimTalk } = require("../services/sendApprovalAlimTalk");
const { pool, loginAs } = require("./helpers/app");
const { resetDb, submitClaim } = require("./helpers/fixtures");

// 알림은 응답 후 setImmediate 로 비동기 발송되므로 잠시 기다린다
const flush = () => new Promise(r => setTimeout(r, 100));

beforeEach(async () => {
  await resetDb(pool);
  sendApprovalAlimTalk.mockClear();
});
afterAll(() => pool.end());

test("상신하면 다음 결재자에게 결재요청 알림을 보낸다", async () => {
  await submitClaim(await loginAs("ang001"));
  await flush();
  expect(sendApprovalAlimTalk).toHaveBeenCalledTimes(1);
  expect(sendApprovalAlimTalk.mock.calls[0][0]).toMatchObject({
    to: "010-1111-0002", deptName: "원천엔젤스", author: "엔젤스회계", totalAmount: 50000, urlPath: "approvalStatus",
  });
});

test("중간 승인 시 다음 결재자에게, 최종 승인 시 기안자에게 알린다", async () => {
  const id = await submitClaim(await loginAs("ang001"));
  await flush();
  sendApprovalAlimTalk.mockClear();

  await (await loginAs("mus002")).post("/api/approval/approve").send({ requestId: id, comment: "확인" });
  await flush();
  expect(sendApprovalAlimTalk).toHaveBeenCalledTimes(1);
  expect(sendApprovalAlimTalk.mock.calls[0][0]).toMatchObject({ to: "010-1111-0003", urlPath: "approvalStatus", comment: "확인" });

  sendApprovalAlimTalk.mockClear();
  await (await loginAs("mus003")).post("/api/approval/approve").send({ requestId: id });
  await flush();
  expect(sendApprovalAlimTalk).toHaveBeenCalledTimes(1);
  expect(sendApprovalAlimTalk.mock.calls[0][0]).toMatchObject({ to: "010-1111-0001", status: "결재완료", urlPath: "approvalList" });
});

test("반려 시 기안자에게 반려 알림을 보낸다", async () => {
  const id = await submitClaim(await loginAs("ang001"));
  await flush();
  sendApprovalAlimTalk.mockClear();

  await (await loginAs("mus002")).post("/api/approval/reject").send({ requestId: id, comment: "영수증 누락" });
  await flush();
  expect(sendApprovalAlimTalk).toHaveBeenCalledTimes(1);
  expect(sendApprovalAlimTalk.mock.calls[0][0]).toMatchObject({ to: "010-1111-0001", status: "반려", comment: "영수증 누락" });
});

test("예산편성서 상신 시 2단계 결재자에게 알린다", async () => {
  await (await loginAs("ang001")).post("/api/budget-plans").send({
    deptName: "원천엔젤스", targetYear: 2027, totalAmount: 0, status: "결재진행중", items: [],
  });
  await flush();
  expect(sendApprovalAlimTalk).toHaveBeenCalledTimes(1);
  expect(sendApprovalAlimTalk.mock.calls[0][0]).toMatchObject({ to: "010-1111-0002", deptName: "원천엔젤스" });
});

test("재정부 기안(즉시 결재완료)은 알림을 보내지 않는다", async () => {
  await (await loginAs("fin001")).post("/api/approval").send({
    documentType: "청구서", deptName: "원천엔젤스", author: "재정담당", userId: "fin001",
    date: "2026-03-10", totalAmount: 1000, items: [],
  });
  await flush();
  expect(sendApprovalAlimTalk).not.toHaveBeenCalled();
});
