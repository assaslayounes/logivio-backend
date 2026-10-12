const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

// GET /api/docks?facilityId=1 - حالة كل الأرصفة الآن
router.get("/", async (req, res, next) => {
  try {
    const { facilityId } = req.query;
    const [rows] = await pool.query(
      "SELECT * FROM docks WHERE facility_id = ? ORDER BY name ASC",
      [facilityId || 1]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/docks - إضافة رصيف جديد لمصنع المسؤول (المصنع يُؤخذ من رمز الدخول وليس من الطلب)
router.post("/", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const { name, avgProcessMinutes } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: "اسم الرصيف مطلوب" });
    const minutes = Number(avgProcessMinutes) > 0 ? Number(avgProcessMinutes) : 60;
    try {
      const [result] = await pool.query(
        "INSERT INTO docks (facility_id, name, avg_process_minutes, status) VALUES (?, ?, ?, 'available')",
        [req.user.facilityId, String(name).trim(), minutes]
      );
      res.status(201).json({ id: result.insertId });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "يوجد رصيف بنفس الاسم في مصنعك" });
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

// PATCH /api/docks/:id/status - تغيير حالة الرصيف (متاح / مشغول / صيانة)
router.patch("/:id/status", async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!["available", "busy", "maintenance"].includes(status)) {
      return res.status(400).json({ error: "حالة غير صالحة" });
    }
    await pool.query("UPDATE docks SET status = ? WHERE id = ?", [status, req.params.id]);
    res.json({ message: "تم تحديث حالة الرصيف" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
