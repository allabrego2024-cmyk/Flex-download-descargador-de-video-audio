require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

// Importar rutas
const apiRoutes = require('./api');
const downloadRoutes = require('./download');

// Crear servidor
const app = express();
const PORT = process.env.PORT || 3000;

// Directorio de descargas
const downloadsDir = process.env.DOWNLOADS_DIR || path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
}

// ===== MIDDLEWARE =====
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Demasiadas peticiones, intenta más tarde' }
});

const downloadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: parseInt(process.env.MAX_DOWNLOADS_PER_HOUR) || 50,
    message: { success: false, message: 'Límite de descargas alcanzado' }
});

// ===== RUTAS =====

// Health check (Render lo usa para verificar que tu app está viva)
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'online',
        cloud: true,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Rutas API - SIN DUPLICAR PREFIX
// api.js debe definir rutas como: router.get('/search', ...) → se accede como /api/search
app.use('/api', apiLimiter, apiRoutes);

// Rutas de descarga - con su propio limiter
// download.js debe definir: router.post('/start', ...) → se accede como /api/download/start
app.use('/api/download', downloadLimiter, downloadRoutes);

// ===== SERVICIO DE FRONTEND =====
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// SPA fallback: sirve index.html para rutas que no son API
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.includes('.')) {
        res.sendFile(path.join(frontendPath, 'index.html'));
    }
});

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.message);
    res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'production' 
            ? 'Error interno del servidor' 
            : err.message
    });
});

// ===== INICIAR SERVIDOR =====
app.listen(PORT, '0.0.0.0', () => {
    console.log('╔══════════════════════════════════════╗');
    console.log('🎵  MusicDown Backend - Render Ready   ');
    console.log('╚══════════════════════════════════════╝');
    console.log(`🚀 Puerto: ${PORT}`);
    console.log(`📁 Descargas: ${downloadsDir}`);
    console.log(`🌐 Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log('══════════════════════════════════════');
});

module.exports = app;