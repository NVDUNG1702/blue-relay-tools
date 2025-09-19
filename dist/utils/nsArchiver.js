import bplistParser from 'bplist-parser';
import plist from 'plist';
import sequentialDecoder from '@blue-relay-tools/utils/sequentialArchiveDecoder';
import foundationBridge from '@blue-relay-tools/utils/foundationBridge';
class NSArchiver {
    constructor() { this.debug = false; }
    enableDebug() { this.debug = true; }
    log(...args) { if (this.debug)
        console.log('[NSArchiver]', ...args); }
    async decode(buffer) {
        try {
            if (!buffer || buffer.length === 0)
                return null;
            let buf = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
            this.log('Decoding buffer of length:', buf.length);
            try {
                const foundationResult = await foundationBridge.decode(buf);
                if (foundationResult)
                    return this.minimalClean(foundationResult);
            }
            catch (e) {
                this.log('Foundation Bridge failed:', e?.message);
            }
            let parsed;
            try {
                parsed = bplistParser.parseBuffer(buf);
                this.log('Successfully parsed as binary plist');
                if (Array.isArray(parsed) && parsed.length > 0)
                    parsed = parsed[0];
                const text = this.extractTextFromArchive(parsed);
                if (text)
                    return this.minimalClean(text);
            }
            catch (binaryError) {
                this.log('Binary plist parsing failed:', binaryError?.message);
            }
            try {
                const xmlString = buf.toString('utf8');
                parsed = plist.parse(xmlString);
                this.log('Successfully parsed as XML plist');
                const text = this.extractTextFromArchive(parsed);
                if (text)
                    return this.minimalClean(text);
            }
            catch (xmlError) {
                this.log('XML plist parsing failed:', xmlError?.message);
            }
            const sequentialResult = sequentialDecoder.decode(buf);
            if (sequentialResult)
                return this.minimalClean(sequentialResult);
            const extractedText = this.extractFromIMessageFormat(buf);
            if (extractedText)
                return this.minimalClean(extractedText);
            const fallbackText = this.extractReadableSequences(buf);
            if (fallbackText)
                return this.minimalClean(fallbackText);
            this.log('No text could be extracted');
            return null;
        }
        catch (error) {
            this.log('Decode error:', error?.message || error);
            throw error;
        }
    }
    extractTextFromArchive(archive) {
        if (!archive || typeof archive !== 'object')
            return null;
        this.log('Extracting text from archive structure');
        if (archive.$objects && Array.isArray(archive.$objects)) {
            this.log('Searching through $objects array');
            for (let i = 0; i < archive.$objects.length; i++) {
                const obj = archive.$objects[i];
                if (typeof obj === 'string' && obj.trim() && obj.length > 5) {
                    if (!this.isObviousMetadata(obj)) {
                        this.log('Found text in $objects[' + i + ']:', obj.substring(0, 50) + '...');
                        return obj;
                    }
                }
            }
        }
        const foundText = this.searchForText(archive);
        if (foundText) {
            this.log('Found text through recursive search:', foundText.substring(0, 50) + '...');
            return foundText;
        }
        this.log('No text found in archive structure');
        return null;
    }
    isObviousMetadata(str) {
        const obviousMetadata = ['$null', '$class', '$classname', '$classes'];
        if (obviousMetadata.includes(str))
            return true;
        if (str.length < 20 && str.startsWith('NS') && !str.includes(' '))
            return true;
        return false;
    }
    searchForText(obj, depth = 0) {
        if (depth > 10)
            return null;
        if (typeof obj === 'string' && obj.trim() && obj.length > 5) {
            if (!this.isObviousMetadata(obj))
                return obj;
        }
        if (Array.isArray(obj)) {
            for (const item of obj) {
                const result = this.searchForText(item, depth + 1);
                if (result)
                    return result;
            }
        }
        if (obj && typeof obj === 'object') {
            const textProperties = ['string', 'text', 'content', 'NSString'];
            for (const prop of textProperties) {
                if (obj[prop]) {
                    const result = this.searchForText(obj[prop], depth + 1);
                    if (result)
                        return result;
                }
            }
            for (const value of Object.values(obj)) {
                const result = this.searchForText(value, depth + 1);
                if (result)
                    return result;
            }
        }
        return null;
    }
    extractFromIMessageFormat(buffer) {
        try {
            const text = buffer.toString('utf8');
            const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
            const messagePatterns = [
                /Tai khoan cua Quy khach[^]*?(?:Xin cam on\.|cam on\.|\.(?:\s|$))/g,
                /(?:Viettel|TB:|Gói|đã|thành công|không|được|Quý khách|Chi tiết|Trân trọng)[^]*?(?:Trân trọng\.|Chi tiết[^]*?\.|\.)/g,
                /(?:Tai khoan|Viettel|TB:|Gói|đã|thành công|không|được|Quý khách|Chi tiết|Trân trọng)[^]*/g,
                /[^]*[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ][^]*/g
            ];
            let bestMatch = null;
            let bestLength = 0;
            for (const pattern of messagePatterns) {
                const matches = [...cleaned.matchAll(pattern)];
                for (const match of matches) {
                    const candidate = match[0];
                    if (candidate && candidate.trim().length > bestLength) {
                        const trimmed = candidate.trim();
                        if (trimmed.length > 20 && !this.isObviousMetadata(trimmed)) {
                            bestMatch = trimmed;
                            bestLength = trimmed.length;
                            this.log('Found better match with length:', bestLength);
                        }
                    }
                }
            }
            if (bestMatch)
                return bestMatch;
            const readableSequences = cleaned.match(/[^\x80-\x9F]{30,}/g) || [];
            if (readableSequences && readableSequences.length > 0) {
                const candidates = readableSequences.filter((seq) => !this.isObviousMetadata(seq)).filter((seq) => seq.trim().length > 20).sort((a, b) => b.length - a.length);
                if (candidates.length > 0) {
                    const best = candidates[0] || '';
                    return (best || '').trim() || null;
                }
            }
        }
        catch (error) {
            this.log('iMessage format extraction error:', error?.message || error);
        }
        return null;
    }
    extractReadableSequences(buffer) {
        try {
            const text = buffer.toString('utf8');
            const readableSequences = text.match(/[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]{15,}/g) || [];
            if (readableSequences && readableSequences.length > 0) {
                const candidates = readableSequences.filter((seq) => !this.isObviousMetadata(seq)).filter((seq) => seq.trim().length > 15).sort((a, b) => b.length - a.length);
                if (candidates.length > 0) {
                    const best = candidates[0] || '';
                    this.log('Found longest readable sequence:', best.substring(0, 50) + '...');
                    return best || null;
                }
            }
        }
        catch (error) {
            this.log('Readable sequence extraction error:', error?.message || error);
        }
        return null;
    }
    minimalClean(text) { return (text || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\uFEFF/g, '').replace(/\s{3,}/g, '  ').trim(); }
}
const nsArchiver = new NSArchiver();
export default nsArchiver;
export { NSArchiver };
export const decode = (buffer) => nsArchiver.decode(buffer);
export const enableDebug = () => nsArchiver.enableDebug();
export const extractFromIMessageFormat = (buffer) => nsArchiver.extractFromIMessageFormat(buffer);
//# sourceMappingURL=nsArchiver.js.map