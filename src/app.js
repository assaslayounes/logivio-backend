const express = require("express");
const cors = require("cors");
const errorHandler = require("./middleware/errorHandler");

const appointmentsRouter = require("./routes/appointments");
const docksRouter = require("./routes/docks");
const gatesRouter = require("./routes/gates");
const queueRouter = require("./routes/queue");
const checkinsRouter = require("./routes/checkins");
const dashboardRouter = require("./routes/dashboard");
const authRouter = require("./routes/auth");
const facilitiesRouter = require("./routes/facilities");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.json({ status: "logivio-backend يعمل بنجاح" }));

app.use("/api/auth", authRouter);
app.use("/api/facilities", facilitiesRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/docks", docksRouter);
app.use("/api/gates", gatesRouter);
app.use("/api/queue", queueRouter);
app.use("/api/checkins", checkinsRouter);
app.use("/api/dashboard", dashboardRouter);

app.use(errorHandler);

module.exports = app;
