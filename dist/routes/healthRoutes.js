import express from 'express';
import { getNgrokUrl } from '@blue-relay-tools/config/ngrok';
import { APP_CONFIG } from '@blue-relay-tools/config/app';
const router = express.Router();
router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0', environment: APP_CONFIG.NODE_ENV });
});
router.get('/ngrok-url', (_req, res) => {
    res.json({ success: true, ngrokUrl: getNgrokUrl(), localUrl: `http://localhost:${APP_CONFIG.PORT}`, hasNgrok: !!getNgrokUrl() });
});
router.get('/info', (_req, res) => {
    res.json({ success: true, server: { version: '2.0.0', environment: APP_CONFIG.NODE_ENV, port: APP_CONFIG.PORT, features: { websocket: APP_CONFIG.ENABLE_WEBSOCKET, databaseMonitoring: APP_CONFIG.ENABLE_DATABASE_MONITORING, ngrok: APP_CONFIG.ENABLE_NGROK } }, timestamp: new Date().toISOString() });
});
export default router;
//# sourceMappingURL=healthRoutes.js.map