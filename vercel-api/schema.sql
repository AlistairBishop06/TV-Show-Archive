CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  profile_picture text NOT NULL DEFAULT '',
  playback_source text NOT NULL DEFAULT 'vidfast',
  auto_switch_source boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS playback_source text NOT NULL DEFAULT 'vidfast';
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_switch_source boolean NOT NULL DEFAULT true;

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

CREATE TABLE IF NOT EXISTS watch_later (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  imdb_id text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('tv', 'movie')),
  show_id integer,
  name text NOT NULL,
  poster text NOT NULL DEFAULT '',
  backdrop text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  year text NOT NULL DEFAULT '',
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, imdb_id)
);

CREATE INDEX IF NOT EXISTS watch_later_user_added_idx ON watch_later(user_id, added_at DESC);

CREATE TABLE IF NOT EXISTS user_lists (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_lists_user_name_unique ON user_lists(user_id, lower(name));
CREATE INDEX IF NOT EXISTS user_lists_public_idx ON user_lists(is_public, updated_at DESC);

CREATE TABLE IF NOT EXISTS list_items (
  list_id uuid NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
  imdb_id text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('tv', 'movie')),
  show_id integer,
  name text NOT NULL,
  poster text NOT NULL DEFAULT '',
  backdrop text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  year text NOT NULL DEFAULT '',
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, imdb_id)
);

CREATE INDEX IF NOT EXISTS list_items_list_added_idx ON list_items(list_id, added_at DESC);

CREATE TABLE IF NOT EXISTS media_comments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  imdb_id text NOT NULL,
  media_name text NOT NULL,
  episode_name text NOT NULL DEFAULT '',
  comment_scope text NOT NULL CHECK (comment_scope IN ('series', 'episode')),
  season integer,
  episode integer,
  comment_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (comment_scope = 'series' AND season IS NULL AND episode IS NULL)
    OR
    (comment_scope = 'episode' AND season > 0 AND episode > 0)
  )
);

CREATE INDEX IF NOT EXISTS media_comments_thread_idx
  ON media_comments(imdb_id, comment_scope, season, episode, created_at DESC);

CREATE INDEX IF NOT EXISTS media_comments_user_idx
  ON media_comments(user_id, created_at DESC);
