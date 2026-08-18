const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/stats", requireAuth("admin"), async (req, res) => {
  try {
    const [agents, faqs, loginsToday, byQueue, liveNow, loginTrend] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM agents WHERE status = 'active'"),
      pool.query("SELECT COUNT(*) FROM posts WHERE type = 'faq' AND status = 'published'"),
      pool.query("SELECT COUNT(*) FROM login_logs WHERE logged_in_at::date = CURRENT_DATE"),
      pool.query("SELECT queue, COUNT(*) FROM agents WHERE status = 'active' GROUP BY queue"),
      pool.query(
        `SELECT COUNT(DISTINCT agent_id) FROM login_logs
         WHERE logged_in_at > now() - interval '30 minutes' AND logged_out_at IS NULL`
      ),
      pool.query(
        `SELECT date_trunc('day', logged_in_at)::date AS day, COUNT(*) AS count
         FROM login_logs
         WHERE logged_in_at > now() - interval '7 days'
         GROUP BY day ORDER BY day`
      ),
    ]);

    res.json({
      totalAgents: Number(agents.rows[0].count),
      totalFaqs: Number(faqs.rows[0].count),
      totalLoginsToday: Number(loginsToday.rows[0].count),
      liveNow: Number(liveNow.rows[0].count),
      agentsByQueue: byQueue.rows.map((r) => ({ queue: r.queue, count: Number(r.count) })),
      loginTrend: loginTrend.rows.map((r) => ({ day: r.day, count: Number(r.count) })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
});

module.exports = router;
