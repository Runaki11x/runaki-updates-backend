-- Runaki Updates & Scripts Portal — Database Schema
-- Single admin model: Miran (QA Team Lead) is the only content/agent manager.

CREATE TABLE IF NOT EXISTS agents (
  id              SERIAL PRIMARY KEY,
  wave_id         VARCHAR(10) UNIQUE NOT NULL,
  name            VARCHAR(150) NOT NULL,
  email           VARCHAR(150),
  queue           VARCHAR(20) NOT NULL CHECK (queue IN ('Sorani','Badini','Arabic')),
  qa_officer      VARCHAR(60),
  coordinator     VARCHAR(60),
  qa_tl           VARCHAR(60) DEFAULT 'Miran Sardar',
  password_hash   TEXT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','onboarding','disabled')),
  must_change_pw  BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(60) UNIQUE NOT NULL,
  name            VARCHAR(100) NOT NULL,
  password_hash   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Updates / Scripts / FAQ are all "posts" with a type, so admin CRUD and the
-- tracker can treat them uniformly while the agent UI still splits by tab.
CREATE TABLE IF NOT EXISTS posts (
  id                SERIAL PRIMARY KEY,
  type              VARCHAR(20) NOT NULL CHECK (type IN ('update','script','faq')),
  title             VARCHAR(200) NOT NULL,
  body_en           TEXT NOT NULL,
  body_sorani       TEXT,               -- used by FAQ (Sorani+English) and optionally scripts
  priority          VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('critical','high','normal')),
  category_tag      VARCHAR(60),         -- e.g. "Legacy Debt Campaign", "Billing", "Technical"
  queue_tags        VARCHAR(20)[] DEFAULT '{}', -- subset of Sorani/Badini/Arabic; empty = all queues
  status            VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','archived')),
  requires_quiz     BOOLEAN NOT NULL DEFAULT false,
  quiz_question     TEXT,
  quiz_choices      JSONB,               -- ["choice a", "choice b", "choice c"]
  quiz_correct_idx  INT,
  ack_deadline      TIMESTAMPTZ,          -- null = no deadline
  publish_at        TIMESTAMPTZ,          -- for scheduled publishing
  published_at      TIMESTAMPTZ,
  archived_at       TIMESTAMPTZ,
  ticket_no         VARCHAR(12) UNIQUE,   -- e.g. TCKT-0417, auto-assigned on publish
  created_by        INT REFERENCES admins(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_versions (
  id           SERIAL PRIMARY KEY,
  post_id      INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  title        VARCHAR(200) NOT NULL,
  body_en      TEXT NOT NULL,
  body_sorani  TEXT,
  edited_by    INT REFERENCES admins(id),
  edited_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acknowledgments (
  id                 SERIAL PRIMARY KEY,
  post_id            INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  agent_id           INT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  opened_at          TIMESTAMPTZ,
  scrolled_to_end_at TIMESTAMPTZ,
  acknowledged_at    TIMESTAMPTZ,
  quiz_attempts      INT NOT NULL DEFAULT 0,
  quiz_passed        BOOLEAN,
  tab_switched_away  BOOLEAN NOT NULL DEFAULT false,
  seconds_to_ack      INT,               -- computed: acknowledged_at - opened_at
  is_suspicious      BOOLEAN NOT NULL DEFAULT false,  -- flagged if seconds_to_ack too low, etc.
  UNIQUE(post_id, agent_id)
);

CREATE TABLE IF NOT EXISTS login_logs (
  id          SERIAL PRIMARY KEY,
  agent_id    INT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  logged_in_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  logged_out_at TIMESTAMPTZ,
  ip_address  VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS script_feedback (
  id          SERIAL PRIMARY KEY,
  post_id     INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  agent_id    INT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  helpful     BOOLEAN NOT NULL,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          SERIAL PRIMARY KEY,
  admin_id    INT REFERENCES admins(id),
  action      VARCHAR(100) NOT NULL,     -- e.g. "post.publish", "agent.edit", "agent.reset_password"
  target_type VARCHAR(40),
  target_id   INT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_checklist (
  id          SERIAL PRIMARY KEY,
  post_id     INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  is_required BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_ack_post ON acknowledgments(post_id);
CREATE INDEX IF NOT EXISTS idx_ack_agent ON acknowledgments(agent_id);
CREATE INDEX IF NOT EXISTS idx_login_agent ON login_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_posts_type_status ON posts(type, status);
