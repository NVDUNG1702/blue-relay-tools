import express from 'express';
import imessageController from '../controllers/imessageController.js';
import { authenticateApiKey } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateApiKey);

// iMessage routes
router.get('/check-imessage', imessageController.checkIMessageSupport);
router.get('/accounts', imessageController.getAccounts);
router.get('/conversations', imessageController.getConversations);
router.get('/raw/messages', imessageController.getRawMessages);
router.get('/messages/appscript', imessageController.getMessagesViaAppleScript);

export default router; 