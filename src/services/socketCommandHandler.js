import messageService from './messageService.js';
import logger from '../utils/logger.js';
import ConversationMergeService from './conversationMergeService.js';

/**
 * Socket Command Handler for Blue Relay Tools
 * Handles commands from frontend via socket
 */
class SocketCommandHandler {
    constructor() {
        this.commands = new Map();
        this.conversationMergeService = new ConversationMergeService();
        this.setupCommands();
    }

    /**
     * Setup available commands
     */
    setupCommands() {
        // Get conversations command
        this.commands.set('get_conversations', this.handleGetConversations.bind(this));

        // Get conversation comparison command
        this.commands.set('get_conversation_comparison', this.handleGetConversationComparison.bind(this));

        // Get conversation messages command
        this.commands.set('get_conversation_messages', this.handleGetConversationMessages.bind(this));

        // Send message command
        this.commands.set('send_message', this.handleSendMessage.bind(this));

        // Mark as read command
        this.commands.set('mark_as_read', this.handleMarkAsRead.bind(this));

        // Check iMessage support command
        this.commands.set('check_imessage_support', this.handleCheckIMessageSupport.bind(this));

        // Get inbox stats command
        this.commands.set('get_inbox_stats', this.handleGetInboxStats.bind(this));

        // Ping command
        this.commands.set('ping', this.handlePing.bind(this));

        // Get device info command
        this.commands.set('get_info', this.handleGetInfo.bind(this));
    }

    /**
     * Handle incoming command
     * @param {string} command - Command name
     * @param {Object} data - Command data
     * @param {string} requestId - Request ID for response
     * @param {Function} callback - Response callback
     */
    async handleCommand(command, data, requestId, callback) {
        try {
            console.log(`📨 Received command: ${command}`, { data, requestId });

            if (!this.commands.has(command)) {
                throw new Error(`Unknown command: ${command}`);
            }

            const handler = this.commands.get(command);
            const result = await handler(data);

            const response = {
                requestId,
                success: true,
                message: 'Command executed successfully',
                data: result
            };

            callback(response);
            console.log(`✅ Command ${command} executed successfully`);

        } catch (error) {
            console.error(`❌ Command ${command} failed:`, error);

            const response = {
                requestId,
                success: false,
                message: error.message || 'Command failed',
                data: null
            };

            callback(response);
        }
    }

    /**
     * Handle get conversations command - Now with merged data from both sources
     */
    async handleGetConversations(data) {
        const {
            page = 1,
            limit = 50,
            search,
            mergeMode = 'hybrid', // 'database-only' | 'applescript-only' | 'hybrid'
            includeStats = false
        } = data;

        try {
            let result;

            switch (mergeMode) {
                case 'database-only':
                    result = await this.conversationMergeService.getMergedConversations({
                        limit,
                        includeDatabase: true,
                        includeAppleScript: false
                    });
                    break;

                case 'applescript-only':
                    result = await this.conversationMergeService.getMergedConversations({
                        limit,
                        includeDatabase: false,
                        includeAppleScript: true
                    });
                    break;

                case 'hybrid':
                default:
                    result = await this.conversationMergeService.getMergedConversations({
                        limit,
                        includeDatabase: true,
                        includeAppleScript: true,
                        mergeStrategy: 'database-priority'
                    });
                    break;
            }

            if (!result.success) {
                throw new Error(result.error || 'Failed to get conversations');
            }

            // Apply search filter if provided
            let conversations = result.conversations;
            if (search && search.trim()) {
                const searchTerm = search.toLowerCase().trim();
                conversations = conversations.filter(conv =>
                    conv.sender.toLowerCase().includes(searchTerm) ||
                    conv.name.toLowerCase().includes(searchTerm) ||
                    (conv.lastMessage && conv.lastMessage.toLowerCase().includes(searchTerm))
                );
            }

            // Apply pagination
            const startIndex = (page - 1) * limit;
            const paginatedConversations = conversations.slice(startIndex, startIndex + limit);

            const response = {
                conversations: paginatedConversations,
                total: conversations.length,
                page,
                limit,
                totalPages: Math.ceil(conversations.length / limit),
                mergeMode
            };

            // Include detailed stats if requested
            if (includeStats) {
                response.stats = result.stats;
                response.sources = result.sources;
            }

            return response;

        } catch (error) {
            console.error('❌ Error in handleGetConversations:', error);
            throw error;
        }
    }

    /**
     * Handle get conversation comparison command - Shows detailed comparison between sources
     */
    async handleGetConversationComparison(data) {
        const {
            limit = 50,
            includeAnalysis = true
        } = data;

        try {
            const result = await this.conversationMergeService.getConversationComparison({
                limit,
                includeDatabase: true,
                includeAppleScript: true
            });

            if (!result.success) {
                throw new Error(result.error || 'Failed to get conversation comparison');
            }

            const response = {
                success: true,
                total: result.total,
                stats: result.stats,
                sources: result.sources,
                conversations: result.conversations
            };

            if (includeAnalysis) {
                response.analysis = result.analysis;
                response.summary = {
                    totalConversations: result.total,
                    databaseConversations: result.analysis.databaseConversations.length,
                    applescriptConversations: result.analysis.applescriptConversations.length,
                    mergedConversations: result.analysis.mergedConversations.length,
                    databaseOnlyConversations: result.analysis.databaseOnlyConversations.length,
                    applescriptOnlyConversations: result.analysis.applescriptOnlyConversations.length,
                    duplicatesRemoved: result.stats.duplicatesRemoved
                };
            }

            return response;

        } catch (error) {
            console.error('❌ Error in handleGetConversationComparison:', error);
            throw error;
        }
    }

