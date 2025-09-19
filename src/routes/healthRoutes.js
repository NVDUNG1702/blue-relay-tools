import express from 'express';
import { getNgrokUrl } from '../config/ngrok.js';
import { APP_CONFIG } from '../config/app.js';

const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        environment: APP_CONFIG.NODE_ENV
    });
});

// Ngrok URL endpoint
router.get('/ngrok-url', (req, res) => {
    res.json({
        success: true,
        ngrokUrl: getNgrokUrl(),
        localUrl: `http://localhost:${APP_CONFIG.PORT}`,
        hasNgrok: !!getNgrokUrl()
    });
});

// Server info endpoint
router.get('/info', (req, res) => {
    res.json({
        success: true,
        server: {
            version: '2.0.0',
            environment: APP_CONFIG.NODE_ENV,
            port: APP_CONFIG.PORT,
            features: {
                websocket: APP_CONFIG.ENABLE_WEBSOCKET,
                databaseMonitoring: APP_CONFIG.ENABLE_DATABASE_MONITORING,
                ngrok: APP_CONFIG.ENABLE_NGROK
            }
        },
        timestamp: new Date().toISOString()
    });
});

export default router; 