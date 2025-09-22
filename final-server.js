import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { exec } from 'child_process';
import fs from 'fs/promises';
import { watch } from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';
import parseAttributedBody from './decode-attributed-body.js';
import ngrok from 'ngrok';
import { NGROK_CONFIG } from './ngrok-config.js';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// SQLite database path
const DB_PATH = process.env.MESSAGES_DB_PATH || `${process.env.HOME}/Library/Messages/chat.db`;
let lastMessageId = 0;

// Initialize database and get last message ID
async function initDatabase() {
    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        const result = await db.get('SELECT MAX(ROWID) as maxId FROM message');
        lastMessageId = result.maxId || 0;
        console.log(`📊 Database initialized. Last message ID: ${lastMessageId}`);

        await db.close();
    } catch (err) {
        console.error('❌ Database init error:', err);
    }
}

// Check for new messages
async function checkNewMessages() {
    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

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
        `, [lastMessageId]);

        if (messages.length > 0) {
            console.log(`📥 Found ${messages.length} new messages`);

            for (const msg of messages) {
                let content = msg.text;
                // Nếu text null và có attributedBody, giải mã attributedBody
                if (!content && msg.attributedBody) {
                    // try {
                    //     let buf = msg.attributedBody;
                    //     if (!(buf instanceof Buffer)) {
                    //         buf = Buffer.from(buf);
                    //     }
                    //     content = await parseAttributedBody(buf);
                    // } catch (e) {
                    //     content = '[Error decoding attributedBody]';
                    // }
                    content = msg.attributedBody;
                }

                const logEntry = {
                    id: msg.ROWID,
                    from: msg.sender,
                    body: content,
                    timestamp: msg.readable_date,
                    isFromMe: msg.is_from_me === 1,
                    status: 'received'
                };

                await fs.appendFile(process.env.LOG_PATH, JSON.stringify(logEntry) + '\n');
                io.emit('message.received', logEntry);

                lastMessageId = Math.max(lastMessageId, msg.ROWID);
            }
        }

        await db.close();
    } catch (err) {
        console.error('❌ Database query error:', err);
    }
}

// Monitor database file for changes
function startDatabaseMonitoring() {
    console.log(`🔍 Monitoring database: ${DB_PATH}`);

    // Initial check
    checkNewMessages();

    // Watch for file changes
    watch(DB_PATH, (eventType, filename) => {
        if (eventType === 'change') {
            console.log('📝 Database changed, checking for new messages...');
            setTimeout(checkNewMessages, 1000); // Wait 1 second for write to complete
        }
    });

    // Also poll every 3 seconds as backup
    setInterval(checkNewMessages, 3000);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ngrok URL endpoint
app.get('/api/ngrok-url', (req, res) => {
    res.json({
        success: true,
        ngrokUrl: ngrokUrl,
        localUrl: `http://localhost:${PORT}`,
        hasNgrok: !!ngrokUrl
    });
});

