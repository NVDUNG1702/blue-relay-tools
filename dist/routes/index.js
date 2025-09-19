import express from 'express';
import healthRoutes from '@blue-relay-tools/routes/healthRoutes';
import messageRoutes from '@blue-relay-tools/routes/messageRoutes';
import imessageRoutes from '@blue-relay-tools/routes/imessageRoutes';
import iCloudRoutes from '@blue-relay-tools/routes/iCloudRoutes';
const router = express.Router();
router.use('/', healthRoutes);
router.use('/', messageRoutes);
router.use('/', imessageRoutes);
router.use('/icloud', iCloudRoutes);
export default router;
//# sourceMappingURL=index.js.map