// 테스트 환경에서는 알림톡이 실제로 발송되지 않아야 한다 (E2E 는 mock 없이 실제 서버를 띄움)
const { sendAlimTalk } = require("../services/kakaoService");

test("NODE_ENV=test 이면 Sendon API 를 호출하지 않고 생략한다", async () => {
  expect(process.env.NODE_ENV).toBe("test");
  const result = await sendAlimTalk({ templateId: "T", to: [{ phone: "01000000000", variables: {} }] });
  expect(result).toEqual({ success: true, skipped: true });
});
