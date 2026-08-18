const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { sign } = require("../middleware/auth");

const router = express.Router();
// Unified login — one field, one password. Tries agent (by Wave ID) first, then
// admin (by username). The person never has to declare which kind of account
// they are, so the login page itself gives no signal that an admin login exists.
router.post("/login", async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.status(400).json({ error: "Both fields are required" });

  try {
    const agentRes = await pool.query("SELECT * FROM agents WHERE wave_id = $1", [identifier.trim()]);
    const agent = agentRes.rows[0];
    if (agent) {
      if (agent.status === "disabled") return res.status(403).json({ error: "This account has been disabled" });
      const valid = await bcrypt.compare(password, agent.password_hash);
      if (valid) {
        await pool.query("INSERT INTO login_logs (agent_id, ip_address) VALUES ($1, $2)", [agent.id, req.ip]);
        const token = sign({ role: "agent", agentId: agent.id, waveId: agent.wave_id, name: agent.name, queue: agent.queue });
        return res.json({
          token,
          role: "agent",
          agent: {
            id: agent.id, name: agent.name, waveId: agent.wave_id,
            queue: agent.queue, mustChangePassword: agent.must_change_pw,
          },
        });
      }
    }

    const adminRes = await pool.query("SELECT * FROM admins WHERE username = $1", [identifier.trim()]);
    const admin = adminRes.rows[0];
    if (admin) {
      const valid = await bcrypt.compare(password, admin.password_hash);
      if (valid) {
        const token = sign({ role: "admin", adminId: admin.id, username: admin.username, name: admin.name });
        return res.json({ token, role: "admin", admin: { id: admin.id, name: admin.name, username: admin.username } });
      }
    }

    // Deliberately identical message whether the identifier doesn't exist at all,
    // exists but wrong password, or belongs to the other account type — no signal leaked.
    return res.status(401).json({ error: "Invalid ID or password" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// Agent login — Wave ID + password (default password = Wave ID on first login)
router.post("/agent/login", async (req, res) => {
  const { waveId, password } = req.body;
  if (!waveId || !password) return res.status(400).json({ error: "Wave ID and password required" });

  try {
    const { rows } = await pool.query("SELECT * FROM agents WHERE wave_id = $1", [waveId.trim()]);
    const agent = rows[0];
    if (!agent) return res.status(401).json({ error: "Invalid Wave ID or password" });
    if (agent.status === "disabled") return res.status(403).json({ error: "This account has been disabled" });

    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid Wave ID or password" });

    await pool.query("INSERT INTO login_logs (agent_id, ip_address) VALUES ($1, $2)", [agent.id, req.ip]);

    const token = sign({ role: "agent", agentId: agent.id, waveId: agent.wave_id, name: agent.name, queue: agent.queue });
    res.json({
      token,
      agent: {
        id: agent.id,
        name: agent.name,
        waveId: agent.wave_id,
        queue: agent.queue,
        mustChangePassword: agent.must_change_pw,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// Admin login — username + password (Miran only, single-admin model)
router.post("/admin/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  try {
    const { rows } = await pool.query("SELECT * FROM admins WHERE username = $1", [username.trim()]);
    const admin = rows[0];
    if (!admin) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = sign({ role: "admin", adminId: admin.id, username: admin.username, name: admin.name });
    res.json({ token, admin: { id: admin.id, name: admin.name, username: admin.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// Agent's first-login forced password change
router.post("/agent/change-password", async (req, res) => {
  const { waveId, currentPassword, newPassword } = req.body;
  if (!waveId || !currentPassword || !newPassword) {
    return res.status(400).json({ error: "All fields required" });
  }
  try {
    const { rows } = await pool.query("SELECT * FROM agents WHERE wave_id = $1", [waveId.trim()]);
    const agent = rows[0];
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const valid = await bcrypt.compare(currentPassword, agent.password_hash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE agents SET password_hash = $1, must_change_pw = false WHERE id = $2", [newHash, agent.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Password change failed" });
  }
});

module.exports = router;
