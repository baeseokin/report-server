module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  globalSetup: "<rootDir>/tests/globalSetup.js",
  setupFiles: ["<rootDir>/tests/setupEnv.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/setupAfterEnv.js"],
  testTimeout: 20000,
  maxWorkers: 1, // 하나의 테스트 DB를 공유하므로 순차 실행
};
