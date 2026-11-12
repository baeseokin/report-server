// 시스템 정보 (기준일자)
const express = require("express");
const { isDateMocked, getSystemToday, getSystemYear } = require("../env");

const router = express.Router();


// ✅ 시스템 기준일자 조회 API (Mock Date 지원)
router.get("/api/system/date", (req, res) => {
  res.json({
    success: true,
    today: getSystemToday(),
    year: getSystemYear(),
    isMocked: isDateMocked(),
  });
});

module.exports = router;
