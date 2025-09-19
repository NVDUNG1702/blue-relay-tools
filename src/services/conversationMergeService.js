import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

/**
 * Service để merge conversations từ cả database và AppleScript
 * Loại bỏ dữ liệu trùng lặp và enrich thông tin
 */
class ConversationMergeService {
    constructor() {
        this.messageService = null;
    }

    async initialize() {
        if (!this.messageService) {
            const { default: messageService } = await import('./messageService.js');
            this.messageService = messageService;
        }
    }

    /**
     * Get conversations từ cả 2 nguồn và merge
     * @param {Object} options - Options for getting conversations
     * @returns {Promise<Object>} Merged conversations result
     */
    async getMergedConversations(options = {}) {
        const {
            limit = 50,
            includeAppleScript = true,
            includeDatabase = true,
            mergeStrategy = 'database-priority' // 'database-priority' | 'applescript-priority' | 'balanced'
        } = options;

        try {
            await this.initialize();

            // Get data từ cả 2 nguồn song song
            const [dbResult, asResult] = await Promise.allSettled([
                includeDatabase ? this.getConversationsFromDatabase(limit) : Promise.resolve({ success: false, conversations: [] }),
                includeAppleScript ? this.getConversationsFromAppleScript() : Promise.resolve({ success: false, conversations: [] })
            ]);

            const dbConversations = dbResult.status === 'fulfilled' && dbResult.value.success
                ? dbResult.value.conversations
                : [];

            const asConversations = asResult.status === 'fulfilled' && asResult.value.success
                ? asResult.value.conversations
                : [];

            console.log(`📊 Database conversations: ${dbConversations.length}`);
            console.log(`📊 AppleScript conversations: ${asConversations.length}`);

            // Merge conversations
            const mergedConversations = this.mergeConversationData(
                dbConversations,
                asConversations,
                mergeStrategy
            );

            // Statistics
            const stats = this.generateMergeStats(dbConversations, asConversations, mergedConversations);

            return {
                success: true,
                conversations: mergedConversations,
                total: mergedConversations.length,
                stats,
                sources: {
                    database: {
                        success: dbResult.status === 'fulfilled' && dbResult.value.success,
                        count: dbConversations.length,
                        error: dbResult.status === 'rejected' ? dbResult.reason.message : null
                    },
                    applescript: {
                        success: asResult.status === 'fulfilled' && asResult.value.success,
                        count: asConversations.length,
                        error: asResult.status === 'rejected' ? asResult.reason.message : null
                    }
                }
            };

        } catch (error) {
            console.error('❌ Error in getMergedConversations:', error);
            return {
                success: false,
                error: error.message,
                conversations: [],
                total: 0
            };
        }
    }

    /**
     * Get conversations từ database
     */
    async getConversationsFromDatabase(limit = 50) {
        try {
            const result = await this.messageService.getConversations(limit);

            if (!result.success) {
                throw new Error(result.error);
            }

            // Transform to standard format
            const conversations = result.conversations.map(conv => ({
                id: conv.sender,
                sender: conv.sender,
                name: this.extractNameFromSender(conv.sender),
                lastMessage: conv.lastMessage || '',
                lastMessageTime: conv.lastMessageDate
                    ? new Date(conv.lastMessageDate / 1000000000 * 1000 + Date.UTC(2001, 0, 1)).toISOString()
                    : new Date().toISOString(),
                unreadCount: conv.unreadCount || 0,
                messageCount: conv.messageCount || 0,
                messageType: conv.service === 'iMessage' ? 'iMessage' : 'SMS',
                service: conv.service || 'unknown',
                country: conv.country,
                source: 'database',
                hasDbData: true,
                hasAppleScriptData: false
            }));

            return {
                success: true,
                conversations
            };

        } catch (error) {
            console.error('❌ Database conversations error:', error);
            return {
                success: false,
                error: error.message,
                conversations: []
            };
        }
    }

