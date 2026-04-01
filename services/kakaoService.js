// server/services/kakaoService.js

const { Sendon } = require("@alipeople/sendon-sdk-typescript");

/**
 * 카카오 알림톡 발송 서비스 (Sendon SDK 연동)
 */

// Sendon SDK 초기화
const sendon = new Sendon({
  id: process.env.SENDON_ID || "",
  apikey: process.env.SENDON_APIKEY || "",
  debug: String(process.env.SENDON_DEBUG) === "true",
});

/**
 * 알림톡 발송 함수
 * @param {object} options { to: [{phone, variables}], templateId, ... }
 * @returns {object} { success, groupId, message }
 */
async function sendAlimTalk(options) {
  const profileId = process.env.SENDON_PROFILE_ID;
  
  if (!process.env.SENDON_ID || !process.env.SENDON_APIKEY || !profileId) {
    console.error("❌ Sendon 설정이 부재합니다. (ID, APIKEY, PROFILE_ID 확인 필요)");
    return { success: false, message: "Sendon configuration missing" };
  }

  try {
    const sendOptions = {
      sendProfileId: profileId,
      ...options
    };

    console.log("📱 [Kakao AlimTalk] Sending with options:", JSON.stringify(sendOptions, null, 2));
    
    const result = await sendon.kakao.sendAlimTalk(sendOptions);

    console.log(`📱 [Kakao AlimTalk] Response:`, JSON.stringify(result, null, 2));

    if (result.code === 200) {
      return {
        success: true,
        groupId: result.data ? result.data.groupId : null,
        message: result.message
      };
    } else {
      return {
        success: false,
        code: result.code,
        message: result.message
      };
    }
  } catch (err) {
    console.error("❌ sendAlimTalk SDK Error:", err);
    throw err;
  }
}

module.exports = { sendAlimTalk };
