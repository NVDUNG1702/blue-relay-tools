import bplistParser from 'bplist-parser';
import plist from 'plist';
import sequentialDecoder from './sequentialArchiveDecoder.js';
import foundationBridge from './foundationBridge.js';

/**
 * NSArchiver/NSKeyedArchiver decoder for iMessage attributedBody
 * Minimal processing approach - preserve content, remove only essential metadata
 */
class NSArchiver {
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
            console.log('[NSArchiver]', ...args);
        }
    }

    /**
     * Decode NSKeyedArchiver data from buffer
     * @param {Buffer} buffer - Binary plist data
     * @returns {Promise<string>} - Decoded text content
     */
    async decode(buffer) {
        try {
            if (!buffer || buffer.length === 0) {
                return null;
            }

            // Ensure we have a Buffer
            let buf = buffer;
            if (!(buf instanceof Buffer)) {
                buf = Buffer.from(buf);
            }

            this.log('Decoding buffer of length:', buf.length);

            // Priority 1: Try Foundation Bridge (native NSUnarchiver) - most accurate
            try {
                const foundationResult = await foundationBridge.decode(buf);
                if (foundationResult) {
                    this.log('Successfully decoded using Foundation Bridge (native NSUnarchiver)');
                    return this.minimalClean(foundationResult);
                }
            } catch (foundationError) {
                this.log('Foundation Bridge failed:', foundationError.message);
            }

            // Priority 2: Try to parse as binary plist
            let parsed;
            try {
                parsed = bplistParser.parseBuffer(buf);
                this.log('Successfully parsed as binary plist');

                // Handle array result from bplist-parser
                if (Array.isArray(parsed) && parsed.length > 0) {
                    parsed = parsed[0];
                }

                // Extract text from NSKeyedArchiver structure
                const text = this.extractTextFromArchive(parsed);
                if (text) {
                    return this.minimalClean(text);
                }
            } catch (binaryError) {
                this.log('Binary plist parsing failed:', binaryError.message);
            }

            // Try as XML plist
            try {
                const xmlString = buf.toString('utf8');
                parsed = plist.parse(xmlString);
                this.log('Successfully parsed as XML plist');

                const text = this.extractTextFromArchive(parsed);
                if (text) {
                    return this.minimalClean(text);
                }
            } catch (xmlError) {
                this.log('XML plist parsing failed:', xmlError.message);
            }

            // Try sequential archive decoder (based on Swift NSUnarchiver success)
            const sequentialResult = sequentialDecoder.decode(buf);
            if (sequentialResult) {
                this.log('Successfully extracted using sequential archive decoder');
                return this.minimalClean(sequentialResult);
            }

            // Primary extraction method: Direct text extraction from iMessage format
            const extractedText = this.extractFromIMessageFormat(buf);
            if (extractedText) {
                this.log('Successfully extracted using iMessage format');
                return this.minimalClean(extractedText);
            }

            // Final fallback: try to extract readable sequences
            const fallbackText = this.extractReadableSequences(buf);
            if (fallbackText) {
                this.log('Extracted using fallback method');
                return this.minimalClean(fallbackText);
            }

            this.log('No text could be extracted');
            return null;

        } catch (error) {
            this.log('Decode error:', error.message);
            throw error;
        }
    }

    /**
     * TỐI ƯU: Decode nhanh nhất chỉ sử dụng Foundation Bridge
     * @param {Buffer} buffer - Binary plist data
     * @returns {Promise<string>} - Decoded text content
     */
    async decodeFast(buffer) {
        try {
            if (!buffer || buffer.length === 0) {
                return null;
            }

            // Ensure we have a Buffer
            let buf = buffer;
            if (!(buf instanceof Buffer)) {
                buf = Buffer.from(buf);
            }

            this.log('Fast decoding buffer of length:', buf.length);

            // CHỈ sử dụng Foundation Bridge (nhanh nhất)
            try {
                const foundationResult = await foundationBridge.decode(buf);
                if (foundationResult) {
                    this.log('✅ Fast decode successful using Foundation Bridge');
                    return this.minimalClean(foundationResult);
                }
            } catch (foundationError) {
                this.log('❌ Fast decode failed (Foundation Bridge):', foundationError.message);
            }

            // Nếu Foundation Bridge thất bại, trả về null để messageService xử lý
            this.log('Fast decode failed, returning null');
            return null;

        } catch (error) {
            this.log('Fast decode error:', error.message);
            return null;
        }
    }

    /**
     * Extract text from NSKeyedArchiver structure
     * @param {Object} archive - Parsed archive object
     * @returns {string} - Extracted text
     */
    extractTextFromArchive(archive) {
        if (!archive || typeof archive !== 'object') {
            return null;
        }

        this.log('Extracting text from archive structure');

        // Search through $objects array if present
        if (archive.$objects && Array.isArray(archive.$objects)) {
            this.log('Searching through $objects array');
            for (let i = 0; i < archive.$objects.length; i++) {
                const obj = archive.$objects[i];
                if (typeof obj === 'string' && obj.trim() && obj.length > 5) {
                    // Skip obvious metadata strings but be less aggressive
                    if (!this.isObviousMetadata(obj)) {
                        this.log('Found text in $objects[' + i + ']:', obj.substring(0, 50) + '...');
                        return obj;
                    }
                }
            }
        }

        // Search recursively through all properties
        const foundText = this.searchForText(archive);
        if (foundText) {
            this.log('Found text through recursive search:', foundText.substring(0, 50) + '...');
            return foundText;
        }

        this.log('No text found in archive structure');
        return null;
    }

    /**
     * Check if string is obvious metadata (more conservative)
     * @param {string} str - String to check
     * @returns {boolean} - True if obvious metadata
     */
    isObviousMetadata(str) {
        // Only filter out very obvious metadata, keep everything else
        const obviousMetadata = [
            '$null',
            '$class',
            '$classname',
            '$classes'
        ];

        // Check for exact matches or very short strings that are clearly metadata
        if (obviousMetadata.includes(str)) {
            return true;
        }

        // Only filter if it's a short string that starts with NS and has no spaces
        if (str.length < 20 && str.startsWith('NS') && !str.includes(' ')) {
            return true;
        }

        return false;
    }

    /**
     * Recursively search for text content (less aggressive filtering)
     * @param {*} obj - Object to search
     * @param {number} depth - Current recursion depth
     * @returns {string|null} - Found text or null
     */
    searchForText(obj, depth = 0) {
        if (depth > 10) return null; // Prevent infinite recursion

        if (typeof obj === 'string' && obj.trim() && obj.length > 5) {
            if (!this.isObviousMetadata(obj)) {
                return obj;
            }
        }

        if (Array.isArray(obj)) {
            for (const item of obj) {
                const result = this.searchForText(item, depth + 1);
                if (result) return result;
            }
        }

        if (obj && typeof obj === 'object') {
            // Prioritize properties that might contain text
            const textProperties = ['string', 'text', 'content', 'NSString'];
            for (const prop of textProperties) {
                if (obj[prop]) {
                    const result = this.searchForText(obj[prop], depth + 1);
                    if (result) return result;
                }
            }

            // Search all other properties
            for (const value of Object.values(obj)) {
                const result = this.searchForText(value, depth + 1);
                if (result) return result;
            }
        }

        return null;
    }

    /**
     * Extract text from iMessage NSKeyedArchiver format
     * @param {Buffer} buffer - Buffer containing iMessage data
     * @returns {string|null} - Extracted text or null
     */
    extractFromIMessageFormat(buffer) {
        try {
            const text = buffer.toString('utf8');

            // First, try to find the main text content by looking for readable sequences
            // and then finding the longest one that contains actual message content

            // Remove only dangerous control characters, keep everything else
            const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

            // Look for sequences that contain Vietnamese text or common message patterns
            const messagePatterns = [
                // Priority: Full message starting with "Tai khoan"
                /Tai khoan cua Quy khach[^]*?(?:Xin cam on\.|cam on\.|\.(?:\s|$))/g,

                // Vietnamese message patterns
                /(?:Viettel|TB:|Gói|đã|thành công|không|được|Quý khách|Chi tiết|Trân trọng)[^]*?(?:Trân trọng\.|Chi tiết[^]*?\.|\.)/g,

                // Any text that starts with common Vietnamese words and continues
                /(?:Tai khoan|Viettel|TB:|Gói|đã|thành công|không|được|Quý khách|Chi tiết|Trân trọng)[^]*/g,

                // Text with Vietnamese characters
                /[^]*[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ][^]*/g
            ];

            // Try each pattern and find the longest meaningful result
            let bestMatch = null;
            let bestLength = 0;

            for (const pattern of messagePatterns) {
                const matches = [...cleaned.matchAll(pattern)];
                for (const match of matches) {
                    const candidate = match[0];
                    if (candidate && candidate.trim().length > bestLength) {
                        // Check if this looks like actual message content
                        const trimmed = candidate.trim();
                        if (trimmed.length > 20 && !this.isObviousMetadata(trimmed)) {
                            bestMatch = trimmed;
                            bestLength = trimmed.length;
                            this.log('Found better match with length:', bestLength);
                        }
                    }
                }
            }

            if (bestMatch) {
                this.log('Found iMessage text via pattern matching');
                return bestMatch;
            }

            // Fallback: look for any substantial readable text
            const readableSequences = cleaned.match(/[^\x80-\x9F]{30,}/g);
            if (readableSequences && readableSequences.length > 0) {
                // Find the longest sequence that's not metadata
                const candidates = readableSequences
                    .filter(seq => !this.isObviousMetadata(seq))
                    .filter(seq => seq.trim().length > 20)
                    .sort((a, b) => b.length - a.length);

                if (candidates.length > 0) {
                    const best = candidates[0].trim();
                    this.log('Found longest readable sequence');
                    return best;
                }
            }

        } catch (error) {
            this.log('iMessage format extraction error:', error.message);
        }

        return null;
    }

    /**
     * Extract readable sequences with minimal processing
     * @param {Buffer} buffer - Buffer to extract from
     * @returns {string|null} - Extracted text or null
     */
    extractReadableSequences(buffer) {
        try {
            const text = buffer.toString('utf8');

            // Find sequences of readable characters (including Vietnamese)
            const readableSequences = text.match(/[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]{15,}/g);

            if (readableSequences && readableSequences.length > 0) {
                // Find the longest sequence that's not obvious metadata
                const candidates = readableSequences
                    .filter(seq => !this.isObviousMetadata(seq))
                    .filter(seq => seq.trim().length > 15)
                    .sort((a, b) => b.length - a.length);

                if (candidates.length > 0) {
                    const best = candidates[0];
                    this.log('Found longest readable sequence:', best.substring(0, 50) + '...');
                    return best;
                }
            }

        } catch (error) {
            this.log('Readable sequence extraction error:', error.message);
        }

        return null;
    }

    /**
     * Minimal text cleaning - preserve as much content as possible
     * @param {string} text - Text to clean
     * @returns {string} - Minimally cleaned text
     */
    minimalClean(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }

        return text
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove only dangerous control characters
            .replace(/\uFEFF/g, '') // Remove BOM
            .replace(/\s{3,}/g, '  ') // Reduce excessive whitespace but keep some formatting
            .trim();
    }
}

// Export singleton instance
const nsArchiver = new NSArchiver();

export default nsArchiver;

// Named exports for convenience
export { NSArchiver };
export const decode = (buffer) => nsArchiver.decode(buffer);
export const enableDebug = () => nsArchiver.enableDebug();
export const extractFromIMessageFormat = (buffer) => nsArchiver.extractFromIMessageFormat(buffer);