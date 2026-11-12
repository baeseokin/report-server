// 결재 요청 등록·삭제·상세·승인·반려
const express = require("express");
const fs = require("fs");
const path = require("path");
const { getSystemYear } = require("../env");
const { pool } = require("../lib/db");
const { upload, uploadDir } = require("../lib/upload");
const { findNextApprovers, toCurrentApprover } = require("../services/approvalLine");
const { notifyUsers, notifyAuthor } = require("../services/approvalNotify");
const { applyApprovedBudgetPlan } = require("../services/budgetPlan");

const router = express.Router();


/* ------------------------------------------------
   ✅ 결재 요청 등록 API (결재자 라인 반영)
------------------------------------------------ */
router.post("/api/approval", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { id, documentType, author, userId, date, totalAmount, comment, remarks, aliasName, items, selectedGwan, selectedHang, accountInfo, requesterPhone, updateDeptAccountInfo } =
      req.body;
    // 영수인(payee)이 없으면 작성자(author)로 기본값 설정
    const payee = (req.body.payee && req.body.payee.trim() !== "") ? req.body.payee.trim() : author;

    // ✅ 클라이언트가 선택한 부서명 사용 (재정부 등이 다른 부서 선택 시). body 문자열이 있으면 무조건 사용, 없을 때만 세션
    const bodyDeptName = req.body.deptName ?? req.body.dept_name;
    const deptName =
      typeof bodyDeptName === "string" && bodyDeptName.trim() !== ""
        ? bodyDeptName.trim()
        : req.session?.user?.deptName ?? null;
    console.log("POST /api/approval body.deptName:", req.body.deptName, "body.dept_name:", req.body.dept_name, "→ deptName:", deptName);
    console.log("POST /api/approval payee:", payee, "author:", author);
    if (!deptName) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: "부서 정보가 없습니다." });
    }

    // ✅ 재정부 권한 사용자가 결재요청 시(본인 부서 포함) 진행상태를 결재완료로 바로 처리 
    // (어차피 재정부이관 단계에서 최종 검토가 이루어지기 때문)
    const userDeptName = req.session?.user?.deptName ?? "";
    const isFinanceUser = userDeptName === "재정부";
    const initialStatus = isFinanceUser ? "결재완료" : "결재진행중";

    // ✅ 1. 부서 ID 조회 및 연도 추출 (approval_items 저장용)
    const [[deptRow]] = await conn.query("SELECT id FROM departments WHERE dept_name = ?", [deptName]);
    if (!deptRow) {
      throw new Error(`부서 정보를 찾을 수 없습니다: ${deptName}`);
    }
    const deptId = deptRow.id;
    const requestYear = new Date(date).getFullYear();


    // ✅ 부서 기본 계좌정보 업데이트 (사용자가 변경하고 체크박스 선택 시)
    if (updateDeptAccountInfo && accountInfo && accountInfo.trim() !== "") {
      await conn.query(
        "UPDATE departments SET account_info = ? WHERE id = ?",
        [accountInfo.trim(), deptId]
      );
    }

    // ✅ 2. 다음 결재자 계산 (결재진행중일 때)
    let nextApprovers = null;
    let nextOrderNo = null;
    let currentApproverRole = null;
    let currentApproverUserId = null;

    if (initialStatus === "결재진행중") {
      if (req.body.selectedChoice === "owner") {
        // ✅ 2안(Owner 부서 위원장 직행) 선택 시
        const [chairmanRows] = await conn.query(
          `SELECT approver_role, approver_user_id, order_no
             FROM approval_line 
            WHERE dept_name = ? AND approver_role = '위원장'`,
          [deptName]
        );
        if (chairmanRows.length === 0) {
          throw new Error(`${deptName} 부서에 '위원장' 결재선이 등록되어 있지 않습니다. 결재선 설정을 확인해 주세요.`);
        }
        nextApprovers = chairmanRows;
        nextOrderNo = chairmanRows[0].order_no;
      } else {
        // ✅ 1안(부서별 기본순서): 기안자 결재선 확인
        const [applicantRows] = await conn.query(
          `SELECT order_no 
             FROM approval_line 
            WHERE dept_name = ? AND approver_user_id = ?
            LIMIT 1`,
          [deptName, userId]
        );

        // ❌ 상신자가 결재선에 없을 경우 명확한 에러 반환
        if (applicantRows.length === 0) {
          throw new Error(`${deptName} 부서의 결재선에 기안자(${author || userId})가 등록되어 있지 않습니다. 결재선 관리에서 담당자 등록 후 다시 시도해 주세요.`);
        }

        const applicantOrder = applicantRows[0].order_no;

        // ✅ 기안자 순번 이후의 첫 번째 결재자 찾기 (순번 공백/건너뜀 대응)
        const next = await findNextApprovers(conn, deptName, applicantOrder);
        if (!next) {
          throw new Error(`${deptName} 부서 결재선에 기안자 다음 결재자가 존재하지 않습니다. 결재선 설정을 확인해 주세요.`);
        }
        if (next.approvers.length === 0) {
          throw new Error(`${deptName} 부서 결재선에서 순번(${next.orderNo})에 해당하는 결재자 정보를 찾을 수 없습니다.`);
        }

        nextOrderNo = next.orderNo;
        nextApprovers = next.approvers;
      }

      ({ role: currentApproverRole, userIds: currentApproverUserId } = toCurrentApprover(nextApprovers));
    }

    // approval_requests 저장 (재정부→타부서 요청 시 status = 결재완료, 그 외 결재진행중)
    let requestId = id;
    if (requestId) {
      // ✅ 수정 모드: 기안자 확인 및 결재 진행 여부 확인
      const [existing] = await conn.query(
        "SELECT author, status, (SELECT COUNT(*) FROM approval_history WHERE request_id = ar.id) as h_count FROM approval_requests ar WHERE ar.id = ?",
        [requestId]
      );
      if (existing.length === 0) throw new Error("수정할 요청을 찾을 수 없습니다.");
      if (existing[0].author !== author) throw new Error("수정 권한이 없습니다.");
      // h_count 가 1이라는 것은 최초 등록 이력만 있다는 뜻 (결재 진행 안 됨)
      if (existing[0].h_count > 1) throw new Error("이미 결재가 진행되어 수정할 수 없습니다.");

      await conn.query(
        `UPDATE approval_requests 
         SET document_type = ?, dept_name = ?, request_date = ?, total_amount = ?, comment = ?, remarks = ?, aliasName = ?, category_gwan = ?, category_hang = ?, updated_at = CONVERT_TZ(NOW(), '+00:00', '+09:00'), payee = ?, account_info = ?, requester_phone = ?,
             current_approver_role = ?, current_approver_user_id = ?, current_order_no = ?
         WHERE id = ?`,
        [documentType, deptName, date, totalAmount, comment, remarks, aliasName, selectedGwan, selectedHang, payee, accountInfo, requesterPhone, currentApproverRole, currentApproverUserId, nextOrderNo, requestId]
      );

      // 기존 항목 삭제 후 재삽입 (단순하게 처리)
      await conn.query("DELETE FROM approval_items WHERE request_id = ?", [requestId]);
    } else {
      const [result] = await conn.query(
        `INSERT INTO approval_requests 
         (document_type, dept_name, author, request_date, total_amount, comment, remarks, aliasName, status, category_gwan, category_hang, payee, account_info, requester_phone, current_approver_role, current_approver_user_id, current_order_no) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [documentType, deptName, author, date, totalAmount, comment, remarks, aliasName, initialStatus, selectedGwan, selectedHang, payee, accountInfo, requesterPhone, currentApproverRole, currentApproverUserId, nextOrderNo]
      );
      requestId = result.insertId;
    }

    // approval_items 저장
    if (items && items.length > 0) {
      const itemInserts = items.map((i) => [
        requestId,
        i.gwan || null,
        i.hang || null,
        i.mok || null,
        i.semok || null,
        i.detail || null,
        i.amount || null,
        deptId,      // ✅ 추가
        requestYear  // ✅ 추가
      ]);

      await conn.query(
        `INSERT INTO approval_items 
         (request_id, gwan, hang, mok, semok, detail, amount, dept_id, year) 
         VALUES ?`,
        [itemInserts]
      );
    }

    await conn.commit();
    res.json({ success: true, id: requestId });

    // ✅ 커밋 후 비동기 발송 (결재진행중일 때만 다음 결재자에게 이관 메일 발송)
    if (initialStatus === "결재진행중" && nextApprovers && nextApprovers.length > 0) {
      setImmediate(async () => {
        try {
          await notifyUsers(nextApprovers.map(a => a.approver_user_id), {
            templateCode: process.env.SENDON_TEMPLATE_ID,
            deptName,
            author,
            requestDate: date,
            totalAmount,
            comment,
            urlPath: "approvalStatus"
          });
        } catch (e) {
          console.error("❌ approval notification send error:", e.message);
        }
      });
    }

  } catch (err) {
    await conn.rollback();
    console.error("❌ DB Insert Error:", err.message);
    res.status(400).json({ success: false, message: err.message, error: err.message });
  } finally {
    conn.release();
  }
});


/* ------------------------------------------------
   ✅ 결재 요청 삭제 API
------------------------------------------------ */
router.delete("/api/approval/:id", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { id } = req.params;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. 권한 및 상태 확인
    const [existing] = await conn.query(
      "SELECT author, status, (SELECT COUNT(*) FROM approval_history WHERE request_id = ar.id) as h_count FROM approval_requests ar WHERE ar.id = ?",
      [id]
    );

    if (existing.length === 0) {
      throw new Error("삭제할 요청을 찾을 수 없습니다.");
    }

    const { author, status, h_count } = existing[0];
    const loginUser = req.session.user;

    // 1. 삭제 권한 확인 (본인, 관리자, 재정부)
    const isOwner = author === loginUser.userName;
    const isAdminUser = loginUser.roles?.some(r => r === '관리자' || r.role_name === '관리자');
    const isFinanceUser = loginUser.deptName === '재정부';
    const hasPrivilege = isAdminUser || isFinanceUser;

    let canDelete = false;

    if (hasPrivilege) {
      canDelete = true;
    } else {
      // 일반 사용자의 경우 상태에 따른 강제 차단
      if (status === '결재완료' || status === '재정부이관완료') {
        throw new Error("결재완료 또는 재정부이관완료 상태의 문서는 삭제할 수 없습니다.");
      }
      if (isOwner && h_count === 1) {
        canDelete = true;
      }
    }

    if (!canDelete) {
      throw new Error("권한이 없거나 삭제할 수 없는 상태입니다.");
    }

    // 2. 관련 파일 삭제 (물리 파일 + DB)
    const [files] = await conn.query("SELECT file_path FROM approval_files WHERE request_id = ?", [id]);
    for (const file of files) {
      const absPath = path.join(uploadDir, file.file_path);
      if (fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
      }
    }
    await conn.query("DELETE FROM approval_files WHERE request_id = ?", [id]);

    // 3. 관련 데이터 삭제
    await conn.query("DELETE FROM approval_items WHERE request_id = ?", [id]);
    await conn.query("DELETE FROM approval_history WHERE request_id = ?", [id]);
    await conn.query("DELETE FROM approval_requests WHERE id = ?", [id]);

    await conn.commit();
    res.json({ success: true, message: "성공적으로 삭제되었습니다." });

  } catch (err) {
    await conn.rollback();
    console.error("❌ Delete Approval Error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});


// ✅ 결재 히스토리 저장 API
router.post("/api/approval/history", upload.single("signature"), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { requestId, approver_role, approver_user_id, comment } = req.body;
    const signaturePath = req.file ? req.file.filename : null;

    if (!requestId || !approver_user_id) {
      return res.status(400).json({ success: false, message: "필수 값 누락" });
    }

    await pool.query(
      `INSERT INTO approval_history (request_id, approver_role, approver_user_id, comment, signature_path, approved_at)
       VALUES (?, ?, ?, ?, ?, CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
      [requestId, approver_role, approver_user_id, comment, signaturePath]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ approval_history 저장 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------
   ✅ 결재요청 상세 조회 (detail 버전)
------------------------------------------------ */
router.get("/api/approval/detail/:id", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { id } = req.params;

    // ✅ 요청 정보 + 관/항 명칭 조회
    const [requests] = await pool.query(`
      SELECT ar.*, 
             cg.category_name as gwan_name, 
             ch.category_name as hang_name
      FROM approval_requests ar
      LEFT JOIN account_categories cg ON ar.category_gwan = cg.category_id
      LEFT JOIN account_categories ch ON ar.category_hang = ch.category_id
      WHERE ar.id = ?
    `, [id]);

    if (requests.length === 0) {
      return res.status(404).json({ success: false, message: "데이터 없음" });
    }

    const request = requests[0];

    // ✅ 항목 정보 + 목/세목 명칭 조회
    const [items] = await pool.query(`
      SELECT ai.gwan, ai.hang, ai.mok, ai.semok, ai.detail, ai.amount,
             cm.category_name as mok_name,
             cs.category_name as semok_name
      FROM approval_items ai
      LEFT JOIN account_categories cm ON ai.mok = cm.category_id
      LEFT JOIN account_categories cs ON ai.semok = cs.category_id
      WHERE ai.request_id = ?
    `, [id]);

    // ✅ 예산편성서인 경우 budget_plan_items 조회 추가
    if (request.document_type === '예산편성서') {
      const [budgetPlanItems] = await pool.query(
        `SELECT * FROM budget_plan_items WHERE request_id = ? ORDER BY sort_order ASC, id ASC`,
        [id]
      );
      request.budgetPlanItems = budgetPlanItems;
    }

    // ✅ 첨부파일 정보 포함
    const [files] = await pool.query(
      "SELECT id, file_name, file_path, mime_type, file_size, alias_name FROM approval_files WHERE request_id = ?",
      [id]
    );

    // ✅ 결재 이력 (처리자 이름: users JOIN)
    const [history] = await pool.query(
      `SELECT ah.approver_user_id, ah.approver_role, ah.comment, ah.signature_path, ah.approved_at, ah.status,
              u.user_name AS approver_user_name
         FROM approval_history ah
         LEFT JOIN users u ON ah.approver_user_id = u.user_id
        WHERE ah.request_id = ?
        ORDER BY ah.approved_at ASC`,
      [id]
    );

    // ✅ 결재선 (approval_line) - 부서 기준 + order_no 정렬 (재정부 포함)
    const [approvalLine] = await pool.query(
      `
      SELECT id, dept_name, approver_role, approver_user_id, order_no
        FROM approval_line
       WHERE dept_name = ?
       ORDER BY order_no ASC, id ASC
      `,
      [request.dept_name]
    );

    // (옵션) 프론트에서 편하게 쓰도록 역할만 뽑은 배열도 함께 내려줌
    const approverRoles = Array.from(
      new Set(approvalLine.map(l => l.approver_role))
    );

    res.json({
      id: request.id,
      document_type: request.document_type,
      dept_name: request.dept_name,
      author: request.author,
      payee: request.payee,
      request_date: request.request_date,
      total_amount: request.total_amount,
      comment: request.comment,
      remarks: request.remarks,
      aliasName: request.aliasName,
      selectedGwan: request.category_gwan,
      selectedHang: request.category_hang,
      gwanName: request.gwan_name, // 명칭 추가
      hangName: request.hang_name, // 명칭 추가
      accountInfo: request.account_info,
      requesterPhone: request.requester_phone,
      items: items.map(i => ({
        ...i,
        mokName: i.mok_name,     // 명칭 추가
        semokName: i.semok_name  // 명칭 추가
      })),
      budgetPlanItems: request.budgetPlanItems || [],
      attachedFiles: files,
      approvalHistory: history,
      approvalLine,
      approverRoles
    });
  } catch (err) {
    console.error("❌ 상세조회 오류:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------
   ✅ 결재 승인 API
------------------------------------------------ */
router.post("/api/approval/approve", upload.single("signature"), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { requestId, comment } = req.body;
  const signaturePath = req.file ? req.file.filename : null;

  const conn = await pool.getConnection();
  // 메일 발송 계획(커밋 후 비동기 실행)
  let mailPlan = null;

  try {
    await conn.beginTransaction();

    const [reqRows] = await conn.query(
      `SELECT dept_name, current_approver_role, current_approver_user_id, current_order_no, document_type, author, request_date, status, total_amount, category_hang
         FROM approval_requests 
        WHERE id=? FOR UPDATE`,
      [requestId]
    );
    if (reqRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "결재 요청 없음" });
    }

    const reqRow = reqRows[0];
    const { dept_name, current_approver_role, current_approver_user_id, current_order_no, status, total_amount, category_hang } = reqRow;

    //console.log("/api/approval/approve - status :", status);
    if (status === "결재진행중") {

      // ✅ 결재진행중인 경우, 로그인한 사용자가 실제 결재자인지 검증
      const isFinance = req.session.user.deptName === '재정부';
      const isCurrentApprover = current_approver_user_id && current_approver_user_id.split(',').includes(req.session.user.userId);
      if (!isCurrentApprover && !isFinance) {
        await conn.rollback();
        return res.status(403).json({ success: false, message: "현재 결재자가 아닙니다." });
      }

      // ✅ 실제 결재자 정보 (대결 시 본인 정보 기록)
      const actualApproverId = req.session.user.userId;
      
      const [[myRoleRow]] = await conn.query(
        `SELECT approver_role FROM approval_line WHERE dept_name=? AND order_no=? AND approver_user_id=?`,
        [dept_name, current_order_no, actualApproverId]
      );
      const actualApproverRole = myRoleRow ? myRoleRow.approver_role : (current_approver_role.split(',')[0] || current_approver_role);

      // ✅ 승인 이력 기록
      await conn.query(
        `INSERT INTO approval_history 
          (request_id, approver_role, approver_user_id, comment, signature_path, status, approved_at)
        VALUES (?, ?, ?, ?, ?, '승인', CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
        [requestId, actualApproverRole, actualApproverId, comment, signaturePath]
      );

      // ✅ 다음 결재자 찾기 (순번 공백/건너뜀 대응: current_order_no 보다 큰 가장 빠른 order_no)
      const next = await findNextApprovers(conn, dept_name, current_order_no);
      const nextRows = next ? next.approvers : [];
      const nextOrderNo = next ? next.orderNo : null;

      if (nextRows.length > 0) {
        const { role: roles, userIds } = toCurrentApprover(nextRows);
        // 다음 결재자 지정
        await conn.query(
          `UPDATE approval_requests
            SET current_approver_role=?, current_approver_user_id=?, current_order_no=?, updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
          WHERE id=?`,
          [roles, userIds, nextOrderNo, requestId]
        );

        // 메일 발송 계획 (다음 결재자에게)
        mailPlan = {
          type: "handoff",
          requestId,
          docType: reqRow.document_type,
          deptName: reqRow.dept_name,
          author: reqRow.author,
          requestDate: reqRow.request_date,
          amount: reqRow.total_amount,
          approverUserIds: nextRows.map(a => a.approver_user_id), // 다음 결재자 목록
          applicantName: reqRow.author,
          approvedBy: req.session.user.userName,
          comment: comment || "",
        };

      } else {
        // 마지막 결재자 → 결재완료 처리
        await conn.query(
          `UPDATE approval_requests
            SET status='결재완료', updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
          WHERE id=?`,
          [requestId]
        );
        // 메일 발송 계획 (신청자에게 최종 승인 완료)
        mailPlan = {
          type: "completed",
          requestId,
          docType: reqRow.document_type,
          deptName: reqRow.dept_name,
          author: reqRow.author,
          requestDate: reqRow.request_date,
          amount: reqRow.total_amount,
          approvedBy: req.session.user.userName,
          comment: comment || "",
        };

      }

    } else if (status === "결재완료") {

      // ✅ 재정부 사용자만 결재완료 건을 이관 처리할 수 있도록 권한 검증 추가
      if (req.session.user.deptName !== '재정부') {
        await conn.rollback();
        return res.status(403).json({ success: false, message: "재정부만 이관 승인을 할 수 있습니다." });
      }

      // ✅ 승인 이력 기록: 이 블록은 재정부가 '결재완료' 건을 이관 승인할 때만 진입하므로, 항상 로그인 사용자(재정부) 정보로 기록
      const historyApproverRole = req.session.user.roles?.[0]?.role_name ?? "재정부";
      const historyApproverUserId = req.session.user.userId;
      await conn.query(
        `INSERT INTO approval_history 
          (request_id, approver_role, approver_user_id, comment, signature_path, status, approved_at)
        VALUES (?, ?, ?, ?, ?, '승인', CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
        [requestId, historyApproverRole, historyApproverUserId, comment, signaturePath]
      );
      // 재정부 결재자 → 재정부이관완료 처리
      await conn.query(
        `UPDATE approval_requests
            SET status='재정부이관완료', updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00')
          WHERE id=?`,
        [requestId]
      );

      // ✅ 예산편성서인 경우: budget_plan_items의 말단(is_leaf=1) 계정들을 budgets 테이블로 자동 반영 (Upsert)
      //    (신규 계정 신청 항목은 '목' -> '세목' 계층 순으로 account_categories 마스터에 자동 정식 등록 후 반영)
      const [[budgetReqRow]] = await conn.query("SELECT document_type, aliasName, dept_name FROM approval_requests WHERE id = ?", [requestId]);
      if (budgetReqRow?.document_type === '예산편성서') {
        await applyApprovedBudgetPlan(conn, requestId, budgetReqRow);
      }

      // ✅ dept_id 조회 (부서명 기준)
      const [[deptObj]] = await conn.query("SELECT id FROM departments WHERE dept_name = ?", [dept_name]);

      // ✅ expense_details에 지출 내역 저장 (request의 category_hang 사용)
      // year는 결재일자가 아닌 '요청(보고) 연도'를 사용해야 budget-status(기준년도)와 dept-budget-status(approval_items.year)가 일치함
      if (deptObj && category_hang && total_amount > 0) {
        const [[yrRow]] = await conn.query("SELECT year FROM approval_items WHERE request_id = ? LIMIT 1", [requestId]);
        const expenseYear = yrRow?.year != null ? yrRow.year : getSystemYear();

        await conn.query(
          `INSERT INTO expense_details 
              (dept_id, category_id, year, expense_date, amount, description, approval_request_id) 
            VALUES (?, ?, ?, CURDATE(), ?, ?, ?)`,
          [
            deptObj.id,
            category_hang,
            expenseYear,
            total_amount,
            `결재 ID ${requestId} 최종 승인 합계`,
            requestId
          ]
        );
      }
    }

    await conn.commit();
    res.json({ success: true, message: "결재가 완료되었습니다." });

    // ───────────────────────────────────────────────────────────
    // ✅ 커밋 후 비동기 알림톡 발송
    // ───────────────────────────────────────────────────────────
    setImmediate(async () => {
      if (!mailPlan) return;

      try {
        if (mailPlan.type === "handoff") {
          // 다음 결재자에게
          const sent = await notifyUsers(mailPlan.approverUserIds, {
            templateCode: process.env.SENDON_TEMPLATE_ID,
            deptName: mailPlan.deptName,
            author: mailPlan.author,
            requestDate: mailPlan.requestDate,
            totalAmount: mailPlan.amount,
            comment: mailPlan.comment,
            urlPath: "approvalStatus"
          });
          sent.forEach(toPhone => console.log(`📱 [handoff alimtalk] #${mailPlan.requestId} → ${toPhone}`));
        } else if (mailPlan.type === "completed") {
          // 신청자에게
          const toPhone = await notifyAuthor(mailPlan.author, {
            templateCode: process.env.SENDON_TEMPLATE_STATUS_ID,
            deptName: mailPlan.deptName,
            author: mailPlan.author,
            requestDate: mailPlan.requestDate,
            totalAmount: mailPlan.amount,
            comment: mailPlan.comment,
            urlPath: "approvalList",
            status: "결재완료"
          });
          if (toPhone) console.log(`📱 [completed alimtalk] #${mailPlan.requestId} → ${toPhone}`);
        }
      } catch (alimtalkErr) {
        console.error("❌ approval approve alimtalk error:", alimtalkErr);
      }
    });

  } catch (error) {
    await conn.rollback();
    console.error("❌ 결재 처리 오류:", error);
    res.status(500).json({ success: false, message: "결재 처리 실패" });
  } finally {
    conn.release();
  }
});


/* ------------------------------------------------
   ✅ 결재 반려 API
------------------------------------------------ */
router.post("/api/approval/reject", upload.single("signature"), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const { requestId, comment, login_user_id } = req.body;
  const signaturePath = req.file ? req.file.filename : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [reqRows] = await conn.query(
      `SELECT current_approver_role, current_approver_user_id, current_order_no, status, author, dept_name, request_date, document_type, total_amount
         FROM approval_requests 
        WHERE id=? FOR UPDATE`,
      [requestId]
    );
    if (reqRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "결재 요청 없음" });
    }

    const { current_approver_role, current_approver_user_id, current_order_no, status, author, dept_name, request_date, document_type, total_amount } = reqRows[0];

    // ✅ 로그인한 사용자가 실제 결재자인지 검증
    const isFinance = req.session.user.deptName === '재정부';
    const isCurrentApprover = current_approver_user_id && current_approver_user_id.split(',').includes(req.session.user.userId);
    if (status === "결재진행중" && !isCurrentApprover && !isFinance) {
      await conn.rollback();
      return res.status(403).json({ success: false, message: "현재 결재자가 아닙니다." });
    }

    const actualApproverId = req.session.user.userId;
    let actualApproverRole = req.session.user.roles?.[0]?.role_name ?? "재정부";
    
    if (current_order_no) {
      const [[myRoleRow]] = await conn.query(
        `SELECT approver_role FROM approval_line WHERE dept_name=? AND order_no=? AND approver_user_id=?`,
        [dept_name, current_order_no, actualApproverId]
      );
      if (myRoleRow) {
        actualApproverRole = myRoleRow.approver_role;
      } else if (current_approver_role) {
        actualApproverRole = current_approver_role.split(',')[0];
      }
    }

    const approverRole = actualApproverRole;
    const approverUserId = actualApproverId;

    // ✅ 결재반려 이력 기록
    await conn.query(
      `INSERT INTO approval_history 
         (request_id, approver_role, approver_user_id, comment, signature_path, status, approved_at)
       VALUES (?, ?, ?, ?, ?, '반려', CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
      [requestId, approverRole, approverUserId, comment, signaturePath]
    );

    // ✅ 결재 요청 반려 처리
    await conn.query(
      `UPDATE approval_requests 
          SET status='결재반려', updated_at=CONVERT_TZ(NOW(), '+00:00', '+09:00'),
              current_approver_role=?, current_approver_user_id=?
        WHERE id=?`,
      [approverRole, approverUserId, requestId]
    );

    await conn.commit();
    res.json({ success: true, message: "결재가 반려되었습니다." });


    // ───────────────────────────────────────────────────────────
    // ✅ 커밋 후 비동기 알림톡 발송
    // ───────────────────────────────────────────────────────────
    setImmediate(async () => {
      try {

        // 신청자에게
        const toPhone = await notifyAuthor(author, {
          templateCode: process.env.SENDON_TEMPLATE_STATUS_ID,
          deptName: dept_name,
          author,
          requestDate: request_date,
          totalAmount: total_amount,
          comment: `${comment || "없음"}`,
          urlPath: "approvalList",
          status: "반려"
        });
        if (toPhone) console.log(`📱 [reject alimtalk] #${requestId} → ${toPhone}`);

      } catch (alimtalkErr) {
        console.error("❌ approval reject alimtalk error:", alimtalkErr);
      }
    });

  } catch (error) {
    await conn.rollback();
    console.error("❌ 결재 반려 오류:", error);
    res.status(500).json({ success: false, message: "결재 반려 실패" });
  } finally {
    conn.release();
  }
});

module.exports = router;
