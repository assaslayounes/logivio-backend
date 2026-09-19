const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

// GET /api/facilities/:id
router.get("/:id", async (req, res, next) => {
  try {
    const [[facility]] = await pool.query("SELECT * FROM facilities WHERE id = ?", [req.params.id]);
    if (!facility) return res.status(404).json({ error: "المصنع غير موجود" });
    res.json(facility);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/facilities/:id - تعديل إعدادات المصنع (المسؤول فقط)
router.patch("/:id", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const {
      name, ownerName, ownerPhone, address,
      workingHoursStart, workingHoursEnd, maxTrucksPerDay,
    } = req.body;

    await pool.query(
      `UPDATE facilities SET
        name = COALESCE(?, name),
        owner_name = ?,
        owner_phone = ?,
        address = ?,
        working_hours_start = COALESCE(?, working_hours_start),
        working_hours_end = COALESCE(?, working_hours_end),
        max_trucks_per_day = COALESCE(?, max_trucks_per_day)
       WHERE id = ?`,
      [name, ownerName || null, ownerPhone || null, address || null,
       workingHoursStart, workingHoursEnd, maxTrucksPerDay, req.params.id]
    );

    const [[updated]] = await pool.query("SELECT * FROM facilities WHERE id = ?", [req.params.id]);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
