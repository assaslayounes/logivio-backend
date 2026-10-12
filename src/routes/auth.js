const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { requireAuth, JWT_SECRET } = require("../middleware/auth");

function signToken(user) {
  return jwt.sign(
    { id: user.id, fullName: user.full_name, role: user.role, facilityId: user.facility_id },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// POST /api/auth/register - تسجيل موظف تشغيلي (سائق/حارس بوابة/مسؤول رصيف) في مصنع قائم بالفعل
// إنشاء حساب "مسؤول" لا يمر من هنا إطلاقًا - له مسار مستقل /register-factory لأنه ينشئ مصنعًا جديدًا
router.post("/register", async (req, res, next) => {
  try {
    const { fullName, email, password, role, facilityId } = req.body;
    if (!fullName || !email || !password || !role || !facilityId) {
      return res.status(400).json({ error: "يرجى تعبئة كل الحقول المطلوبة، واختيار المصنع" });
    }
    if (!["gate_agent", "dock_operator", "driver"].includes(role)) {
      return res.status(400).json({ error: "دور غير صالح لهذا النوع من التسجيل" });
    }

    const [[facility]] = await pool.query("SELECT id FROM facilities WHERE id = ?", [facilityId]);
    if (!facility) {
      return res.status(404).json({ error: "المصنع المحدد غير موجود" });
    }

    const [[existing]] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) {
      return res.status(409).json({ error: "هذا البريد الإلكتروني مسجَّل بالفعل" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (facility_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
      [facilityId, fullName, email, passwordHash, role]
    );

    const user = { id: result.insertId, full_name: fullName, role, facility_id: facilityId };
    res.status(201).json({ token: signToken(user), user: { id: user.id, fullName, email, role, facilityId: user.facility_id } });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/register-factory - تسجيل مصنع جديد بالكامل + إنشاء أول حساب مسؤول له دفعة واحدة
router.post("/register-factory", async (req, res, next) => {
  try {
    const { facilityName, fullName, email, password } = req.body;
    if (!facilityName || !fullName || !email || !password) {
      return res.status(400).json({ error: "يرجى تعبئة كل الحقول المطلوبة" });
    }

    const [[existing]] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) {
      return res.status(409).json({ error: "هذا البريد الإلكتروني مسجَّل بالفعل" });
    }

    const [facilityResult] = await pool.query(
      `INSERT INTO facilities (name, owner_name, working_hours_start, working_hours_end, max_trucks_per_day)
       VALUES (?, ?, '08:00:00', '18:00:00', 0)`,
      [facilityName, fullName]
    );
    const facilityId = facilityResult.insertId;

    // تجهيز مبدئي حتى يعمل المصنع الجديد فورًا: بوابة واحدة ورصيف واحد (يُعدَّلان ويُضاف غيرهما من الإعدادات)
    await pool.query(
      "INSERT INTO gates (facility_id, name, avg_checkin_minutes, status) VALUES (?, 'البوابة 1', 5, 'available')",
      [facilityId]
    );
    await pool.query(
      "INSERT INTO docks (facility_id, name, avg_process_minutes, status) VALUES (?, 'رصيف 1', 60, 'available')",
      [facilityId]
    );

    const passwordHash = await bcrypt.hash(password, 10);
    const [userResult] = await pool.query(
      "INSERT INTO users (facility_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')",
      [facilityId, fullName, email, passwordHash]
    );

    const user = { id: userResult.insertId, full_name: fullName, role: "admin", facility_id: facilityId };
    res.status(201).json({
      token: signToken(user),
      user: { id: user.id, fullName, email, role: "admin", facilityId },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "يرجى إدخال البريد الإلكتروني وكلمة المرور" });
    }

    const [[user]] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      return res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    }

    res.json({
      token: signToken(user),
      user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role, facilityId: user.facility_id },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me - استرجاع بيانات المستخدم الحالي من الرمز (لاستعادة الجلسة بعد إعادة تحميل الصفحة)
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const [[user]] = await pool.query(
      "SELECT id, full_name, email, role, facility_id FROM users WHERE id = ?",
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });
    res.json({
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      facilityId: user.facility_id,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
