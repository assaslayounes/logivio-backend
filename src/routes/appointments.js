const express = require("express");
const router = express.Router();
const pool = require("../db");
const { validateAppointment } = require("../services/schedulingService");

// GET /api/appointments?date=2026-09-08 - قائمة مواعيد يوم معيّن
router.get("/", async (req, res, next) => {
  try {
    const { date } = req.query;
    let query = `SELECT a.*, d.name AS dock_name, t.plate_number, t.driver_name
                 FROM appointments a
                 JOIN docks d ON d.id = a.dock_id
                 JOIN trucks t ON t.id = a.truck_id`;
    const params = [];
    if (date) {
      query += " WHERE DATE(a.scheduled_start) = ?";
      params.push(date);
    }
    query += " ORDER BY a.scheduled_start ASC";
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/appointments - إنشاء موعد جديد مع كل عمليات التحقق التلقائية
// السائق يُدخل رقم اللوحة واسمه مباشرة (وليس معرّفًا داخليًا) - الشاحنة تُنشأ تلقائيًا إن لم تكن مسجَّلة
router.post("/", async (req, res, next) => {
  try {
    const {
      facilityId, dockId, plateNumber, driverName, operationType,
      isPerishable, scheduledStart, scheduledEnd,
    } = req.body;

    if (!facilityId || !dockId || !plateNumber || !driverName || !operationType || !scheduledStart || !scheduledEnd) {
      return res.status(400).json({ error: "بيانات ناقصة في الطلب" });
    }

    const start = new Date(scheduledStart);
    const end = new Date(scheduledEnd);

    const check = await validateAppointment({ facilityId, dockId, scheduledStart: start, scheduledEnd: end });
    if (!check.valid) {
      return res.status(409).json({ error: check.reason });
    }

    // البحث عن الشاحنة برقم لوحتها، أو إنشاؤها إن كانت أول مرة تُسجَّل
    const normalizedPlate = String(plateNumber).trim();
    let truckId;
    const [[existingTruck]] = await pool.query("SELECT id FROM trucks WHERE plate_number = ?", [normalizedPlate]);
    if (existingTruck) {
      truckId = existingTruck.id;
      await pool.query("UPDATE trucks SET driver_name = ? WHERE id = ?", [driverName, truckId]);
    } else {
      const [truckResult] = await pool.query(
        "INSERT INTO trucks (plate_number, driver_name) VALUES (?, ?)",
        [normalizedPlate, driverName]
      );
      truckId = truckResult.insertId;
    }

    const [result] = await pool.query(
      `INSERT INTO appointments
       (facility_id, dock_id, truck_id, operation_type, is_perishable, scheduled_start, scheduled_end, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
      [facilityId, dockId, truckId, operationType, isPerishable ? 1 : 0, start, end]
    );

    // إنشاء رمز QR فريد وربطه بسجل تسجيل دخول مبدئي
    const qrCode = `LGV-${result.insertId}-${Date.now()}`;
    await pool.query("INSERT INTO checkins (appointment_id, qr_code) VALUES (?, ?)", [result.insertId, qrCode]);

    res.status(201).json({ id: result.insertId, qrCode });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/appointments/:id/cancel - إلغاء موعد
router.patch("/:id/cancel", async (req, res, next) => {
  try {
    await pool.query("UPDATE appointments SET status = 'cancelled' WHERE id = ?", [req.params.id]);
    res.json({ message: "تم إلغاء الموعد" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
