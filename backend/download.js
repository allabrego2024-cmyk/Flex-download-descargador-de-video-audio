const express = require('express');
const router = express.Router();
const axios = require('axios');

/**
 * POST /api/download
 * Obtiene link de descarga desde Cobalt (sin procesar archivos en tu servidor)
 */
router.post('/', async (req, res) => {
    const { videoId, format } = req.body;

    if (!videoId) {
        return res.status(400).json({
            success: false,
            message: 'El videoId o URL es requerido'
        });
    }

    // Convertir ID a URL si es necesario
    const videoUrl = videoId.includes('http') ? videoId : `https://www.youtube.com/watch?v=${videoId}`;

    try {
        console.log(`🔄 Cobalt request: ${videoUrl} [${format}]`);

        // Llamada a API externa (no usa tu CPU/almacenamiento)
        const response = await axios.post('https://api.cobalt.tools/api/json', {
            url: videoUrl,
            downloadMode: format === 'mp3' ? 'audio' : 'video',
            audioFormat: 'mp3',
            videoQuality: '720'
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'MusicDown/1.0'
            },
            timeout: 30000 // 30 segundos máximo
        });

        if (response.data?.url) {
            // ✅ IMPORTANTE: El usuario descarga DIRECTO desde Cobalt, no pasa por tu servidor
            return res.json({
                success: true,
                status: 'completed',
                downloadUrl: response.data.url,
                // Opcional: registrar en BD que se solicitó esta descarga
                // (pero no guardes el archivo en tu servidor)
            });
        } else {
            throw new Error('La API no devolvió un link de descarga');
        }

    } catch (error) {
        console.error('❌ Error con Cobalt:', error.message);
        
        // Manejo de errores específico
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({
                success: false,
                message: 'Tiempo de espera agotado. Intenta con otro video.'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'No se pudo procesar la descarga. Intenta más tarde.'
        });
    }
});

/**
 * GET /api/download/status/:downloadId
 * Compatibilidad con frontend (siempre "completado" porque Cobalt es instantáneo)
 */
router.get('/status/:downloadId', (req, res) => {
    res.json({
        success: true,
        status: 'completed',
        percent: 100,
        message: 'Usa el downloadUrl recibido en la petición POST'
    });
});

module.exports = router;