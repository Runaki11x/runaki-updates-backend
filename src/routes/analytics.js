const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Fastest/slowest acknowledgers — average seconds-to-ack per agent, across all their acks.
router.get("/leaderboard", requireAuth("admin"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ag.id AS agent_id, ag.wave_id, ag.name, ag.queue,
              COUNT(a.id) AS ack_count,
              ROUND(AVG(a.seconds_to_ack)) AS avg_seconds,
              COUNT(a.id) FILTER (WHERE a.is_suspicious) AS suspicious_count
       FROM agents ag
       JOIN acknowledgments a ON a.agent_id = ag.id AND a.acknowledged_at IS NOT NULL
       WHERE ag.status = 'active'
       GROUP BY ag.id, ag.wave_id, ag.name, ag.queue
       HAVING COUNT(a.id) > 0
       ORDER BY avg_seconds ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

// Most-viewed / most-ignored published content, by acknowledgment rate against active agent count.
router.get("/content-engagement", requireAuth("admin"), async (req, res) => {
  try {
    const totalAgentsRes = await pool.query("SELECT COUNT(*) FROM agents WHERE status = 'active'");
    const totalAgents = Number(totalAgentsRes.rows[0].count) || 1;

    const { rows } = await pool.query(
      `SELECT p.id, p.type, p.title, p.ticket_no, p.priority, p.published_at,
              COUNT(a.id) FILTER (WHERE a.acknowledged_at IS NOT NULL) AS ack_count,
              COUNT(a.id) FILTER (WHERE a.opened_at IS NOT NULL) AS open_count
       FROM posts p
       LEFT JOIN acknowledgments a ON a.post_id = p.id
       WHERE p.status = 'published'
       GROUP BY p.id
       ORDER BY p.published_at DESC`
    );

    const withRate = rows.map((r) => ({
      ...r,
      ackRate: Math.round((Number(r.ack_count) / totalAgents) * 100),
    }));

    res.json(withRate);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load content engagement" });
  }
});

// Peak login hours (0-23), aggregated across all login history.
router.get("/peak-hours", requireAuth("admin"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT EXTRACT(HOUR FROM logged_in_at)::int AS hour, COUNT(*) AS count
       FROM login_logs
       GROUP BY hour
       ORDER BY hour`
    );
    // Fill in missing hours with 0 so the chart always has all 24 bars
    const byHour = Object.fromEntries(rows.map((r) => [r.hour, Number(r.count)]));
    const full = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: byHour[h] || 0 }));
    res.json(full);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load peak hours" });
  }
});

module.exports = router;