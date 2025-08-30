// server.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

// ✅ DB 연결 설정
const pool = mysql.createPool({
  host: "localhost",
  port: 32006,
  user: "reportuser",
  password: "reportpass",
  database: "reportdb",
});

// ✅ 결재 요청 등록 API
app.post("/api/approval", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { documentType, deptName, author, date, totalAmount, comment, aliasName, items } = req.body;

    // 1️⃣ approval_requests 저장 (aliasName 추가)
    const [result] = await conn.query(
      `INSERT INTO approval_requests 
       (document_type, dept_name, author, request_date, total_amount, comment, aliasName) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [documentType, deptName, author, date, totalAmount, comment, aliasName]
    );

    const requestId = result.insertId;

    // 2️⃣ approval_items 저장
    if (items && items.length > 0) {
      const itemInserts = items.map((i) => [
        requestId,
        i.gwan || null,
        i.hang || null,
        i.mok || null,
        i.semok || null,
        i.detail || null,
        i.amount || null,
      ]);

      await conn.query(
        `INSERT INTO approval_items 
         (request_id, gwan, hang, mok, semok, detail, amount) 
         VALUES ?`,
        [itemInserts]
      );
    }

    await conn.commit();

    res.json({ success: true, id: requestId });
  } catch (err) {
    await conn.rollback();
    console.error("❌ DB Insert Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ✅ 결재 목록 조회 API
app.post("/api/approvalList", async (req, res) => {
  try {
    const { deptName, documentType, startDate, endDate, page = 1, pageSize = 10 } = req.body;

    let where = "WHERE 1=1";
    const params = [];

    if (deptName) {
      where += " AND ar.dept_name LIKE ?";
      params.push(`%${deptName}%`);
    }
    if (documentType) {
      where += " AND ar.document_type = ?";
      params.push(documentType);
    }
    if (startDate) {
      where += " AND ar.request_date >= ?";
      params.push(startDate);
    }
    if (endDate) {
      where += " AND ar.request_date <= ?";
      params.push(endDate);
    }

    // 전체 개수
    const [[{ count }]] = await pool.query(
      `SELECT COUNT(*) as count FROM approval_requests ar ${where}`,
      params
    );

    const totalPages = Math.ceil(count / pageSize);
    const offset = (page - 1) * pageSize;

    // 목록 조회 (aliasName 추가)
    const [rows] = await pool.query(
      `SELECT ar.id, ar.dept_name, ar.document_type, ar.request_date, ar.total_amount, ar.author, ar.aliasName
       FROM approval_requests ar
       ${where}
       ORDER BY ar.request_date DESC, ar.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({ success: true, rows, totalPages });
  } catch (err) {
    console.error("❌ DB Select Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ 결재요청 상세 조회
app.get("/api/approval/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 요청 정보 (aliasName 포함)
    const [requests] = await pool.query(
      "SELECT * FROM approval_requests WHERE id = ?",
      [id]
    );

    if (requests.length === 0) {
      return res.status(404).json({ success: false, message: "데이터 없음" });
    }

    const request = requests[0];

    // 항목 정보
    const [items] = await pool.query(
      "SELECT gwan, hang, mok, semok, detail, amount FROM approval_items WHERE request_id = ?",
      [id]
    );

    res.json({
      id: request.id,
      documentType: request.document_type,
      deptName: request.dept_name,
      author: request.author,
      date: request.request_date,
      totalAmount: request.total_amount,
      comment: request.comment,
      aliasName: request.aliasName, // ✅ 별칭 추가됨
      items,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ 서버 실행
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
