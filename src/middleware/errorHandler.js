// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || "حدث خطأ غير متوقع في الخادم",
  });
}

module.exports = errorHandler;
