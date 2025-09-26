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
        this.SEND_FAIL_TIMEOUT_MS = Number(process.env.SEND_FAIL_TIMEOUT_MS || 10 * 60 * 1000);
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
            console.log('[MessageService] Attempting to send message...', {
                to,
                bodyPreview: typeof body === 'string' ? body.slice(0, 120) : body,
                bodyLength: typeof body === 'string' ? body.length : 0,
                timestamp: new Date().toISOString()
            });
            // Snapshot before sending to detect new records
            let snapshot = null;
            try {
                const handleRow = await this.findHandleForRecipient(to);
                if (handleRow) {
                    snapshot = await this.getLastRowIdForHandle(handleRow.handle_id);
                }
            } catch (e) {
                // ignore
            }

            const result = await appleScript.sendMessage(to, body);

            const messageData = {
                to,
                body,
                timestamp: new Date().toISOString(),
                result
            };

            if (result === 'success') {
                // Post-send verification with retry
                const { verification, derivedStatus } = await this.verifySendWithRetry(to, snapshot);
                console.log('[MessageService] Send success', {
                    to,
                    result,
                    at: messageData.timestamp
                });
                await logger.logSentMessage({ ...messageData, verification, derivedStatus });
                const success = derivedStatus !== 'failed';
                return { success, result, verification, derivedStatus };
            } else {
                messageData.status = 'failed';
                messageData.error = result;
                console.warn('[MessageService] Send failed', {
                    to,
                    error: result,
                    at: messageData.timestamp
                });
                await logger.logError(result, messageData);
                return { success: false, error: result };
            }
        } catch (error) {
            console.error('[MessageService] Send threw error', {
                to,
                error: error?.message || String(error)
            });
            await logger.logError(error, { to, body });
            return { success: false, error: error.message };
        }
    }

    /**
     * Get last outbound message for a recipient from Messages DB
     */
    async getLastOutboundMessageForRecipient(recipient, sinceRowId = 0) {
        const db = await getDatabase();
        const handle = await this.findHandleForRecipient(recipient);
        if (!handle) {
            console.log(`[MessageService] No handle found for recipient: ${recipient}`);
            return null;
        }
        
        console.log(`[MessageService] Found handle for ${recipient}:`, handle);
        
        // Find all handles with the same ID (there can be multiple)
        const allHandles = await db.all(`
            SELECT ROWID as handle_id, id 
            FROM handle 
            WHERE id COLLATE NOCASE = ? COLLATE NOCASE
        `, [recipient]);
        
        console.log(`[MessageService] All handles for ${recipient}:`, allHandles);
        
        if (allHandles.length === 0) return null;
        
        const handleIds = allHandles.map(h => h.handle_id);
        const placeholders = handleIds.map(() => '?').join(',');
        
        const row = await db.get(`
            SELECT 
                m.ROWID AS rowid,
                m.guid,
                m.text,
                m.attributedBody,
                m.date,
                datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') AS readable_date,
                m.is_from_me,
                m.is_sent,
                m.is_delivered,
                m.is_finished,
                m.error AS error,
                m.service,
                m.date_read,
                m.date_delivered
            FROM message m
            WHERE m.handle_id IN (${placeholders})
              AND m.is_from_me = 1 
              AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
              AND m.ROWID > ?
            ORDER BY m.date DESC
            LIMIT 1
        `, [...handleIds, sinceRowId || 0]);
        
        console.log(`[MessageService] Query result for ${recipient} (sinceRowId: ${sinceRowId}):`, row ? {
            rowid: row.rowid,
            text: row.text?.slice(0, 50),
            is_sent: row.is_sent,
            is_delivered: row.is_delivered,
            is_finished: row.is_finished,
            error: row.error,
            readable_date: row.readable_date
        } : 'null');
        
        return row || null;
    }

    async findHandleForRecipient(recipient) {
        const db = await getDatabase();
        const candidates = this.generateRecipientCandidates(recipient);
        for (const c of candidates) {
            const row = await db.get(`
                SELECT ROWID AS handle_id, id 
                FROM handle 
                WHERE id COLLATE NOCASE = ? COLLATE NOCASE 
                LIMIT 1
            `, [c]);
            if (row) return row;
        }
        return null;
    }

    generateRecipientCandidates(recipient) {
        const out = new Set();
        if (!recipient) return [];
        out.add(recipient);
        out.add(String(recipient).toLowerCase());
        // If looks like number, try variants
        const digits = String(recipient).replace(/[^0-9+]/g, '');
        if (digits) {
            out.add(digits);
            if (!digits.startsWith('tel:')) out.add(`tel:${digits}`);
            // VN normalization guesses (safe to try as candidate without forcing)
            if (digits.startsWith('0')) {
                out.add(`+84${digits.slice(1)}`);
                out.add(`tel:+84${digits.slice(1)}`);
            }
        }
        return Array.from(out);
    }

    async getLastRowIdForHandle(handleId) {
        const db = await getDatabase();
        const row = await db.get(`SELECT MAX(ROWID) AS max_rowid FROM message WHERE handle_id = ?`, [handleId]);
        return row?.max_rowid || 0;
    }

    async sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

    toUnixMsFromAppleNsEpoch(nsValue) {
        if (!nsValue || isNaN(Number(nsValue))) return null;
        const ns = Number(nsValue);
        const msFrom2001 = ns / 1_000_000;
        const unixMs = msFrom2001 + Date.UTC(2001, 0, 1);
        return unixMs;
    }

    deriveStatusFromRow(row) {
        if (!row) return { derivedStatus: 'unknown', failed: false };
        const deliveredFlags = row.is_delivered === 1 || (row.date_delivered && Number(row.date_delivered) > 0);
        const sentFlags = row.is_sent === 1;
        const hasError = !!row.error && Number(row.error) !== 0;
        if (hasError) return { derivedStatus: 'failed', failed: true };
        if (deliveredFlags) return { derivedStatus: 'delivered', failed: false };
        if (sentFlags) return { derivedStatus: 'sent', failed: false };
        if (row.is_finished === 1 && row.is_sent === 0) return { derivedStatus: 'failed', failed: true };

        // Timeout downgrade: outbound, not delivered for too long → failed
        const nowMs = Date.now();
        const baseMs = this.toUnixMsFromAppleNsEpoch(row.date) || (row.readable_date ? Date.parse(row.readable_date) : null);
        if (row.is_from_me === 1 && !deliveredFlags && baseMs) {
            const elapsed = nowMs - baseMs;
            if (elapsed > this.SEND_FAIL_TIMEOUT_MS) {
                return { derivedStatus: 'failed', failed: true };
            }
        }
        return { derivedStatus: 'queued', failed: false };
    }

    async verifySendWithRetry(recipient, snapshotRowId, attempts = 5, delayMs = 400) {
        let latest = null;
        
        // First, try to find any recent outbound message for this recipient (ignore sinceRowId initially)
        for (let i = 0; i < attempts; i++) {
            try {
                latest = await this.getLastOutboundMessageForRecipient(recipient, 0);
                if (latest) {
                    console.log(`[MessageService] Found message on attempt ${i + 1}:`, {
                        rowid: latest.rowid,
                        text: latest.text?.slice(0, 50),
                        is_sent: latest.is_sent,
                        is_delivered: latest.is_delivered,
                        is_finished: latest.is_finished,
                        error: latest.error,
                        readable_date: latest.readable_date
                    });
                    break;
                }
            } catch (err) {
                console.log(`[MessageService] Attempt ${i + 1} failed:`, err.message);
            }
            await this.sleep(delayMs);
        }
        
        const { derivedStatus } = this.deriveStatusFromRow(latest);
        console.log(`[MessageService] Final verification result:`, { 
            hasMessage: !!latest, 
            derivedStatus,
            messageInfo: latest ? {
                rowid: latest.rowid,
                is_sent: latest.is_sent,
                is_delivered: latest.is_delivered,
                error: latest.error
            } : null
        });
        
        return { verification: latest || null, derivedStatus };
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

            // Use deriveStatusFromRow for accurate status determination
            const { derivedStatus } = this.deriveStatusFromRow(msg);
            
            return {
                id: msg.id,
                sender_phone: senderId,
                sender_name: senderId,
                content: content || "",
                message_type: messageType,
                direction: msg.is_from_me === 1 ? "outbound" : "inbound",
                status: derivedStatus === 'failed' ? 'failed' : 
                       derivedStatus === 'delivered' ? 'delivered' : 
                       derivedStatus === 'sent' ? 'sent' : 
                       derivedStatus === 'queued' ? 'sent' : 'received', // map queued to sent for UI
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

            // Use deriveStatusFromRow for accurate status determination
            const { derivedStatus } = this.deriveStatusFromRow(msg);
            
            return {
                id: msg.id,
                sender_phone: senderId,
                sender_name: senderId,
                content: content || "",
                message_type: messageType,
                direction: msg.is_from_me === 1 ? "outbound" : "inbound",
                status: derivedStatus === 'failed' ? 'failed' : 
                       derivedStatus === 'delivered' ? 'delivered' : 
                       derivedStatus === 'sent' ? 'sent' : 
                       derivedStatus === 'queued' ? 'sent' : 'received', // map queued to sent for UI
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
            if (process.env.VERBOSE_INBOX_LOG === 'true') {
                console.log(`📊 Total message count for sender "${sender}": ${totalCount}`);
            }

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


