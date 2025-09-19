import messageService from '@blue-relay-tools/services/messageService';
import ConversationMergeService from '@blue-relay-tools/services/conversationMergeService';
class SocketCommandHandler {
    constructor() {
        this.commands = new Map();
        this.conversationMergeService = new ConversationMergeService();
        this.setupCommands();
    }
    setupCommands() {
        this.commands.set('get_conversations', this.handleGetConversations.bind(this));
        this.commands.set('get_conversation_messages', this.handleGetConversationMessages.bind(this));
        this.commands.set('send_message', this.handleSendMessage.bind(this));
        this.commands.set('mark_as_read', this.handleMarkAsRead.bind(this));
        this.commands.set('check_imessage_support', this.handleCheckIMessageSupport.bind(this));
        this.commands.set('get_inbox_stats', this.handleGetInboxStats.bind(this));
        this.commands.set('get_conversation_comparison', this.handleGetConversationComparison.bind(this));
    }
    async handleCommand(command, data, requestId, callback) {
        try {
            if (!this.commands.has(command))
                throw new Error(`Unknown command: ${command}`);
            const handler = this.commands.get(command);
            const result = await handler(data);
            callback({ requestId, success: true, message: 'Command executed successfully', data: result });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Command failed';
            callback({ requestId, success: false, message: errorMessage, data: null });
        }
    }
    async handleGetConversations(data) {
        const { limit = 50, fastMode = false, sinceTimestamp } = data || {};
        // Sử dụng fast mode để tăng tốc độ
        const result = await messageService.getConversations(limit, {
            fastMode: fastMode,
            includeUnreadCount: true,
            sinceTimestamp: sinceTimestamp
        });
        if (!result.success)
            throw new Error(result.error);
        // Wrap conversations trong data object để tương thích với blue-relay-api
        return { conversations: result.conversations, total: result.total };
    }
    async handleGetConversationComparison(data) {
        const { limit = 50, includeAnalysis = true } = data || {};
        const result = await this.conversationMergeService.getConversationComparison({ limit: limit, includeDatabase: true, includeAppleScript: true });
        if (!result.success)
            throw new Error(result.error || 'Failed to get conversation comparison');
        const response = { success: true, total: result.total, stats: result.stats, sources: result.sources, conversations: result.conversations };
        if (includeAnalysis) {
            response.analysis = result.analysis;
            response.summary = {
                totalConversations: result.total,
                databaseConversations: result.analysis?.databaseConversations.length,
                applescriptConversations: result.analysis?.applescriptConversations.length,
                mergedConversations: result.analysis?.mergedConversations.length,
                databaseOnlyConversations: result.analysis?.databaseOnlyConversations.length,
                applescriptOnlyConversations: result.analysis?.applescriptOnlyConversations.length,
                duplicatesRemoved: result.stats.duplicatesRemoved
            };
        }
        return response;
    }
    async handleGetConversationMessages(data) {
        const { sender, page = 1, limit = 50, fastMode = false, skipAttributedBody = false } = data || {};
        if (!sender)
            throw new Error('Sender is required');
        const parsedLimit = Math.min(parseInt(String(limit)) || 50, 200);
        const parsedPage = Math.max(parseInt(String(page)) || 1, 1);
        const offset = (parsedPage - 1) * parsedLimit;
        // Sử dụng options tối ưu từ mac-imessage-api
        const result = await messageService.getMessages(sender, parsedLimit, offset, {
            skipAttributedBody: skipAttributedBody,
            fastMode: fastMode
        });
        if (!result.success)
            throw new Error(result.error);
        const messages = result.messages || [];
        const totalResult = await messageService.getMessageCount(sender);
        const totalMessages = totalResult.success ? (totalResult.count || 0) : 0;
        return {
            messages,
            total: totalMessages,
            page: parsedPage,
            limit: parsedLimit,
            hasMore: messages.length === parsedLimit && (offset + messages.length) < totalMessages
        };
    }
    async handleSendMessage(data) {
        const { recipient, content } = data || {};
        if (!recipient || !content)
            throw new Error('Recipient and content are required');
        const result = await messageService.sendMessage(recipient, content);
        if (!result.success)
            throw new Error(result.error);
        return { message: { id: Date.now(), sender_phone: recipient, sender_name: recipient, content: content, message_type: 'iMessage', direction: 'outbound', status: 'sent', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, device: { id: 5, device_name: 'Dungkuro MacBook', device_id: 'dungkuro-macbook-001' } };
    }
    async handleMarkAsRead(data) {
        const { sender } = data || {};
        if (!sender)
            throw new Error('Sender is required');
        const result = await messageService.markAsRead(sender);
        if (!result.success)
            throw new Error(result.error);
        return { success: true };
    }
    async handleCheckIMessageSupport(data) {
        const { recipient } = data || {};
        if (!recipient)
            throw new Error('Recipient is required');
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);
        return { supportsIMessage: isEmail, message: isEmail ? 'Supports iMessage' : 'SMS only (phone number)' };
    }
    async handleGetInboxStats() {
        // Sử dụng fast mode để lấy stats nhanh hơn
        const conversationsResult = await messageService.getConversations(1000, { fastMode: true });
        if (!conversationsResult.success)
            throw new Error(conversationsResult.error);
        const conversations = conversationsResult.conversations || [];
        const totalConversations = conversations.length;
        const unreadMessages = conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
        const totalMessages = conversations.reduce((sum, conv) => sum + (conv.messageCount || 0), 0);
        return { totalMessages, unreadMessages, totalConversations };
    }
}
export default new SocketCommandHandler();
