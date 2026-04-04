const { sendAlimTalk } = require("./kakaoService");

/**
 * 결재 알림톡 발송 서비스 (심플 & 통합 버전)
 * 
 * @param {Object} opts
 * @param {string|string[]}   opts.to            수신 전화번호
 * @param {string}            opts.status        진행상태
 * @param {string}            opts.deptName      부서명
 * @param {string}            opts.author        작성자
 * @param {string}            opts.requestDate   요청일자
 * @param {string|number}     opts.totalAmount   청구총액
 * @param {string}            opts.comment       결재 코멘트
 * @param {string=}           opts.urlPath       상세보기 URL (예: report/123)
 * @param {string=}           opts.templateCode  센돈 템플릿 코드
 */
async function sendApprovalAlimTalk(opts) {
  const {
    to,
    deptName,
    author,
    requestDate,
    totalAmount,
    comment,
    templateCode,
    urlPath,
    status
  } = opts || {};

  // 필수값 검증
  if (!to) throw new Error("to(전화번호)는 필수입니다.");
  if (!templateCode) throw new Error("templateCode는 필수입니다.");

  // 1. 카카오 알림톡 등록 템플릿과 동일하게 메세지 본문 구성
  // (카카오 서버에서는 이 본문이 등록된 템플릿과 일치해야 합니다)
  const formattedAmount = Number(totalAmount || 0).toLocaleString();

  // 2. 알림톡 전송 데이터 구성 (샘플 소스 형식에 맞춰 variables를 to 리스트 안에 포함)
  const kakaoData = {
    templateId: templateCode,
    to: [
      {
        phone: String(to).replace(/-/g, ""), // 전화번호에서 하이픈 제거
        variables: {
          "#{부서명}": deptName || "-",
          "#{작성자}": author || "-",
          "#{요청일자}": requestDate || "-",
          "#{청구총액}": `${formattedAmount}`,
          "#{코멘트 내용}": comment || "없음",
          "#{URL}": urlPath || "",
          ...(status && { "#{진행상태}": status })
        }
      }
    ]
  };

  // 3. 실제 발송 (kakaoService 호출)
  try {
    const result = await sendAlimTalk(kakaoData);
    return result;
  } catch (err) {
    console.error("❌ sendApprovalAlimTalk 발송 오류:", err);
    throw err;
  }
}

module.exports = { sendApprovalAlimTalk };
