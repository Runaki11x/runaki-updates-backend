const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Minimum plausible reading time floor, scaled to word count (~200 wpm, floor at 4s).
function minReadSeconds(bodyText) {
  const words = bodyText.trim().split(/\s+/).length;
  return Math.max(4, Math.round((words / 200) * 60));
}
// Anything acknowledged faster than this fraction of the floor is flagged suspicious.
const SUSPICIOUS_RATIO = 0.4;

// Agent opens a post — logs opened_at (starts the time floor + tab-switch tracking)
router.post("/:postId/open", requireAuth("agent"), async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO acknowledgments (post_id, agent_id, opened_at)
       VALUES ($1, $2, now())
       ON CONFLICT (post_id, agent_id) DO UPDATE SET opened_at = COALESCE(acknowledgments.opened_at, now())`,
      [req.params.postId, req.user.agentId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to log open" });
  }
});

// Agent scrolls to the bottom — unlocks the acknowledge button client-side,
// but we also record it server-side so the tracker knows engagement happened.
router.post("/:postId/scrolled", requireAuth("agent"), async (req, res) => {
  await pool.query(
    "UPDATE acknowledgments SET scrolled_to_end_at = now() WHERE post_id = $1 AND agent_id = $2",
    [req.params.postId, req.user.agentId]
  );
  res.json({ success: true });
});

// Agent flags a tab-switch-away event while a post was open
router.post("/:postId/tab-switch", requireAuth("agent"), async (req, res) => {
  await pool.query(
    "UPDATE acknowledgments SET tab_switched_away = true WHERE post_id = $1 AND agent_id = $2",
    [req.params.postId, req.user.agentId]
  );
  res.json({ success: true });
});

// Final acknowledge — validates scroll-gate + time floor + quiz (if required)
router.post("/:postId/acknowledge", requireAuth("agent"), async (req, res) => {
  const { quizAnswerIdx } = req.body;
  try {
    const postRes = await pool.query("SELECT * FROM posts WHERE id = $1", [req.params.postId]);
    const post = postRes.rows[0];
    if (!post) return res.status(404).json({ error: "Post not found" });

    const ackRes = await pool.query(
      "SELECT * FROM acknowledgments WHERE post_id = $1 AND agent_id = $2",
      [req.params.postId, req.user.agentId]
    );
    const ack = ackRes.rows[0];
    if (!ack || !ack.opened_at) return res.status(400).json({ error: "Post must be opened before acknowledging" });
    if (!ack.scrolled_to_end_at) return res.status(400).json({ error: "Scroll to the end before acknowledging" });

    // Quiz check for critical/high priority posts marked requires_quiz
    let quizPassed = null;
    if (post.requires_quiz) {
      quizPassed = Number(quizAnswerIdx) === post.quiz_correct_idx;
      await pool.query(
        "UPDATE acknowledgments SET quiz_attempts = quiz_attempts + 1, quiz_passed = $1 WHERE post_id = $2 AND agent_id = $3",
        [quizPassed, req.params.postId, req.user.agentId]
      );
      if (!quizPassed) {
        return res.status(400).json({ error: "Incorrect answer — please re-read and try again", quizPassed: false });
      }
    }

    const secondsToAck = Math.round((Date.now() - new Date(ack.opened_at).getTime()) / 1000);
    const floor = minReadSeconds(post.body_en);
    const isSuspicious = secondsToAck < floor * SUSPICIOUS_RATIO || ack.tab_switched_away;

    await pool.query(
      `UPDATE acknowledgments SET
         acknowledged_at = now(), seconds_to_ack = $1, is_suspicious = $2
       WHERE post_id = $3 AND agent_id = $4`,
      [secondsToAck, isSuspicious, req.params.postId, req.user.agentId]
    );

    res.json({ success: true, secondsToAck, isSuspicious, quizPassed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to acknowledge post" });
  }
});

// Agent's own history ("My History" tab)
router.get("/mine", requireAuth("agent"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.type, p.title, p.ticket_no, a.acknowledged_at, a.opened_at
     FROM acknowledgments a JOIN posts p ON p.id = a.post_id
     WHERE a.agent_id = $1 ORDER BY a.opened_at DESC`,
    [req.user.agentId]
  );
  res.json(rows);
});

// --- Admin: Agent Read/Ack Tracker (the dedicated table with filters) ---
router.get("/tracker", requireAuth("admin"), async (req, res) => {
  const { postId, agentSearch, status, queue, minReadPct, maxReadPct } = req.query;

  try {
    if (postId) {
      // Per-post view: every agent's status for one specific post
      const { rows } = await pool.query(
        `SELECT ag.id AS agent_id, ag.wave_id, ag.name, ag.queue,
                a.acknowledged_at, a.seconds_to_ack, a.is_suspicious
         FROM agents ag
         LEFT JOIN acknowledgments a ON a.agent_id = ag.id AND a.post_id = $1
         WHERE ag.status = 'active'
           AND ($2::text IS NULL OR ag.queue = $2)
           AND ($3::text IS NULL OR ag.name ILIKE '%' || $3 || '%' OR ag.wave_id ILIKE '%' || $3 || '%')
         ORDER BY ag.name`,
        [postId, queue || null, agentSearch || null]
      );
      const filtered = status === "read" ? rows.filter((r) => r.acknowledged_at)
        : status === "not_read" ? rows.filter((r) => !r.acknowledged_at)
        : rows;
      return res.json({
        rows: filtered,
        summary: { read: rows.filter((r) => r.acknowledged_at).length, notRead: rows.filter((r) => !r.acknowledged_at).length },
      });
    }

    // Overview: per-agent read percentage across all published posts
    const { rows } = await pool.query(
      `SELECT ag.id AS agent_id, ag.wave_id, ag.name, ag.queue,
              COUNT(DISTINCT p.id) AS total_posts,
              COUNT(DISTINCT a.post_id) FILTER (WHERE a.acknowledged_at IS NOT NULL) AS read_posts
       FROM agents ag
       CROSS JOIN (SELECT id FROM posts WHERE status = 'published') p
       LEFT JOIN acknowledgments a ON a.agent_id = ag.id AND a.post_id = p.id
       WHERE ag.status = 'active'
         AND ($1::text IS NULL OR ag.queue = $1)
         AND ($2::text IS NULL OR ag.name ILIKE '%' || $2 || '%' OR ag.wave_id ILIKE '%' || $2 || '%')
       GROUP BY ag.id, ag.wave_id, ag.name, ag.queue
       ORDER BY ag.name`,
      [queue || null, agentSearch || null]
    );

    let result = rows.map((r) => ({
      ...r,
      readPct: r.total_posts > 0 ? Math.round((r.read_posts / r.total_posts) * 100) : 100,
    }));

    if (minReadPct) result = result.filter((r) => r.readPct >= Number(minReadPct));
    if (maxReadPct) result = result.filter((r) => r.readPct <= Number(maxReadPct));

    res.json({ rows: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load tracker" });
  }
});

module.exports = router;
