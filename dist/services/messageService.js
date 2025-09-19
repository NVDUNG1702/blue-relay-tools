import { APP_CONFIG } from '@blue-relay-tools/config/app';
let imessageApi = null;
/**
 * Lấy API instance của mac-imessage-api
 */
async function getApi() {
    if (!imessageApi) {
        try {
            const mod = await import('mac-imessage-api');
            const MacIMessageAPI = mod.default || mod.MacIMessageAPI || mod.default?.MacIMessageAPI;
            if (MacIMessageAPI) {
                imessageApi = new MacIMessageAPI({ databasePath: APP_CONFIG.DATABASE_PATH });
            }
            else {
                throw new Error('MacIMessageAPI constructor not found');
            }
        }
        catch (error) {
            console.error('Failed to initialize mac-imessage-api:', error);
            throw error;
        }
    }
    return imessageApi;
}
/**
 * Gửi tin nhắn iMessage
 */
async function sendMessage(to, body) {
    try {
        const appleScript = await import('@blue-relay-tools/utils/applescript');
        const logger = await import('@blue-relay-tools/utils/logger');
        const result = await appleScript.sendMessage(to, body);
        const messageData = { to, body, timestamp: new Date().toISOString(), result };
        if (result === 'success') {
            await logger.logSentMessage(messageData);
            return { success: true, result };
        }
        else {
            messageData.status = 'failed';
            messageData.error = result;
            await logger.logError(result, messageData);
            return { success: false, error: result };
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const logger = await import('@blue-relay-tools/utils/logger');
        await logger.logError(error, { to, body });
        return { success: false, error: errorMessage };
    }
}
/**
 * Lấy tin nhắn với tối ưu hóa từ mac-imessage-api
 */
async function getMessages(sender, limit = 50, offset = 0, options) {
    try {
        const api = await getApi();
        // Sử dụng page thay vì offset để tương thích với mac-imessage-api
        const page = Math.floor(offset / limit) + 1;
        // Gọi API với options tối ưu
        const result = await api.getMessages(sender, limit, page, {
            skipAttributedBody: options?.skipAttributedBody || false,
            fastMode: options?.fastMode || false,
            sinceTimestamp: options?.sinceTimestamp
        });
        if (result.success) {
            return {
                success: true,
                messages: result.messages || [],
                total: result.total || 0,
                page: result.page || page,
                limit: result.pageSize || limit
            };
        }
        else {
            return {
                success: false,
                error: result.error?.message || 'Failed to get messages',
                messages: [],
                total: 0
            };
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            error: errorMessage,
            messages: [],
            total: 0
        };
    }
}
/**
 * Lấy danh sách conversations với tối ưu hóa
 */
async function getConversations(limit = 20, options) {
    try {
        const api = await getApi();
        // Sử dụng fast mode nếu được yêu cầu
        const result = await api.getConversations({
            limit,
            fastMode: options?.fastMode || false,
            includeUnreadCount: options?.includeUnreadCount !== false,
            sinceTimestamp: options?.sinceTimestamp
        });
        if (result.success) {
            // Parse và format conversations
            const conversations = (result.conversations || []).map((conv) => {
                const sender = conv.sender || conv.handle_id;
                const parsedSender = sender.includes(';-;') ? sender.split(';-;')[1] : sender;
                return {
                    sender: parsedSender,
                    name: parsedSender, // Sử dụng sender làm name nếu không có
                    lastMessage: conv.lastMessage || conv.text || '',
                    lastMessageDate: conv.lastMessageDate || conv.date || Date.now(),
                    lastMessageReadable: conv.lastMessageReadable || conv.readableDate || '',
                    lastReceivedMessage: conv.lastReceivedMessage || '',
                    lastSentMessage: conv.lastSentMessage || '',
                    unreadCount: conv.unreadCount || 0,
                    messageCount: conv.messageCount || 0,
                    service: conv.service || 'iMessage',
                    country: conv.country || null
                };
            });
            return {
                success: true,
                conversations,
                total: conversations.length
            };
        }
        else {
            return {
                success: false,
                error: result.error?.message || 'Failed to get conversations',
                conversations: [],
                total: 0
            };
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            error: errorMessage,
            conversations: [],
            total: 0
        };
    }
}
/**
 * Đánh dấu tin nhắn đã đọc
 */
async function markAsRead(sender) {
    try {
        const api = await getApi();
        const result = await api.markAsRead(sender);
        if (result.success) {
            return { success: true };
        }
        else {
            return {
                success: false,
                error: result.error?.message || 'Failed to mark as read'
            };
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            error: errorMessage
        };
    }
}
/**
 * Kiểm tra tin nhắn mới
 */
async function checkNewMessages(sinceTimestamp) {
    try {
        const api = await getApi();
        // Sử dụng timestamp để lấy tin nhắn mới
        const result = await api.getConversations({
            limit: 100,
            sinceTimestamp: sinceTimestamp || (Date.now() - 24 * 60 * 60 * 1000), // 24 giờ trước
            fastMode: true
        });
        if (result.success) {
            const newMessages = (result.conversations || []).filter((conv) => {
                const lastMessageDate = conv.lastMessageDate || conv.date;
                return lastMessageDate > (sinceTimestamp || 0);
            });
            return {
                success: true,
                messages: newMessages,
                total: newMessages.length
            };
        }
        else {
            return {
                success: false,
                error: result.error?.message || 'Failed to check new messages',
                messages: [],
                total: 0
            };
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            error: errorMessage,
            messages: [],
            total: 0
        };
    }
}
/**
 * Bắt đầu monitoring tin nhắn mới
 */
async function startMonitoring(callback, interval = 5000) {
    let lastCheck = Date.now();
    const checkInterval = setInterval(async () => {
        try {
            const result = await checkNewMessages(lastCheck);
            if (result.success && result.messages && result.messages.length > 0) {
                for (const msg of result.messages) {
                    callback(msg);
                }
                lastCheck = Date.now();
            }
        }
        catch (error) {
            console.error('Error in message monitoring:', error);
        }
    }, interval);
    // Trả về function để stop monitoring
    return () => {
        clearInterval(checkInterval);
    };
}
/**
 * Lấy số lượng tin nhắn
 */
async function getMessageCount(sender) {
    try {
        const api = await getApi();
        const result = await api.getMessageCount(sender);
        if (result.success) {
            return {
                success: true,
                count: result.count || 0
            };
        }
        else {
            return {
                success: false,
                error: result.error?.message || 'Failed to get message count',
                count: 0
            };
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
            success: false,
            error: errorMessage,
            count: 0
        };
    }
}
export default {
    sendMessage,
    getMessages,
    getConversations,
    markAsRead,
    checkNewMessages,
    startMonitoring,
    getMessageCount
};
