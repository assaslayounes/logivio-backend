const express = require("express");
const router = express.Router();
const pool = require("../db");
const { reorderQueue } = require("../services/queueService");

// GET /api/queue?facilityId=1&type=dock          - كل طوابير الأرصفة (افتراضي)
// GET /api/queue?facilityId=1&type=dock&dockId=2 - طابور رصيف واحد بالذات
// GET /api/queue?facilityId=1&type=gate          - كل طوابير البوابات
router.get("/", async (req, res, next) => {
  try {
    const { facilityId, type = "dock", dockId, gateId } = req.query;

    let query = `SELECT qe.id, qe.queue_type, qe.queue_position, qe.wait_reason, qe.arrival_time,
              qe.expected_dock_id, qe.gate_id,
              a.operation_type, a.is_perishable,
              t.plate_number, t.driver_name,
              d.name AS expected_dock_name, g.name AS gate_name
       FROM queue_entries qe
       JOIN appointments a ON a.id = qe.appointment_id
       JOIN trucks t ON t.id = a.truck_id
       LEFT JOIN docks d ON d.id = qe.expected_dock_id
       LEFT JOIN gates g ON g.id = qe.gate_id
       WHERE qe.status = 'waiting' AND qe.queue_type = ? AND a.facility_id = ?`;
    const params = [type, facilityId || 1];

    if (type === "dock" && dockId) {
      query += " AND qe.expected_dock_id = ?";
      params.push(dockId);
    }
    if (type === "gate" && gateId) {
      query += " AND qe.gate_id = ?";
      params.push(gateId);
    }
    query += " ORDER BY qe.expected_dock_id ASC, qe.gate_id ASC, qe.queue_position ASC";

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/queue/:id/remove - إخراج شاحنة من طابورها (بوابة أو رصيف) بعد استدعائها
router.patch("/:id/remove", async (req, res, next) => {
  try {
    const [[entry]] = await pool.query(
      "SELECT queue_type, expected_dock_id, gate_id FROM queue_entries WHERE id = ?",
      [req.params.id]
    );
    await pool.query("UPDATE queue_entries SET status = 'called' WHERE id = ?", [req.params.id]);
    if (entry) {
      const resourceId = entry.queue_type === "gate" ? entry.gate_id : entry.expected_dock_id;
      await reorderQueue(entry.queue_type, resourceId);
    }
    res.json({ message: "تم استدعاء الشاحنة من الطابور" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
