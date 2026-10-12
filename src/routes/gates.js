const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

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

// POST /api/gates - إضافة بوابة جديدة لمصنع المسؤول
router.post("/", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const { name, avgCheckinMinutes } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: "اسم البوابة مطلوب" });
    const minutes = Number(avgCheckinMinutes) > 0 ? Number(avgCheckinMinutes) : 5;
    try {
      const [result] = await pool.query(
        "INSERT INTO gates (facility_id, name, avg_checkin_minutes, status) VALUES (?, ?, ?, 'available')",
        [req.user.facilityId, String(name).trim(), minutes]
      );
      res.status(201).json({ id: result.insertId });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "توجد بوابة بنفس الاسم في مصنعك" });
      throw e;
    }
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
