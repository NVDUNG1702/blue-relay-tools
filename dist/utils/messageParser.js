import nsArchiver from '@blue-relay-tools/utils/nsArchiver';
class MessageParser {
    async parseAttributedBody(buffer) {
        try {
            if (!buffer)
                return null;
            let buf = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
            const decodedText = await nsArchiver.decode(buf);
            return decodedText || '[Empty attributedBody]';
        }
        catch (error) {
            try {
                const fallbackText = Buffer.from(buffer).toString('utf8').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
                if (fallbackText && fallbackText.length > 0)
                    return fallbackText;
            }
            catch { }
            return '[Error decoding attributedBody]';
        }
    }
    async parseMessage(row) {
        let content = row.text;
        if (!content && row.attributedBody) {
            content = await this.parseAttributedBody(row.attributedBody);
        }
        let service = row.service || row.handle_service || (row.service_center ? 'SMS' : 'unknown');
        let messageType = service === 'iMessage' ? 'iMessage' : service === 'SMS' ? 'SMS' : service === 'RCS' ? 'RCS' : 'unknown';
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
    formatMessage(message) {
        return { id: message.id, from: message.from, to: message.to, body: message.body, timestamp: message.timestamp, isFromMe: message.isFromMe, isRead: message.isRead, service: message.service, date: message.date };
    }
    validateMessage(messageData) {
        const { to, body } = messageData || {};
        const errors = [];
        if (!to)
            errors.push('Missing recipient (to)');
        if (!body)
            errors.push('Missing message body');
        if (body && String(body).length > 1000)
            errors.push('Message too long (max 1000 characters)');
        return { isValid: errors.length === 0, errors };
    }
    sanitizeContent(content) {
        if (!content)
            return '';
        return String(content).replace(/[<>]/g, '').trim();
    }
}
export default new MessageParser();
//# sourceMappingURL=messageParser.js.map