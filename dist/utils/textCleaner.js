class TextCleaner {
    constructor() {
        this.debug = false;
    }
    enableDebug() { this.debug = true; }
    log(...args) { if (this.debug)
        console.log('[TextCleaner]', ...args); }
    extractCleanContent(rawText) {
        if (!rawText || typeof rawText !== 'string')
            return '';
        if (this.isAlreadyCleanText(rawText))
            return this.finalClean(rawText);
        const messageContent = this.findMessageContent(rawText);
        if (messageContent)
            return this.finalClean(messageContent);
        const readableContent = this.extractReadableSequences(rawText);
        if (readableContent)
            return this.finalClean(readableContent);
        return rawText;
    }
    isAlreadyCleanText(text) {
        const hasMetadata = text.includes('NSMutableAttributedString') || text.includes('NSAttributedString') || text.includes('streamtyped') || text.includes('__kIM') || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text);
        const hasNaturalContent = text.length > 50 && (text.includes('Tai khoan') || text.includes('Viettel') || text.includes('TB:') || /[a-zA-Z\s]{20,}/.test(text));
        return !hasMetadata && hasNaturalContent;
    }
    findMessageContent(text) {
        const cleanExtractionPatterns = [
            /NSString[^]*?([A-Za-z][^]*?)(?:��iI|__kIM|NSMutableAttributedString)/,
            /((?:Tai khoan|Viettel|TB:|Gói|đã|thành công|không|được|Quý khách|Chi tiết|Trân trọng)[^]*?)(?:��iI|__kIM|NSMutableAttributedString)/,
            /([A-Za-z][^]*?)(?:��iI|__kIM|NSMutableAttributedString)/
        ];
        for (const pattern of cleanExtractionPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const candidate = match[1].trim();
                if (candidate.length > 10 && this.isValidMessageContent(candidate))
                    return candidate;
            }
        }
        const vietnamesePatterns = [
            /(Tai khoan cua Quy khach[^]*?(?:Xin cam on\.|cam on\.|\.(?:\s|$)))/,
            /((?:Viettel|TB:|Gói|đã|thành công|không|được|Quý khách|Chi tiết|Trân trọng)[^]*?(?:Trân trọng\.|Chi tiết[^]*?\.|LH [0-9]+[^]*?\.|Xin cam on\.|cam on\.|\.(?:\s|$)))/,
            /((?:Tai khoan|Viettel|TB:|Gói|đã|thành công|không|được|Quý khách|Chi tiết|Trân trọng)[^]*)/
        ];
        for (const pattern of vietnamesePatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const candidate = match[1].trim();
                if (candidate.length > 10 && this.isValidMessageContent(candidate))
                    return candidate;
            }
        }
        return null;
    }
    extractReadableSequences(text) {
        const nsStringPatterns = [
            /NSString[^]*?\+([^]*?)(?:��iI|__kIM|NSDictionary)/,
            /NSString[^]*?([A-Za-z0-9\.\,\!\?\s]+)(?:��iI|__kIM|NSDictionary)/,
            /\+([A-Za-z0-9\.\,\!\?\s\u00A0-\uFFFF]+)(?:��iI|__kIM)/
        ];
        for (const pattern of nsStringPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const candidate = match[1].trim();
                if (candidate.length > 0)
                    return candidate;
            }
        }
        const cleaned = text
            .replace(/streamtyped[^]*?NSString[^]*/g, '')
            .replace(/��iI[^]*/g, '')
            .replace(/__kIM[^]*/g, '')
            .replace(/NSMutableAttributedString[^]*/g, '')
            .replace(/NSAttributedString[^]*/g, '')
            .replace(/NSObject[^]*/g, '')
            .replace(/\[[0-9]+c\]bplist[^]*/g, '')
            .trim();
        if (cleaned.length > 0 && this.isValidMessageContent(cleaned))
            return cleaned;
        return null;
    }
    isValidMessageContent(text) {
        if (!text || text.length < 1)
            return false;
        const metadataPatterns = [/^NSMutableAttributedString/, /^streamtyped/, /^__kIM/, /^\$null/, /^bplist/, /^NSKeyedArchiver/];
        for (const pattern of metadataPatterns) {
            if (pattern.test(text))
                return false;
        }
        const hasLetters = /[a-zA-Z]/.test(text);
        const hasVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/.test(text);
        const hasNumbers = /[0-9]/.test(text);
        const hasPunctuation = /[\.!?,:;]/.test(text);
        return hasLetters || hasPunctuation || hasVietnamese || (hasNumbers && text.length > 1);
    }
    finalClean(text) { return (text || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\uFEFF/g, '').replace(/\s{3,}/g, '  ').trim(); }
    processMessages(messages) { if (!Array.isArray(messages))
        return messages; return messages.map(msg => msg?.text ? { ...msg, text: this.extractCleanContent(msg.text), originalText: msg.text } : msg); }
}
const textCleaner = new TextCleaner();
export default textCleaner;
export { TextCleaner };
export const extractCleanContent = (text) => textCleaner.extractCleanContent(text);
export const processMessages = (messages) => textCleaner.processMessages(messages);
export const enableDebug = () => textCleaner.enableDebug();
//# sourceMappingURL=textCleaner.js.map