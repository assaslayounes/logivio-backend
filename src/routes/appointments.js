const express = require("express");
const router = express.Router();
const pool = require("../db");
const { validateAppointment } = require("../services/schedulingService");

// GET /api/appointments?date=2026-09-08 - قائمة مواعيد يوم معيّن
router.get("/", async (req, res, next) => {
  try {
    const { date, facilityId } = req.query;
    let query = `SELECT a.*, d.name AS dock_name, t.plate_number, t.driver_name
                 FROM appointments a
                 JOIN docks d ON d.id = a.dock_id
                 JOIN trucks t ON t.id = a.truck_id
                 WHERE a.facility_id = ?`;
    const params = [facilityId || 1];
    if (date) {
      query += " AND DATE(a.scheduled_start) = ?";
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
    const qrCode = `CAP-${result.insertId}-${Date.now()}`;
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

// PATCH /api/appointments/:id/reschedule - إعادة جدولة موعد بعد تعطّل ناجم عن ظرف قاهر
// (سوء أحوال جوية، انقطاع تيار كهربائي...) أو أي سبب آخر يستدعي تغيير الموعد قبل وصول الشاحنة
const RESCHEDULE_REASONS = {
  weather: "سوء الأحوال الجوية",
  power_outage: "انقطاع التيار الكهربائي",
  dock_maintenance: "صيانة طارئة في الرصيف",
  other: "سبب آخر",
};

router.patch("/:id/reschedule", async (req, res, next) => {
  try {
    const { scheduledStart, scheduledEnd, dockId, reasonCategory, notes } = req.body;
    if (!scheduledStart || !scheduledEnd || !reasonCategory) {
      return res.status(400).json({ error: "يرجى تحديد الموعد الجديد وسبب إعادة الجدولة" });
    }
    if (!RESCHEDULE_REASONS[reasonCategory]) {
      return res.status(400).json({ error: "سبب إعادة الجدولة غير معروف" });
    }

    const [[appointment]] = await pool.query("SELECT * FROM appointments WHERE id = ?", [req.params.id]);
    if (!appointment) return res.status(404).json({ error: "الموعد غير موجود" });
    if (["completed", "cancelled"].includes(appointment.status)) {
      return res.status(409).json({ error: "لا يمكن إعادة جدولة موعد مكتمل أو ملغى" });
    }

    const start = new Date(scheduledStart);
    const end = new Date(scheduledEnd);
    const finalDockId = dockId || appointment.dock_id;

    const check = await validateAppointment({
      facilityId: appointment.facility_id,
      dockId: finalDockId,
      scheduledStart: start,
      scheduledEnd: end,
      excludeAppointmentId: appointment.id,
    });
    if (!check.valid) {
      return res.status(409).json({ error: check.reason });
    }

    const reasonLabel = RESCHEDULE_REASONS[reasonCategory];
    const reasonText = notes ? `${reasonLabel} — ${notes}` : reasonLabel;

    await pool.query(
      `UPDATE appointments
       SET dock_id = ?, scheduled_start = ?, scheduled_end = ?, status = 'rescheduled', reschedule_reason = ?
       WHERE id = ?`,
      [finalDockId, start, end, reasonText, req.params.id]
    );

    const [[updated]] = await pool.query(
      `SELECT a.*, d.name AS dock_name, t.plate_number, t.driver_name
       FROM appointments a JOIN docks d ON d.id = a.dock_id JOIN trucks t ON t.id = a.truck_id
       WHERE a.id = ?`,
      [req.params.id]
    );
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
