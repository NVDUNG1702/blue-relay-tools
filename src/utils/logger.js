import fs from 'fs/promises';
import { APP_CONFIG } from '../config/app.js';

/**
 * Logger utility for Blue Relay Tools
 */
class Logger {
    constructor() {
        this.logPath = APP_CONFIG.LOG_PATH;
    }

    /**
     * Log message to file
     * @param {Object} logEntry - Log entry object
     */
    async logToFile(logEntry) {
        try {
            const logLine = JSON.stringify({
                ...logEntry,
                timestamp: new Date().toISOString()
            }) + '\n';

            await fs.appendFile(this.logPath, logLine);
        } catch (error) {
            console.error('❌ Failed to write to log file:', error);
        }
    }

    /**
     * Log sent message
     * @param {Object} messageData - Message data
     */
    async logSentMessage(messageData) {
        const logEntry = {
            type: 'message_sent',
            ...messageData,
            status: 'sent'
        };
        await this.logToFile(logEntry);
    }

    /**
     * Log received message
     * @param {Object} messageData - Message data
     */
    async logReceivedMessage(messageData) {
        const logEntry = {
            type: 'message_received',
            ...messageData,
            status: 'received'
        };
        await this.logToFile(logEntry);
    }

    /**
     * Log error
     * @param {string} error - Error message
     * @param {Object} context - Error context
     */
    async logError(error, context = {}) {
        const logEntry = {
            type: 'error',
            error: error.message || error,
            context,
            status: 'error'
        };
        await this.logToFile(logEntry);
        console.error('❌', error);
    }

    /**
     * Log info message
     */
    info(...args) {
        console.log('[INFO]', ...args);
    }

    /**
     * Log warning message
     */
    warn(...args) {
        console.warn('[WARN]', ...args);
    }

    /**
     * Log debug message
     */
    debug(...args) {
        console.debug('[DEBUG]', ...args);
    }

    /**
     * Log error message (sync, for compatibility)
     */
    error(...args) {
        console.error('[ERROR]', ...args);
    }

    /**
     * Get logs from file
     * @param {number} limit - Number of logs to return
     * @returns {Promise<Array>}
     */
    async getLogs(limit = 100) {
        try {
            const logContent = await fs.readFile(this.logPath, 'utf8');
            const logs = logContent.trim().split('\n')
                .filter(line => line)
                .map(line => JSON.parse(line))
                .slice(-limit);
            return logs;
        } catch (error) {
            console.error('❌ Failed to read logs:', error);
            return [];
        }
    }

    /**
     * Clear logs
     */
    async clearLogs() {
        try {
            await fs.writeFile(this.logPath, '');
            console.log('📝 Logs cleared');
        } catch (error) {
            console.error('❌ Failed to clear logs:', error);
        }
    }
}

export default new Logger(); 