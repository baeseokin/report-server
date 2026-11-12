// 로그인 사용자 · 권한 헬퍼
function getLoginUser(req) {
  return req.session?.user || null;
}
function isAdmin(req) {
  const u = getLoginUser(req);
  return Array.isArray(u?.roles) && u.roles.some(r => r.role_name === "관리자");
}
function isFinance(req) {
  return getLoginUser(req)?.deptName === "재정부";
}
function assertSelfOrAdmin(req, targetUserId) {
  const u = getLoginUser(req);
  // userId는 문자열(로그인 ID), DB user_signatures.user_id와 동일 타입
  if (!u) return false;
  if (isAdmin(req)) return true;
  return String(u.userId) === String(targetUserId);
}

// 파일 URL 생성: /api/files/:filename 엔드포인트에 맞춰 인코딩
function makeSignatureUrl(filePath) {
  // filePath 예: "signatures/1727952435_signature.png"
  return `/api/files/${encodeURIComponent(filePath)}`;
}

// 세션에서 1차 역할 뽑기 (role_name 우선, 없으면 원시값)
function getUserPrimaryRole(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  // 우선순위가 있다면 여기에 배열로 두고 가장 먼저 매칭되는 것을 사용
  const priority = ["부장", "팀장", "회계", "담당"];

  const roleNames = roles
    .map(r => r?.role_name ?? r)
    .filter(Boolean);

  // 우선순위 매칭
  for (const p of priority) {
    if (roleNames.includes(p)) return p;
  }
  // 없으면 첫 번째
  return roleNames[0] ?? null;
}

// ── 미들웨어 ──────────────────────────────────────────────
// 로그인 필수
function requireLogin(req, res, next) {
  if (!getLoginUser(req)) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }
  next();
}

// 재정부 또는 관리자만 허용
function requireFinanceOrAdmin(req, res, next) {
  if (!getLoginUser(req)) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }
  if (!isFinance(req) && !isAdmin(req)) {
    return res.status(403).json({ success: false, message: "재정부 또는 관리자만 사용할 수 있습니다." });
  }
  next();
}

module.exports = {
  getLoginUser, isAdmin, isFinance, assertSelfOrAdmin, makeSignatureUrl, getUserPrimaryRole,
  requireLogin, requireFinanceOrAdmin,
};
