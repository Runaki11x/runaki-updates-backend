const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

async function nextTicketNo() {
  const { rows } = await pool.query("SELECT COALESCE(MAX(id), 400) + 1 AS n FROM posts");
  return `TCKT-${String(rows[0].n).padStart(4, "0")}`;
}

async function logAudit(adminId, action, targetId, details = {}) {
  await pool.query(
    "INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1,'post.action',$2,$3,$4)",
    [adminId, action, targetId, details]
  );
}

// Admin: list all posts (any status) with filters
router.get("/admin", requireAuth("admin"), async (req, res) => {
  const { type, status } = req.query;
  const clauses = [];
  const params = [];
  if (type) { params.push(type); clauses.push(`type = $${params.length}`); }
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query(`SELECT * FROM posts ${where} ORDER BY updated_at DESC`, params);
  res.json(rows);
});

// Agent-facing: published posts only, filtered by type + agent's queue
router.get("/", requireAuth("agent"), async (req, res) => {
  const { type } = req.query;
  const queue = req.user.queue;
  try {
    const { rows } = await pool.query(
      `SELECT p.*, a.acknowledged_at AS "myAcknowledgedAt"
       FROM posts p
       LEFT JOIN acknowledgments a ON a.post_id = p.id AND a.agent_id = $3
       WHERE p.type = $1 AND p.status = 'published'
         AND (p.queue_tags = '{}' OR $2 = ANY(p.queue_tags))
       ORDER BY p.priority = 'critical' DESC, p.published_at DESC`,
      [type, queue, req.user.agentId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// Create post (draft by default)
router.post("/", requireAuth("admin"), async (req, res) => {
  const {
    type, title, titleKurdish, bodyEn, bodyKurdish, kurdishDialect, priority, categoryTag, queueTags,
    requiresQuiz, quizQuestion, quizChoices, quizCorrectIdx, ackDeadline, publishAt, status,
  } = req.body;

  if (!type || !title || !bodyEn) return res.status(400).json({ error: "type, title, and bodyEn are required" });

  try {
    const { rows } = await pool.query(
      `INSERT INTO posts (type, title, title_kurdish, body_en, body_kurdish, kurdish_dialect, priority, category_tag, queue_tags,
         requires_quiz, quiz_question, quiz_choices, quiz_correct_idx, ack_deadline, publish_at, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        type, title, titleKurdish || null, bodyEn, bodyKurdish || null, kurdishDialect || null,
        priority || "normal", categoryTag || null, queueTags || [], !!requiresQuiz, quizQuestion || null,
        quizChoices ? JSON.stringify(quizChoices) : null, quizCorrectIdx ?? null, ackDeadline || null,
        publishAt || null, status || "draft", req.user.adminId,
      ]
    );
    await logAudit(req.user.adminId, "create", rows[0].id, { title });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create post" });
  }
});

// Update post — snapshots previous version first (version history)
router.put("/:id", requireAuth("admin"), async (req, res) => {
  const { title, titleKurdish, bodyEn, bodyKurdish, kurdishDialect, priority, categoryTag, queueTags, ackDeadline } = req.body;
  try {
    const existing = await pool.query("SELECT * FROM posts WHERE id = $1", [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ error: "Post not found" });

    await pool.query(
      `INSERT INTO post_versions (post_id, title, title_kurdish, body_en, body_kurdish, edited_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.params.id, existing.rows[0].title, existing.rows[0].title_kurdish, existing.rows[0].body_en, existing.rows[0].body_kurdish, req.user.adminId]
    );

    const { rows } = await pool.query(
      `UPDATE posts SET
         title = COALESCE($1, title), title_kurdish = COALESCE($2, title_kurdish),
         body_en = COALESCE($3, body_en), body_kurdish = COALESCE($4, body_kurdish),
         kurdish_dialect = COALESCE($5, kurdish_dialect),
         priority = COALESCE($6, priority), category_tag = COALESCE($7, category_tag),
         queue_tags = COALESCE($8, queue_tags), ack_deadline = COALESCE($9, ack_deadline), updated_at = now()
       WHERE id = $10 RETURNING *`,
      [title, titleKurdish, bodyEn, bodyKurdish, kurdishDialect, priority, categoryTag, queueTags, ackDeadline, req.params.id]
    );
    await logAudit(req.user.adminId, "edit", req.params.id, { title });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update post" });
  }
});

// Publish a draft/scheduled post now — assigns ticket number
router.post("/:id/publish", requireAuth("admin"), async (req, res) => {
  try {
    const ticketNo = await nextTicketNo();
    const { rows } = await pool.query(
      `UPDATE posts SET status = 'published', published_at = now(), ticket_no = COALESCE(ticket_no, $1)
       WHERE id = $2 RETURNING *`,
      [ticketNo, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Post not found" });
    await logAudit(req.user.adminId, "publish", req.params.id, { ticketNo });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to publish post" });
  }
});

// Archive a post (keeps it searchable but off the live list)
router.post("/:id/archive", requireAuth("admin"), async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE posts SET status = 'archived', archived_at = now() WHERE id = $1 RETURNING *",
    [req.params.id]
  );
  await logAudit(req.user.adminId, "archive", req.params.id);
  res.json(rows[0]);
});

router.delete("/:id", requireAuth("admin"), async (req, res) => {
  await pool.query("DELETE FROM posts WHERE id = $1", [req.params.id]);
  await logAudit(req.user.adminId, "delete", req.params.id);
  res.json({ success: true });
});

// Version history for a post
router.get("/:id/versions", requireAuth("admin"), async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM post_versions WHERE post_id = $1 ORDER BY edited_at DESC",
    [req.params.id]
  );
  res.json(rows);
});

module.exports = router;