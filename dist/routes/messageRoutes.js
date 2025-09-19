import express from 'express';
import messageController from '@blue-relay-tools/controllers/messageController';
import { authenticateApiKey } from '@blue-relay-tools/middleware/auth';
const router = express.Router();
router.use(authenticateApiKey);
router.post('/send', messageController.sendMessage);
router.get('/logs', messageController.getLogs);
router.delete('/logs', messageController.clearLogs);
router.get('/conversations', messageController.getConversations);
router.get('/conversations/detailed', messageController.getDetailedConversations);
router.get('/conversations/:sender/messages', messageController.getMessages);
router.post('/conversations/:sender/mark-read', messageController.markAsRead);
export default router;
//# sourceMappingURL=messageRoutes.js.map