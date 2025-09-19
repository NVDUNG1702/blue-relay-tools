import messageService from '../services/messageService.js';
import messageParser from '../utils/messageParser.js';
import logger from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * Message Controller for Blue Relay Tools
 */
class MessageController {
    /**
     * Send message
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    sendMessage = asyncHandler(async (req, res) => {
        const { to, body } = req.body;

        // Validate input
        const validation = messageParser.validateMessage({ to, body });
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                details: validation.errors
            });
        }

        // Sanitize content
        const sanitizedBody = messageParser.sanitizeContent(body);

        // Send message
        const result = await messageService.sendMessage(to, sanitizedBody);

        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    });

    /**
     * Get messages for a conversation
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    getMessages = asyncHandler(async (req, res) => {
        const { sender } = req.params;
        const limit = parseInt(req.query.limit) || 50;

        if (!sender) {
            return res.status(400).json({
                success: false,
                error: 'Sender parameter is required'
            });
        }

        const result = await messageService.getMessages(sender, limit);

        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    });

    /**
     * Get conversations list
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    getConversations = asyncHandler(async (req, res) => {
        const limit = parseInt(req.query.limit) || 50;
        const result = await messageService.getConversations(limit);

        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    });

    /**
     * Get detailed conversations
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    getDetailedConversations = asyncHandler(async (req, res) => {
        const limit = parseInt(req.query.limit) || 50;
        const result = await messageService.getConversations(limit);

        if (result.success) {
            // Add additional details to conversations
            const detailedConversations = result.conversations.map(conv => ({
                ...conv,
                lastMessage: conv.lastMessage || '',
                unreadCount: conv.unreadCount || 0,
                messageCount: conv.messageCount || 0
            }));

            res.json({
                success: true,
                conversations: detailedConversations
            });
        } else {
            res.status(500).json(result);
        }
    });

    /**
     * Mark conversation as read
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    markAsRead = asyncHandler(async (req, res) => {
        const { sender } = req.params;

        if (!sender) {
            return res.status(400).json({
                success: false,
                error: 'Sender parameter is required'
            });
        }

        const result = await messageService.markAsRead(sender);

        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    });

    /**
     * Get logs
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    getLogs = asyncHandler(async (req, res) => {
        const limit = parseInt(req.query.limit) || 100;
        const logs = await logger.getLogs(limit);

        res.json({ success: true, logs });
    });

    /**
     * Clear logs
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    clearLogs = asyncHandler(async (req, res) => {
        await logger.clearLogs();
        res.json({ success: true, message: 'Logs cleared successfully' });
    });
}

export default new MessageController(); 