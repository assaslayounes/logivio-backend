const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/dashboard/stats?facilityId=1&date=2026-09-08
router.get("/stats", async (req, res, next) => {
  try {
    const facilityId = req.query.facilityId || 1;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [[{ trucksToday }]] = await pool.query(
      `SELECT COUNT(*) AS trucksToday FROM appointments
       WHERE facility_id = ? AND DATE(scheduled_start) = ? AND status != 'cancelled'`,
      [facilityId, date]
    );

    const [[{ completedCount }]] = await pool.query(
      `SELECT COUNT(*) AS completedCount FROM appointments a
       JOIN checkins c ON c.appointment_id = a.id
       WHERE a.facility_id = ? AND DATE(a.scheduled_start) = ? AND a.status = 'completed'`,
      [facilityId, date]
    );

    const [[{ onTimeCount }]] = await pool.query(
      `SELECT COUNT(*) AS onTimeCount FROM appointments a
       JOIN checkins c ON c.appointment_id = a.id
       WHERE a.facility_id = ? AND DATE(a.scheduled_start) = ? AND a.status = 'completed'
         AND c.arrival_time <= a.scheduled_start`,
      [facilityId, date]
    );

    const [[{ avgWaitMinutes }]] = await pool.query(
      `SELECT AVG(TIMESTAMPDIFF(MINUTE, c.arrival_time, c.entry_time)) AS avgWaitMinutes
       FROM checkins c JOIN appointments a ON a.id = c.appointment_id
       WHERE a.facility_id = ? AND DATE(a.scheduled_start) = ? AND c.entry_time IS NOT NULL`,
      [facilityId, date]
    );

    const [dockRows] = await pool.query("SELECT status FROM docks WHERE facility_id = ?", [facilityId]);
    const busyDocks = dockRows.filter((d) => d.status === "busy").length;
    const dockUtilization = dockRows.length ? Math.round((busyDocks / dockRows.length) * 100) : 0;

    res.json({
      trucksToday,
      onTimeRate: completedCount ? Math.round((onTimeCount / completedCount) * 100) : null,
      avgWaitMinutes: avgWaitMinutes ? Math.round(avgWaitMinutes) : null,
      dockUtilization,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
