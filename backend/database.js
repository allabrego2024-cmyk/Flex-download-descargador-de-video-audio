const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'musicdown.db');

const db = new Database(DB_PATH);

// Habilitar WAL mode para mejor rendimiento
db.pragma('journal_mode = WAL');

// Crear tablas
db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        yt_video_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        duration INTEGER,
        thumbnail TEXT,
        views INTEGER DEFAULT 0,
        format TEXT DEFAULT 'both',
        category TEXT DEFAULT 'unknown',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id INTEGER,
        format TEXT NOT NULL,
        quality TEXT NOT NULL,
        file_path TEXT,
        file_size INTEGER,
        ip_address TEXT,
        downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (song_id) REFERENCES songs(id)
    );

    CREATE TABLE IF NOT EXISTS cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT UNIQUE NOT NULL,
        results TEXT NOT NULL,
        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
    CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
    CREATE INDEX IF NOT EXISTS idx_songs_category ON songs(category);
    CREATE INDEX IF NOT EXISTS idx_downloads_song_id ON downloads(song_id);
`);

console.log('✅ Base de datos inicializada correctamente');

module.exports = db;