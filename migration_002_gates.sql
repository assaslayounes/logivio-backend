-- ============================================================
-- Migration 002: إضافة البوابات (Gates) كنقطة اختناق مستقلة عن الأرصفة
-- نفّذ هذا السكريبت على نفس قاعدة البيانات الموجودة (لا يحذف أي بيانات)
-- ============================================================

-- 1) جدول البوابات - نقطة الدخول الفيزيائية، منفصلة عن الأرصفة
CREATE TABLE IF NOT EXISTS gates (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  facility_id         INT UNSIGNED NOT NULL,
  name                VARCHAR(50) NOT NULL,              -- مثال: "البوابة 1"
  avg_checkin_minutes INT UNSIGNED NOT NULL DEFAULT 5,    -- مدة معالجة شاحنة واحدة عند البوابة
  status              ENUM('available','busy','maintenance') NOT NULL DEFAULT 'available',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_gates_facility FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE,
  UNIQUE KEY uq_gate_name_per_facility (facility_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) توسيع queue_entries لتمييز طابور البوابة عن طابور الرصيف
--    (شاحنة قد تمر بطابورين متتاليين: طابور بوابة، ثم طابور رصيف)
ALTER TABLE queue_entries
  ADD COLUMN queue_type ENUM('gate','dock') NOT NULL DEFAULT 'dock' AFTER appointment_id,
  ADD COLUMN gate_id INT UNSIGNED NULL AFTER expected_dock_id,
  ADD CONSTRAINT fk_queue_gate FOREIGN KEY (gate_id) REFERENCES gates(id) ON DELETE SET NULL;

-- 3) ربط كل تسجيل دخول بالبوابة التي استُخدمت فعليًا لمعالجته
ALTER TABLE checkins
  ADD COLUMN gate_id INT UNSIGNED NULL AFTER qr_code,
  ADD CONSTRAINT fk_checkin_gate FOREIGN KEY (gate_id) REFERENCES gates(id) ON DELETE SET NULL;

-- 4) بيانات تجريبية: بوابتان لمصنع عمر بن عمر (facility_id = 1)
INSERT INTO gates (facility_id, name, avg_checkin_minutes, status) VALUES
(1, 'البوابة 1', 4, 'available'),
(1, 'البوابة 2', 4, 'available');
