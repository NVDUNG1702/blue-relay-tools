import { getDatabase } from '../config/database.js';
import messageParser from '../utils/messageParser.js';
import logger from '../utils/logger.js';
import appleScript from '../utils/applescript.js';
import { watch } from 'fs';
import { DB_CONFIG } from '../config/database.js';

/**
 * Message Service for Blue Relay Tools
 */
class MessageService {
    constructor() {
        this.lastMessageId = 0;
        this.isMonitoring = false;
        this.db = null;
    }

    /**
     * Initialize message service
     */
    async initialize() {
        try {
            this.db = await getDatabase();
            const result = await this.db.get('SELECT MAX(ROWID) as maxId FROM message');
            this.lastMessageId = result.maxId || 0;
            console.log(`📊 Message service initialized. Last message ID: ${this.lastMessageId}`);
        } catch (error) {
            console.error('❌ Failed to initialize message service:', error);
            throw error;
        }
    }

    /**
     * Get database connection
     */
    async getDb() {
        if (!this.db) {
            this.db = await getDatabase();
        }
        return this.db;
    }

    /**
     * Send message
     * @param {string} to - Recipient
     * @param {string} body - Message body
     * @returns {Promise<Object>}
     */
    async sendMessage(to, body) {
        try {
            const result = await appleScript.sendMessage(to, body);

            const messageData = {
                to,
                body,
                timestamp: new Date().toISOString(),
                result
            };

            if (result === 'success') {
                await logger.logSentMessage(messageData);
                return { success: true, result };
            } else {
                messageData.status = 'failed';
                messageData.error = result;
                await logger.logError(result, messageData);
                return { success: false, error: result };
            }
        } catch (error) {
            await logger.logError(error, { to, body });
            return { success: false, error: error.message };
        }
    }

    /**
     * Lấy tin nhắn từ database với tối ưu hóa hiệu suất
     * @param {string} sender - Số điện thoại hoặc ID của người gửi
     * @param {number} limit - Số lượng tin nhắn tối đa
     * @param {number} offset - Số tin nhắn bỏ qua
     * @param {Object} options - Tùy chọn bổ sung
     * @returns {Promise<Object>} - Kết quả tin nhắn
     */
    async getMessages(sender, limit = 50, offset = 0, options = {}) {
        try {
            const { skipAttributedBody = false, fastMode = false } = options;
            
            console.log(`🔍 Starting optimized query execution...`);
            const queryStartTime = Date.now();

            // Lấy database connection
            const db = await this.getDb();

            // Lấy tổng số tin nhắn
            const countResult = await db.get(`
                SELECT COUNT(DISTINCT m.ROWID) as count
                FROM message m
                LEFT JOIN handle h ON m.handle_id = h.ROWID
                WHERE h.id = ? AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
            `, [sender]);

            const total = countResult?.count || 0;
            const currentPage = Math.floor(offset / limit) + 1;
            const totalPages = Math.ceil(total / limit);

            // Lấy tin nhắn với thông tin chi tiết
            const messages = await db.all(`
                SELECT DISTINCT
                    m.ROWID as id,
                    m.text,
                    m.attributedBody,
                    m.date,
                    m.is_from_me,
                    m.is_read,
                    m.is_sent,
                    m.is_delivered,
                    m.error,
                    m.date_read,
                    m.date_delivered,
                    m.service,
                    m.service_center,
                    m.account,
                    m.handle_id as handle_rowid,
                    h.id as handle_id_text,
                    h.service as handle_service,
                    datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as readable_date
                FROM message m
                LEFT JOIN handle h ON m.handle_id = h.ROWID
                WHERE h.id = ? AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
                ORDER BY m.date DESC
                LIMIT ? OFFSET ?
            `, [sender, limit, offset]);

            const queryTime = Date.now() - queryStartTime;
            console.log(`✅ Optimized query completed in ${queryTime}ms, found ${messages.length} messages`);

            // Tối ưu hóa: Xử lý attributedBody decoding song song với chunking
            const formattedMessages = skipAttributedBody || fastMode
                ? await this.processMessagesFast(messages, sender)
                : await this.processMessagesWithAttributedBody(messages, sender);

            return {
                success: true,
                messages: formattedMessages,
                total,
                page: currentPage,
                pageSize: limit,
                totalPages
            };

        } catch (error) {
            console.error('❌ Error in getMessages:', error);
            return {
                success: false,
                messages: [],
                total: 0,
                page: 1,
                pageSize: limit,
                totalPages: 0,
                error: error.message
            };
        }
    }

