-- ESTRUCTURA DE radio.db

CREATE TABLE songs (
  id INTEGER PRIMARY KEY,
  title TEXT,
  artist TEXT,
  filename TEXT,
  duration INTEGER,
  plays INTEGER,
  added_at DATETIME
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE playlist_songs (
  playlist_id INTEGER,
  song_id INTEGER,
  position INTEGER
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  password TEXT,
  role TEXT
);

CREATE TABLE recordings (
  id INTEGER PRIMARY KEY,
  filename TEXT,
  size INTEGER,
  duration INTEGER,
  created_at DATETIME
);

CREATE TABLE ads (
  id INTEGER PRIMARY KEY,
  image TEXT,
  link TEXT,
  title TEXT,
  active INTEGER,
  created_at DATETIME
);

CREATE TABLE playlists (
  id INTEGER PRIMARY KEY,
  name TEXT,
  description TEXT,
  created_at DATETIME
);

