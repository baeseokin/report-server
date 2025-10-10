const express = require("express");
const router = express.Router();
const { sendMail } = require("../services/emailService");
const { sendApprovalDecisionMail } = require("../services/sendApprovalDecisionMail"); // ✅ 추가


// ─────────────────────────────────────────────
// ① HTML 직접 발송 (기존 방식)
// ─────────────────────────────────────────────
router.post("/send", async (req, res) => {
  try {
    const { to, subject, html } = req.body;

    if (!to || !subject || !html) {
      return res.status(400).json({ error: "to, subject, html are required" });
    }

    // 기존 서비스는 sendMail(to, subject, html) 형식 → 수정 필요
    const info = await sendMail({ to, subject, html });

    res.json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error("📧 메일 발송 오류:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// ② Text 기반 공통 템플릿 발송 (EmailTest.vue 연동)
// ─────────────────────────────────────────────
router.post("/send-text", async (req, res) => {
  try {
    const { to, cc, title, bodyText, requestId } = req.body;

    if (!to || !title || !bodyText) {
      return res
        .status(400)
        .json({ success: false, error: "to, title, bodyText are required" });
    }

    await sendApprovalDecisionMail({
      to,
      cc,
      title,
      bodyText,
      requestId,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("📧 텍스트 메일 발송 오류:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
