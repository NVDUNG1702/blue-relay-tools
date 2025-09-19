import express from 'express';
import { iCloudController } from '@blue-relay-tools/controllers/iCloudController';
const router = express.Router();
router.get('/info', iCloudController.getICloudInfo);
router.get('/status', iCloudController.checkICloudStatus);
router.get('/device', iCloudController.getDeviceInfo);
router.get('/test', iCloudController.testICloudConnection);
router.get('/services', iCloudController.getICloudServices);
export default router;
//# sourceMappingURL=iCloudRoutes.js.map