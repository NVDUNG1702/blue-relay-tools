import express from 'express';
import { iCloudController } from '../controllers/iCloudController.js';

const router = express.Router();

// iCloud detection endpoints
router.get('/info', iCloudController.getICloudInfo);
router.get('/status', iCloudController.checkICloudStatus);
router.get('/device', iCloudController.getDeviceInfo);
router.get('/test', iCloudController.testICloudConnection);
router.get('/services', iCloudController.getICloudServices);

export default router; 