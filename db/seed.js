// Seeds the `agents` table from raw_agents.tsv (the real Runaki roster).
// Default password for every agent = their Wave ID (must_change_pw = true,
// so this is a first-login-only default, not a permanent password).
//
// Run with:  node db/seed.js
require("dotenv").config();
console.log("DATABASE_URL =", process.env.DATABASE_URL);
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function main() {
  const raw = fs.readFileSync(path.join(__dirname, "raw_agents.tsv"), "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;

    for (const line of lines) {
      const cols = line.split("\t");
      if (cols.length < 7) continue;
      const [, name, email, queue, qaOfficer, qaTL, waveId] = cols;
      const passwordHash = await bcrypt.hash(waveId.trim(), 10);

      await client.query(
        `INSERT INTO agents (wave_id, name, email, queue, qa_officer, qa_tl, password_hash, status, must_change_pw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', true)
         ON CONFLICT (wave_id) DO NOTHING`,
        [waveId.trim(), name.trim(), email.trim(), queue.trim(), qaOfficer.trim(), qaTL.trim(), passwordHash]
      );
      inserted++;
    }

    // Default admin account for Miran — CHANGE THIS PASSWORD after first login.
    const adminPasswordHash = await bcrypt.hash(process.env.DEFAULT_ADMIN_PASSWORD || "runaki-admin-2026", 10);
    await client.query(
      `INSERT INTO admins (username, name, password_hash)
       VALUES ('miran', 'Miran Sardar', $1)
       ON CONFLICT (username) DO NOTHING`,
      [adminPasswordHash]
    );

    await client.query("COMMIT");
    console.log(`Seed complete. Processed ${inserted} agent rows. Admin user 'miran' ready.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
