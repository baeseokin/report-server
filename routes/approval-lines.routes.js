// 부서별 결재선 관리
const express = require("express");
const { pool } = require("../lib/db");

const router = express.Router();


/* ------------------------------------------------
   ✅ 결재선 관리 (ApprovalLineManagement.vue 대응)
------------------------------------------------ */
// 부서별 결재선 조회
router.get("/api/approval-lines", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { deptName } = req.query;

    let query = `
      SELECT al.id, al.dept_name, al.approver_role, al.approver_user_id, al.order_no,
             u.user_name AS approver_user_name
        FROM approval_line al
        LEFT JOIN users u ON al.approver_user_id = u.user_id
    `;
    const params = [];

    if (deptName) {
      query += " WHERE al.dept_name = ?";
      params.push(deptName);
    }

    query += " ORDER BY al.dept_name ASC, al.order_no ASC, al.id ASC";

    const [rows] = await pool.query(query, params);
    // 프론트에서 배열을 바로 받을 수 있도록 success 래퍼 없이 반환
    res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error("❌ 결재선 조회 실패:", err);
    res.status(500).json({ success: false, message: "결재선 조회 실패" });
  }
});

// 부서별 결재선 저장 (전체 덮어쓰기)
router.post("/api/approval-lines", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { deptName, lines } = req.body;

  if (!deptName || !Array.isArray(lines)) {
    return res.status(400).json({ success: false, message: "deptName과 lines는 필수입니다." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. 유효한 부서(자기 자신 및 상위 부서) 목록 조회 (JS 로직으로 안전하게 탐색)
    const [allDepts] = await conn.query("SELECT id, dept_name, parent_dept_id FROM departments");
    const validDeptNames = [];
    const visited = new Set();
    let currentDept = allDepts.find(d => d.dept_name === deptName);
    
    while (currentDept && !visited.has(currentDept.id)) {
      validDeptNames.push(currentDept.dept_name);
      visited.add(currentDept.id);
      currentDept = allDepts.find(d => d.id === currentDept.parent_dept_id);
    }

    // 2. 등록하려는 사용자들의 소속 부서 검증
    const userIds = lines.map(line => line?.approver_user_id ?? line?.approverUserId).filter(Boolean);
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(',');
      const [users] = await conn.query(
        `SELECT u.user_id, u.dept_name 
         FROM users u 
         WHERE u.user_id IN (${placeholders})`,
        userIds
      );
      
      for (const u of users) {
        if (!validDeptNames.includes(u.dept_name)) {
          await conn.rollback();
          return res.status(400).json({ 
            success: false, 
            message: "같은 부서이거나 상위부서 사용자만 결재선에 등록할 수 있습니다." 
          });
        }
      }
    }

    // 기존 결재선 제거 후 재삽입
    await conn.query("DELETE FROM approval_line WHERE dept_name = ?", [deptName]);

    const values = lines
      // ✅ camelCase / snake_case 모두 허용
      .map((line, idx) => ({
        approverRole: line?.approver_role ?? line?.approverRole,
        approverUserId: line?.approver_user_id ?? line?.approverUserId,
        orderNo: line?.order_no ?? line?.orderNo ?? idx + 1,
      }))
      .filter((line) => line.approverRole && line.approverUserId)
      .map((line) => [deptName, line.approverRole, line.approverUserId, line.orderNo]);

    if (values.length > 0) {
      await conn.query(
        "INSERT INTO approval_line (dept_name, approver_role, approver_user_id, order_no) VALUES ?",
        [values]
      );
    }

    await conn.commit();
    res.json({ success: true, count: values.length });
  } catch (err) {
    await conn.rollback();
    console.error("❌ 결재선 저장 실패:", err);
    res.status(500).json({ success: false, message: "결재선 저장 실패: " + err.message });
  } finally {
    conn.release();
  }
});

// 단일 결재선 수정
router.put("/api/approval-lines/:id", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const approvalLineId = req.params.id;
  // camelCase, snake_case 모두 허용
  const deptName = req.body.deptName ?? req.body.dept_name;
  const approverRole = req.body.approverRole ?? req.body.approver_role;
  const approverUserId = req.body.approverUserId ?? req.body.approver_user_id;
  const orderNo = req.body.orderNo ?? req.body.order_no;

  const updateFields = [];
  const params = [];

  if (deptName) {
    updateFields.push("dept_name = ?");
    params.push(deptName);
  }
  if (approverRole) {
    updateFields.push("approver_role = ?");
    params.push(approverRole);
  }
  if (approverUserId) {
    updateFields.push("approver_user_id = ?");
    params.push(approverUserId);
  }
  if (orderNo !== undefined) {
    updateFields.push("order_no = ?");
    params.push(orderNo);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ success: false, message: "수정할 필드가 없습니다." });
  }

  try {
    // 부서 검증 로직 추가
      const [allDepts] = await pool.query("SELECT id, dept_name, parent_dept_id FROM departments");
      
      const getValidDeptNames = (targetDeptName) => {
        const validDeptNames = [];
        const visited = new Set();
        let currentDept = allDepts.find(d => d.dept_name === targetDeptName);
        while (currentDept && !visited.has(currentDept.id)) {
          validDeptNames.push(currentDept.dept_name);
          visited.add(currentDept.id);
          currentDept = allDepts.find(d => d.id === currentDept.parent_dept_id);
        }
        return validDeptNames;
      };

      let validDeptNames = [];
      let shouldCheckUser = false;

      if (deptName && approverUserId) {
        validDeptNames = getValidDeptNames(deptName);
        shouldCheckUser = true;
      } else if (approverUserId && !deptName) {
        const [[existing]] = await pool.query("SELECT dept_name FROM approval_line WHERE id = ?", [approvalLineId]);
        if (existing) {
          validDeptNames = getValidDeptNames(existing.dept_name);
          shouldCheckUser = true;
        }
      }

      if (shouldCheckUser) {
        const [[user]] = await pool.query(
          `SELECT u.dept_name 
           FROM users u 
           WHERE u.user_id = ?`,
          [approverUserId]
        );

        if (user && !validDeptNames.includes(user.dept_name)) {
          return res.status(400).json({ 
            success: false, 
            message: "같은 부서이거나 상위부서 사용자만 결재선에 등록할 수 있습니다." 
          });
        }
      }
    const [result] = await pool.query(
      `UPDATE approval_line SET ${updateFields.join(", ")} WHERE id = ?`,
      [...params, approvalLineId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "해당 결재선을 찾을 수 없습니다." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ 결재선 수정 실패:", err);
    res.status(500).json({ success: false, message: "결재선 수정 실패" });
  }
});

// 단일 결재선 삭제
router.delete("/api/approval-lines/:id", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const approvalLineId = req.params.id;

  try {
    const [result] = await pool.query("DELETE FROM approval_line WHERE id = ?", [approvalLineId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "해당 결재선을 찾을 수 없습니다." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ 결재선 삭제 실패:", err);
    res.status(500).json({ success: false, message: "결재선 삭제 실패" });
  }
});

module.exports = router;
