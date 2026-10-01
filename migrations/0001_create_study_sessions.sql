CREATE TABLE study_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_study_sessions_user_created
ON study_sessions(user_id, created_at);
