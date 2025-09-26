import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * AppleScript utility for Blue Relay Tools
 */
class AppleScriptUtil {
    /**
     * Execute AppleScript command
     * @param {string} script - AppleScript code
     * @returns {Promise<string>}
     */
    async execute(script) {
        try {
            const { stdout, stderr } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);

            if (stderr) {
                console.warn('⚠️  AppleScript stderr:', stderr);
            }

            return stdout.trim();
        } catch (error) {
            console.error('❌ AppleScript execution failed:', error.message);
            throw error;
        }
    }

    /**
     * Send message via iMessage
     * @param {string} to - Recipient (phone/email)
     * @param {string} body - Message body
     * @returns {Promise<string>}
     */
    async sendMessage(to, body) {
        console.log("[AppleScript] sendMessage called", {
            to,
            bodyPreview: typeof body === 'string' ? body.slice(0, 120) : body,
            bodyLength: typeof body === 'string' ? body.length : 0
        });

        // Escape quotes to prevent AppleScript injection
        const escapedTo = to.replace(/"/g, '\\"');
        const escapedBody = body.replace(/"/g, '\\"');

        const script = `tell application "Messages"
            try
                set svc to 1st service whose service type = iMessage
                set bud to buddy "${escapedTo}" of svc
                set msg to send "${escapedBody}" to bud
                return "success"
            on error errMsg
                return "error: " & errMsg
            end try
        end tell`;

        const execStart = Date.now();
        const res = await this.execute(script);
        const ms = Date.now() - execStart;
        console.log('[AppleScript] result', { result: res, durationMs: ms });
        return res;
    }

    /**
     * Get conversations list
     * @returns {Promise<Array>}
     */
    async getConversations() {
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

        const result = await this.execute(script);

        if (result.startsWith('error:')) {
            throw new Error(result);
        }

        const lines = result.trim().split('\n').filter(line => line.trim());
        return lines.map(line => {
            const [id, name, participantCount] = line.split('|');
            return { id, name, participantCount: Number(participantCount) };
        });
    }

    /**
     * Check iMessage support for a contact
     * @param {string} contact - Contact (phone/email)
     * @returns {Promise<Object>}
     */
    async checkIMessageSupport(contact) {
        const script = `tell application "Messages"
            try
                set svc to 1st service whose service type = iMessage
                set bud to buddy "${contact}" of svc
                set serviceType to service type of bud
                if serviceType is iMessage then
                    return "iMessage"
                else
                    return "SMS"
                end if
            on error errMsg
                return "error: " & errMsg
            end try
        end tell`;

        const result = await this.execute(script);

        if (result.startsWith('error:')) {
            return {
                supportsIMessage: false,
                service: 'unknown',
                message: result.replace('error: ', '')
            };
        }

        const supportsIMessage = result === 'iMessage';
        return {
            supportsIMessage,
            service: result,
            message: supportsIMessage ?
                'Hỗ trợ iMessage' :
                'Chỉ hỗ trợ SMS'
        };
    }

    /**
     * Get iMessage accounts
     * @returns {Promise<Object>}
     */
    async getIMessageAccounts() {
        const script = `defaults read ~/Library/Preferences/com.apple.iChat.plist 'Accounts'`;

        try {
            const result = await execAsync(script);
            const accountsRaw = result.stdout;

            // Parse account information
            const accountRegex = /AccountName\s+=\s+([^;\s]+)/g;
            let match;
            const accounts = [];

            while ((match = accountRegex.exec(accountsRaw)) !== null) {
                accounts.push(match[1].replace(/\"/g, ''));
            }

            const emails = accounts.filter(a => a.includes('@'));
            const phones = accounts.filter(a => !a.includes('@'));

            return {
                success: true,
                emails,
                phones,
                all: accounts
            };
        } catch (error) {
            return {
                success: false,
                error: 'Không thể đọc file cấu hình iMessage'
            };
        }
    }
}

export default new AppleScriptUtil(); 