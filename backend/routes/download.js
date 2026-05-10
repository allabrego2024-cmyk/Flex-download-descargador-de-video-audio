const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../proyecto -descargador/backend/database');
const { downloadMP3, downloadMP4, getVideoInfo } = require('../proyecto -descargador/backend/downloader');

const activeDownloads = new Map();

// POST /api/download
router.post('/download', async (req, res) => {
    try {
        const { videoId, title, format, quality = '320kbps' } = req.body;

        if (!videoId || !format) {
            return res.status(400).json({ success: false, message: 'Faltan parámetros' });
        }

        const downloadKey = `${videoId}_${format}_${quality}`;

        if (activeDownloads.has(downloadKey)) {
            return res.json({ success: true, message: 'Descarga en progreso', downloadId: downloadKey });
        }

        const existing = db.prepare(`
            SELECT d.*, s.title FROM downloads d 
            JOIN songs s ON d.song_id = s.id 
            WHERE s.yt_video_id = ? AND d.format = ?
        `).get(videoId, format);

        if (existing && fs.existsSync(existing.file_path)) {
            return res.json({
                success: true, status: 'ready',
                downloadId: `existing_${existing.id}`,
                downloadUrl: `/api/download/file/${existing.id}`
            });
        }

        let videoTitle = title || 'unknown';
        let artist = 'Unknown';

        if (!title) {
            const info = await getVideoInfo(videoId);
            if (info) {
                videoTitle = info.title;
                artist = info.artist;
            }
        }

        let song = db.prepare('SELECT id FROM songs WHERE yt_video_id = ?').get(videoId);
        if (!song) {
            const result = db.prepare('INSERT INTO songs (yt_video_id, title, artist) VALUES (?, ?, ?)').run(videoId, videoTitle, artist);
            song = { id: result.lastInsertRowid };
        }

        activeDownloads.set(downloadKey, { progress: 0, status: 'starting' });

        const downloadFn = format === 'mp3' ? downloadMP3 : downloadMP4;

        downloadFn(videoId, videoTitle, quality, (update) => {
            activeDownloads.set(downloadKey, { ...activeDownloads.get(downloadKey), ...update, status: 'downloading' });
        })
        .then((result) => {
            db.prepare(`
                INSERT INTO downloads (song_id, format, quality, file_path, file_size, ip_address)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(song.id, result.format, result.quality, result.filePath, result.fileSize, req.ip);

            const dbRecord = db.prepare('SELECT id FROM downloads ORDER BY id DESC LIMIT 1').get();
            activeDownloads.set(downloadKey, { ...result, status: 'completed', downloadId: dbRecord.id });
            setTimeout(() => activeDownloads.delete(downloadKey), 300000);
        })
        .catch((error) => {
            console.error('❌ Download error:', error.message);
            activeDownloads.set(downloadKey, { status: 'error', error: error.message });
            setTimeout(() => activeDownloads.delete(downloadKey), 60000);
        });

        res.json({ success: true, message: 'Descarga iniciada', downloadId: downloadKey });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al iniciar descarga' });
    }
});

// GET /api/download/status/:downloadId
router.get('/download/status/:downloadId', (req, res) => {
    const { downloadId } = req.params;
    const status = activeDownloads.get(downloadId);

    if (!status) {
        const record = db.prepare(`
            SELECT d.*, s.title FROM downloads d 
            JOIN songs s ON d.song_id = s.id WHERE d.id = ?
        `).get(parseInt(downloadId));

        if (record) {
            return res.json({
                success: true, status: 'completed', percent: 100,
                downloadUrl: `/api/download/file/${record.id}`
            });
        }
        return res.json({ success: true, status: 'not_found' });
    }

    res.json({
        success: true, status: status.status, percent: status.percent || 0,
        ...(status.downloadId && { downloadUrl: `/api/download/file/${status.downloadId}` })
    });
});

// GET /api/download/file/:id
router.get('/download/file/:id', (req, res) => {
    try {
        const record = db.prepare(`
            SELECT d.*, s.title FROM downloads d 
            JOIN songs s ON d.song_id = s.id WHERE d.id = ?
        `).get(parseInt(req.params.id));

        if (!record || !fs.existsSync(record.file_path)) {
            return res.status(404).json({ success: false, message: 'Archivo no encontrado' });
        }

        const ext = record.format === 'mp3' ? 'mp3' : 'mp4';
        res.setHeader('Content-Type', record.format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(record.title)}.${ext}"`);
        
        fs.createReadStream(record.file_path).pipe(res);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error' });
    }
});

// GET /api/download/stream/:videoId
router.get('/download/stream/:videoId', async (req, res) => {
    try {
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);

        const command = `yt-dlp -f bestaudio --get-url "https://www.youtube.com/watch?v=${req.params.videoId}"`;
        const { stdout } = await execAsync(command, { timeout: 15000 });
        
        if (stdout.trim()) {
            res.redirect(stdout.trim());
        } else {
            res.status(404).json({ success: false, message: 'No se pudo obtener el stream' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener stream' });
    }
});

module.exports = router;