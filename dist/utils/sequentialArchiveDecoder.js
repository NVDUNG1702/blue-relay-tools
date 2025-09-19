class SequentialArchiveDecoder {
    constructor() {
        this.debug = false;
    }
    enableDebug() { this.debug = true; }
    log(...args) { if (this.debug)
        console.log('[SequentialDecoder]', ...args); }
    decode(buffer) {
        try {
            if (!buffer || (buffer.length === 0))
                return null;
            const buf = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
            if (buf.length < 10)
                return null;
            const headerStr = buf.slice(0, 20).toString('utf8');
            if (!headerStr.includes('streamtyped'))
                return null;
            return this.extractTextFromSequentialArchive(buf);
        }
        catch (error) {
            this.log('Decode error:', error?.message || error);
            return null;
        }
    }
    extractTextFromSequentialArchive(buffer) {
        try {
            const text = Buffer.from(buffer).toString('utf8');
            const nsStringPattern = /NSString[^\x20-\x7E]*([^\x00-\x1F\x7F-\x9F]*[A-Za-z][^\x00-\x1F\x7F-\x9F]*)/;
            let match = text.match(nsStringPattern);
            if (match && match[1]) {
                const candidate = match[1].trim();
                if (candidate.length > 20)
                    return this.cleanExtractedText(candidate);
            }
            const vietnamesePattern = /(Tai khoan cua Quy khach[^]*?)(?:\x86\x84|\x00|\x01)/;
            match = text.match(vietnamesePattern);
            if (match && match[1])
                return this.cleanExtractedText(match[1].trim());
            return this.extractByDirectByteAnalysis(buffer);
        }
        catch (error) {
            this.log('Text extraction error:', error?.message || error);
            return null;
        }
    }
    extractByDirectByteAnalysis(buffer) {
        try {
            const markers = [Buffer.from('Tai khoan', 'utf8'), Buffer.from([84, 97, 105, 32, 107, 104, 111, 97, 110])];
            for (const marker of markers) {
                const startIndex = buffer.indexOf(marker);
                if (startIndex !== -1) {
                    const endMarkers = [Buffer.from([134, 132]), Buffer.from([146, 132]), Buffer.from([0, 134])];
                    let endIndex = buffer.length;
                    for (const endMarker of endMarkers) {
                        const foundEnd = buffer.indexOf(endMarker, startIndex);
                        if (foundEnd !== -1 && foundEnd < endIndex)
                            endIndex = foundEnd;
                    }
                    if (endIndex > startIndex) {
                        const textBuffer = buffer.slice(startIndex, endIndex);
                        return this.cleanExtractedText(textBuffer.toString('utf8'));
                    }
                }
            }
            return null;
        }
        catch (error) {
            this.log('Direct byte analysis error:', error?.message || error);
            return null;
        }
    }
    cleanExtractedText(text) { return (text || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\uFEFF/g, '').replace(/\s{3,}/g, '  ').trim(); }
}
const sequentialArchiveDecoder = new SequentialArchiveDecoder();
export default sequentialArchiveDecoder;
export { SequentialArchiveDecoder };
export const decode = (buffer) => sequentialArchiveDecoder.decode(buffer);
export const enableDebug = () => sequentialArchiveDecoder.enableDebug();
export const testWithSampleBytes = () => sequentialArchiveDecoder.decode(Buffer.from([4, 11, 115, 116]));
//# sourceMappingURL=sequentialArchiveDecoder.js.map