// services/sendApprovalDecisionMail.js
const { buildMailHTML } = require("./mailTemplate");     // ← 경로 확인
const { sendMail } = require("./emailService");          // ← 경로 확인

// ───────────────────────────────────────────────────────────
// 이메일 발송
// ───────────────────────────────────────────────────────────
/**
 * 공통 메일 발송 함수
 * - 제목/본문(Text) 중심, 공통 템플릿으로 HTML 구성
 *
 * @param {Object} opts
 * @param {string|string[]} opts.to         수신자(필수)
 * @param {string}          opts.title      메일 제목(필수) = 본문 타이틀과 동일하게 사용
 * @param {string}          opts.bodyText   본문 텍스트(필수, \n 자동 줄바꿈)
 * @param {number|string=}  opts.requestId  상세보기 링크에 사용(선택)
 * @param {string=}         opts.cc         CC(선택, 없으면 process.env.MAIL_CC 사용 가능)
 * @param {string=}         opts.bcc        BCC(선택)
 * @param {string=}         opts.from       발신자 오버라이드(선택, 기본은 process.env.MAIL_FROM)
 * @param {string=}         opts.replyTo    회신 주소(선택)
 * @param {Array=}          opts.attachments Nodemailer attachments (선택)
 * @param {string=}         opts.ctaText    버튼 문구(선택, 기본: "재정시스템 바로가기")
 * @param {string=}         opts.ctaUrl     버튼 링크(선택, 기본: APP_BASE_URL/report/{requestId})
 * @param {string=}         opts.footerText 푸터 문구(선택)
 */
async function sendApprovalDecisionMail(opts) {
  const {
    to,
    title,
    bodyText,
    requestId,
    cc,
    bcc,
    from,
    replyTo,
    attachments,
    ctaText,
    ctaUrl,
    footerText,
  } = opts || {};

  // --- 기본 검증 ---
  if (!to) throw new Error("sendApprovalDecisionMail: 'to' is required");
  if (!title) throw new Error("sendApprovalDecisionMail: 'title' is required");
  if (!bodyText) throw new Error("sendApprovalDecisionMail: 'bodyText' is required");

  // (선택) 수신자 정규화: "a@b.com, c@d.com" → ["a@b.com","c@d.com"]
  const toList = Array.isArray(to)
    ? to
    : String(to).split(",").map(s => s.trim()).filter(Boolean);

  const baseUrl = process.env.APP_BASE_URL || "";
  const resolvedCtaUrl =
    //ctaUrl || (baseUrl && requestId ? `${baseUrl}/report/${requestId}` : baseUrl);
    ctaUrl || baseUrl;

  const html = buildMailHTML({
    title,
    bodyText,                                         // 텍스트는 템플릿에서 nl2br 처리
    ctaText: resolvedCtaUrl ? (ctaText || "재정시스템 바로가기") : undefined,
    ctaUrl: resolvedCtaUrl,
    footerText: footerText || "본 메일은 시스템에서 자동 발송되었습니다.",
  });

  const subject = title;
  const mailOptions = {
    to: toList,
    cc: cc || undefined,
    bcc,
    subject,
    html,
    attachments,
  };
  if (from) mailOptions.from = from;
  if (replyTo) mailOptions.replyTo = replyTo;

  try {
    const result = await sendMail(mailOptions);
    console.log("📧 Mail sent:", { subject, to: toList, messageId: result.messageId });
    return result;
  } catch (err) {
    console.error("❌ sendApprovalDecisionMail error:", err);
    throw err;
  }
}

module.exports = { sendApprovalDecisionMail };
