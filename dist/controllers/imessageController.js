import appleScript from '@blue-relay-tools/utils/applescript';
import { asyncHandler } from '@blue-relay-tools/middleware/errorHandler';
class IMessageController {
    constructor() {
        this.checkIMessageSupport = asyncHandler(async (req, res) => {
            const { to } = (req.query || {});
            if (!to)
                return res.status(400).json({ success: false, error: 'Contact parameter (to) is required' });
            try {
                const result = await appleScript.checkIMessageSupport(String(to));
                res.json({ success: true, ...result });
            }
            catch (error) {
                res.status(500).json({ success: false, error: error?.message });
            }
        });
        this.getAccounts = asyncHandler(async (_req, res) => {
            try {
                const result = await appleScript.getIMessageAccounts();
                res.json(result);
            }
            catch (error) {
                res.status(500).json({ success: false, error: error?.message });
            }
        });
        this.getConversations = asyncHandler(async (_req, res) => {
            try {
                const conversations = await appleScript.getConversations();
                res.json({ success: true, conversations });
            }
            catch (error) {
                res.status(500).json({ success: false, error: error?.message });
            }
        });
        this.getRawMessages = asyncHandler(async (req, res) => {
            const limit = parseInt(String((req.query || {}).limit)) || 100;
            try {
                const { getDatabase } = await import('@blue-relay-tools/config/database.js');
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
                const messageParser = await import('@blue-relay-tools/utils/messageParser.js');
                for (const row of rows) {
                    if (row.text === null && row.attributedBody) {
                        try {
                            row.decoded_text = await messageParser.default.parseAttributedBody(row.attributedBody);
                        }
                        catch {
                            row.decoded_text = '[Error decoding attributedBody]';
                        }
                    }
                }
                res.json({ success: true, rows });
            }
            catch (error) {
                res.status(500).json({ success: false, error: error?.message });
            }
        });
        this.getMessagesViaAppleScript = asyncHandler(async (_req, res) => {
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
                    set itemJson to "{\\\"chat\\\":\\\"" & chatName & "\\\",\\\"service\\\":\\\"" & chatService & "\\\",\\\"participants\\\":\\\"" & chatParticipants & "\\\",\\\"sender\\\":\\\"" & msgSender & "\\\",\\\"fromMe\\\":" & msgFromMe & ",\\\"date\\\":\\\"" & msgDate & "\\\",\\\"text\\\":\\\"" & msgText & "\\\"}"
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
            }
            catch (error) {
                res.status(500).json({ success: false, error: error?.message });
            }
        });
    }
}
export default new IMessageController();
//# sourceMappingURL=imessageController.js.map