    /**
     * Xử lý tin nhắn với attributedBody decoding song song (tối ưu hóa hiệu suất)
     */
    async processMessagesWithAttributedBody(messages, sender) {
        // Tối ưu hóa: Batch decode tất cả attributedBody cùng lúc
        const messagesToDecode = messages.filter(
            (msg) => !msg.text && msg.attributedBody
        );

        let decodedResults = {};

        if (messagesToDecode.length > 0) {
            console.log(
                `🔧 Batch decoding ${messagesToDecode.length} attributedBody items...`
            );

            // Chuẩn bị items cho batch decode
            const batchItems = messagesToDecode.map((msg, index) => ({
                id: `msg_${msg.id || index}`,
                buffer: msg.attributedBody,
            }));

            try {
                // Sử dụng Foundation Bridge batch decode
                const { default: foundationBridge } = await import('../utils/foundationBridge.js');
                const batchResults = await foundationBridge.batchDecode(batchItems);

                // Chuyển kết quả thành map để lookup nhanh
                for (const result of batchResults) {
                    if (result.result) {
                        decodedResults[result.id] = result.result;
                    }
                }

                console.log(
                    `✅ Batch decoded ${batchResults.filter((r) => r.result).length}/${batchItems.length} items successfully`
                );
            } catch (error) {
                console.warn("⚠️ Batch decode failed:", error.message);
            }
        }

        // Xử lý tất cả tin nhắn với kết quả đã decode
        return messages.map((msg) => {
            let content = msg.text;
            let senderId, recipients;

            // Sử dụng kết quả đã decode từ batch
            if (!content && msg.attributedBody) {
                const needsDecoding = this.shouldDecodeAttributedBody(
                    msg.attributedBody
                );

                if (needsDecoding) {
                    const msgId = `msg_${msg.id || messages.indexOf(msg)}`;
                    const decodedContent = decodedResults[msgId];

                    if (decodedContent) {
                        content = decodedContent;
                    } else {
                        content = "[Media/Sticker - Decoded via Foundation Bridge]";
                    }
                } else {
                    content = "[Media/Sticker - Skipped decoding]";
                }
            }

            // Xác định sender và recipients
            if (msg.is_from_me === 1) {
                senderId = "me";
                recipients = [sender];
            } else {
                senderId = msg.handle_id_text || msg.handle_rowid || null;
                recipients = ["me"];
            }

            // Xác định loại tin nhắn (SMS/iMessage)
            let messageType = "unknown";
            let serviceInfo = {
                type: msg.service || msg.handle_service || "unknown",
                center: msg.service_center || null,
                account: msg.account || null,
            };

            // Phân loại tin nhắn dựa trên service
            if (serviceInfo.type === "iMessage") {
                messageType = "iMessage";
            } else if (serviceInfo.type === "SMS") {
                messageType = "SMS";
            } else if (serviceInfo.type === "RCS") {
                messageType = "RCS";
            } else {
                // Fallback: dựa vào service_center để xác định SMS
                if (serviceInfo.center) {
                    messageType = "SMS";
                    serviceInfo.type = "SMS";
                } else {
                    messageType = "iMessage";
                    serviceInfo.type = "iMessage";
                }
            }

            return {
                id: msg.id,
                sender_phone: senderId,
                sender_name: senderId,
                content: content || "",
                message_type: messageType,
                direction: msg.is_from_me === 1 ? "outbound" : "inbound",
                status: msg.is_delivered === 1 ? "delivered" : msg.is_sent === 1 ? "sent" : "received",
                created_at: msg.readable_date,
                updated_at: msg.readable_date,
                has_rich_content: !!msg.attributedBody,
                _raw_date: msg.date
            };
        });
    }

    /**
     * Kiểm tra xem có cần decode attributedBody hay không (tối ưu hóa)
     */
    shouldDecodeAttributedBody(attributedBody) {
        // Kiểm tra nhanh: nếu buffer quá nhỏ, có thể không cần decode
        if (!attributedBody || attributedBody.length < 10) {
            return false;
        }

        // Kiểm tra pattern để xác định có phải media/sticker thực sự không
        const firstBytes = attributedBody.slice(0, 4);
        const hasValidPattern = firstBytes.some((byte) => byte > 0);

        return hasValidPattern;
    }

