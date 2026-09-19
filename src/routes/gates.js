const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/gates?facilityId=1 - حالة كل البوابات الآن
router.get("/", async (req, res, next) => {
  try {
    const { facilityId } = req.query;
    const [rows] = await pool.query("SELECT * FROM gates WHERE facility_id = ? ORDER BY name ASC", [facilityId || 1]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/gates/:id/status - تغيير حالة بوابة يدويًا (متاحة / مشغولة / صيانة)
router.patch("/:id/status", async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!["available", "busy", "maintenance"].includes(status)) {
      return res.status(400).json({ error: "حالة غير صالحة" });
    }
    await pool.query("UPDATE gates SET status = ? WHERE id = ?", [status, req.params.id]);
    res.json({ message: "تم تحديث حالة البوابة" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