    /**
     * Get conversations từ AppleScript
     */
    async getConversationsFromAppleScript() {
        try {
            const script = `tell application "Messages"
                try
                    set svc to 1st service whose service type = iMessage
                    set result to ""
                    repeat with theChat in every chat of svc
                        try
                            set chatId to id of theChat as string
                            set chatName to name of theChat as string
                            set participantCount to (count of participants of theChat)
                            set chatInfo to chatId & "|" & chatName & "|" & participantCount
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

            const { stdout, stderr } = await execAsync(`osascript -e '${script}'`);

            if (stderr) {
                console.warn('⚠️ AppleScript stderr:', stderr);
            }

            const lines = (stdout || '').trim().split('\n').filter(line => line.trim());

            if (lines.length === 0 || lines[0].startsWith('error:')) {
                throw new Error(lines[0] || 'No conversations found');
            }

            const conversations = lines.map(line => {
                const [id, name, participantCount] = line.split('|');
                return {
                    id: id || '',
                    sender: id || '',
                    name: name || this.extractNameFromSender(id),
                    participantCount: Number(participantCount) || 1,
                    lastMessage: '',
                    lastMessageTime: new Date().toISOString(),
                    unreadCount: 0,
                    messageCount: 0,
                    messageType: 'iMessage',
                    service: 'iMessage',
                    source: 'applescript',
                    hasDbData: false,
                    hasAppleScriptData: true
                };
            });

            return {
                success: true,
                conversations
            };

        } catch (error) {
            console.error('❌ AppleScript conversations error:', error);
            return {
                success: false,
                error: error.message,
                conversations: []
            };
        }
    }

    /**
     * Merge conversation data từ cả 2 nguồn
     */
    mergeConversationData(dbConversations, asConversations, strategy = 'database-priority') {
        const conversationMap = new Map();

        // Helper function để normalize sender
        const normalizeSender = (sender) => {
            if (!sender) return '';
            return sender.toLowerCase().trim();
        };

        // Helper function để choose better sender format
        const chooseBetterSender = (sender1, sender2) => {
            if (!sender1) return sender2;
            if (!sender2) return sender1;

            // Prefer phone numbers over emails
            if (sender1.includes('@') && !sender2.includes('@')) return sender2;
            if (!sender1.includes('@') && sender2.includes('@')) return sender1;

            // Prefer properly formatted phone numbers
            if (sender1.startsWith('+') && !sender2.startsWith('+')) return sender1;
            if (!sender1.startsWith('+') && sender2.startsWith('+')) return sender2;

            return sender1;
        };

        // Add database conversations first (higher priority)
        dbConversations.forEach(conv => {
            const key = normalizeSender(conv.sender);
            if (key) {
                conversationMap.set(key, {
                    ...conv,
                    hasDbData: true,
                    hasAppleScriptData: false
                });
            }
        });

        // Merge with AppleScript conversations
        asConversations.forEach(conv => {
            const key = normalizeSender(conv.sender);
            if (!key) return;

            if (conversationMap.has(key)) {
                // Merge existing conversation
                const existing = conversationMap.get(key);

                const merged = {
                    ...existing,
                    // Choose better sender format
                    sender: chooseBetterSender(existing.sender, conv.sender),
                    // Use AppleScript name if database doesn't have a good name
                    name: this.chooseBetterName(existing.name, conv.name, existing.sender),
                    // Keep database data for message info (more reliable)
                    participantCount: conv.participantCount || existing.participantCount || 1,
                    hasDbData: existing.hasDbData,
                    hasAppleScriptData: true,
                    source: 'merged'
                };

                conversationMap.set(key, merged);
            } else {
                // Add new conversation from AppleScript
                conversationMap.set(key, {
                    ...conv,
                    hasDbData: false,
                    hasAppleScriptData: true
                });
            }
        });

        // Convert to array and sort
        const mergedConversations = Array.from(conversationMap.values());

        // Sort by priority: merged > database > applescript, then by lastMessageTime
        mergedConversations.sort((a, b) => {
            // Priority by source
            const sourcePriority = { 'merged': 3, 'database': 2, 'applescript': 1 };
            const priorityDiff = (sourcePriority[b.source] || 0) - (sourcePriority[a.source] || 0);

            if (priorityDiff !== 0) return priorityDiff;

            // Then by last message time
            const timeA = new Date(a.lastMessageTime || 0);
            const timeB = new Date(b.lastMessageTime || 0);
            return timeB - timeA;
        });

        return mergedConversations;
    }

    /**
     * Choose better name between database and AppleScript
     */
    chooseBetterName(dbName, asName, sender) {
        // If AppleScript has a real name (not just phone/email), prefer it
        if (asName && asName !== sender && !asName.includes('@') && !asName.match(/^\+?\d+$/)) {
            return asName;
        }

        // If database has a real name, use it
        if (dbName && dbName !== sender && !dbName.includes('@') && !dbName.match(/^\+?\d+$/)) {
            return dbName;
        }

        // Fallback to extracted name from sender
        return this.extractNameFromSender(sender);
    }

    /**
     * Extract name from sender (phone/email)
     */
    extractNameFromSender(sender) {
        if (!sender) return 'Unknown';

        // If it's an email, extract the part before @
        if (sender.includes('@')) {
            return sender.split('@')[0];
        }

        // If it's a phone number, return as is
        return sender;
    }

    /**
     * Generate merge statistics
     */
    generateMergeStats(dbConversations, asConversations, mergedConversations) {
        const dbOnly = mergedConversations.filter(c => c.hasDbData && !c.hasAppleScriptData).length;
        const asOnly = mergedConversations.filter(c => !c.hasDbData && c.hasAppleScriptData).length;
        const merged = mergedConversations.filter(c => c.hasDbData && c.hasAppleScriptData).length;

        return {
            total: mergedConversations.length,
            databaseOnly: dbOnly,
            applescriptOnly: asOnly,
            merged: merged,
            duplicatesRemoved: (dbConversations.length + asConversations.length) - mergedConversations.length,
            sources: {
                database: {
                    total: dbConversations.length,
                    unique: dbOnly,
                    merged: merged
                },
                applescript: {
                    total: asConversations.length,
                    unique: asOnly,
                    merged: merged
                }
            }
        };
    }

    /**
     * Get detailed conversation comparison
     */
    async getConversationComparison(options = {}) {
        const result = await this.getMergedConversations(options);

        if (!result.success) {
            return result;
        }

        const comparison = {
            ...result,
            analysis: {
                databaseConversations: result.conversations.filter(c => c.hasDbData),
                applescriptConversations: result.conversations.filter(c => c.hasAppleScriptData),
                mergedConversations: result.conversations.filter(c => c.hasDbData && c.hasAppleScriptData),
                databaseOnlyConversations: result.conversations.filter(c => c.hasDbData && !c.hasAppleScriptData),
                applescriptOnlyConversations: result.conversations.filter(c => !c.hasDbData && c.hasAppleScriptData)
            }
        };

        return comparison;
    }
}

export default ConversationMergeService;