    /**
     * Xử lý tin nhắn nhanh (bỏ qua attributedBody decoding)
     */
    async processMessagesFast(messages, sender) {
        return messages.map((msg) => {
            let content = msg.text;
            let senderId, recipients;

            // Bỏ qua attributedBody decoding để tăng tốc
            if (!content && msg.attributedBody) {
                content = "[Media/Sticker - Fast Mode]";
            }

            // Xác định sender và recipients
            if (msg.is_from_me === 1) {
                senderId = "me";
                recipients = [sender];
            } else {
                senderId = msg.handle_id_text || msg.handle_rowid || null;
                recipients = ["me"];
            }

            // Xác định loại tin nhắn (SMS/iMessage)
            let messageType = "unknown";
            let serviceInfo = {
                type: msg.service || msg.handle_service || "unknown",
                center: msg.service_center || null,
                account: msg.account || null,
            };

            // Phân loại tin nhắn dựa trên service
            if (serviceInfo.type === "iMessage") {
                messageType = "iMessage";
            } else if (serviceInfo.type === "SMS") {
                messageType = "SMS";
            } else if (serviceInfo.type === "RCS") {
                messageType = "RCS";
            } else {
                // Fallback: dựa vào service_center để xác định SMS
                if (serviceInfo.center) {
                    messageType = "SMS";
                    serviceInfo.type = "SMS";
                } else {
                    messageType = "iMessage";
                    serviceInfo.type = "iMessage";
                }
            }

            return {
                id: msg.id,
                sender_phone: senderId,
                sender_name: senderId,
                content: content || "",
                message_type: messageType,
                direction: msg.is_from_me === 1 ? "outbound" : "inbound",
                status: msg.is_delivered === 1 ? "delivered" : msg.is_sent === 1 ? "sent" : "received",
                created_at: msg.readable_date,
                updated_at: msg.readable_date,
                has_rich_content: !!msg.attributedBody,
                _raw_date: msg.date
            };
        });
    }

