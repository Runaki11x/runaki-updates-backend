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
app.use(cors());
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
app.listen(PORT, () => console.log(`Runaki Updates & Scripts Portal API running on :${PORT}`));