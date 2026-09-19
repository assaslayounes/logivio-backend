const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "logivio-dev-secret-change-me";

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "يجب تسجيل الدخول للوصول إلى هذا المورد" });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.user = payload; // { id, fullName, role, facilityId }
    next();
  } catch {
    return res.status(401).json({ error: "جلسة الدخول منتهية أو غير صالحة" });
  }
}

// وسيط اختياري: يتحقق من الرمز إن وُجد، لكن لا يرفض الطلب إن كان غائبًا
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
    } catch {
      /* تجاهل الرمز غير الصالح، تابع بدون مستخدم */
    }
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "لا تملك صلاحية الوصول إلى هذا المورد" });
    }
    next();
  };
}

module.exports = { requireAuth, optionalAuth, requireRole, JWT_SECRET };