// Send message endpoint
app.post('/api/send', async (req, res) => {
    const { to, body } = req.body;

    if (!to || !body) {
        return res.status(400).json({ error: 'Missing to/body parameters' });
    }

    try {
        // Trước tiên, tìm sender chính xác từ database để đảm bảo case sensitivity
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        // Tìm sender với case sensitivity chính xác
        const senderRow = await db.get(`
            SELECT id FROM handle 
            WHERE id COLLATE NOCASE = ? COLLATE NOCASE
            LIMIT 1
        `, [to]);

        await db.close();

        // Sử dụng sender chính xác từ database nếu tìm thấy
        const senderToUse = senderRow ? senderRow.id : to;
        console.log(`Sending message to: "${senderToUse}" (original: "${to}")`);
        console.log('=== DEBUG LOG ===');
        console.log({ to, body, senderToUse });
        console.log('=== END DEBUG ===');

        const script = `tell application "Messages"
            try
                set svc to 1st service whose service type = iMessage
                set bud to buddy "${senderToUse}" of svc
                set msg to send "${body}" to bud
                return "success"
            on error errMsg
                return "error: " & errMsg
            end try
            end tell`;

        exec(`osascript -e '${script}'`, async (err, stdout) => {
            const timestamp = new Date().toISOString();
            let logEntry = { to: senderToUse, body, timestamp };

            if (err) {
                logEntry = { ...logEntry, status: 'failed', error: err.message };
                await fs.appendFile(process.env.LOG_PATH, JSON.stringify(logEntry) + '\n');
                return res.status(500).json({ success: false, error: err.message });
            }

            logEntry = { ...logEntry, status: 'sent', result: stdout.trim() };
            await fs.appendFile(process.env.LOG_PATH, JSON.stringify(logEntry) + '\n');
            res.json({ success: true, result: stdout.trim() });
        });
    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get logs endpoint
app.get('/api/logs', async (req, res) => {
    try {
        const logContent = await fs.readFile(process.env.LOG_PATH, 'utf8');
        const logs = logContent.trim().split('\n').filter(line => line).map(line => JSON.parse(line));
        res.json({ logs });
    } catch (err) {
        res.status(500).json({ error: 'Không thể đọc logs' });
    }
});

// Get conversations list
app.get('/api/conversations', async (req, res) => {
    try {
        const script = `tell application "Messages"
      try
        set svc to 1st service whose service type = iMessage
        set result to ""
        repeat with theChat in every chat of svc
          try
            set chatId to id of theChat as string
            set chatName to name of theChat as string
            set chatInfo to chatId & "|" & chatName & "|1"
            if result is not "" then
              set result to result & "\\n"
            end if
            set result to result & chatInfo
          on error chatErr
            log "Error processing chat: " & chatErr
          end try
        end repeat
        return result
      on error errMsg
        return "error: " & errMsg
      end try
    end tell`;

        exec(`osascript -e '${script}'`, (err, stdout, stderr) => {
            console.log('AppleScript stdout:', stdout);
            if (stderr) console.error('AppleScript stderr:', stderr);
            if (err) {
                console.error('AppleScript error:', err);
                return res.status(500).json({ success: false, error: err.message });
            }
            try {
                const lines = (stdout || '').trim().split('\n').filter(line => line.trim());
                const conversations = lines.map(line => {
                    const [id, name, participantCount] = line.split('|');
                    return { id, name, participantCount: Number(participantCount) };
                });
                res.json({ success: true, conversations });
            } catch (parseErr) {
                res.status(500).json({ success: false, error: 'Invalid response format' });
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get messages from database
app.get('/api/messages', async (req, res) => {
    const { limit = 50, offset = 0 } = req.query;

    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        const messages = await db.all(`
            SELECT 
                m.ROWID as id, 
                m.text, 
                m.attributedBody,
                m.date, 
                m.is_from_me, 
                m.is_read,
                m.date_read,
                h.id as sender,
                datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as readable_date
            FROM message m 
            LEFT JOIN handle h ON m.handle_id = h.ROWID 
            ORDER BY m.date DESC 
            LIMIT ? OFFSET ?
        `, [limit, offset]);

        const formattedMessages = await Promise.all(messages.map(async msg => {
            let content = msg.text;

            // Check if text contains raw NSArchiver data
            const isRawNSArchiverText = content && (
                content.includes('streamtyped') ||
                content.includes('NSMutableAttributedString') ||
                content.includes('NSAttributedString')
            );

            // Nếu text null và có attributedBody, hoặc text chứa raw NSArchiver data
            if ((!content && msg.attributedBody) || isRawNSArchiverText) {
                try {
                    // Import Foundation Bridge (native NSUnarchiver) and text cleaner
                    const { default: foundationBridge } = await import('./src/utils/foundationBridge.js');
                    const { default: textCleaner } = await import('./src/utils/textCleaner.js');
                    const { default: nsArchiver } = await import('./src/utils/nsArchiver.js');

                    let rawContent = null;

                    if (isRawNSArchiverText) {
                        // If text contains raw NSArchiver data, try to clean it first
                        rawContent = textCleaner.extractCleanContent(content);
                        if (!rawContent || rawContent.length < content.length * 0.5) {
                            // If cleaning didn't work well, keep original
                            rawContent = content;
                        }
                    } else if (msg.attributedBody) {
                        // Priority 1: Try Foundation Bridge (native NSUnarchiver) - most accurate
                        try {
                            rawContent = await foundationBridge.decode(msg.attributedBody);
                            if (rawContent) {
                                console.log(`✅ Foundation Bridge decoded message ${msg.id}: ${rawContent.length} chars`);
                            }
                        } catch (foundationError) {
                            console.log(`⚠️ Foundation Bridge failed for message ${msg.id}:`, foundationError.message);
                        }

                        // Priority 2: Fallback to NSArchiver if Foundation Bridge fails
                        if (!rawContent) {
                            let buf = msg.attributedBody;
                            if (!(buf instanceof Buffer)) {
                                buf = Buffer.from(buf);
                            }
                            rawContent = await nsArchiver.decode(buf);
                            if (rawContent) {
                                console.log(`✅ NSArchiver fallback decoded message ${msg.id}: ${rawContent.length} chars`);
                            }
                        }
                    }

                    if (rawContent) {
                        // Clean the decoded content to extract just the message
                        content = textCleaner.extractCleanContent(rawContent);
                    }

                    // Minimal fallback - preserve content, remove only dangerous chars
                    if (!content && msg.attributedBody) {
                        const buf = Buffer.from(msg.attributedBody);
                        const decodedText = buf.toString('utf-8')
                            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove only dangerous control chars
                            .trim();
                        content = decodedText || '[Empty attributedBody]';
                    }
                } catch (e) {
                    console.error('Error decoding attributedBody:', e);
                    // Minimal final fallback
                    try {
                        const decodedText = Buffer.from(msg.attributedBody).toString('utf-8')
                            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove only dangerous control chars
                            .trim();
                        content = decodedText || '[Error decoding attributedBody]';
                    } catch (fallbackError) {
                        content = '[Error decoding attributedBody]';
                    }
                }
            }

            return {
                id: msg.id,
                sender: msg.sender,
                text: content,
                date: msg.readable_date,
                isFromMe: msg.is_from_me === 1,
                isRead: msg.is_read === 1,
                dateRead: msg.date_read ? new Date(msg.date_read / 1000000000 * 1000 + Date.UTC(2001, 0, 1)) : null
            };
        }));

        await db.close();
        res.json({ success: true, messages: formattedMessages });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get messages by type (iMessage/SMS)
app.get('/api/messages/type/:type', async (req, res) => {
    const { type } = req.params; // 'iMessage' or 'SMS'
    const { limit = 50, offset = 0 } = req.query;

    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        const messages = await db.all(`
            SELECT 
                m.ROWID as rowid,
                m.guid,
                m.text,
                m.subject,
                m.attributedBody,
                m.handle_id,
                m.other_handle,
                m.service,
                m.service_center,
                m.account,
                m.account_guid,
                m.date,
                m.date_delivered,
                m.date_read,
                m.date_played,
                m.date_retracted,
                m.is_from_me,
                m.is_sent,
                m.is_delivered,
                m.is_read,
                m.is_prepared,
                m.is_delayed,
                m.is_emote,
                m.is_auto_reply,
                m.is_system_message,
                m.is_service_message,
                m.is_forward,
                m.was_downgraded,
                m.is_spam,
                m.has_unseen_mention,
                m.cache_has_attachments,
                m.has_dd_results,
                m.is_audio_message,
                m.is_played,
                m.group_title,
                m.thread_originator_guid,
                m.group_action_type,
                m.share_status,
                m.associated_message_guid,
                m.associated_message_type,
                m.reply_to_guid,
                m.cache_roomnames,
                m.message_summary_info,
                m.ck_sync_state,
                m.ck_record_id,
                m.ck_record_change_tag,
                m.error,
                m.schedule_type,
                m.schedule_state,
                m.needs_relay,
                m.sent_or_received_off_grid,
                h.id as sender,
                datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as readable_date
            FROM message m
            LEFT JOIN handle h ON m.handle_id = h.ROWID
            WHERE m.text IS NOT NULL AND h.id = ?
            ORDER BY m.date DESC
            LIMIT ? OFFSET ?
        `, [sender, limit, offset]);

        const formattedMessages = messages.map(msg => ({
            id: msg.id,
            sender: msg.sender,
            text: msg.text,
            date: msg.readable_date,
            service: msg.service,
            isFromMe: msg.is_from_me === 1
        }));

        await db.close();
        res.json({ success: true, messages: formattedMessages, count: formattedMessages.length });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get conversation details with participants and message count
app.get('/api/conversations/detailed', async (req, res) => {
    const { limit = 50, offset = 0 } = req.query;

    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

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
                COUNT(m.ROWID) as message_count,
                MAX(m.date) as last_message_date,
                datetime(MAX(m.date)/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as last_message_readable,
                (
                  SELECT m4.text
                  FROM message m4
                  WHERE m4.handle_id = h.ROWID AND m4.is_from_me = 0 AND (m4.text IS NOT NULL OR m4.attributedBody IS NOT NULL)
                  ORDER BY m4.date DESC
                  LIMIT 1
                ) as last_received_message,
                (
                  SELECT m5.text
                  FROM message m5
                  WHERE m5.handle_id = h.ROWID AND m5.is_from_me = 1 AND (m5.text IS NOT NULL OR m5.attributedBody IS NOT NULL)
                  ORDER BY m5.date DESC
                  LIMIT 1
                ) as last_sent_message,
                (
                  SELECT COUNT(*) FROM message m3
                  WHERE m3.handle_id = h.ROWID AND m3.is_read = 0 AND m3.is_from_me = 0
                ) as unread_count
            FROM handle h
            LEFT JOIN message m ON h.ROWID = m.handle_id
            WHERE (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
            GROUP BY h.ROWID, h.id COLLATE NOCASE, h.country
            HAVING MAX(m.date) IS NOT NULL
            ORDER BY MAX(m.date) DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);

        // Merge conversations with same sender (case insensitive) and choose the best case
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
                const convDate = conv.last_message_date || 0;
                const existingDate = existing.last_message_date || 0;
                const useConvData = convDate > existingDate;

                // Merge message counts and other data
                const merged = {
                    ...existing,
                    sender: betterSender,
                    message_count: existing.message_count + conv.message_count,
                    unread_count: existing.unread_count + conv.unread_count,
                    // Keep the most recent message date and related data
                    last_message_date: Math.max(existingDate, convDate),
                    last_message_readable: useConvData ? conv.last_message_readable : existing.last_message_readable,
                    last_received_message: useConvData ? conv.last_received_message : existing.last_received_message,
                    last_sent_message: useConvData ? conv.last_sent_message : existing.last_sent_message,
                    service: useConvData ? conv.service : existing.service
                };

                conversationMap.set(senderKey, merged);
            }
        });

        // Sort conversations by last message date (most recent first)
        const formattedConversations = Array.from(conversationMap.values())
            .sort((a, b) => (b.last_message_date || 0) - (a.last_message_date || 0))
            .map(conv => ({
                sender: conv.sender,
                country: conv.country,
                service: conv.service,
                messageCount: conv.message_count,
                lastMessageDate: conv.last_message_readable,
                lastReceivedMessage: conv.last_received_message,
                lastSentMessage: conv.last_sent_message,
                unreadCount: conv.unread_count,
                lastMessageTimestamp: conv.last_message_date // Thêm timestamp để có thể sort ở frontend nếu cần
            }));

        await db.close();
        res.json({ success: true, conversations: formattedConversations, count: formattedConversations.length });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get conversation statistics
app.get('/api/conversations/stats', async (req, res) => {
    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        const stats = await db.get(`
            SELECT 
                COUNT(DISTINCT h.ROWID) as total_contacts,
                COUNT(m.ROWID) as total_messages,
                COUNT(CASE WHEN m.is_from_me = 1 THEN 1 END) as sent_messages,
                COUNT(CASE WHEN m.is_from_me = 0 THEN 1 END) as received_messages,
                COUNT(CASE WHEN m.service = 'iMessage' THEN 1 END) as imessage_count,
                COUNT(CASE WHEN m.service = 'SMS' THEN 1 END) as sms_count,
                MIN(datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime')) as first_message_date,
                MAX(datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime')) as last_message_date
            FROM handle h
            LEFT JOIN message m ON h.ROWID = m.handle_id
            WHERE m.text IS NOT NULL
        `);

        await db.close();
        res.json({ success: true, stats });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get recent conversations (last 10)
app.get('/api/conversations/recent', async (req, res) => {
    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        const recentConversations = await db.all(`
            SELECT 
                h.id as sender,
                h.country,
                COUNT(m.ROWID) as message_count,
                MAX(m.date) as last_message_timestamp,
                datetime(MAX(m.date)/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as last_message_date,
                (
                  SELECT m2.text
                  FROM message m2
                  WHERE m2.handle_id = h.ROWID AND m2.is_from_me = 0 AND (m2.text IS NOT NULL OR m2.attributedBody IS NOT NULL)
                  ORDER BY m2.date DESC
                  LIMIT 1
                ) as last_message
            FROM handle h
            LEFT JOIN message m ON h.ROWID = m.handle_id
            WHERE (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
            GROUP BY h.ROWID, h.id COLLATE NOCASE, h.country
            HAVING MAX(m.date) IS NOT NULL
            ORDER BY MAX(m.date) DESC
            LIMIT 10
        `);

        // Merge conversations with same sender (case insensitive)
        const conversationMap = new Map();

        recentConversations.forEach(conv => {
            const senderKey = conv.sender.toLowerCase();

            if (!conversationMap.has(senderKey)) {
                conversationMap.set(senderKey, conv);
            } else {
                // Merge with existing conversation
                const existing = conversationMap.get(senderKey);

                // Choose the sender with better case
                const betterSender = (conv.sender !== conv.sender.toLowerCase() && existing.sender === existing.sender.toLowerCase())
                    ? conv.sender
                    : existing.sender;

                // Determine which conversation has the most recent message
                const convTimestamp = conv.last_message_timestamp || 0;
                const existingTimestamp = existing.last_message_timestamp || 0;
                const useConvData = convTimestamp > existingTimestamp;

                // Merge data
                const merged = {
                    ...existing,
                    sender: betterSender,
                    message_count: existing.message_count + conv.message_count,
                    // Keep the most recent message date and data
                    last_message_timestamp: Math.max(existingTimestamp, convTimestamp),
                    last_message_date: useConvData ? conv.last_message_date : existing.last_message_date,
                    last_message: useConvData ? conv.last_message : existing.last_message
                };

                conversationMap.set(senderKey, merged);
            }
        });

        // Sort conversations by timestamp (most recent first) and format
        const formattedConversations = Array.from(conversationMap.values())
            .sort((a, b) => (b.last_message_timestamp || 0) - (a.last_message_timestamp || 0))
            .map(conv => ({
                sender: conv.sender,
                country: conv.country,
                messageCount: conv.message_count,
                lastMessageDate: conv.last_message_date,
                lastMessage: conv.last_message,
                lastMessageTimestamp: conv.last_message_timestamp
            }));

        await db.close();
        res.json({ success: true, conversations: formattedConversations });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get conversations sorted by last message time (optimized version)
app.get('/api/conversations/sorted', async (req, res) => {
    const { limit = 50, offset = 0 } = req.query;

    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        // Lấy conversations với thông tin tin nhắn cuối cùng
        const conversations = await db.all(`
            WITH latest_messages AS (
                SELECT 
                    h.ROWID as handle_rowid,
                    h.id as sender,
                    h.country,
                    h.service,
                    MAX(m.date) as last_message_timestamp,
                    datetime(MAX(m.date)/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as last_message_date,
                    COUNT(m.ROWID) as message_count,
                    SUM(CASE WHEN m.is_read = 0 AND m.is_from_me = 0 THEN 1 ELSE 0 END) as unread_count
                FROM handle h
                LEFT JOIN message m ON h.ROWID = m.handle_id
                WHERE (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
                GROUP BY h.ROWID, h.id, h.country, h.service
                HAVING MAX(m.date) IS NOT NULL
            ),
            last_messages AS (
                SELECT 
                    lm.*,
                    (
                        SELECT m2.text
                        FROM message m2
                        WHERE m2.handle_id = lm.handle_rowid 
                        AND (m2.text IS NOT NULL OR m2.attributedBody IS NOT NULL)
                        ORDER BY m2.date DESC
                        LIMIT 1
                    ) as last_message_text,
                    (
                        SELECT CASE WHEN m3.is_from_me = 1 THEN 'sent' ELSE 'received' END
                        FROM message m3
                        WHERE m3.handle_id = lm.handle_rowid 
                        AND (m3.text IS NOT NULL OR m3.attributedBody IS NOT NULL)
                        ORDER BY m3.date DESC
                        LIMIT 1
                    ) as last_message_type
                FROM latest_messages lm
            )
            SELECT * FROM last_messages
            ORDER BY last_message_timestamp DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);

        // Merge conversations với cùng sender (case insensitive)
        const conversationMap = new Map();

        conversations.forEach(conv => {
            const senderKey = conv.sender.toLowerCase();

            if (!conversationMap.has(senderKey)) {
                conversationMap.set(senderKey, conv);
            } else {
                const existing = conversationMap.get(senderKey);

                // Choose sender với case tốt hơn
                const betterSender = (conv.sender !== conv.sender.toLowerCase() && existing.sender === existing.sender.toLowerCase())
                    ? conv.sender
                    : existing.sender;

                // Merge dựa trên tin nhắn mới nhất
                const convTimestamp = conv.last_message_timestamp || 0;
                const existingTimestamp = existing.last_message_timestamp || 0;
                const useConvData = convTimestamp > existingTimestamp;

                const merged = {
                    ...existing,
                    sender: betterSender,
                    message_count: existing.message_count + conv.message_count,
                    unread_count: existing.unread_count + conv.unread_count,
                    last_message_timestamp: Math.max(existingTimestamp, convTimestamp),
                    last_message_date: useConvData ? conv.last_message_date : existing.last_message_date,
                    last_message_text: useConvData ? conv.last_message_text : existing.last_message_text,
                    last_message_type: useConvData ? conv.last_message_type : existing.last_message_type,
                    service: useConvData ? conv.service : existing.service
                };

                conversationMap.set(senderKey, merged);
            }
        });

        // Sort và format kết quả
        const formattedConversations = Array.from(conversationMap.values())
            .sort((a, b) => (b.last_message_timestamp || 0) - (a.last_message_timestamp || 0))
            .map(conv => ({
                sender: conv.sender,
                country: conv.country,
                service: conv.service,
                messageCount: conv.message_count,
                unreadCount: conv.unread_count,
                lastMessageDate: conv.last_message_date,
                lastMessageText: conv.last_message_text,
                lastMessageType: conv.last_message_type,
                lastMessageTimestamp: conv.last_message_timestamp
            }));

        await db.close();
        res.json({
            success: true,
            conversations: formattedConversations,
            count: formattedConversations.length,
            total: formattedConversations.length
        });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get exact sender case from database
app.get('/api/sender/:query', async (req, res) => {
    const { query } = req.params;

    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        const senderRow = await db.get(`
            SELECT id FROM handle 
            WHERE id COLLATE NOCASE = ? COLLATE NOCASE
            LIMIT 1
        `, [query]);

        await db.close();

        if (senderRow) {
            res.json({
                success: true,
                sender: senderRow.id,
                found: true
            });
        } else {
            res.json({
                success: true,
                sender: query,
                found: false
            });
        }
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Cleanup and merge duplicate handles (case insensitive)
app.post('/api/cleanup-handles', async (req, res) => {
    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        // Find handles with same id (case insensitive)
        const duplicateHandles = await db.all(`
            SELECT h1.ROWID as rowid1, h1.id as id1, h2.ROWID as rowid2, h2.id as id2
            FROM handle h1
            JOIN handle h2 ON h1.id COLLATE NOCASE = h2.id COLLATE NOCASE
            WHERE h1.ROWID < h2.ROWID
        `);

        console.log(`Found ${duplicateHandles.length} duplicate handles`);

        for (const duplicate of duplicateHandles) {
            // Choose the handle with better case (prefer proper case over all lowercase)
            const keepRowId = (duplicate.id1 !== duplicate.id1.toLowerCase() && duplicate.id2 === duplicate.id2.toLowerCase())
                ? duplicate.rowid1
                : duplicate.rowid2;
            const deleteRowId = keepRowId === duplicate.rowid1 ? duplicate.rowid2 : duplicate.rowid1;

            // Update all messages to use the kept handle
            await db.run(`
                UPDATE message 
                SET handle_id = ? 
                WHERE handle_id = ?
            `, [keepRowId, deleteRowId]);

            // Update chat_handle_join to use the kept handle
            await db.run(`
                UPDATE chat_handle_join 
                SET handle_id = ? 
                WHERE handle_id = ?
            `, [keepRowId, deleteRowId]);

            // Delete the duplicate handle
            await db.run(`
                DELETE FROM handle 
                WHERE ROWID = ?
            `, [deleteRowId]);

            console.log(`Merged handle ${duplicate.id2} into ${duplicate.id1}`);
        }

        await db.close();
        res.json({
            success: true,
            message: `Cleaned up ${duplicateHandles.length} duplicate handles`,
            duplicates: duplicateHandles.length
        });
    } catch (err) {
        console.error('Cleanup error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get messages from a specific conversation (by sender)
app.get('/api/conversations/:sender/messages', async (req, res) => {
    const { sender } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        // Lấy danh sách tài khoản iMessage của chính mình
        let myAccounts = [];
        try {
            const accountsRaw = execSync("defaults read ~/Library/Preferences/com.apple.iChat.plist 'Accounts'").toString();
            const accountRegex = /AccountName\s+=\s+([^;\s]+)/g;
            let match;
            while ((match = accountRegex.exec(accountsRaw)) !== null) {
                myAccounts.push(match[1].replace(/\"/g, ''));
            }
        } catch (e) { }

        // Lấy handle_id của sender
        const handleRow = await db.get(`
            SELECT ROWID, id FROM handle 
            WHERE id COLLATE NOCASE = ? COLLATE NOCASE
            LIMIT 1
        `, [sender]);

        console.log("handle row: ", { handleRow });

        if (!handleRow) {
            await db.close();
            return res.json({ success: true, messages: [] });
        }

        const senderHandleId = handleRow.ROWID;
        const senderId = handleRow.id;

        // Lấy tất cả tin nhắn liên quan đến sender này (bao gồm cả tin nhắn lỗi)
        // Sử dụng nhiều cách để đảm bảo lấy được tất cả tin nhắn:
        // 1. Tin nhắn từ sender đến tôi
        // 2. Tin nhắn từ tôi đến sender
        // 3. Tin nhắn trong cùng chat với sender
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
            LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            WHERE 
                -- Cách 1: Tin nhắn từ sender đến tôi
                (m.handle_id = ? AND m.is_from_me = 0)
                OR 
                -- Cách 2: Tin nhắn từ tôi đến sender
                (m.is_from_me = 1 AND m.handle_id = ?)
                OR
                -- Cách 3: Tin nhắn trong cùng chat với sender (bao gồm cả tin nhắn lỗi)
                (cmj.chat_id IN (
                    SELECT DISTINCT chj.chat_id 
                    FROM chat_handle_join chj 
                    WHERE chj.handle_id = ?
                ))
            ORDER BY m.date DESC 
            LIMIT ? OFFSET ?
        `, [senderHandleId, senderHandleId, senderHandleId, limit, offset]);

        const formattedMessages = await Promise.all(messages.map(async msg => {
            // console.log({ messages: messages[0] });

            let senderId, recipients;
            let content = msg.text;



            // Nếu text null và attributedBody có dữ liệu, hoặc text chứa raw NSArchiver data
            if ((!content && msg.attributedBody)) {
                try {
                    // Import Foundation Bridge (native NSUnarchiver) and text cleaner
                    const { default: foundationBridge } = await import('./src/utils/foundationBridge.js');
                    const { default: nsArchiver } = await import('./src/utils/nsArchiver.js');

                    let rawContent = null;

                    if (msg.attributedBody) {
                        // Priority 1: Try Foundation Bridge (native NSUnarchiver) - most accurate
                        try {
                            rawContent = await foundationBridge.decode(msg.attributedBody);
                            if (rawContent) {
                                console.log(`✅ Foundation Bridge decoded message ${msg.id}: ${rawContent.length} chars`);
                                console.log(rawContent);
                                content = rawContent;
                            }
                        } catch (foundationError) {
                            console.log(`⚠️ Foundation Bridge failed for message ${msg.id}:`, foundationError.message);
                        }

                        // Priority 2: Fallback to NSArchiver if Foundation Bridge fails
                        if (!rawContent) {
                            let buf = msg.attributedBody;
                            if (!(buf instanceof Buffer)) {
                                buf = Buffer.from(buf);
                            }
                            rawContent = await nsArchiver.decode(buf);
                            if (rawContent) {
                                console.log(`✅ NSArchiver fallback decoded message ${msg.id}: ${rawContent.length} chars`);
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error decoding attributedBody:', e);
                    // Minimal final fallback
                    try {
                        const decodedText = Buffer.from(msg.attributedBody).toString('utf-8')
                            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove only dangerous control chars
                            .trim();
                        content = decodedText || '[Error decoding attributedBody]';
                    } catch (fallbackError) {
                        content = '[Error decoding attributedBody]';
                    }
                }
            }
            if (msg.is_from_me === 1) {
                senderId = 'me';
                recipients = [sender]; // Sử dụng sender gốc từ URL parameter
            } else {
                senderId = msg.handle_id_text || msg.handle_rowid || null;
                recipients = ['me'];
            }

            // Xác định loại tin nhắn (SMS/iMessage)
            let messageType = 'unknown';
            let serviceInfo = {
                type: msg.service || msg.handle_service || 'unknown',
                center: msg.service_center || null,
                account: msg.account || null
            };

            // Phân loại tin nhắn dựa trên service
            if (serviceInfo.type === 'iMessage') {
                messageType = 'iMessage';
            } else if (serviceInfo.type === 'SMS') {
                messageType = 'SMS';
            } else if (serviceInfo.type === 'RCS') {
                messageType = 'RCS';
            } else {
                // Fallback: dựa vào service_center để xác định SMS
                if (serviceInfo.center) {
                    messageType = 'SMS';
                    serviceInfo.type = 'SMS';
                } else {
                    messageType = 'iMessage'; // Mặc định là iMessage nếu không có service_center
                    serviceInfo.type = 'iMessage';
                }
            }

            return {
                id: msg.id,
                text: content,
                date: msg.readable_date,
                is_from_me: msg.is_from_me,
                service: msg.service,
                handle_id: msg.handle_id_text || msg.handle_rowid || null,
                isFromMe: msg.is_from_me === 1,
                sender: senderId,
                recipients,
                isRead: msg.is_read === 1,
                isSent: msg.is_sent === 1,
                isDelivered: msg.is_delivered === 1,
                error: msg.error,
                dateRead: msg.date_read ? new Date(msg.date_read / 1000000000 * 1000 + Date.UTC(2001, 0, 1)) : null,
                dateDelivered: msg.date_delivered ? new Date(msg.date_delivered / 1000000000 * 1000 + Date.UTC(2001, 0, 1)) : null,
                // Thông tin service mới
                messageType: messageType,
                serviceInfo: serviceInfo,
                // Badge hiển thị loại tin nhắn
                typeBadge: messageType === 'iMessage' ? '💬' : messageType === 'SMS' ? '📱' : '❓'
            };
        }));

        await db.close();
        res.json({ success: true, messages: formattedMessages });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Đánh dấu tin nhắn đã đọc cho một cuộc trò chuyện
app.post('/api/conversations/:sender/mark-read', async (req, res) => {
    const { sender } = req.params;
    try {
        const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
        await db.run(
            `UPDATE message SET is_read = 1 WHERE is_from_me = 0 AND handle_id = (SELECT ROWID FROM handle WHERE id = ?) AND is_read = 0`,
            [sender]
        );
        await db.close();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get message statistics
app.get('/api/stats', async (req, res) => {
    try {
        const logContent = await fs.readFile(process.env.LOG_PATH, 'utf8');
        const logs = logContent.trim().split('\n').filter(line => line).map(line => JSON.parse(line));

        const stats = {
            total: logs.length,
            sent: logs.filter(log => log.status === 'sent').length,
            received: logs.filter(log => log.status === 'received').length,
            failed: logs.filter(log => log.status === 'failed').length,
            conversations: [...new Set(logs.filter(log => log.chatId).map(log => log.chatId))].length,
            lastActivity: logs.length > 0 ? logs[logs.length - 1].timestamp : null
        };

        res.json({ success: true, stats });
    } catch (err) {
        res.status(500).json({ error: 'Không thể đọc thống kê' });
    }
});

// Check service type (iMessage or SMS) for a phone/email
app.get('/api/check-service', async (req, res) => {
    const { to } = req.query;
    if (!to) return res.status(400).json({ error: 'Missing to parameter' });
    const script = `
      tell application \"Messages\"
        set target to \"${to}\"
        set found to false
        repeat with svc in services
          try
            set bud to buddy target of svc
            set found to true
            set serviceType to service type of svc
            exit repeat
          end try
        end repeat
        if found then
          return serviceType
        else
          return \"SMS\"
        end if
      end tell
    `;
    require('child_process').exec(`osascript -e '${script}'`, (err, stdout) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ service: stdout.trim() });
    });
});

// Check iMessage support for email/phone (database first, fallback AppleScript)
app.get('/api/check-imessage', async (req, res) => {
    const { to } = req.query;
    if (!to) {
        return res.status(400).json({ error: 'Missing to parameter' });
    }

    // 1. Check in database first
    try {
        const db = await open({
            filename: process.env.MESSAGES_DB_PATH || `${process.env.HOME}/Library/Messages/chat.db`,
            driver: sqlite3.Database
        });
        const handle = await db.get('SELECT service FROM handle WHERE id = ?', [to]);
        await db.close();
        if (handle && handle.service) {
            if (handle.service === 'iMessage') {
                return res.json({
                    supportsIMessage: true,
                    service: 'iMessage',
                    isAvailable: true,
                    message: 'Hỗ trợ iMessage (từ lịch sử chat)'
                });
            } else if (handle.service === 'SMS') {
                return res.json({
                    supportsIMessage: false,
                    service: 'SMS',
                    isAvailable: false,
                    message: 'Không hỗ trợ iMessage (từ lịch sử chat)'
                });
            }
        }
    } catch (err) {
        // Nếu lỗi DB, vẫn fallback AppleScript
        console.error('DB check error:', err);
    }

    // 2. Fallback AppleScript
    try {
        const script = `tell application "Messages"
            try
                set svc to 1st service whose service type = iMessage
                set bud to buddy "${to}" of svc
                set serviceType to service type of svc
                set isAvailable to available of bud
                return {serviceType, isAvailable}
            on error errMsg
                return {"error", errMsg}
            end try
        end tell`;
        const { exec } = await import('child_process');
        exec(`osascript -e '${script}'`, (err, stdout) => {
            if (err) {
                console.error('Check iMessage error:', err);
                return res.status(500).json({
                    supportsIMessage: false,
                    service: 'unknown',
                    error: err.message,
                    message: 'Lỗi khi kiểm tra iMessage support'
                });
            }
            const result = stdout.trim();
            if (result.startsWith('error:')) {
                return res.json({
                    supportsIMessage: false,
                    service: 'unknown',
                    error: result.replace('error:', '').trim(),
                    message: 'Không thể kiểm tra hoặc không hỗ trợ iMessage'
                });
            }
            const [serviceType, isAvailable] = result.split(', ');
            const supportsIMessage = serviceType === 'iMessage' && isAvailable === 'true';
            res.json({
                supportsIMessage,
                service: serviceType,
                isAvailable: isAvailable === 'true',
                message: supportsIMessage
                    ? 'Hỗ trợ iMessage (AppleScript realtime)'
                    : 'Không hỗ trợ iMessage hoặc không khả dụng (AppleScript realtime)'
            });
        });
    } catch (err) {
        console.error('Check iMessage error:', err);
        res.status(500).json({
            supportsIMessage: false,
            service: 'unknown',
            error: err.message,
            message: 'Lỗi khi kiểm tra iMessage support'
        });
    }
});

// Lấy toàn bộ email và số điện thoại iMessage đang hoạt động
app.get('/api/imessage/accounts', async (req, res) => {
    try {
        // Đọc thông tin tài khoản iMessage từ file cấu hình
        let accountsRaw = '';
        try {
            accountsRaw = execSync("defaults read ~/Library/Preferences/com.apple.iChat.plist 'Accounts'").toString();
        } catch (e) {
            return res.status(500).json({ success: false, error: 'Không thể đọc file cấu hình iMessage' });
        }
        // Tìm tất cả AccountName (email hoặc số điện thoại)
        const accountRegex = /AccountName\s+=\s+([^;\s]+)/g;
        let match;
        const accounts = [];
        while ((match = accountRegex.exec(accountsRaw)) !== null) {
            accounts.push(match[1].replace(/\"/g, ''));
        }
        // Phân loại email/số điện thoại
        const emails = accounts.filter(a => a.includes('@'));
        const phones = accounts.filter(a => !a.includes('@'));
        res.json({ success: true, emails, phones, all: accounts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Raw debug API: trả về toàn bộ dữ liệu và các field gốc của mỗi tin nhắn và các bảng liên quan
app.get('/api/raw/messages', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        // Lấy tất cả các trường của message, handle, chat, chat_message_join, attachment
        const rows = await db.all(`
            SELECT 
                m.*, 
                h.*, 
                c.*, 
                cmj.*, 
                a.*
            FROM message m
            LEFT JOIN handle h ON m.handle_id = h.ROWID
            LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            LEFT JOIN chat c ON cmj.chat_id = c.ROWID
            LEFT JOIN message_attachment_join maj ON m.ROWID = maj.message_id
            LEFT JOIN attachment a ON maj.attachment_id = a.ROWID
            ORDER BY m.date DESC
            LIMIT ?
        `, [limit]);

        // Giải mã attributedBody nếu text=null
        for (const row of rows) {
            if (row.text === null && row.attributedBody) {
                try {
                    // attributedBody có thể là Buffer hoặc Uint8Array
                    let buf = row.attributedBody;
                    if (!(buf instanceof Buffer)) {
                        buf = Buffer.from(buf);
                    }
                    row.decoded_text = await parseAttributedBody(buf);
                } catch (e) {
                    row.decoded_text = '[Error decoding attributedBody]';
                }
            }
        }

        await db.close();
        res.json({ success: true, rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Lấy toàn bộ nội dung tin nhắn từ Message.app qua AppleScript
app.get('/api/messages/appscript', async (req, res) => {
    const { exec } = await import('child_process');
    const script = `
set json to "["
tell application \"Messages\"
    set firstItem to true
    repeat with c in chats
        set chatName to name of c
        set chatService to service type of c
        set chatParticipants to participants of c as string
        repeat with m in messages of c
            set msgText to ""
            try
                set msgText to text of m
            end try
            set msgSender to sender of m as string
            set msgDate to time sent of m
            set msgFromMe to outgoing of m
            set itemJson to \"{\\\"chat\\\":\\\"\" & chatName & \"\\\",\\\"service\\\":\\\"\" & chatService & \"\\\",\\\"participants\\\":\\\"\" & chatParticipants & \"\\\",\\\"sender\\\":\\\"\" & msgSender & \"\\\",\\\"fromMe\\\":\" & msgFromMe & ",\\\"date\\\":\\\"\" & msgDate & \"\\\",\\\"text\\\":\\\"\" & msgText & \"\\\"}\"
            if firstItem then
                set json to json & itemJson
                set firstItem to false
            else
                set json to json & "," & itemJson
            end if
        end repeat
    end repeat
end tell
set json to json & "]"
return json
`;
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err, stdout, stderr) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        try {
            const messages = JSON.parse(stdout);
            res.json({ success: true, messages });
        } catch (e) {
            res.status(500).json({ success: false, error: 'Failed to parse AppleScript output', raw: stdout });
        }
    });
});

// WebSocket handling
let lastCheck = new Date().toISOString();

// Note: AppleScript polling removed - now using SQLite database monitoring

io.on('connection', socket => {
    console.log('Frontend connected to WebSocket');

    // Gửi thông tin kết nối
    socket.emit('connected', {
        timestamp: new Date().toISOString(),
        serverInfo: {
            version: '2.0.0',
            features: ['send', 'receive', 'conversations', 'stats']
        }
    });

    socket.on('disconnect', () => {
        console.log('Frontend disconnected from WebSocket');
    });

    // Event để client request conversations
    socket.on('get_conversations', async () => {
        try {
            const script = `tell application "Messages"
              try
                set svc to 1st service whose service type = iMessage
                set result to ""
                repeat with theChat in every chat of svc
                  try
                    set chatId to id of theChat as string
                    set chatName to name of theChat as string
                    set chatInfo to chatId & "|" & chatName & "|1"
                    if result is not "" then
                      set result to result & "\\n"
                    end if
                    set result to result & chatInfo
                  on error chatErr
                    log "Error processing chat: " & chatErr
                  end try
                end repeat
                return result
              on error errMsg
                return "error: " & errMsg
              end try
            end tell`;

            exec(`osascript -e '${script}'`, (err, stdout) => {
                if (err) {
                    socket.emit('conversations_error', { error: err.message });
                    return;
                }

                try {
                    const lines = (stdout || '').trim().split('\n').filter(line => line.trim());
                    const conversations = lines.map(line => {
                        const [id, name, participantCount] = line.split('|');
                        return { id, name, participantCount: Number(participantCount) };
                    });
                    socket.emit('conversations_list', { conversations });
                } catch (parseErr) {
                    socket.emit('conversations_error', { error: 'Invalid response format' });
                }
            });
        } catch (err) {
            socket.emit('conversations_error', { error: err.message });
        }
    });
});

// Ngrok configuration
let ngrokUrl = null;

async function startNgrok() {
    try {
        // Check if ngrok is enabled
        if (!NGROK_CONFIG.ENABLE_NGROK) {
            console.log('🌐 Ngrok disabled. Set ENABLE_NGROK: true in ngrok-config.js to enable');
            return;
        }

        console.log('🚀 Starting ngrok tunnel...');

        // Prepare ngrok options
        const ngrokOptions = {
            addr: PORT,
            region: NGROK_CONFIG.REGION,
            ...NGROK_CONFIG.OPTIONS
        };

        // Add auth token if available
        if (NGROK_CONFIG.NGROK_AUTH_TOKEN) {
            ngrokOptions.authtoken = NGROK_CONFIG.NGROK_AUTH_TOKEN;
        }

        // Add subdomain if specified
        if (NGROK_CONFIG.SUBDOMAIN) {
            ngrokOptions.subdomain = NGROK_CONFIG.SUBDOMAIN;
        }

        // Start ngrok tunnel
        ngrokUrl = await ngrok.connect(ngrokOptions);

        console.log('🌐 Ngrok tunnel created successfully!');
        console.log(`🔗 Public URL: ${ngrokUrl}`);
        console.log(`📱 Mobile-friendly URL: ${ngrokUrl}`);
        console.log(`🔒 HTTPS enabled: ${ngrokUrl.startsWith('https://')}`);

        // Log the ngrok URL to a file for easy access
        await fs.writeFile('./ngrok-url.txt', ngrokUrl);
        console.log('📄 Ngrok URL saved to: ./ngrok-url.txt');

        // Also log to console with QR code for easy mobile access
        console.log('\n📱 Mobile Access:');
        console.log('1. Open the URL above on your phone');
        console.log('2. Or scan this QR code (if you have qrcode-terminal installed)');

    } catch (error) {
        console.error('❌ Failed to start ngrok:', error.message);
        console.log('💡 Make sure ngrok is installed: npm install ngrok');
        console.log('💡 Or sign up at https://ngrok.com for auth token');
    }
}

const PORT = process.env.PORT || 4004;
server.listen(PORT, async () => {
    console.log(`🔵 Blue Relay Tools Server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket available on ws://localhost:${PORT}`);
    console.log(`🔑 API Key: ${process.env.API_KEY}`);
    console.log(`⏱️  Polling interval: ${process.env.POLL_INTERVAL_MS}ms`);
    console.log(`📝 Log file: ${process.env.LOG_PATH}`);

    // Start ngrok tunnel
    await startNgrok();
});

// Bắt đầu theo dõi database để realtime
startDatabaseMonitoring();


// Hàm trích xuất văn bản từ chuỗi text của một tin nhắn
function extractText(rawText) {
    // return rawText
    // Định nghĩa các điểm đánh dấu
    const startMarkers = ["\u0001+", "+\u007d\u0001"];
    const endMarker = "\u0002iI\u0001i";

    // Tìm điểm bắt đầu phù hợp
    let startIndex = -1;
    let selectedStartMarker = "";

    for (const marker of startMarkers) {
        const index = rawText.indexOf(marker);
        if (index !== -1 && (startIndex === -1 || index < startIndex)) {
            startIndex = index + marker.length;
            selectedStartMarker = marker;
        }
    }

    // Tìm điểm kết thúc
    const endIndex = rawText.indexOf(endMarker);

    // Kiểm tra nếu không tìm thấy điểm đánh dấu hoặc thứ tự không hợp lệ
    if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
        return "";
    }

    // Trích xuất văn bản
    let text = rawText.slice(startIndex, endIndex);

    // Loại bỏ các ký tự điều khiển không mong muốn (Unicode từ U+0000 đến U+001F và U+007F đến U+009F)
    text = text.replace(/[-\u001F\u007F-\u009F]/g, "");

    // Loại bỏ khoảng trắng thừa
    text = text.trim();

    // Loại bỏ các ký tự replacement character (�) và các cặp ký tự không mong muốn ở đầu và cuối
    // Loại bỏ các pattern như ��, �}, {�, }�, v.v. ở đầu văn bản
    text = text.replace(/^[�}{]+/g, "");

    // Loại bỏ các pattern như ��, �}, {�, }�, v.v. ở cuối văn bản
    text = text.replace(/[�}{]+$/g, "");

    // Loại bỏ khoảng trắng thừa sau khi đã loại bỏ các ký tự không mong muốn
    return text.trim();
}