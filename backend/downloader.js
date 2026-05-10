const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');

const execAsync = util.promisify(exec);

const DOWNLOAD_DIR = path.join(__dirname, '..', process.env.DOWNLOAD_DIR || './downloads');

// Asegurar que la carpeta de descargas exista
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

/**
 * Buscar videos en YouTube
 */
async function searchYouTube(query) {
    try {
        const command = `${process.env.YTDL_PATH || 'yt-dlp'} \
            --dump-json \
            --flat-playlist \
            --default-search ytsearch10 \
            "${query}"`;

        const { stdout } = await execAsync(command, { timeout: 15000 });
        const lines = stdout.trim().split('\n').filter(line => line.trim());
        
        return lines.map(line => {
            try {
                const data = JSON.parse(line);
                return {
                    videoId: data.id,
                    title: data.title,
                    artist: extractArtist(data.title),
                    duration: formatDuration(data.duration),
                    durationSec: data.duration,
                    thumbnail: data.thumbnails?.[data.thumbnails.length - 2]?.url || 
                              data.thumbnail || '',
                    views: data.view_count || 0,
                    url: `https://www.youtube.com/watch?v=${data.id}`
                };
            } catch {
                return null;
            }
        }).filter(Boolean);
    } catch (error) {
        console.error('❌ Error buscando en YouTube:', error.message);
        return [];
    }
}

/**
 * Obtener información de un video específico
 */
async function getVideoInfo(videoId) {
    try {
        const command = `${process.env.YTDL_PATH || 'yt-dlp'} \
            --dump-json \
            "https://www.youtube.com/watch?v=${videoId}"`;

        const { stdout } = await execAsync(command, { timeout: 10000 });
        const data = JSON.parse(stdout);

        return {
            videoId: data.id,
            title: data.title,
            artist: extractArtist(data.title),
            duration: formatDuration(data.duration),
            durationSec: data.duration,
            thumbnail: data.thumbnails?.[data.thumbnails.length - 2]?.url || 
                      data.thumbnail || '',
            views: data.view_count || 0,
            url: data.webpage_url,
            description: data.description?.substring(0, 200) || ''
        };
    } catch (error) {
        console.error('❌ Error obteniendo info del video:', error.message);
        return null;
    }
}

/**
 * Descargar y convertir a MP3
 */
