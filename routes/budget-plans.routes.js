// 예산편성서
const express = require("express");
const fs = require("fs");
const path = require("path");
const { getSystemToday, getSystemYear } = require("../env");
const { pool } = require("../lib/db");
const { SIGN_BASE_DIR } = require("../lib/upload");
const { notifyUsers } = require("../services/approvalNotify");

const router = express.Router();


/* ------------------------------------------------
   📊 부서별 년도별 예산 기안·편성 API
------------------------------------------------ */

// ✅ 1. 예산편성 템플릿 조회 (당해년도 예산 자동 세팅 & 관·항·목·세목 4단계 계층)
router.get("/api/budget-plans/template", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { deptName, targetYear: rawTargetYear } = req.query;
    const targetYear = parseInt(rawTargetYear, 10) || (getSystemYear() + 1);
    const baseYear = targetYear - 1; // 당해년도(전년도) 예산 기준

    // 부서 ID 확인
    let deptId = null;
    if (deptName) {
      const [[dept]] = await pool.query("SELECT id FROM departments WHERE dept_name = ?", [deptName]);
      if (dept) deptId = dept.id;
    }

    // 계정과목 조회 (부서 매핑 계정 우선)
    let categories = [];
    if (deptId) {
      const [mappedRows] = await pool.query(`
        WITH RECURSIVE category_tree AS (
          SELECT ac.id, ac.category_id, ac.parent_id, ac.category_name, ac.level, ac.owner_dept_id
            FROM account_categories ac
            INNER JOIN account_category_departments acd ON ac.id = acd.account_category_id
           WHERE acd.dept_id = ?
          UNION
          SELECT p.id, p.category_id, p.parent_id, p.category_name, p.level, p.owner_dept_id
            FROM account_categories p
            INNER JOIN category_tree c ON c.parent_id = p.id
        )
        SELECT DISTINCT ct.* FROM category_tree ct ORDER BY category_id
      `, [deptId]);

      if (mappedRows && mappedRows.length > 0) {
        categories = mappedRows;
      }
    }

    // 부서 매핑 계정이 없거나 전체 조회인 경우 유효한 전체 계정과목 조회
    if (categories.length === 0) {
      const [allRows] = await pool.query(`
        SELECT id, category_id, parent_id, category_name, level, owner_dept_id
          FROM account_categories
         WHERE valid_to IS NULL OR valid_to >= CURDATE()
         ORDER BY category_id
      `);
      categories = allRows;
    }

    // 당해년도(baseYear) 예산 조회 (budgets 테이블)
    const [budgetRows] = await pool.query(`
      SELECT category_id, SUM(budget_amount) as budget_amount
        FROM budgets
       WHERE year = ?
       GROUP BY category_id
    `, [baseYear]);

    const budgetMap = {};
    for (const b of budgetRows) {
      budgetMap[b.category_id] = Number(b.budget_amount) || 0;
    }

    // 부서 목록 맵 (ID -> dept_name)
    const [deptRows] = await pool.query("SELECT id, dept_name FROM departments");
    const deptMap = {};
    for (const d of deptRows) {
      deptMap[d.id] = d.dept_name;
    }

    const catMap = {};
    for (const c of categories) {
      catMap[c.id] = c;
    }

    // leaf 판별 (자식이 없는 최하위 계정)
    const parentIds = new Set(categories.map(c => c.parent_id).filter(Boolean));

    const processedCategories = categories.map(c => {
      const isLeaf = !parentIds.has(c.id);
      const prevAmount = budgetMap[c.category_id] ?? 0;

      // owner_dept_id가 비어있으면 부모 계정에서 찾아 상속
      let resolvedOwnerDeptId = c.owner_dept_id;
      let curr = c;
      while (!resolvedOwnerDeptId && curr.parent_id && catMap[curr.parent_id]) {
        curr = catMap[curr.parent_id];
        resolvedOwnerDeptId = curr.owner_dept_id;
      }

      const ownerDeptName = resolvedOwnerDeptId ? (deptMap[resolvedOwnerDeptId] || "") : "";
      // 해당 부서가 owner 부서인지 확인 (지정된 부서 ID와 일치할 때만 true)
      const isOwner = deptId ? (resolvedOwnerDeptId === deptId) : true;

      return {
        id: c.id,
        category_id: c.category_id,
        parent_id: c.parent_id,
        category_name: c.category_name,
        level: c.level,
        owner_dept_id: resolvedOwnerDeptId,
        owner_dept_name: ownerDeptName,
        is_owner: isOwner,
        is_leaf: isLeaf ? 1 : 0,
        prev_amount: prevAmount,
        request_amount: isLeaf ? prevAmount : 0, // 최하위 계정은 당해년도 예산 그대로 기본 세팅!
        diff_amount: 0,
        calc_basis: isOwner ? "" : (ownerDeptName ? `${ownerDeptName}` : "")
      };
    });

    // 해당 부서/연도의 기존 건 확인 (임시저장, 반려, 재정부이관완료)
    let draftRow = null;
    if (deptName && req.session.user?.userName) {
      const [[d]] = await pool.query(
        `SELECT id, status, aliasName, comment, updated_at
           FROM approval_requests
          WHERE document_type = '예산편성서'
            AND dept_name = ?
            AND aliasName = ?
            AND (
              (status IN ('작성중', '임시저장') AND author = ?)
              OR status IN ('결재반려', '반려', '재정부이관완료', '재정부이관')
            )
          ORDER BY 
            CASE 
              WHEN status IN ('작성중', '임시저장') THEN 1
              WHEN status IN ('결재반려', '반려') THEN 2
              WHEN status IN ('재정부이관완료', '재정부이관') THEN 3
              ELSE 4
            END ASC,
            id DESC 
          LIMIT 1`,
        [deptName, `${targetYear}년도 ${deptName} 예산편성`, req.session.user.userName]
      );
      draftRow = d || null;
    }

    res.json({
      success: true,
      targetYear,
      baseYear,
      deptId,
      deptName,
      draft: draftRow,
      categories: processedCategories
    });
  } catch (err) {
    console.error("❌ budget-plans/template 조회 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ 예산편성서 상신 전 기존 건 상태 체크 API
router.get("/api/budget-plans/check-status", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { deptName, targetYear, requestId } = req.query;
    const aliasName = `${targetYear}년도 ${deptName} 예산편성`;
    const excludeId = requestId ? parseInt(requestId, 10) : 0;

    // 해당 부서/연도의 다른 예산편성서 건 조회 (결재진행중, 결재완료, 재정부이관완료)
    const [rows] = await pool.query(
      `SELECT id, status, aliasName, request_date, author
         FROM approval_requests
        WHERE document_type = '예산편성서'
          AND dept_name = ?
          AND aliasName = ?
          AND id != ?
          AND status IN ('결재진행중', '결재완료', '재정부이관완료')
        ORDER BY id DESC`,
      [deptName, aliasName, excludeId]
    );

    const inProgress = rows.find(r => r.status === '결재진행중' || r.status === '결재완료');
    const transferred = rows.find(r => r.status === '재정부이관완료');

    return res.json({
      success: true,
      hasInProgress: !!inProgress,
      inProgressItem: inProgress || null,
      hasTransferred: !!transferred,
      transferredItem: transferred || null
    });
  } catch (err) {
    console.error("❌ budget-plans/check-status 오류:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ 2. 예산편성서 저장 및 결재 상신
router.post("/api/budget-plans", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      requestId: existingRequestId,
      deptName,
      targetYear,
      totalAmount,
      comment,
      status: reqStatus,
      items,
      signature
    } = req.body;

    const author = req.session.user.userName;
    const authorUserId = req.session.user.userId;
    const documentType = "예산편성서";
    const aliasName = `${targetYear}년도 ${deptName} 예산편성`;
    const today = getSystemToday();

    // ✅ 결재상신 시 기존 건 상태 검증
    if (reqStatus === "결재진행중") {
      const checkExcludeId = existingRequestId ? parseInt(existingRequestId, 10) : 0;
      const [existingRows] = await conn.query(
        `SELECT id, status FROM approval_requests
          WHERE document_type = '예산편성서'
            AND dept_name = ?
            AND aliasName = ?
            AND id != ?
            AND status IN ('결재진행중', '결재완료')
          LIMIT 1`,
        [deptName, aliasName, checkExcludeId]
      );

      if (existingRows.length > 0) {
        await conn.rollback();
        return res.status(400).json({
          success: false,
          code: "ALREADY_IN_PROGRESS",
          message: `해당 연도(${targetYear}년도)의 ${deptName} 예산편성서가 이미 결재진행중입니다.`
        });
      }
    }

    // 부서 ID 조회
    const [[deptRow]] = await conn.query("SELECT id FROM departments WHERE dept_name = ?", [deptName]);
    const deptId = deptRow?.id;

    // 결재선 조회 (approval_line)
    const [approvalLines] = await conn.query(
      `SELECT approver_role, approver_user_id, order_no 
         FROM approval_line 
        WHERE dept_name = ? 
        ORDER BY order_no ASC, id ASC`,
      [deptName]
    );

    let initialStatus = reqStatus || "작성중";
    let currentApproverRole = null;
    let currentApproverUserId = null;
    let nextOrderNo = null;

    if (initialStatus === "결재진행중") {
      // 1단계는 기안자 본인이므로 다음 결재자(2단계) 찾기
      const nextApprover = approvalLines.find(line => line.order_no === 2) || approvalLines[1];
      if (nextApprover) {
        currentApproverRole = nextApprover.approver_role;
        currentApproverUserId = nextApprover.approver_user_id;
        nextOrderNo = nextApprover.order_no;
      } else {
        initialStatus = "결재완료";
      }
    }

    let requestId = null;
    if (existingRequestId) {
      const parsed = parseInt(existingRequestId, 10);
      if (!isNaN(parsed) && parsed > 0) {
        const [[checkReq]] = await conn.query(
          "SELECT id FROM approval_requests WHERE id = ?",
          [parsed]
        );
        if (checkReq) {
          requestId = parsed;
        }
      }
    }

    if (!requestId) {
      // 기존 동일 부서/연도의 본인 임시저장 건이 있는지 확인하여 재사용
      const [[existingDraft]] = await conn.query(
        `SELECT id FROM approval_requests
          WHERE document_type = ? AND dept_name = ? AND aliasName = ? AND author = ? AND status IN ('작성중', '임시저장')
          ORDER BY id DESC LIMIT 1`,
        [documentType, deptName, aliasName, author]
      );
      if (existingDraft) {
        requestId = existingDraft.id;
      }
    }

    if (requestId) {
      const [updateResult] = await conn.query(
        `UPDATE approval_requests
            SET document_type = ?, dept_name = ?, request_date = ?, total_amount = ?, comment = ?, aliasName = ?, status = ?,
                current_approver_role = ?, current_approver_user_id = ?, current_order_no = ?, updated_at = CONVERT_TZ(NOW(), '+00:00', '+09:00')
          WHERE id = ?`,
        [documentType, deptName, today, totalAmount, comment, aliasName, initialStatus, currentApproverRole, currentApproverUserId, nextOrderNo, requestId]
      );

      if (updateResult.affectedRows === 0) {
        const [insertResult] = await conn.query(
          `INSERT INTO approval_requests
            (document_type, dept_name, author, request_date, total_amount, comment, aliasName, status, current_approver_role, current_approver_user_id, current_order_no)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [documentType, deptName, author, today, totalAmount, comment, aliasName, initialStatus, currentApproverRole, currentApproverUserId, nextOrderNo]
        );
        requestId = insertResult.insertId;
      } else {
        await conn.query("DELETE FROM budget_plan_items WHERE request_id = ?", [requestId]);
        await conn.query("DELETE FROM approval_items WHERE request_id = ?", [requestId]);
      }
    } else {
      const [insertResult] = await conn.query(
        `INSERT INTO approval_requests
          (document_type, dept_name, author, request_date, total_amount, comment, aliasName, status, current_approver_role, current_approver_user_id, current_order_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [documentType, deptName, author, today, totalAmount, comment, aliasName, initialStatus, currentApproverRole, currentApproverUserId, nextOrderNo]
      );
      requestId = insertResult.insertId;
    }

    if (!requestId) {
      throw new Error("결재 요청 ID를 생성하지 못했습니다.");
    }

    // budget_plan_items 저장
    if (items && items.length > 0) {
      const [allCats] = await conn.query("SELECT id, category_id FROM account_categories");
      const codeToIdMap = {};
      for (const ac of allCats) {
        codeToIdMap[ac.category_id] = ac.id;
      }

      // 계층 순서(관 -> 항 -> 목 -> 세목)로 정렬하여 sort_order 부여
      const byParent = {};
      items.forEach(it => {
        const pid = it.parent_id ?? 0;
        if (!byParent[pid]) byParent[pid] = [];
        byParent[pid].push(it);
      });

      const parentKeyMap = new Set();
      items.forEach(it => {
        if (it.category_id != null) parentKeyMap.add(it.category_id);
        if (it.id != null) parentKeyMap.add(it.id);
      });

      const roots = items.filter(it => it.level === '관' || !it.parent_id || !parentKeyMap.has(it.parent_id));
      const sortedItems = [];
      const visited = new Set();

      const traverse = (item) => {
        if (!item || visited.has(item)) return;
        visited.add(item);
        sortedItems.push(item);

        const c1 = item.category_id != null ? (byParent[item.category_id] || []) : [];
        const c2 = item.id != null && item.id !== item.category_id ? (byParent[item.id] || []) : [];
        const children = [...c1];
        c2.forEach(c => { if (!children.includes(c)) children.push(c); });
        children.forEach(child => traverse(child));
      };

      roots.forEach(r => traverse(r));
      items.forEach(it => {
        if (!visited.has(it)) sortedItems.push(it);
      });

      const budgetItemValues = sortedItems.map((it, idx) => {
        let catId = 0;
        if (typeof it.id === "number" && !isNaN(it.id)) {
          catId = it.id;
        } else if (typeof it.category_id === "number" && !isNaN(it.category_id)) {
          catId = it.category_id;
        } else if (typeof it.category_id === "string") {
          const parsed = parseInt(it.category_id, 10);
          if (!isNaN(parsed) && String(parsed) === it.category_id.trim()) {
            catId = parsed;
          } else if (codeToIdMap[it.category_id]) {
            catId = codeToIdMap[it.category_id];
          }
        }

        // INT(11) 범위(-2147483648 ~ 2147483647) 안전 보호
        if (catId < -2147483648 || catId > 2147483647) {
          catId = -((Math.abs(catId) % 2000000000) + 1);
        }

        const catCode = it.category_code || (typeof it.category_id === "string" ? it.category_id : String(catId));

        return [
          requestId,
          catId,
          catCode,
          it.category_name,
          it.level,
          it.parent_id || null,
          it.owner_dept_id || deptId || null,
          it.is_leaf ? 1 : 0,
          it.is_new_category ? 1 : 0,
          it.prev_amount || 0,
          it.request_amount || 0,
          it.diff_amount || 0,
          it.calc_basis || null,
          idx + 1
        ];
      });

      await conn.query(
        `INSERT INTO budget_plan_items
          (request_id, category_id, category_code, category_name, level, parent_id, owner_dept_id, is_leaf, is_new_category, prev_amount, request_amount, diff_amount, calc_basis, sort_order)
         VALUES ?`,
        [budgetItemValues]
      );

      const finalDeptId = deptId || 1;
      const finalTargetYear = targetYear || (getSystemYear() + 1);

      // 기존 결재목록/통계 호환성을 위해 approval_items에도 저장
      const approvalItemValues = items
        .filter(it => it.is_leaf)
        .map(it => [
          requestId,
          null,
          null,
          String(it.category_id || ""),
          null,
          it.category_name,
          it.request_amount || 0,
          finalDeptId,
          finalTargetYear
        ]);

      if (approvalItemValues.length > 0) {
        await conn.query(
          `INSERT INTO approval_items
            (request_id, gwan, hang, mok, semok, detail, amount, dept_id, year)
           VALUES ?`,
          [approvalItemValues]
        );
      }
    }

    // 기안자 서명 이력 기록 (결재진행중 상신 시)
    if (initialStatus === "결재진행중") {
      let signaturePath = null;
      if (typeof signature === "string" && signature.startsWith("data:image/png;base64,")) {
        const base64Data = signature.replace(/^data:image\/png;base64,/, "");
        const filename = `${Date.now()}_signature.png`;
        try {
          await fs.promises.writeFile(path.join(SIGN_BASE_DIR, filename), base64Data, "base64");
          signaturePath = filename;
        } catch (e) {
          console.error("❌ 서명 파일 저장 실패:", e);
        }
      } else if (typeof signature === "string" && signature.trim()) {
        const clean = signature.replace(/^.*\/api\/files\//, "").replace(/^signatures\//, "").replace(/^signatures%2F/, "");
        signaturePath = decodeURIComponent(clean);
      }

      const drafterRole = approvalLines[0]?.approver_role || "회계";

      // 기존 기안 및 결재 이력이 있다면 정리 (재상신 시 이전 결재선 초기화)
      await conn.query("DELETE FROM approval_history WHERE request_id = ?", [requestId]);

      await conn.query(
        `INSERT INTO approval_history
          (request_id, approver_role, approver_user_id, comment, signature_path, status, approved_at)
         VALUES (?, ?, ?, ?, ?, '승인', CONVERT_TZ(NOW(), '+00:00', '+09:00'))`,
        [requestId, drafterRole, authorUserId, comment, signaturePath]
      );
    }

    await conn.commit();
    res.json({ success: true, requestId, message: "예산편성서가 저장되었습니다." });

    // 커밋 후 비동기 알림 발송 (결재진행중일 때 다음 결재자에게)
    if (initialStatus === "결재진행중" && currentApproverUserId) {
      setImmediate(async () => {
        try {
          await notifyUsers([currentApproverUserId], {
            templateCode: process.env.SENDON_TEMPLATE_ID,
            deptName,
            author,
            requestDate: today,
            totalAmount,
            comment,
            urlPath: "approvalStatus"
          });
        } catch (e) {
          console.error("❌ 예산편성서 결재 알림 발송 오류:", e.message);
        }
      });
    }
  } catch (err) {
    await conn.rollback();
    console.error("❌ 예산편성서 저장 실패:", err);
    res.status(500).json({ success: false, error: err.message, message: err.message });
  } finally {
    conn.release();
  }
});

// ✅ 3. 예산편성서 상세 조회
router.get("/api/budget-plans/:requestId", async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: "로그인이 필요합니다." });
  }

  try {
    const { requestId } = req.params;
    const [[request]] = await pool.query("SELECT * FROM approval_requests WHERE id = ?", [requestId]);
    if (!request) {
      return res.status(404).json({ success: false, message: "예산편성서를 찾을 수 없습니다." });
    }

    const [items] = await pool.query(
      "SELECT * FROM budget_plan_items WHERE request_id = ? ORDER BY sort_order ASC, id ASC",
      [requestId]
    );

    const [history] = await pool.query(
      `SELECT ah.*, u.user_name AS approver_user_name
         FROM approval_history ah
         LEFT JOIN users u ON ah.approver_user_id = u.user_id
        WHERE ah.request_id = ?
        ORDER BY ah.approved_at ASC`,
      [requestId]
    );

    res.json({
      success: true,
      report: {
        ...request,
        budgetPlanItems: items,
        history
      }
    });
  } catch (err) {
    console.error("❌ 예산편성서 상세 조회 실패:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