    /**
     * Handle get conversation messages command
     */
    async handleGetConversationMessages(data) {
        console.log(`🎯 SocketCommandHandler: handleGetConversationMessages called with:`, data);
        const { sender, page = 1, limit = 50 } = data;

        if (!sender) {
            throw new Error('Sender is required');
        }

        // Validate parameters
        const parsedLimit = Math.min(parseInt(limit) || 50, 200); // Max 200 messages
        const parsedPage = Math.max(parseInt(page) || 1, 1); // Min page 1
        const offset = (parsedPage - 1) * parsedLimit;

        console.log(`📞 Calling messageService.getMessages for sender: ${sender}, limit: ${parsedLimit}, page: ${parsedPage}, offset: ${offset}`);

        // Force fresh data by adding request ID
        const requestId = `${Date.now()}-${Math.random()}`;
        console.log(`🔍 Request ID: ${requestId}`);

        const result = await messageService.getMessages(sender, parsedLimit, offset);
        console.log(`📨 messageService.getMessages result:`, { 
            success: result.success, 
            messageCount: result.messages?.length,
            total: result.total,
            page: result.page,
            totalPages: result.totalPages
        });

        if (!result.success) {
            throw new Error(result.error);
        }

        // Data đã được format đúng từ messageService
        const messages = result.messages;

        // Get total count for pagination
        const totalResult = await messageService.getMessageCount(sender);
        const totalMessages = totalResult.success ? totalResult.count : 0;

        console.log(`✅ SocketCommandHandler: Returning ${messages.length} messages for page ${parsedPage}, total: ${totalMessages}`);
        console.log(`🔍 Final return object:`, {
            messages: messages.length,
            total: totalMessages,
            page: parsedPage,
            limit: parsedLimit,
            hasMore: messages.length === parsedLimit && (offset + messages.length) < totalMessages
        });
        return {
            messages,
            total: totalMessages,
            page: parsedPage,
            limit: parsedLimit,
            hasMore: messages.length === parsedLimit && (offset + messages.length) < totalMessages
        };
    }

    /**
     * Handle send message command
     */
    async handleSendMessage(data) {
        const { recipient, content } = data;
        console.log({ data });


        if (!recipient || !content) {
            throw new Error('Recipient and content are required');
        }

        const result = await messageService.sendMessage(recipient, content);

        if (!result.success) {
            throw new Error(result.error);
        }

        // Return mock response (will be replaced with real response)
        return {
            message: {
                id: Date.now(),
                sender_phone: recipient,
                sender_name: recipient,
                content: content,
                message_type: 'iMessage',
                direction: 'outbound',
                status: 'sent',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            },
            device: {
                id: 5,
                device_name: 'Dungkuro MacBook',
                device_id: 'dungkuro-macbook-001'
            }
        };
    }

    /**
     * Handle mark as read command
     */
    async handleMarkAsRead(data) {
        const { sender } = data;

        if (!sender) {
            throw new Error('Sender is required');
        }

        const result = await messageService.markAsRead(sender);

        if (!result.success) {
            throw new Error(result.error);
        }

        return { success: true };
    }

    /**
     * Handle check iMessage support command
     */
    async handleCheckIMessageSupport(data) {
        const { recipient } = data;

        if (!recipient) {
            throw new Error('Recipient is required');
        }

        // Simple check: email = iMessage, phone = SMS
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);

        return {
            supportsIMessage: isEmail,
            message: isEmail ? 'Supports iMessage' : 'SMS only (phone number)'
        };
    }

    /**
     * Handle get inbox stats command
     */
    async handleGetInboxStats() {
        try {
            // Get conversations to calculate stats
            const conversationsResult = await messageService.getConversations(1000);

            if (!conversationsResult.success) {
                throw new Error(conversationsResult.error);
            }

            const conversations = conversationsResult.conversations;
            const totalConversations = conversations.length;
            const unreadMessages = conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
            const totalMessages = conversations.reduce((sum, conv) => sum + (conv.messageCount || 0), 0);

            return {
                totalMessages,
                unreadMessages,
                totalConversations
            };
        } catch (error) {
            throw new Error(`Failed to get inbox stats: ${error.message}`);
        }
    }

    /**
     * Handle ping command
     */
    async handlePing() {
        return { pong: true, timestamp: new Date().toISOString() };
    }

    /**
     * Handle get device info command
     */
    async handleGetInfo() {
        return {
            deviceName: 'Dungkuro MacBook',
            deviceId: 'dungkuro-macbook-001',
            status: 'online',
            version: '2.0.0',
            features: ['send', 'receive', 'conversations', 'stats'],
            timestamp: new Date().toISOString()
        };
    }
}

export default new SocketCommandHandler(); 