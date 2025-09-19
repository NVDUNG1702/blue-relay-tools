import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
class FoundationBridge {
    constructor() { this.debug = false; this.tempDir = tmpdir(); }
    enableDebug() { this.debug = true; }
    log(...args) { if (this.debug)
        console.log('[FoundationBridge]', ...args); }
    async decode(buffer) {
        try {
            if (!buffer || (buffer.length === 0))
                return null;
            let buf = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
            const inputFile = join(this.tempDir, `nsarchiver_input_${Date.now()}.dat`);
            const outputFile = join(this.tempDir, `nsarchiver_output_${Date.now()}.txt`);
            const scriptFile = join(this.tempDir, `nsarchiver_script_${Date.now()}.swift`);
            try {
                writeFileSync(inputFile, buf);
                const swiftScript = this.createSwiftScript(inputFile, outputFile);
                writeFileSync(scriptFile, swiftScript);
                execSync(`swift "${scriptFile}"`, { stdio: this.debug ? 'inherit' : 'pipe', timeout: 10000 });
                if (existsSync(outputFile)) {
                    const result = readFileSync(outputFile, 'utf8').trim();
                    this.cleanup([inputFile, outputFile, scriptFile]);
                    return result || null;
                }
                else {
                    this.cleanup([inputFile, scriptFile]);
                    return null;
                }
            }
            catch (error) {
                this.log('Foundation bridge error:', error?.message || error);
                this.cleanup([inputFile, outputFile, scriptFile]);
                return null;
            }
        }
        catch (error) {
            this.log('Decode error:', error?.message || error);
            return null;
        }
    }
    createSwiftScript(inputFile, outputFile) {
        return `
import Foundation

func decodeSequentialArchive(_ data: Data) -> NSAttributedString? {
    if let first = data.first, first == 0x80 {
        if #available(macOS 10.13, iOS 11, *) {
            return try? NSKeyedUnarchiver.unarchivedObject(ofClass: NSAttributedString.self, from: data)
        } else {
            return NSKeyedUnarchiver.unarchiveObject(with: data) as? NSAttributedString
        }
    }
    return NSUnarchiver.unarchiveObject(with: data) as? NSAttributedString
}

guard let data = NSData(contentsOfFile: "${inputFile}") else { print("ERROR: Could not read input file"); exit(1) }
if let attributed = decodeSequentialArchive(data as Data) {
    let result = attributed.string
    do { try result.write(toFile: "${outputFile}", atomically: true, encoding: .utf8); print("SUCCESS: Decoded \\ (result.count) characters") } catch { print("ERROR: Could not write output file: \\(error)"); exit(1) }
} else { print("ERROR: Failed to decode the archive"); exit(1) }
`;
    }
    cleanup(files) { for (const file of files) {
        try {
            if (existsSync(file))
                unlinkSync(file);
        }
        catch (error) {
            this.log('Cleanup error for', file, ':', error?.message || error);
        }
    } }
    async testWithSampleBytes() { const sampleBytes = [4, 11, 115, 116, 114, 101, 97, 109, 116, 121, 112, 101, 100, 129, 232, 3]; const buffer = Buffer.from(sampleBytes); return await this.decode(buffer); }
}
const foundationBridge = new FoundationBridge();
export default foundationBridge;
export { FoundationBridge };
export const decode = (buffer) => foundationBridge.decode(buffer);
export const enableDebug = () => foundationBridge.enableDebug();
export const testWithSampleBytes = () => foundationBridge.testWithSampleBytes();
//# sourceMappingURL=foundationBridge.js.map