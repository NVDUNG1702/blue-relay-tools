/**
 * Text cleaner utility for extracting clean message content from NSArchiver output
 * Preserves content while removing metadata and formatting artifacts
 */
class TextCleaner {
    constructor() {
        this.debug = false;
    }

    /**
     * Enable debug logging
     */
    enableDebug() {
        this.debug = true;
    }

    /**
     * Log debug information
     */
    log(...args) {
        if (this.debug) {
            console.log('[TextCleaner]', ...args);
        }
    }

    /**
     * Extract clean message content from NSArchiver decoded text
     * @param {string} rawText - Raw decoded text from NSArchiver
     * @returns {string} - Clean message content
     */
    extractCleanContent(rawText) {
        if (!rawText || typeof rawText !== 'string') {
            return '';
        }

        this.log('Processing text of length:', rawText.length);

        // If text is already clean (from Foundation Bridge), just do minimal cleaning
        if (this.isAlreadyCleanText(rawText)) {
            this.log('Text appears to be already clean from Foundation Bridge');
            return this.finalClean(rawText);
        }

        // Step 1: Find the actual message content
        const messageContent = this.findMessageContent(rawText);
        if (messageContent) {
            this.log('Found message content:', messageContent.substring(0, 50) + '...');
            return this.finalClean(messageContent);
        }

        // Step 2: Fallback - extract readable sequences
        const readableContent = this.extractReadableSequences(rawText);
        if (readableContent) {
            this.log('Found readable content:', readableContent.substring(0, 50) + '...');
            return this.finalClean(readableContent);
        }

        this.log('No clean content found');
        return rawText; // Return original if nothing better found
    }

    /**
 * Check if text is already clean (from Foundation Bridge)
 * @param {string} text - Text to check
 * @returns {boolean} - True if already clean
 */
    isAlreadyCleanText(text) {
        // Check if text doesn't contain obvious NSArchiver metadata
        const hasMetadata = text.includes('NSMutableAttributedString') ||
            text.includes('NSAttributedString') ||
            text.includes('streamtyped') ||
            text.includes('__kIM') ||
            /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text);

        // Check if text looks like natural message content
        const hasNaturalContent = text.length > 50 &&
            (text.includes('Tai khoan') ||
                text.includes('Viettel') ||
                text.includes('TB:') ||
                /[a-zA-Z\s]{20,}/.test(text));

