// 알림톡은 절대 실제로 발송하지 않습니다.
jest.mock("../services/sendApprovalAlimTalk", () => ({
  sendApprovalAlimTalk: jest.fn().mockResolvedValue({ mocked: true }),
}));

// 서버 로그가 테스트 출력을 덮지 않도록 숨깁니다. (DEBUG_TEST=1 이면 표시)
if (!process.env.DEBUG_TEST) {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
}
