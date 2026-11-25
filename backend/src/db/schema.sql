CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  status TEXT NOT NULL,
  leader_agent_id TEXT
);

CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  assigned_agent_id TEXT,
  status TEXT NOT NULL,
  result_path TEXT NOT NULL,
  done_marker TEXT NOT NULL,
  model TEXT,
  depends_on TEXT,
  agent_kind TEXT,
  phase TEXT
);