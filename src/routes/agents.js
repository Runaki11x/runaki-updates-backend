const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

async function logAudit(adminId, action, targetType, targetId, details = {}) {
  await pool.query(
    "INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5)",
    [adminId, action, targetType, targetId, details]
  );
}

// List agents with filters: queue, status, search
router.get("/", requireAuth("admin"), async (req, res) => {
  const { queue, status, search } = req.query;
  const clauses = [];
  const params = [];

  if (queue) { params.push(queue); clauses.push(`queue = $${params.length}`); }
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  if (search) { params.push(`%${search}%`); clauses.push(`(name ILIKE $${params.length} OR wave_id ILIKE $${params.length})`); }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT id, wave_id, name, email, queue, qa_officer, qa_tl, status, must_change_pw, created_at
       FROM agents ${where} ORDER BY name ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch agents" });
  }
});

// Create agent
router.post("/", requireAuth("admin"), async (req, res) => {
  const { waveId, name, email, queue, qaOfficer } = req.body;
  if (!waveId || !name || !queue) return res.status(400).json({ error: "waveId, name, and queue are required" });

  try {
    const passwordHash = await bcrypt.hash(waveId, 10);
    const { rows } = await pool.query(
      `INSERT INTO agents (wave_id, name, email, queue, qa_officer, password_hash, must_change_pw)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id, wave_id, name, queue`,
      [waveId, name, email || null, queue, qaOfficer || null, passwordHash]
    );
    await logAudit(req.user.adminId, "agent.create", "agent", rows[0].id, { waveId });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create agent (Wave ID may already exist)" });
  }
});

// Update agent (name, email, queue, qaOfficer, status/role)
router.put("/:id", requireAuth("admin"), async (req, res) => {
  const { name, email, queue, qaOfficer, status } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE agents SET
         name = COALESCE($1, name),
         email = COALESCE($2, email),
         queue = COALESCE($3, queue),
         qa_officer = COALESCE($4, qa_officer),
         status = COALESCE($5, status)
       WHERE id = $6 RETURNING id, name, queue, status`,
      [name, email, queue, qaOfficer, status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Agent not found" });
    await logAudit(req.user.adminId, "agent.edit", "agent", req.params.id, req.body);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update agent" });
  }
});

// Delete agent
router.delete("/:id", requireAuth("admin"), async (req, res) => {
  try {
    await pool.query("DELETE FROM agents WHERE id = $1", [req.params.id]);
    await logAudit(req.user.adminId, "agent.delete", "agent", req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete agent" });
  }
});

// Force password reset -> resets to Wave ID default, forces change on next login
router.post("/:id/reset-password", requireAuth("admin"), async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT wave_id FROM agents WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Agent not found" });

    const newHash = await bcrypt.hash(rows[0].wave_id, 10);
    await pool.query("UPDATE agents SET password_hash = $1, must_change_pw = true WHERE id = $2", [newHash, req.params.id]);
    await logAudit(req.user.adminId, "agent.reset_password", "agent", req.params.id);
    res.json({ success: true, note: "Password reset to Wave ID default; agent must change on next login." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// Bulk action: reassign queue for multiple agents
router.post("/bulk/reassign-queue", requireAuth("admin"), async (req, res) => {
  const { agentIds, queue } = req.body;
  if (!Array.isArray(agentIds) || !queue) return res.status(400).json({ error: "agentIds[] and queue required" });

  try {
    await pool.query("UPDATE agents SET queue = $1 WHERE id = ANY($2::int[])", [queue, agentIds]);
    await logAudit(req.user.adminId, "agent.bulk_reassign", "agent", null, { agentIds, queue });
    res.json({ success: true, updated: agentIds.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Bulk reassign failed" });
  }
});

module.exports = router;
