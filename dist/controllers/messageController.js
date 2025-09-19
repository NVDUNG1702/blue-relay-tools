import messageService from '@blue-relay-tools/services/messageService';
import messageParser from '@blue-relay-tools/utils/messageParser';
import logger from '@blue-relay-tools/utils/logger';
import { asyncHandler } from '@blue-relay-tools/middleware/errorHandler';
class MessageController {
    constructor() {
        this.sendMessage = asyncHandler(async (req, res) => {
            const { to, body } = req.body || {};
            const validation = messageParser.validateMessage({ to, body });
            if (!validation.isValid) {
                return res.status(400).json({ success: false, error: 'Validation failed', details: validation.errors });
            }
            const sanitizedBody = messageParser.sanitizeContent(body);
            const result = await messageService.sendMessage(to, sanitizedBody);
            if (result.success)
                res.json(result);
            else
                res.status(500).json(result);
        });
        this.getMessages = asyncHandler(async (req, res) => {
            const { sender } = req.params || {};
            const limit = parseInt(String((req.query || {}).limit)) || 50;
            if (!sender) {
                return res.status(400).json({ success: false, error: 'Sender parameter is required' });
            }
            const result = await messageService.getMessages(sender, limit);
            if (result.success)
                res.json(result);
            else
                res.status(500).json(result);
        });
        this.getConversations = asyncHandler(async (req, res) => {
            const limit = parseInt(String((req.query || {}).limit)) || 50;
            const result = await messageService.getConversations(limit);
            if (result.success)
                res.json(result);
            else
                res.status(500).json(result);
        });
        this.getDetailedConversations = asyncHandler(async (req, res) => {
            const limit = parseInt(String((req.query || {}).limit)) || 50;
            const result = await messageService.getConversations(limit);
            if (result.success) {
                const detailedConversations = (result.conversations || []).map((conv) => ({
                    ...conv,
                    lastMessage: conv.lastMessage || '',
                    unreadCount: conv.unreadCount || 0,
                    messageCount: conv.messageCount || 0
                }));
                res.json({ success: true, conversations: detailedConversations });
            }
            else {
                res.status(500).json(result);
            }
        });
        this.markAsRead = asyncHandler(async (req, res) => {
            const { sender } = req.params || {};
            if (!sender) {
                return res.status(400).json({ success: false, error: 'Sender parameter is required' });
            }
            const result = await messageService.markAsRead(sender);
            if (result.success)
                res.json(result);
            else
                res.status(500).json(result);
        });
        this.getLogs = asyncHandler(async (req, res) => {
            const limit = parseInt(String((req.query || {}).limit)) || 100;
            const logs = await logger.getLogs(limit);
            res.json({ success: true, logs });
        });
        this.clearLogs = asyncHandler(async (_req, res) => {
            await logger.clearLogs();
            res.json({ success: true, message: 'Logs cleared successfully' });
        });
    }
}
export default new MessageController();
//# sourceMappingURL=messageController.js.map