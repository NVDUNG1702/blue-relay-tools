import express from 'express';
import messageController from '../controllers/messageController.js';
import { authenticateApiKey } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateApiKey);

// Message routes
router.post('/send', messageController.sendMessage);
router.get('/logs', messageController.getLogs);
router.delete('/logs', messageController.clearLogs);

// Conversation routes
router.get('/conversations', messageController.getConversations);
router.get('/conversations/detailed', messageController.getDetailedConversations);
router.get('/conversations/:sender/messages', messageController.getMessages);
router.post('/conversations/:sender/mark-read', messageController.markAsRead);

export default router;