const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth("admin"), async (req, res) => {
  const { action, search } = req.query;
  const clauses = [];
  const params = [];

  if (action) { params.push(`%${action}%`); clauses.push(`(al.action ILIKE $${params.length} OR al.target_type ILIKE $${params.length})`); }
  if (search) { params.push(`%${search}%`); clauses.push(`al.details::text ILIKE $${params.length}`); }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(
      `SELECT al.id, al.action, al.target_type, al.target_id, al.details, al.created_at, ad.name AS admin_name
       FROM admin_audit_log al
       LEFT JOIN admins ad ON ad.id = al.admin_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load audit log" });
  }
});

module.exports = router;