// 예산편성서 이관 처리: 신규 계정과목 마스터 등록(코드 채번) + 예산(budgets) 반영
const { getSystemYear } = require("../env");

/**
 * 재정부가 예산편성서를 이관 승인할 때 호출합니다. (호출 측 트랜잭션 conn 사용)
 * 1) 신규 신청 계정(is_new_category=1 또는 category_id<=0)을 '목' → '세목' 순서로 account_categories 에 등록
 * 2) 말단(is_leaf=1) 계정의 편성액을 대상 연도 budgets 에 Upsert
 * @param {object} budgetReqRow approval_requests 의 { document_type, aliasName, dept_name }
 */
async function applyApprovedBudgetPlan(conn, requestId, budgetReqRow) {
  let requestDeptId = null;
  if (budgetReqRow.dept_name) {
    const [[dRow]] = await conn.query("SELECT id FROM departments WHERE dept_name = ?", [budgetReqRow.dept_name]);
    requestDeptId = dRow?.id || null;
  }

  // 대상 회계연도 결정 (approval_items의 year 또는 aliasName에서 추출)
  const [[yrRow]] = await conn.query("SELECT year FROM approval_items WHERE request_id = ? LIMIT 1", [requestId]);
  let targetYear = yrRow?.year;
  if (!targetYear && budgetReqRow.aliasName) {
    const match = budgetReqRow.aliasName.match(/(\d{4})년/);
    if (match) targetYear = parseInt(match[1], 10);
  }
  if (!targetYear) {
    targetYear = getSystemYear() + 1;
  }

  // 🌟 1) 신규 신청 계정(is_new_category = 1 또는 category_id <= 0)들을 레벨 순서('목' 먼저, 그 다음 '세목')로 마스터 등록
  const [allNewItems] = await conn.query(
    `SELECT id, category_id, category_code, category_name, level, parent_id, owner_dept_id, is_new_category, is_leaf, request_amount
       FROM budget_plan_items
      WHERE request_id = ? AND (is_new_category = 1 OR category_id <= 0)
      ORDER BY CASE level WHEN '목' THEN 1 WHEN '세목' THEN 2 ELSE 3 END ASC, id ASC`,
    [requestId]
  );

  const tempIdMap = {}; // 임시 ID -> 정식 등록된 account_categories.id

  for (const item of allNewItems) {
    let resolvedParentId = item.parent_id;
    if (resolvedParentId && tempIdMap[resolvedParentId]) {
      resolvedParentId = tempIdMap[resolvedParentId];
    }

    let finalCategoryId = item.category_id;
    let finalAccCode = null;

    const [[existingCat]] = await conn.query(
      `SELECT id, category_id FROM account_categories 
        WHERE parent_id <=> ? AND category_name = ? AND (valid_to IS NULL OR valid_to >= ?)
        LIMIT 1`,
      [resolvedParentId, item.category_name, `${targetYear}-01-01`]
    );

    if (existingCat) {
      finalCategoryId = existingCat.id;
      finalAccCode = existingCat.category_id;
    } else {
      // ✅ 부모 계정 정보 조회 (관/항/목 코드 승계)
      let g = "00", h = "00", m = "00", s = "00";
      if (resolvedParentId) {
        const [[parentRow]] = await conn.query(
          "SELECT category_id FROM account_categories WHERE id = ?",
          [resolvedParentId]
        );
        if (parentRow?.category_id && parentRow.category_id.startsWith("ACC") && parentRow.category_id.length >= 11) {
          g = parentRow.category_id.substring(3, 5);
          h = parentRow.category_id.substring(5, 7);
          m = parentRow.category_id.substring(7, 9);
          s = parentRow.category_id.substring(9, 11);
        }
      }

      // 동일 부모 하위의 동일 레벨 형제 계정들 중 최대 순번 + 1
      const childLevel = item.level || '세목';
      const [siblings] = await conn.query(
        "SELECT category_id FROM account_categories WHERE parent_id <=> ? AND level = ?",
        [resolvedParentId || null, childLevel]
      );

      let maxNum = 0;
      for (const sib of siblings) {
        if (sib.category_id && sib.category_id.startsWith("ACC") && sib.category_id.length >= 11) {
          let num = 0;
          if (childLevel === "항") num = parseInt(sib.category_id.substring(5, 7), 10) || 0;
          else if (childLevel === "목") num = parseInt(sib.category_id.substring(7, 9), 10) || 0;
          else if (childLevel === "세목") num = parseInt(sib.category_id.substring(9, 11), 10) || 0;
          else if (childLevel === "관") num = parseInt(sib.category_id.substring(3, 5), 10) || 0;
          if (num > maxNum) maxNum = num;
        }
      }

      const next = String(maxNum + 1).padStart(2, "0");
      if (childLevel === "관") g = next;
      else if (childLevel === "항") h = next;
      else if (childLevel === "목") m = next;
      else if (childLevel === "세목") s = next;

      const newAccCode = `ACC${g}${h}${m}${s}`;
      finalAccCode = newAccCode;

      const [catResult] = await conn.query(
        `INSERT INTO account_categories 
          (category_id, parent_id, category_name, level, owner_dept_id, valid_from)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          newAccCode,
          resolvedParentId || null,
          item.category_name,
          item.level || '목',
          item.owner_dept_id || requestDeptId || null,
          `${targetYear}-01-01`
        ]
      );
      finalCategoryId = catResult.insertId;
      console.log(`✨ [신규 계정과목 마스터 등록 완료] level: ${item.level}, id: ${finalCategoryId}, 코드: ${newAccCode}, 계정명: ${item.category_name}`);
    }

    // 해당 부서(신청부서 / owner_dept)에 매핑 자동 추가 (예산관리 조회 연동)
    const mappingDeptId = item.owner_dept_id || requestDeptId;
    if (mappingDeptId) {
      await conn.query(
        `INSERT IGNORE INTO account_category_departments (account_category_id, dept_id, year)
         VALUES (?, ?, ?)`,
        [finalCategoryId, mappingDeptId, targetYear]
      );
    }

    if (item.category_id) tempIdMap[item.category_id] = finalCategoryId;
    tempIdMap[item.id] = finalCategoryId;

    // budget_plan_items의 category_id 및 parent_id, category_code 업데이트
    await conn.query(
      `UPDATE budget_plan_items 
          SET category_id = ?, category_code = ?, parent_id = ?, is_new_category = 0 
        WHERE id = ?`,
      [finalCategoryId, finalAccCode || String(finalCategoryId), resolvedParentId, item.id]
    );
  }

  // 🌟 2) 말단(is_leaf=1) 계정들의 예산을 budgets 테이블에 Upsert
  const [planLeafItems] = await conn.query(
    `SELECT id, category_id, request_amount 
       FROM budget_plan_items 
      WHERE request_id = ? AND is_leaf = 1`,
    [requestId]
  );

  if (planLeafItems && planLeafItems.length > 0) {
    for (const item of planLeafItems) {
      if (item.category_id && item.category_id > 0) {
        const [[accCat]] = await conn.query("SELECT category_id FROM account_categories WHERE id = ?", [item.category_id]);
        const accCode = accCat?.category_id || String(item.category_id);
        await conn.query(
          `INSERT INTO budgets (category_id, year, budget_amount)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE budget_amount = VALUES(budget_amount), updated_at = CONVERT_TZ(NOW(), '+00:00', '+09:00')`,
          [accCode, targetYear, item.request_amount]
        );
      }
    }
    console.log(`✅ [예산편성서 이관완료] ${targetYear}년도 ${planLeafItems.length}개 계정 예산 budgets 자동 반영 완료 (requestId: ${requestId})`);
  }
}

module.exports = { applyApprovedBudgetPlan };
