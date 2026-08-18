CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
  ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS watch_history (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  imdb_id text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('tv', 'movie')),
  show_id integer,
  name text NOT NULL,
  poster text NOT NULL DEFAULT '',
  backdrop text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  year text NOT NULL DEFAULT '',
  season integer,
  episode integer,
  episode_name text NOT NULL DEFAULT '',
  position_seconds double precision NOT NULL DEFAULT 0,
  duration double precision NOT NULL DEFAULT 0,
  last_watched timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, imdb_id)
);

CREATE INDEX IF NOT EXISTS watch_history_user_last_watched_idx
  ON watch_history(user_id, last_watched DESC);