function downloadMP3(videoId, title, onProgress) {
    return new Promise((resolve, reject) => {
        const safeTitle = sanitizeFilename(title);
        const outputPath = path.join(DOWNLOAD_DIR, 'mp3', `${safeTitle}.%(ext)s`);

        if (!fs.existsSync(path.join(DOWNLOAD_DIR, 'mp3'))) {
            fs.mkdirSync(path.join(DOWNLOAD_DIR, 'mp3'), { recursive: true });
        }

        const args = [
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            '--no-playlist',
            '--no-warnings',
            '--output', outputPath,
            '--progress-template', '%(progress._percent_str)s %(progress._eta_str)s',
            `https://www.youtube.com/watch?v=${videoId}`
        ];

        const process = spawn(process.env.YTDL_PATH || 'yt-dlp', args);
        let lastProgress = 0;

        process.stdout.on('data', (data) => {
            const output = data.toString();
            const match = output.match(/([\d.]+)%/);
            if (match) {
                const percent = parseFloat(match[1]);
                if (percent !== lastProgress && onProgress) {
                    lastProgress = percent;
                    onProgress({ type: 'progress', percent: Math.round(percent) });
                }
            }
        });

        process.stderr.on('data', (data) => {
            const output = data.toString();
            const match = output.match(/([\d.]+)%/);
            if (match) {
                const percent = parseFloat(match[1]);
                if (percent !== lastProgress && onProgress) {
                    lastProgress = percent;
                    onProgress({ type: 'progress', percent: Math.round(percent) });
                }
            }
        });

        process.on('close', (code) => {
            if (code === 0) {
                // Buscar el archivo descargado
                const mp3Dir = path.join(DOWNLOAD_DIR, 'mp3');
                const files = fs.readdirSync(mp3Dir)
                    .filter(f => f.startsWith(safeTitle) && f.endsWith('.mp3'));
                
                if (files.length > 0) {
                    const filePath = path.join(mp3Dir, files[0]);
                    const stats = fs.statSync(filePath);
                    resolve({
                        success: true,
                        filePath,
                        fileName: files[0],
                        fileSize: stats.size,
                        format: 'mp3',
                        quality: '320kbps'
                    });
                } else {
                    reject(new Error('Archivo MP3 no encontrado después de la descarga'));
                }
            } else {
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });

        process.on('error', reject);
    });
}

/**
 * Descargar video en MP4
 */
function downloadMP4(videoId, title, quality = '720p', onProgress) {
    return new Promise((resolve, reject) => {
        const safeTitle = sanitizeFilename(title);
        const outputPath = path.join(DOWNLOAD_DIR, 'mp4', `${safeTitle}.%(ext)s`);

        if (!fs.existsSync(path.join(DOWNLOAD_DIR, 'mp4'))) {
            fs.mkdirSync(path.join(DOWNLOAD_DIR, 'mp4'), { recursive: true });
        }

        const formatMap = {
            '1080p': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
            '720p': 'bestvideo[height<=720]+bestaudio/best[height<=720]',
            '480p': 'bestvideo[height<=480]+bestaudio/best[height<=480]',
            '360p': 'bestvideo[height<=360]+bestaudio/best[height<=360]'
        };

        const args = [
            '-f', formatMap[quality] || formatMap['720p'],
            '--merge-output-format', 'mp4',
            '--no-playlist',
            '--no-warnings',
            '--output', outputPath,
            '--progress-template', '%(progress._percent_str)s %(progress._eta_str)s',
            `https://www.youtube.com/watch?v=${videoId}`
        ];

        const process = spawn(process.env.YTDL_PATH || 'yt-dlp', args);
        let lastProgress = 0;

        process.stdout.on('data', (data) => {
            const output = data.toString();
            const match = output.match(/([\d.]+)%/);
            if (match) {
                const percent = parseFloat(match[1]);
                if (percent !== lastProgress && onProgress) {
                    lastProgress = percent;
                    onProgress({ type: 'progress', percent: Math.round(percent) });
                }
            }
        });

        process.stderr.on('data', (data) => {
            const output = data.toString();
            const match = output.match(/([\d.]+)%/);
            if (match) {
                const percent = parseFloat(match[1]);
                if (percent !== lastProgress && onProgress) {
                    lastProgress = percent;
                    onProgress({ type: 'progress', percent: Math.round(percent) });
                }
            }
        });

        process.on('close', (code) => {
            if (code === 0) {
                const mp4Dir = path.join(DOWNLOAD_DIR, 'mp4');
                const files = fs.readdirSync(mp4Dir)
                    .filter(f => f.startsWith(safeTitle) && f.endsWith('.mp4'));
                
                if (files.length > 0) {
                    const filePath = path.join(mp4Dir, files[0]);
                    const stats = fs.statSync(filePath);
                    resolve({
                        success: true,
                        filePath,
                        fileName: files[0],
                        fileSize: stats.size,
                        format: 'mp4',
                        quality
                    });
                } else {
                    reject(new Error('Archivo MP4 no encontrado después de la descarga'));
                }
            } else {
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });

        process.on('error', reject);
    });
}

/**
 * Obtener todos los archivos descargados
 */
function getDownloadedFiles(format = 'all') {
    const files = [];
    const formats = format === 'all' ? ['mp3', 'mp4'] : [format];

    formats.forEach(fmt => {
        const dir = path.join(DOWNLOAD_DIR, fmt);
        if (fs.existsSync(dir)) {
            const dirFiles = fs.readdirSync(dir)
                .filter(f => f.endsWith(fmt === 'mp3' ? '.mp3' : '.mp4'))
                .map(f => ({
                    name: f,
                    format: fmt,
                    size: fs.statSync(path.join(dir, f)).size,
                    path: path.join(dir, f)
                }));
            files.push(...dirFiles);
        }
    });

    return files;
}

// ===== UTILIDADES =====

function sanitizeFilename(filename) {
    return filename
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 100)
        .toLowerCase();
}

function extractArtist(title) {
    // Intentar extraer artista del título (formato "Artista - Título")
    const parts = title.split(/\s*[-–—]\s*/);
    return parts.length > 1 ? parts[0].trim() : 'Artista Desconocido';
}

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

module.exports = {
    searchYouTube,
    getVideoInfo,
    downloadMP3,
    downloadMP4,
    getDownloadedFiles
};