// 결재선 탐색

/**
 * 지정 순번 다음의 결재자 목록을 찾습니다. (순번 공백/건너뜀 대응: afterOrderNo 보다 큰 가장 작은 순번)
 * 같은 순번에 여러 명이 있으면 모두 반환합니다.
 * @returns {Promise<{orderNo:number, approvers:Array<{approver_role, approver_user_id, order_no}>}|null>}
 */
async function findNextApprovers(conn, deptName, afterOrderNo) {
  const [[nextOrderRow]] = await conn.query(
    `SELECT MIN(order_no) AS next_order_no
       FROM approval_line
      WHERE dept_name = ? AND order_no > ?`,
    [deptName, afterOrderNo]
  );
  if (!nextOrderRow || nextOrderRow.next_order_no == null) return null;

  const orderNo = nextOrderRow.next_order_no;
  const [approvers] = await conn.query(
    `SELECT approver_role, approver_user_id, order_no
       FROM approval_line
      WHERE dept_name = ? AND order_no = ?`,
    [deptName, orderNo]
  );
  return { orderNo, approvers };
}

/** approval_requests.current_approver_role / current_approver_user_id 에 저장할 값 (쉼표 구분) */
function toCurrentApprover(approvers) {
  return {
    role: [...new Set(approvers.map(a => a.approver_role))].join(","),
    userIds: approvers.map(a => a.approver_user_id).join(","),
  };
}

module.exports = { findNextApprovers, toCurrentApprover };
