-- Schema for genetic collaboration workflow
-- Designed to store agents, customers, employees, and tasks with flexible metadata

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  configuration TEXT NOT NULL,          -- serialized config or prompt text
  photo_color TEXT,                     -- hex or CSS color associated with avatar
  bio TEXT,
  meta JSON,                            -- arbitrary nested data (use TEXT if JSON not supported)
  model TEXT NOT NULL,                  -- e.g., gpt-4o, llama3
  provider TEXT NOT NULL,               -- e.g., openai, local, anthropic
  role TEXT,                            -- functional role within the collaboration
  supervisor_id INTEGER,                -- self-referential supervisor/lead
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supervisor_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  configuration TEXT NOT NULL,
  photo_color TEXT,
  bio TEXT,
  meta JSON,
  role TEXT,                            -- customer-facing equivalent of role
  supervisor_id INTEGER,                -- account owner / sponsor
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supervisor_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  configuration TEXT NOT NULL,
  photo_color TEXT,
  bio TEXT,
  meta JSON,
  role TEXT,                            -- employee title or duties
  supervisor_id INTEGER,                -- manager
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supervisor_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT CHECK(status IN ('todo','in_progress','blocked','done')) DEFAULT 'todo',
  priority TEXT CHECK(priority IN ('low','medium','high','urgent')) DEFAULT 'medium',
  due_date DATETIME,
  created_by_agent_id INTEGER,
  created_by_employee_id INTEGER,
  meta JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_agent_id) REFERENCES agents(id),
  FOREIGN KEY (created_by_employee_id) REFERENCES employees(id)
);

-- Flexible assignment table that can point tasks at any participant type
CREATE TABLE IF NOT EXISTS task_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  assignee_type TEXT CHECK(assignee_type IN ('agent','customer','employee')) NOT NULL,
  assignee_id INTEGER NOT NULL,
  role TEXT,                -- e.g., owner, reviewer, approver
  meta JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Simple history of decisions for auditable collaboration
CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  actor_type TEXT CHECK(actor_type IN ('agent','customer','employee')) NOT NULL,
  actor_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,             -- created, updated, delegated, comment
  payload JSON,                         -- structured details
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
