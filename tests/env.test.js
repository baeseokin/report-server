// env.js: MOCK_DATE(기준일자 시뮬레이션)는 운영 환경에서 무시되어야 한다
const ORIGINAL_ENV = process.env;
afterEach(() => { process.env = ORIGINAL_ENV; });

// 지정한 환경변수로 env.js 를 새로 불러온다 (환경변수는 afterEach 에서 원복)
function loadEnv(vars) {
  process.env = { ...ORIGINAL_ENV, ...vars };
  let mod;
  jest.isolateModules(() => { mod = require("../env"); });
  return mod;
}

test("개발 환경에서는 MOCK_DATE 를 기준일자로 사용한다", () => {
  const env = loadEnv({ NODE_ENV: "development", MOCK_DATE__development: "2027-01-15" });
  expect(env.getSystemToday()).toBe("2027-01-15");
  expect(env.getSystemYear()).toBe(2027);
  expect(env.isDateMocked()).toBe(true);
});

test("운영 환경에서는 MOCK_DATE 가 설정되어 있어도 실제 날짜를 사용한다", () => {
  const env = loadEnv({ NODE_ENV: "production", MOCK_DATE: "2027-01-15", MOCK_DATE__production: "2027-01-15" });
  const now = new Date();
  expect(env.getSystemYear()).toBe(now.getFullYear());
  expect(env.getSystemToday()).not.toBe("2027-01-15");
  expect(env.getSystemDate().getFullYear()).toBe(now.getFullYear());
  expect(env.isDateMocked()).toBe(false);
});

test("형식이 잘못된 MOCK_DATE 는 무시한다", () => {
  const env = loadEnv({ NODE_ENV: "development", MOCK_DATE__development: "내일" });
  expect(env.isDateMocked()).toBe(false);
});
