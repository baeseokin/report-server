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

// ✅ API 엔드포인트
app.post("/api/approval", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { documentType, deptName, author, date, totalAmount, comment, items } = req.body;

    // 1️⃣ approval_requests 저장
    const [result] = await conn.query(
      `INSERT INTO approval_requests 
       (document_type, dept_name, author, request_date, total_amount, comment) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [documentType, deptName, author, date, totalAmount, comment]
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

// ✅ 서버 실행
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
