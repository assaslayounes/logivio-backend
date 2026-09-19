const pool = require("../db");

/**
 * يعيد ترتيب طابور "مورد" واحد بالذات (بوابة معيّنة أو رصيف معيّن) - وليس طابورًا عامًا للمصنع.
 * هذا يعكس الواقع الميداني: طابور البوابة 1 مستقل عن طابور البوابة 2،
 * وطابور الرصيف 3 مستقل عن طابور الرصيف 7.
 *
 * queueType: 'gate' أو 'dock'
 * resourceId: gate_id إذا كان النوع 'gate'، أو expected_dock_id إذا كان النوع 'dock'
 */
async function reorderQueue(queueType, resourceId) {
  const resourceColumn = queueType === "gate" ? "gate_id" : "expected_dock_id";

  const [rows] = await pool.query(
    `SELECT qe.id, a.is_perishable, qe.arrival_time
     FROM queue_entries qe
     JOIN appointments a ON a.id = qe.appointment_id
     WHERE qe.status = 'waiting' AND qe.queue_type = ? AND qe.${resourceColumn} = ?
     ORDER BY a.is_perishable DESC, qe.arrival_time ASC`,
    [queueType, resourceId]
  );

  for (let i = 0; i < rows.length; i++) {
    await pool.query("UPDATE queue_entries SET queue_position = ? WHERE id = ?", [i + 1, rows[i].id]);
  }
  return rows.length;
}

/**
 * يضيف شاحنة إلى طابور رصيف معيّن (بعد أن دخلت المصنع فعليًا ووجدت رصيفها مشغولاً).
 */
async function addToDockQueue({ appointmentId, arrivalTime, waitReason, expectedDockId }) {
  if (!expectedDockId) {
    throw Object.assign(new Error("يجب تحديد الرصيف المتوقع لإضافة الشاحنة إلى طابوره"), { status: 400 });
  }
  await pool.query(
    `INSERT INTO queue_entries (appointment_id, queue_type, arrival_time, queue_position, wait_reason, expected_dock_id, status)
     VALUES (?, 'dock', ?, 0, ?, ?, 'waiting')`,
    [appointmentId, arrivalTime, waitReason, expectedDockId]
  );
  await reorderQueue("dock", expectedDockId);
}

/**
 * يضيف شاحنة إلى طابور بوابة معيّنة (قبل الدخول الفيزيائي، عندما تكون البوابات كلها مشغولة).
 */
async function addToGateQueue({ appointmentId, arrivalTime, gateId }) {
  if (!gateId) {
    throw Object.assign(new Error("يجب تحديد البوابة لإضافة الشاحنة إلى طابورها"), { status: 400 });
  }
  await pool.query(
    `INSERT INTO queue_entries (appointment_id, queue_type, arrival_time, queue_position, wait_reason, gate_id, status)
     VALUES (?, 'gate', ?, 0, 'بانتظار توفر البوابة', ?, 'waiting')`,
    [appointmentId, arrivalTime, gateId]
  );
  await reorderQueue("gate", gateId);
}

/**
 * يختار أقل البوابات ازدحامًا حاليًا (الأقل عدد شاحنات منتظرة في طابورها) من بين البوابات المتاحة.
 * يُستخدم لتوزيع الشاحنات تلقائيًا بين البوابتين بدل تركها للمصادفة.
 */
async function pickLeastBusyGate(facilityId) {
  const [gates] = await pool.query(
    `SELECT g.id, g.status,
            (SELECT COUNT(*) FROM queue_entries qe WHERE qe.gate_id = g.id AND qe.status = 'waiting') AS queue_length
     FROM gates g
     WHERE g.facility_id = ? AND g.status != 'maintenance'
     ORDER BY g.status = 'busy' ASC, queue_length ASC
     LIMIT 1`,
    [facilityId]
  );
  return gates[0] || null;
}

module.exports = { reorderQueue, addToDockQueue, addToGateQueue, pickLeastBusyGate };
