import express from 'express';
import messageController from '../controllers/messageController.js';
import { authenticateApiKey } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateApiKey);

// Message routes
router.post('/send', (req, res, next) => {
    console.log('[HTTP] /api/send payload', {
        to: req?.body?.to,
        bodyPreview: typeof req?.body?.body === 'string' ? req.body.body.slice(0, 120) : req?.body?.body,
        at: new Date().toISOString()
    });
    return messageController.sendMessage(req, res).catch((err) => {
        console.error('[HTTP] /api/send error', err?.message || err);
        next(err);
    });
});
router.get('/logs', messageController.getLogs);
router.delete('/logs', messageController.clearLogs);

// Conversation routes
router.get('/conversations', messageController.getConversations);
router.get('/conversations/detailed', messageController.getDetailedConversations);
router.get('/conversations/:sender/messages', messageController.getMessages);
router.post('/conversations/:sender/mark-read', messageController.markAsRead);

export default router;