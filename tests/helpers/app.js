// 테스트 대상 Express 앱과 DB 풀을 한 곳에서 불러옵니다.
const request = require("supertest");
const app = require("../../app");
const { pool } = require("../../lib/db");
const cfg = require("../testDbConfig");

if (pool.pool.config.connectionConfig.database !== cfg.database) {
  throw new Error("테스트가 테스트 DB가 아닌 곳에 연결되어 있습니다. 중단합니다.");
}

/** 로그인된 supertest agent 반환 (세션 쿠키 유지) */
async function loginAs(userId, password = "pw") {
  const agent = request.agent(app);
  const res = await agent.post("/api/login").send({ userId, password });
  if (res.status !== 200) {
    throw new Error(`로그인 실패(${userId}): ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

module.exports = { app, pool, request, loginAs };