    /**
     * Get conversations list
     * @param {number} limit - Number of conversations to return
     * @returns {Promise<Object>}
     */
    async getConversations(limit = 50) {
        try {
            const db = await getDatabase();

            // Updated SQL query with improved logic from /api/conversations/detailed
            const conversations = await db.all(`
                SELECT 
                    h.id as sender,
                    h.country,
                    (
                      SELECT m2.service
                      FROM message m2
                      WHERE m2.handle_id = h.ROWID AND (m2.text IS NOT NULL OR m2.attributedBody IS NOT NULL)
                      ORDER BY m2.date DESC
                      LIMIT 1
                    ) as service,
                    COUNT(m.ROWID) as messageCount,
                    MAX(m.date) as lastMessageDate,
                    datetime(MAX(m.date)/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as lastMessageReadable,
                    (
                      SELECT m3.text
                      FROM message m3
                      WHERE m3.handle_id = h.ROWID AND (m3.text IS NOT NULL OR m3.attributedBody IS NOT NULL)
                      ORDER BY m3.date DESC
                      LIMIT 1
                    ) as lastMessage,
                    (
                      SELECT m4.text
                      FROM message m4
                      WHERE m4.handle_id = h.ROWID AND m4.is_from_me = 0 AND (m4.text IS NOT NULL OR m4.attributedBody IS NOT NULL)
                      ORDER BY m4.date DESC
                      LIMIT 1
                    ) as lastReceivedMessage,
                    (
                      SELECT m5.text
                      FROM message m5
                      WHERE m5.handle_id = h.ROWID AND m5.is_from_me = 1 AND (m5.text IS NOT NULL OR m5.attributedBody IS NOT NULL)
                      ORDER BY m5.date DESC
                      LIMIT 1
                    ) as lastSentMessage,
                    (
                      SELECT COUNT(*) FROM message m6
                      WHERE m6.handle_id = h.ROWID AND m6.is_read = 0 AND m6.is_from_me = 0
                    ) as unreadCount
                FROM handle h
                LEFT JOIN message m ON h.ROWID = m.handle_id
                WHERE (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
                GROUP BY h.ROWID, h.id COLLATE NOCASE, h.country
                HAVING MAX(m.date) IS NOT NULL
                ORDER BY MAX(m.date) DESC
                LIMIT ?
            `, [limit]);

            // Merge conversations with same sender (case insensitive) - improved logic
            const conversationMap = new Map();

            conversations.forEach(conv => {
                const senderKey = conv.sender.toLowerCase();

                if (!conversationMap.has(senderKey)) {
                    conversationMap.set(senderKey, conv);
                } else {
                    // Merge with existing conversation
                    const existing = conversationMap.get(senderKey);

                    // Choose the sender with better case (prefer proper case over all lowercase)
                    const betterSender = (conv.sender !== conv.sender.toLowerCase() && existing.sender === existing.sender.toLowerCase())
                        ? conv.sender
                        : existing.sender;

                    // Determine which conversation has the most recent message
                    const convDate = conv.lastMessageDate || 0;
                    const existingDate = existing.lastMessageDate || 0;
                    const useConvData = convDate > existingDate;

                    // Merge message counts and other data
                    const merged = {
                        ...existing,
                        sender: betterSender,
                        messageCount: existing.messageCount + conv.messageCount,
                        unreadCount: existing.unreadCount + conv.unreadCount,
                        // Keep the most recent message date and related data
                        lastMessageDate: Math.max(existingDate, convDate),
                        lastMessageReadable: useConvData ? conv.lastMessageReadable : existing.lastMessageReadable,
                        lastMessage: useConvData ? conv.lastMessage : existing.lastMessage,
                        lastReceivedMessage: useConvData ? conv.lastReceivedMessage : existing.lastReceivedMessage,
                        lastSentMessage: useConvData ? conv.lastSentMessage : existing.lastSentMessage,
                        service: useConvData ? conv.service : existing.service
                    };

                    conversationMap.set(senderKey, merged);
                }
            });

            // Sort conversations by last message date (most recent first)
            const mergedConversations = Array.from(conversationMap.values())
                .sort((a, b) => (b.lastMessageDate || 0) - (a.lastMessageDate || 0));

            return { success: true, conversations: mergedConversations };
        } catch (error) {
            console.error('❌ Failed to get conversations:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Mark conversation as read
     * @param {string} sender - Sender identifier
     * @returns {Promise<Object>}
     */
    async markAsRead(sender) {
        try {
            const db = await getDatabase();

            await db.run(`
                UPDATE message 
                SET is_read = 1 
                WHERE handle_id = (SELECT ROWID FROM handle WHERE id = ?) 
                AND is_from_me = 0
            `, [sender]);

            return { success: true };
        } catch (error) {
            console.error('❌ Failed to mark as read:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Check for new messages
     * @param {Function} onNewMessage - Callback for new messages
     * @returns {Promise<void>}
     */
    async checkNewMessages(onNewMessage) {
        try {
            const db = await getDatabase();

            const messages = await db.all(`
                SELECT 
                    m.ROWID, 
                    m.text, 
                    m.attributedBody,
                    m.date, 
                    m.is_from_me, 
                    h.id as sender,
                    datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as readable_date
                FROM message m 
                LEFT JOIN handle h ON m.handle_id = h.ROWID 
                WHERE m.ROWID > ? 
                ORDER BY m.date DESC
            `, [this.lastMessageId]);

            if (messages.length > 0) {
                console.log(`📥 Found ${messages.length} new messages`);

                for (const msg of messages) {
                    const parsedMessage = await messageParser.parseMessage(msg);
                    await logger.logReceivedMessage(parsedMessage);

                    if (onNewMessage) {
                        onNewMessage(parsedMessage);
                    }

                    this.lastMessageId = Math.max(this.lastMessageId, msg.ROWID);
                }
            }
        } catch (error) {
            console.error('❌ Failed to check new messages:', error);
        }
    }

    /**
     * Start database monitoring
     * @param {Function} onNewMessage - Callback for new messages
     */
    startMonitoring(onNewMessage) {
        if (this.isMonitoring) {
            console.log('⚠️  Database monitoring already started');
            return;
        }

        console.log(`🔍 Starting database monitoring: ${DB_CONFIG.filename}`);
        this.isMonitoring = true;

        // Initial check
        this.checkNewMessages(onNewMessage);

        // Watch for file changes
        watch(DB_CONFIG.filename, (eventType, filename) => {
            if (eventType === 'change') {
                console.log('📝 Database changed, checking for new messages...');
                setTimeout(() => this.checkNewMessages(onNewMessage), 1000);
            }
        });

        // Also poll every 3 seconds as backup
        this.pollInterval = setInterval(() => {
            this.checkNewMessages(onNewMessage);
        }, 3000);
    }

    /**
     * Stop database monitoring
     */
    stopMonitoring() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.isMonitoring = false;
        console.log('🔍 Database monitoring stopped');
    }

    /**
     * Get total message count for a sender
     */
    async getMessageCount(sender) {
        try {
            const db = await getDatabase();

            // Lấy handle_id của sender
            const handleRow = await db.get(`
                SELECT ROWID FROM handle 
                WHERE id COLLATE NOCASE = ? COLLATE NOCASE
                LIMIT 1
            `, [sender]);

            if (!handleRow) {
                return { success: true, count: 0 };
            }

            const senderHandleId = handleRow.ROWID;

            // Count total messages
            const countResult = await db.get(`
                SELECT COUNT(*) as count
                FROM message m 
                WHERE m.handle_id = ?
            `, [senderHandleId]);

            const totalCount = countResult?.count || 0;
            console.log(`📊 Total message count for sender "${sender}": ${totalCount}`);

            return {
                success: true,
                count: totalCount
            };
        } catch (error) {
            console.error('❌ Error getting message count:', error);
            return {
                success: false,
                error: error.message,
                count: 0
            };
        }
    }
}

export default new MessageService();