        return !hasMetadata && hasNaturalContent;
    }

    /**
     * Find the main message content in the raw text
 * @param {string} text - Raw text
 * @returns {string|null} - Message content or null
 */
    findMessageContent(text) {
        // First, try to extract the clean message by finding text between NSString and metadata markers
        const cleanExtractionPatterns = [
            // Look for text after NSString markers and before metadata - get everything
            /NSString[^]*?([A-Za-z][^]*?)(?:��iI|__kIM|NSMutableAttributedString)/,

            // Look for Vietnamese text patterns - get full message until metadata
            /((?:Tai khoan|Viettel|TB:|Gói|đã|thành công|không|được|Quý khách|Chi tiết|Trân trọng)[^]*?)(?:��iI|__kIM|NSMutableAttributedString)/,

            // Look for any text that starts with letters and continues until metadata
            /([A-Za-z][^]*?)(?:��iI|__kIM|NSMutableAttributedString)/
        ];

        for (const pattern of cleanExtractionPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const candidate = match[1].trim();
                if (candidate.length > 10 && this.isValidMessageContent(candidate)) {
                    this.log('Found clean message content via pattern');
                    return candidate;
                }
            }
        }

        // Enhanced Vietnamese patterns to capture full messages
        const vietnamesePatterns = [
            // Full message starting with "Tai khoan" - capture everything until end
            /(Tai khoan cua Quy khach[^]*?(?:Xin cam on\.|cam on\.|\.(?:\s|$)))/,

            // Full Vietnamese message patterns - capture everything until end markers
            /((?:Viettel|TB:|Gói|đã|thành công|không|được|Quý khách|Chi tiết|Trân trọng)[^]*?(?:Trân trọng\.|Chi tiết[^]*?\.|LH [0-9]+[^]*?\.|Xin cam on\.|cam on\.|\.(?:\s|$)))/,

            // Any text starting with Vietnamese words - capture until natural end
            /((?:Tai khoan|Viettel|TB:|Gói|đã|thành công|không|được|Quý khách|Chi tiết|Trân trọng)[^]*)/
        ];

        for (const pattern of vietnamesePatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const candidate = match[1].trim();
                if (candidate.length > 10 && this.isValidMessageContent(candidate)) {
                    this.log('Found Vietnamese message content');
                    return candidate;
                }
            }
        }

        return null;
    }

    /**
     * Extract readable sequences from text
     * @param {string} text - Raw text
     * @returns {string|null} - Readable content or null
     */
    extractReadableSequences(text) {
        // Try to extract content between NSString markers
        const nsStringPatterns = [
            // Look for content after NSString marker
            /NSString[^]*?\+([^]*?)(?:��iI|__kIM|NSDictionary)/,
            /NSString[^]*?([A-Za-z0-9\.\,\!\?\s]+)(?:��iI|__kIM|NSDictionary)/,
            // Look for any readable content between markers
            /\+([A-Za-z0-9\.\,\!\?\s\u00A0-\uFFFF]+)(?:��iI|__kIM)/
        ];

        for (const pattern of nsStringPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const candidate = match[1].trim();
                if (candidate.length > 0) {
                    this.log('Found content via NSString pattern:', candidate);
                    return candidate;
                }
            }
        }

        // Remove obvious metadata markers
        const cleaned = text
            .replace(/streamtyped[^]*?NSString[^]*?/g, '') // Remove header metadata
            .replace(/��iI[^]*/g, '') // Remove trailing metadata
            .replace(/__kIM[^]*/g, '') // Remove iMessage metadata
            .replace(/NSMutableAttributedString[^]*/g, '') // Remove class metadata
            .replace(/NSAttributedString[^]*/g, '') // Remove class metadata
            .replace(/NSObject[^]*/g, '') // Remove class metadata
            .replace(/\[[0-9]+c\]bplist[^]*/g, '') // Remove bplist data
            .trim();

        if (cleaned.length > 0 && this.isValidMessageContent(cleaned)) {
            return cleaned;
        }

        return null;
    }

    /**
     * Check if text looks like valid message content
     * @param {string} text - Text to check
     * @returns {boolean} - True if valid message content
     */
    isValidMessageContent(text) {
        if (!text || text.length < 1) {
            return false;
        }

        // Check for obvious metadata patterns
        const metadataPatterns = [
            /^NSMutableAttributedString/,
            /^streamtyped/,
            /^__kIM/,
            /^\$null/,
            /^bplist/,
            /^NSKeyedArchiver/
        ];

        for (const pattern of metadataPatterns) {
            if (pattern.test(text)) {
                return false;
            }
        }

        // Check for reasonable content characteristics
        const hasLetters = /[a-zA-Z]/.test(text);
        const hasVietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/.test(text);
        const hasNumbers = /[0-9]/.test(text);
        const hasSpaces = /\s/.test(text);
        const hasPunctuation = /[\.!?,:;]/.test(text);

        // Accept if has letters, or just punctuation (like "..")
        return hasLetters || hasPunctuation || hasVietnamese || (hasNumbers && text.length > 1);
    }

    /**
     * Final cleaning of extracted content
     * @param {string} text - Text to clean
     * @returns {string} - Cleaned text
     */
    finalClean(text) {
        if (!text) {
            return '';
        }

        return text
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
            .replace(/\uFEFF/g, '') // Remove BOM
            .replace(/\s{3,}/g, '  ') // Reduce excessive whitespace
            .trim();
    }

    /**
     * Process multiple messages and extract clean content
     * @param {Array} messages - Array of message objects with text property
     * @returns {Array} - Array of messages with cleaned text
     */
    processMessages(messages) {
        if (!Array.isArray(messages)) {
            return messages;
        }

        return messages.map(msg => {
            if (msg.text) {
                const cleanText = this.extractCleanContent(msg.text);
                return {
                    ...msg,
                    text: cleanText,
                    originalText: msg.text // Keep original for debugging
                };
            }
            return msg;
        });
    }
}

// Export singleton instance
const textCleaner = new TextCleaner();

export default textCleaner;

// Named exports for convenience
export { TextCleaner };
export const extractCleanContent = (text) => textCleaner.extractCleanContent(text);
export const processMessages = (messages) => textCleaner.processMessages(messages);
export const enableDebug = () => textCleaner.enableDebug();