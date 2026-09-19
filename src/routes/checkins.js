const express = require("express");
const router = express.Router();
const pool = require("../db");
const { addToDockQueue, addToGateQueue, pickLeastBusyGate, reorderQueue } = require("../services/queueService");

// GET /api/checkins/scan/:qrCode - حالة حية كاملة للموعد (يستخدمها السائق للتتبع، والحارس عند المسح)
router.get("/scan/:qrCode", async (req, res, next) => {
  try {
    const [[data]] = await pool.query(
      `SELECT c.id AS checkin_id, c.qr_code, c.gate_id, c.arrival_time, c.entry_time,
              c.process_start_time, c.process_end_time, c.departure_time,
              a.id AS appointment_id, a.scheduled_start, a.status AS appointment_status,
              a.operation_type, a.is_perishable, a.dock_id, a.facility_id,
              d.name AS dock_name, d.status AS dock_status,
              g.name AS gate_name,
              t.plate_number, t.driver_name
       FROM checkins c
       JOIN appointments a ON a.id = c.appointment_id
       JOIN docks d ON d.id = a.dock_id
       JOIN trucks t ON t.id = a.truck_id
       LEFT JOIN gates g ON g.id = c.gate_id
       WHERE c.qr_code = ?`,
      [req.params.qrCode]
    );
    if (!data) return res.status(404).json({ error: "رمز QR غير معروف" });

    // هل الشاحنة منتظرة حاليًا في أي طابور (بوابة أو رصيف)؟
    const [[queueInfo]] = await pool.query(
      `SELECT qe.queue_type, qe.queue_position,
              COALESCE(g2.name, d2.name) AS resource_name
       FROM queue_entries qe
       LEFT JOIN gates g2 ON g2.id = qe.gate_id
       LEFT JOIN docks d2 ON d2.id = qe.expected_dock_id
       WHERE qe.appointment_id = ? AND qe.status = 'waiting'
       LIMIT 1`,
      [data.appointment_id]
    );

    res.json({ ...data, queueInfo: queueInfo || null });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/checkins/:id/arrive - المرحلة الأولى: الشاحنة وصلت فيزيائيًا أمام المصنع
// النظام يختار أقل بوابة ازدحامًا؛ إن كانت متاحة تُشغَل فورًا، وإلا تدخل الشاحنة طابور تلك البوابة تحديدًا
router.patch("/:id/arrive", async (req, res, next) => {
  try {
    const [[checkin]] = await pool.query(
      `SELECT c.*, a.facility_id FROM checkins c
       JOIN appointments a ON a.id = c.appointment_id WHERE c.id = ?`,
      [req.params.id]
    );
    if (!checkin) return res.status(404).json({ error: "سجل غير موجود" });

    const now = new Date();
    await pool.query("UPDATE checkins SET arrival_time = ? WHERE id = ?", [now, req.params.id]);

    const gate = await pickLeastBusyGate(checkin.facility_id);
    if (!gate) {
      return res.status(409).json({ error: "لا توجد بوابة متاحة حاليًا (الكل تحت الصيانة)" });
    }

    if (gate.status === "available") {
      await pool.query("UPDATE gates SET status = 'busy' WHERE id = ?", [gate.id]);
      await pool.query("UPDATE checkins SET gate_id = ? WHERE id = ?", [gate.id, req.params.id]);
      return res.json({ message: `تم توجيهك إلى ${await gateName(gate.id)} — تفضّل للمسح والتسجيل`, gateId: gate.id, queued: false });
    }

    // كل البوابات مشغولة الآن: الشاحنة تنتظر في طابور أقل بوابة ازدحامًا تحديدًا
    await addToGateQueue({ appointmentId: checkin.appointment_id, arrivalTime: now, gateId: gate.id });
    res.json({ message: `كل البوابات مشغولة، أُضفت إلى طابور ${await gateName(gate.id)}`, gateId: gate.id, queued: true });
  } catch (err) {
    next(err);
  }
});

async function gateName(gateId) {
  const [[g]] = await pool.query("SELECT name FROM gates WHERE id = ?", [gateId]);
  return g ? g.name : "البوابة";
}

// PATCH /api/checkins/:id/entry - المرحلة الثانية: انتهت معالجة الشاحنة عند البوابة فعليًا (فحص + مسح QR)
// تُحرَّر البوابة، وإذا كان الرصيف المستهدف مشغولاً تدخل الشاحنة طابور ذلك الرصيف تحديدًا
router.patch("/:id/entry", async (req, res, next) => {
  try {
    const { checkedInBy } = req.body;
    const [[checkin]] = await pool.query(
      `SELECT c.*, a.dock_id, a.facility_id FROM checkins c
       JOIN appointments a ON a.id = c.appointment_id WHERE c.id = ?`,
      [req.params.id]
    );
    if (!checkin) return res.status(404).json({ error: "سجل غير موجود" });

    const now = new Date();
    await pool.query(
      "UPDATE checkins SET entry_time = ?, checked_in_by = ? WHERE id = ?",
      [now, checkedInBy || null, req.params.id]
    );

    // تحرير البوابة التي استُخدمت، حتى تستقبل الشاحنة التالية في طابورها
    if (checkin.gate_id) {
      await pool.query("UPDATE gates SET status = 'available' WHERE id = ?", [checkin.gate_id]);
    }

    const [[dock]] = await pool.query("SELECT status FROM docks WHERE id = ?", [checkin.dock_id]);
    if (dock.status !== "available") {
      await addToDockQueue({
        appointmentId: checkin.appointment_id,
        arrivalTime: now,
        waitReason: "بانتظار تحرر الرصيف",
        expectedDockId: checkin.dock_id,
      });
      return res.json({ message: "تم تسجيل الدخول، الشاحنة أُضيفت إلى طابور الرصيف" });
    }

    await pool.query("UPDATE docks SET status = 'busy' WHERE id = ?", [checkin.dock_id]);
    res.json({ message: "تم تسجيل الدخول، التوجه مباشرة إلى الرصيف" });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/checkins/:id/start - بداية عملية التحميل/التفريغ
router.patch("/:id/start", async (req, res, next) => {
  try {
    await pool.query("UPDATE checkins SET process_start_time = NOW() WHERE id = ?", [req.params.id]);
    res.json({ message: "بدأت العملية" });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/checkins/:id/finish - نهاية العملية والمغادرة، وتحرير الرصيف
router.patch("/:id/finish", async (req, res, next) => {
  try {
    const [[checkin]] = await pool.query(
      `SELECT c.*, a.dock_id FROM checkins c JOIN appointments a ON a.id = c.appointment_id WHERE c.id = ?`,
      [req.params.id]
    );
    if (!checkin) return res.status(404).json({ error: "سجل غير موجود" });

    const now = new Date();
    await pool.query(
      "UPDATE checkins SET process_end_time = ?, departure_time = ? WHERE id = ?",
      [now, now, req.params.id]
    );
    await pool.query("UPDATE appointments SET status = 'completed' WHERE id = ?", [checkin.appointment_id]);
    await pool.query("UPDATE docks SET status = 'available' WHERE id = ?", [checkin.dock_id]);

    res.json({ message: "اكتملت العملية وتحرر الرصيف" });
  } catch (err) {
    next(err);
  }
});

// POST /api/checkins/:id/delay-reason - تسجيل سبب تأخير لهذا التسجيل
router.post("/:id/delay-reason", async (req, res, next) => {
  try {
    const { reasonCategory, delayMinutes, notes } = req.body;
    await pool.query(
      "INSERT INTO delay_reasons (checkin_id, reason_category, delay_minutes, notes) VALUES (?, ?, ?, ?)",
      [req.params.id, reasonCategory, delayMinutes || 0, notes || null]
    );
    res.status(201).json({ message: "تم تسجيل سبب التأخير" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
