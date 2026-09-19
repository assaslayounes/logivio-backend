const pool = require("../db");

/**
 * يتحقق من صلاحية موعد جديد قبل إنشائه:
 * 1) هل هو ضمن ساعات العمل؟
 * 2) هل الرصيف متاح في هذا الوقت (لا تعارض)؟
 * 3) هل تجاوزت المؤسسة العدد الأقصى للشاحنات في هذا اليوم؟
 * يرجع { valid: true } أو { valid: false, reason: "..." }
 */
async function validateAppointment({ facilityId, dockId, scheduledStart, scheduledEnd }) {
  const [[facility]] = await pool.query(
    "SELECT working_hours_start, working_hours_end, max_trucks_per_day FROM facilities WHERE id = ?",
    [facilityId]
  );
  if (!facility) return { valid: false, reason: "المؤسسة غير موجودة" };

  // 1) التحقق من ساعات العمل
  const startTime = scheduledStart.toTimeString().slice(0, 8);
  const endTime = scheduledEnd.toTimeString().slice(0, 8);
  if (startTime < facility.working_hours_start || endTime > facility.working_hours_end) {
    return { valid: false, reason: "الموعد خارج ساعات العمل المسموحة" };
  }

  // 2) التحقق من عدم تعارض الرصيف (نفس الرصيف، تداخل زمني)
  const [overlaps] = await pool.query(
    `SELECT id FROM appointments
     WHERE dock_id = ?
       AND status IN ('confirmed','rescheduled')
       AND scheduled_start < ?
       AND scheduled_end   > ?`,
    [dockId, scheduledEnd, scheduledStart]
  );
  if (overlaps.length > 0) {
    return { valid: false, reason: "يوجد حجز آخر متداخل على نفس الرصيف في هذا الوقت" };
  }

  // 3) التحقق من الطاقة الاستيعابية اليومية للمؤسسة
  if (facility.max_trucks_per_day > 0) {
    const dayStart = new Date(scheduledStart);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [[{ count }]] = await pool.query(
      `SELECT COUNT(*) AS count FROM appointments
       WHERE facility_id = ?
         AND status IN ('confirmed','rescheduled')
         AND scheduled_start >= ? AND scheduled_start < ?`,
      [facilityId, dayStart, dayEnd]
    );
    if (count >= facility.max_trucks_per_day) {
      return { valid: false, reason: "تم تجاوز الطاقة الاستيعابية القصوى لهذا اليوم" };
    }
  }

  return { valid: true };
}

module.exports = { validateAppointment };
