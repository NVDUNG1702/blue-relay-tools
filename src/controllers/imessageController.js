import appleScript from '../utils/applescript.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * iMessage Controller for Blue Relay Tools
 */
class IMessageController {
    /**
     * Check iMessage support for a contact
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    checkIMessageSupport = asyncHandler(async (req, res) => {
        const { to } = req.query;

        if (!to) {
            return res.status(400).json({
                success: false,
                error: 'Contact parameter (to) is required'
            });
        }

        try {
            const result = await appleScript.checkIMessageSupport(to);
            res.json({
                success: true,
                ...result
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * Get iMessage accounts
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    getAccounts = asyncHandler(async (req, res) => {
        try {
            const result = await appleScript.getIMessageAccounts();
            res.json(result);
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * Get conversations via AppleScript
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    getConversations = asyncHandler(async (req, res) => {
        try {
            const conversations = await appleScript.getConversations();
            res.json({
                success: true,
                conversations
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * Get raw messages data
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    getRawMessages = asyncHandler(async (req, res) => {
        const limit = parseInt(req.query.limit) || 100;

        try {
            const { getDatabase } = await import('../config/database.js');
            const db = await getDatabase();

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

            // Decode attributedBody if text is null
            const messageParser = await import('../utils/messageParser.js');
            for (const row of rows) {
                if (row.text === null && row.attributedBody) {
                    try {
                        row.decoded_text = await messageParser.default.parseAttributedBody(row.attributedBody);
                    } catch (e) {
                        row.decoded_text = '[Error decoding attributedBody]';
                    }
                }
            }

            res.json({ success: true, rows });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * Get messages via AppleScript
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    getMessagesViaAppleScript = asyncHandler(async (req, res) => {
        const script = `
        set json to "["
        tell application "Messages"
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
                    set itemJson to "{\\\"chat\\\":\\\"\\" & chatName & "\\\",\\\"service\\\":\\\"\\" & chatService & "\\\",\\\"participants\\\":\\\"\\" & chatParticipants & "\\\",\\\"sender\\\":\\\"\\" & msgSender & "\\\",\\\"fromMe\\\":\\" & msgFromMe & ",\\\"date\\\":\\\"\\" & msgDate & "\\\",\\\"text\\\":\\\"\\" & msgText & "\\\"}"
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

        try {
            const result = await appleScript.execute(script);
            const messages = JSON.parse(result);
            res.json({ success: true, messages });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
}

export default new IMessageController(); 