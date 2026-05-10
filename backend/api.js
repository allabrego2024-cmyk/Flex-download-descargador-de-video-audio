const express = require('express');
const router = express.Router();

// ✅ CORRECCIÓN 1: Ruta correcta (database.js está en la misma carpeta)
const db = require('./database');
const { searchYouTube, getVideoInfo } = require('./downloader');

/**
 * GET /api/search?q=termino
 */
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'La búsqueda debe tener al menos 2 caracteres'
            });
        }

        // ✅ CORRECCIÓN 2: Manejo seguro de caché (sqlite3 es async)
        const getCached = new Promise((resolve, reject) => {
            db.get(
                'SELECT results FROM cache WHERE query = ? AND cached_at > datetime("now", "-1 hour")',
                [q.toLowerCase()],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });

        const cached = await getCached;

        if (cached) {
            return res.json({
                success: true,
                source: 'cache',
                results: JSON.parse(cached.results)
            });
        }

        // Buscar en YouTube
        const results = await searchYouTube(q);

        // Guardar en caché (solo si hay resultados)
        if (results.length > 0) {
            const setCache = new Promise((resolve, reject) => {
                db.run(
                    'INSERT OR REPLACE INTO cache (query, results, cached_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
                    [q.toLowerCase(), JSON.stringify(results)],
                    (err) => err ? reject(err) : resolve()
                );
            });
            await setCache;

            // Guardar canciones (transacción segura)
            const insertSong = db.prepare(`
                INSERT OR IGNORE INTO songs (yt_video_id, title, artist, duration, thumbnail, views, durationSec)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            const insertMany = db.transaction((songs) => {
                for (const song of songs) {
                    insertSong.run(
                        song.videoId, song.title, song.artist || '',
                        song.duration, song.thumbnail || '', song.views || 0, song.durationSec || 0
                    );
                }
            });

            await insertMany(results);
        }

        res.json({
            success: true,
            source: 'youtube',
            count: results.length,
            results
        });

    } catch (error) {
        console.error('❌ Error en búsqueda:', error);
        res.status(500).json({
            success: false,
            message: process.env.NODE_ENV === 'production' 
                ? 'Error al buscar. Inténtalo de nuevo.' 
                : error.message
        });
    }
});

/**
 * GET /api/video/:videoId
 */
router.get('/video/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;

        // Buscar en BD primero (async)
        const getCached = new Promise((resolve, reject) => {
            db.get('SELECT * FROM songs WHERE yt_video_id = ?', [videoId], 
                (err, row) => err ? reject(err) : resolve(row));
        });
        
        const cached = await getCached;

        if (cached) {
            return res.json({
                success: true,
                source: 'database',
                video: cached
            });
        }

        // Obtener de YouTube
        const info = await getVideoInfo(videoId);

        if (info) {
            const insert = new Promise((resolve, reject) => {
                db.run(`
                    INSERT OR IGNORE INTO songs (yt_video_id, title, artist, duration, thumbnail, views, durationSec)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [info.videoId, info.title, info.artist || '', info.duration, info.thumbnail || '', info.views || 0, info.durationSec || 0],
                (err) => err ? reject(err) : resolve());
            });
            await insert;
        }

        res.json({
            success: true,
            source: 'youtube',
            video: info
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: process.env.NODE_ENV === 'production'
                ? 'Error al obtener información del video'
                : error.message
        });
    }
});

/**
 * GET /api/trending
 */
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

        db.all(query, params, (err, songs) => {
            if (err) throw err;
            res.json({
                success: true,
                count: songs.length,
                results: songs
            });
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error al obtener tendencias'
        });
    }
});

/**
 * GET /api/stats
 */
router.get('/stats', (req, res) => {
    try {
        const queries = [
            new Promise((resolve) => db.get('SELECT COUNT(*) as count FROM songs', (err, row) => resolve(row?.count || 0))),
            new Promise((resolve) => db.get('SELECT COUNT(*) as count FROM downloads', (err, row) => resolve(row?.count || 0))),
            new Promise((resolve) => db.get('SELECT COALESCE(SUM(file_size), 0) as size FROM downloads', (err, row) => resolve(row?.size || 0)))
        ];

        Promise.all(queries).then(([totalSongs, totalDownloads, totalSize]) => {
            res.json({
                success: true,
                stats: {
                    totalSongs,
                    totalDownloads,
                    totalDownloadSize: `${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`
                }
            });
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error al obtener estadísticas'
        });
    }
});

module.exports = router;