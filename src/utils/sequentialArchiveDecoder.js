/**
 * Sequential Archive Decoder for NSAttributedString
 * Based on successful Swift implementation using NSUnarchiver
 */
class SequentialArchiveDecoder {
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
            console.log('[SequentialDecoder]', ...args);
        }
    }

    /**
     * Decode sequential archive data
     * @param {Buffer} buffer - Binary data
     * @returns {string|null} - Decoded text or null
     */
    decode(buffer) {
        try {
            if (!buffer || buffer.length === 0) {
                return null;
            }

            // Ensure we have a Buffer
            let buf = buffer;
            if (!(buf instanceof Buffer)) {
                buf = Buffer.from(buf);
            }

            this.log('Decoding sequential archive of length:', buf.length);

            // Check if this is a sequential archive (starts with specific pattern)
            if (buf.length < 10) {
                this.log('Buffer too short');
                return null;
            }

            // Look for the pattern that indicates sequential archive
            const header = buf.slice(0, 20);
            const headerStr = header.toString('utf8', 0, Math.min(20, header.length));

            if (!headerStr.includes('streamtyped')) {
                this.log('Not a sequential archive (no streamtyped header)');
                return null;
            }

            this.log('Found streamtyped header, processing as sequential archive');

            // Extract text content using the pattern from your Swift success
            return this.extractTextFromSequentialArchive(buf);

        } catch (error) {
            this.log('Decode error:', error.message);
            return null;
        }
    }

    /**
     * Extract text from sequential archive based on Swift implementation
     * @param {Buffer} buffer - Buffer containing sequential archive
     * @returns {string|null} - Extracted text or null
     */
    extractTextFromSequentialArchive(buffer) {
        try {
            // Convert to string to analyze structure
            const text = buffer.toString('utf8');

            // Look for the text content pattern based on your successful Swift decode
            // The Swift code successfully extracted the full message, so we need to find where the actual text starts

            // Pattern 1: Look for text after NSString class markers
            const nsStringPattern = /NSString[^\x20-\x7E]*([^\x00-\x1F\x7F-\x9F]*[A-Za-z][^\x00-\x1F\x7F-\x9F]*)/;
            let match = text.match(nsStringPattern);

            if (match && match[1]) {
                let candidate = match[1].trim();
                if (candidate.length > 20) {
                    this.log('Found text via NSString pattern');
                    return this.cleanExtractedText(candidate);
                }
            }

            // Pattern 2: Look for Vietnamese text patterns specifically
            const vietnamesePattern = /(Tai khoan cua Quy khach[^]*?)(?:\x86\x84|\x00|\x01)/;
            match = text.match(vietnamesePattern);

            if (match && match[1]) {
                let candidate = match[1].trim();
                this.log('Found text via Vietnamese pattern');
                return this.cleanExtractedText(candidate);
            }

            // Pattern 3: Direct byte analysis - look for readable sequences
            return this.extractByDirectByteAnalysis(buffer);

        } catch (error) {
            this.log('Text extraction error:', error.message);
            return null;
        }
    }

    /**
     * Extract text by direct byte analysis
     * @param {Buffer} buffer - Buffer to analyze
     * @returns {string|null} - Extracted text or null
     */
    extractByDirectByteAnalysis(buffer) {
        try {
            // Based on your Swift success, look for the actual text content
            // The sample bytes you provided show the text starts around byte position with "Tai khoan"

            // Find the start of actual text content
            const textStartMarkers = [
                Buffer.from('Tai khoan', 'utf8'),
                Buffer.from([84, 97, 105, 32, 107, 104, 111, 97, 110]) // "Tai khoan" in bytes
            ];

            for (const marker of textStartMarkers) {
                const startIndex = buffer.indexOf(marker);
                if (startIndex !== -1) {
                    this.log('Found text start at byte position:', startIndex);

                    // Extract from this position until we hit metadata markers
                    const endMarkers = [
                        Buffer.from([134, 132]), // Common end marker
                        Buffer.from([146, 132]), // Another end marker
                        Buffer.from([0, 134]),   // Null + marker
                    ];

                    let endIndex = buffer.length;
                    for (const endMarker of endMarkers) {
                        const foundEnd = buffer.indexOf(endMarker, startIndex);
                        if (foundEnd !== -1 && foundEnd < endIndex) {
                            endIndex = foundEnd;
                        }
                    }

                    if (endIndex > startIndex) {
                        const textBuffer = buffer.slice(startIndex, endIndex);
                        const extractedText = textBuffer.toString('utf8');
                        this.log('Extracted text by byte analysis:', extractedText.substring(0, 50) + '...');
                        return this.cleanExtractedText(extractedText);
                    }
                }
            }

            this.log('No text found by direct byte analysis');
            return null;

        } catch (error) {
            this.log('Direct byte analysis error:', error.message);
            return null;
        }
    }

    /**
     * Clean extracted text
     * @param {string} text - Raw extracted text
     * @returns {string} - Cleaned text
     */
    cleanExtractedText(text) {
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
     * Test with the sample bytes from Swift success
     * @returns {string|null} - Test result
     */
    testWithSampleBytes() {
        const sampleBytes = [
            4, 11, 115, 116, 114, 101, 97, 109, 116, 121, 112, 101, 100, 129, 232, 3,
            132, 1, 64, 132, 132, 132, 25, 78, 83, 77, 117, 116, 97, 98, 108, 101, 65,
            116, 116, 114, 105, 98, 117, 116, 101, 100, 83, 116, 114, 105, 110, 103, 0,
            132, 132, 18, 78, 83, 65, 116, 116, 114, 105, 98, 117, 116, 101, 100, 83,
            116, 114, 105, 110, 103, 0, 132, 132, 8, 78, 83, 79, 98, 106, 101, 99, 116,
            0, 133, 146, 132, 132, 132, 15, 78, 83, 77, 117, 116, 97, 98, 108, 101, 83,
            116, 114, 105, 110, 103, 1, 132, 132, 8, 78, 83, 83, 116, 114, 105, 110, 103,
            1, 149, 132, 1, 43, 129, 101, 1, 84, 97, 105, 32, 107, 104, 111, 97, 110, 32,
            99, 117, 97, 32, 81, 117, 121, 32, 107, 104, 97, 99, 104, 32, 115, 97, 112, 32,
            104, 101, 116, 46, 32, 83, 111, 97, 110, 58, 10, 49, 32, 103, 117, 105, 32,
            50, 49, 49, 32, 100, 101, 32, 99, 111, 110, 103, 32, 53, 53, 32, 112, 104, 117,
            116, 32, 110, 111, 105, 32, 109, 97, 110, 103, 32, 40, 55, 57, 52, 100, 47, 112,
            41, 44, 32, 115, 117, 32, 100, 117, 110, 103, 32, 116, 114, 111, 110, 103, 32,
            49, 53, 32, 110, 103, 97, 121, 10, 50, 32, 103, 117, 105, 32, 50, 49, 49, 32,
            100, 101, 32, 99, 111, 110, 103, 32, 51, 50, 32, 112, 104, 117, 116, 32, 110,
            103, 111, 97, 105, 32, 109, 97, 110, 103, 32, 40, 49, 46, 51, 54, 57, 100, 47,
            112, 41, 44, 32, 115, 117, 32, 100, 117, 110, 103, 32, 116, 114, 111, 110, 103,
            32, 49, 53, 32, 110, 103, 97, 121, 10, 51, 32, 103, 117, 105, 32, 50, 49, 49,
            32, 100, 101, 32, 99, 111, 110, 103, 32, 49, 48, 48, 32, 116, 105, 110, 32,
            110, 104, 97, 110, 32, 110, 111, 105, 32, 109, 97, 110, 103, 32, 40, 50, 51, 48,
            100, 47, 116, 105, 110, 41, 44, 32, 115, 117, 32, 100, 117, 110, 103, 32, 116,
            114, 111, 110, 103, 32, 49, 53, 32, 110, 103, 97, 121, 10, 52, 32, 103, 117,
            105, 32, 50, 49, 49, 32, 100, 101, 32, 99, 111, 110, 103, 32, 50, 48, 32, 116,
            105, 110, 32, 110, 104, 97, 110, 32, 110, 103, 111, 97, 105, 32, 109, 97, 110,
            103, 32, 40, 51, 49, 51, 100, 47, 116, 105, 110, 41, 44, 32, 115, 117, 32, 100,
            117, 110, 103, 32, 116, 114, 111, 110, 103, 32, 55, 32, 110, 103, 97, 121, 10,
            67, 104, 105, 32, 116, 105, 101, 116, 32, 76, 72, 32, 49, 56, 48, 48, 56, 48,
            57, 56, 32, 40, 109, 105, 101, 110, 32, 112, 104, 105, 41, 46, 134, 132, 2, 105,
            73, 1, 129, 101, 1, 146, 132, 132, 132, 12, 78, 83, 68, 105, 99, 116, 105,
            111, 110, 97, 114, 121, 0, 149, 132, 1, 105, 1, 146, 132, 152, 152, 29, 95, 95,
            107, 73, 77, 77, 101, 115, 115, 97, 103, 101, 80, 97, 114, 116, 65, 116, 116,
            114, 105, 98, 117, 116, 101, 78, 97, 109, 101, 134, 146, 132, 132, 132, 8, 78,
            83, 78, 117, 109, 98, 101, 114, 0, 132, 132, 7, 78, 83, 86, 97, 108, 117, 101,
            0, 149, 132, 1, 42, 132, 155, 155, 0, 134, 134, 134
        ];

        const buffer = Buffer.from(sampleBytes);
        this.log('Testing with sample bytes from Swift success');
        return this.decode(buffer);
    }
}

// Export singleton instance
const sequentialArchiveDecoder = new SequentialArchiveDecoder();

export default sequentialArchiveDecoder;

// Named exports for convenience
export { SequentialArchiveDecoder };
export const decode = (buffer) => sequentialArchiveDecoder.decode(buffer);
export const enableDebug = () => sequentialArchiveDecoder.enableDebug();
export const testWithSampleBytes = () => sequentialArchiveDecoder.testWithSampleBytes();