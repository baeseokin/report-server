// 결재 알림톡 발송 대상 조회 + 발송
const { pool } = require("../lib/db");
const { sendApprovalAlimTalk } = require("./sendApprovalAlimTalk");

/** 결재자(로그인 ID 목록)에게 발송. 휴대폰 번호가 없는 사용자는 건너뜁니다. 발송한 번호 목록을 반환합니다. */
async function notifyUsers(userIds, message) {
  if (!userIds || userIds.length === 0) return [];
  const [users] = await pool.query(`SELECT user_name, phone FROM users WHERE user_id IN (?)`, [userIds]);
  const sent = [];
  for (const user of users) {
    if (user?.phone) {
      await sendApprovalAlimTalk({ to: user.phone, ...message });
      sent.push(user.phone);
    }
  }
  return sent;
}

/** 기안자(이름 기준)에게 발송. 발송한 번호(없으면 null)를 반환합니다. */
async function notifyAuthor(authorName, message) {
  const [[applicant]] = await pool.query(`SELECT phone FROM users WHERE user_name=? LIMIT 1`, [authorName]);
  const toPhone = applicant?.phone;
  if (!toPhone) return null;
  await sendApprovalAlimTalk({ to: toPhone, ...message });
  return toPhone;
}

module.exports = { notifyUsers, notifyAuthor };
