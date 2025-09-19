import express from 'express';
import imessageController from '@blue-relay-tools/controllers/imessageController';
import { authenticateApiKey } from '@blue-relay-tools/middleware/auth';
const router = express.Router();
router.use(authenticateApiKey);
router.get('/check-imessage', imessageController.checkIMessageSupport);
router.get('/accounts', imessageController.getAccounts);
router.get('/conversations', imessageController.getConversations);
router.get('/raw/messages', imessageController.getRawMessages);
router.get('/messages/appscript', imessageController.getMessagesViaAppleScript);
export default router;
//# sourceMappingURL=imessageRoutes.js.map