import nsArchiver from './nsArchiver.js';

/**
 * Message parsing utility for Blue Relay Tools
 * Tối ưu: Chỉ sử dụng Foundation Bridge để decode nhanh nhất
 */
class MessageParser {
    /**
     * Parse attributed body buffer using ONLY Foundation Bridge (fastest method)
     * @param {Buffer} buffer - Attributed body buffer
     * @returns {Promise<string>}
     */
    async parseAttributedBody(buffer) {
        try {
            if (!buffer) {
                return null;
            }

            let buf = buffer;
            if (!(buf instanceof Buffer)) {
                buf = Buffer.from(buf);
            }

            // TỐI ƯU: Chỉ sử dụng Foundation Bridge (nhanh nhất)
            const decodedText = await nsArchiver.decodeFast(buf);
            return decodedText || '[Rich content]';
        } catch (error) {
            console.warn('⚠️ Fast decode failed, returning placeholder:', error.message);
            return '[Rich content]';
        }
    }

    /**
     * Parse message from database row
     * @param {Object} row - Database row
     * @returns {Promise<Object>}
     */
    async parseMessage(row) {
        let content = row.text;

        // If text is null and has attributedBody, decode it
        if (!content && row.attributedBody) {
            content = await this.parseAttributedBody(row.attributedBody);
        }

        // Ưu tiên lấy service từ message, sau đó đến handle, sau đó đến service_center
        let service = row.service || row.handle_service || null;
        if (!service && row.service_center) {
            service = 'SMS';
        }
        if (!service) {
            service = 'unknown';
        }
        // Phân loại messageType cho frontend
        let messageType = 'unknown';
        if (service === 'iMessage') {
            messageType = 'iMessage';
        } else if (service === 'SMS') {
            messageType = 'SMS';
        } else if (service === 'RCS') {
            messageType = 'RCS';
        }

        return {
            id: row.ROWID,
            from: row.sender,
            body: content,
            timestamp: row.readable_date,
            isFromMe: row.is_from_me === 1,
            isSent: row.is_sent === 1,
            isDelivered: row.is_delivered === 1,
            error: row.error,
            status: 'received',
            service,
            messageType,
            typeBadge: messageType === 'iMessage' ? '💬' : messageType === 'SMS' ? '📱' : '❓'
        };
    }

    /**
     * Format message for API response
     * @param {Object} message - Message object
     * @returns {Object}
     */
    formatMessage(message) {
        return {
            id: message.id,
            from: message.from,
            to: message.to,
            body: message.body,
            timestamp: message.timestamp,
            isFromMe: message.isFromMe,
            isRead: message.isRead,
            service: message.service,
            date: message.date
        };
    }

    /**
     * Validate message data
     * @param {Object} messageData - Message data
     * @returns {Object}
     */
    validateMessage(messageData) {
        const { to, body } = messageData;
        const errors = [];

        if (!to) {
            errors.push('Missing recipient (to)');
        }

        if (!body) {
            errors.push('Missing message body');
        }

        if (body && body.length > 1000) {
            errors.push('Message too long (max 1000 characters)');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Sanitize message content
     * @param {string} content - Message content
     * @returns {string}
     */
    sanitizeContent(content) {
        if (!content) return '';

        return content
            .replace(/[<>]/g, '') // Remove potential HTML tags
            .trim();
    }
}

export default new MessageParser(); 