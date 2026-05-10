const express = require('express');
const router = express.Router();
const db = require('../proyecto -descargador/backend/database');
const { searchYouTube, getVideoInfo } = require('../proyecto -descargador/backend/downloader');

// GET /api/search?q=termino
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.trim().length < 2) {
            return res.status(400).json({ success: false, message: 'Mínimo 2 caracteres' });
        }

        // Verificar caché (30 min en cloud)
        const cached = db.prepare(
            'SELECT results FROM cache WHERE query = ? AND cached_at > datetime("now", "-30 minutes")'
        ).get(q.toLowerCase());

        if (cached) {
            return res.json({ success: true, source: 'cache', results: JSON.parse(cached.results) });
        }

        const results = await searchYouTube(q);

        if (results.length > 0) {
            db.prepare('INSERT OR REPLACE INTO cache (query, results) VALUES (?, ?)')
                .run(q.toLowerCase(), JSON.stringify(results));

            const insertSong = db.prepare(`
                INSERT OR IGNORE INTO songs (yt_video_id, title, artist, duration, thumbnail, views, durationSec)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            results.forEach(song => {
                insertSong.run(song.videoId, song.title, song.artist, song.duration, song.thumbnail, song.views, song.durationSec);
            });
        }

        res.json({ success: true, source: 'youtube', count: results.length, results });
    } catch (error) {
        console.error('❌ Search error:', error);
        res.status(500).json({ success: false, message: 'Error al buscar' });
    }
});

// GET /api/video/:videoId
router.get('/video/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;
        const cached = db.prepare('SELECT * FROM songs WHERE yt_video_id = ?').get(videoId);

        if (cached) {
            return res.json({ success: true, source: 'database', video: cached });
        }

        const info = await getVideoInfo(videoId);
        if (info) {
            db.prepare(`
                INSERT OR IGNORE INTO songs (yt_video_id, title, artist, duration, thumbnail, views, durationSec)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(info.videoId, info.title, info.artist, info.duration, info.thumbnail, info.views, info.durationSec);
        }

        res.json({ success: true, source: 'youtube', video: info });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener video' });
    }
});

// GET /api/trending
router.get('/trending', (req, res) => {
    try {
        const { category = 'all', limit = 20 } = req.query;
        let query = 'SELECT * FROM songs';
        let params = [];

        if (category !== 'all') {
            query += ' WHERE category = ?';
            params.push(category);
        }

        query += ' ORDER BY views DESC LIMIT ?';
        params.push(parseInt(limit));

        const songs = db.prepare(query).all(...params);
        res.json({ success: true, count: songs.length, results: songs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error' });
    }
});

// GET /api/stats
router.get('/stats', (req, res) => {
    const totalSongs = db.prepare('SELECT COUNT(*) as count FROM songs').get();
    const totalDownloads = db.prepare('SELECT COUNT(*) as count FROM downloads').get();

    res.json({
        success: true,
        stats: {
            totalSongs: totalSongs.count,
            totalDownloads: totalDownloads.count
        }
    });
});

module.exports = router;