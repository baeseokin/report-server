// server/services/mailTemplate.js

/**
 * 간단한 HTML 이스케이프
 */
function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 개행(\n)을 <br/>로 변환
 */
function nl2br(str = "") {
  return escapeHtml(str).replace(/\n/g, "<br/>");
}

/**
 * 공통 메일 HTML 템플릿
 * - 호출측에서 Text만 채워 넣는 방식
 *
 * @param {object} param0
 * @param {string} param0.title          메일 제목(본문 상단 타이틀, 선택)
 * @param {string} param0.bodyText       본문 텍스트(멀티라인 가능, \n 자동 줄바꿈)
 * @param {string} [param0.ctaText]      버튼 텍스트(선택)
 * @param {string} [param0.ctaUrl]       버튼 링크(선택)
 * @param {string} [param0.footerText]   하단 푸터 문구(선택, 기본: 자동발송 문구)
 * @returns {string}                     완성된 HTML
 */
function buildMailHTML({ title, bodyText, ctaText, ctaUrl, footerText }) {
  const safeTitle = title ? escapeHtml(title) : "";
  const safeBody = nl2br(bodyText || "");
  const safeFooter = footerText
    ? nl2br(footerText)
    : "본 메일은 시스템에서 자동 발송되었습니다.";

  const ctaButton = ctaText && ctaUrl
    ? `
      <div style="margin-top:16px;">
        <a href="${escapeHtml(ctaUrl)}"
           style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;border-radius:8px;padding:10px 14px;">
          ${escapeHtml(ctaText)}
        </a>
      </div>
    `
    : "";

  return `
  <div style="font-family:Apple SD Gothic Neo,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;line-height:1.6;">
    ${safeTitle ? `<h2 style="font-size:18px;margin:0 0 12px 0;">${safeTitle}</h2>` : ""}
    <div style="font-size:14px;">${safeBody}</div>
    ${ctaButton}
    <p style="font-size:12px;color:#6b7280;margin-top:16px;">${safeFooter}</p>
  </div>`;
}

module.exports = { buildMailHTML };
