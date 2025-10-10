// server/services/emailService.js
const nodemailer = require("nodemailer");

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP env is missing");
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE) === "true", // 465면 true
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

/**
 * 공통 메일 발송 함수
 * @param {object} param0 { to, cc, subject, html, attachments }
 */
async function sendMail({ to, cc, subject, html, attachments }) {
  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    cc,
    subject,
    html,
    attachments,
  });
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

module.exports = { sendMail };
