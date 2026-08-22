require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const agentsRoutes = require("./routes/agents");
const postsRoutes = require("./routes/posts");
const ackRoutes = require("./routes/acknowledgments");
const dashboardRoutes = require("./routes/dashboard");
const analyticsRoutes = require("./routes/analytics");
const auditRoutes = require("./routes/audit");

const app = express();
app.use(cors({ origin: "https://runaki-updates-frontend.vercel.app" }));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/agents", agentsRoutes);
app.use("/api/posts", postsRoutes);
app.use("/api/acknowledgments", ackRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/audit", auditRoutes);

const PORT = process.env.PORT || 4000;
// Vercel imports this file as a serverless function and calls the exported
// app directly — it never needs app.listen(). Only start a real listener
// when running locally (npm run dev), so both environments work correctly.
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Runaki Updates & Scripts Portal API running on :${PORT}`));
}

module.exports = app;