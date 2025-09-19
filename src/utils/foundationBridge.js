/**
 * Foundation Bridge using JSCore ↔ ObjC
 * Direct access to NSUnarchiver and NSKeyedUnarchiver
 * TỐI ƯU: Chỉ tạo temporary file 1 lần và gom tất cả tin nhắn cần decode
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

class FoundationBridge {
    constructor() {
        this.debug = false;
        this.tempDir = tmpdir();
        this.batchId = 0; // Để tạo unique batch ID
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
            console.log('[FoundationBridge]', ...args);
        }
    }

    /**
     * TỐI ƯU: Decode nhiều attributedBody cùng lúc (giống mac-imessage-api)
     * @param {Array<{id: string, buffer: Buffer}>} items - Array of items with id and buffer
     * @returns {Promise<Array<{id: string, result: string|null, success: boolean}>>} - Array of results
     */
    async batchDecode(items) {
        if (!items || items.length === 0) {
            return [];
        }

        this.log(`Batch decoding ${items.length} items`);

        try {
            // Tạo single temporary files cho batch processing
            const batchId = Date.now();
            const inputDir = join(this.tempDir, `batch_${batchId}`);
            const outputFile = join(this.tempDir, `batch_output_${batchId}.json`);
            const scriptFile = join(this.tempDir, `batch_script_${batchId}.swift`);

            // Tạo input directory
            if (!existsSync(inputDir)) {
                const { mkdirSync } = await import('fs');
                mkdirSync(inputDir, { recursive: true });
            }

            // Ghi tất cả input files
            const inputFiles = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const inputFile = join(inputDir, `${item.id}.dat`);
                writeFileSync(inputFile, item.buffer);
                inputFiles.push(inputFile);
            }

            // Tạo batch Swift script
            const swiftScript = this.createBatchSwiftScript(inputDir, outputFile);
            writeFileSync(scriptFile, swiftScript);

            this.log('Created batch Swift script:', scriptFile);

            // Execute batch Swift script
            const command = `swift "${scriptFile}"`;
            this.log('Executing batch command:', command);

            try {
                const output = execSync(command, {
                    stdio: this.debug ? 'inherit' : 'pipe',
                    timeout: 30000 // 30 second timeout cho batch
                });
                if (output) {
                    this.log('Swift script output:', output.toString());
                }
            } catch (error) {
                this.log('Swift script error:', error.message);
                // Don't throw error if script completed successfully
                if (existsSync(outputFile)) {
                    this.log('Output file exists, continuing...');
                } else {
                    throw error;
                }
            }

            // Đọc batch results
            if (existsSync(outputFile)) {
                const resultData = readFileSync(outputFile, 'utf8');
                const results = JSON.parse(resultData);
                this.log('Successfully batch decoded via Foundation');

                // Convert NSNull back to null for JavaScript
                const processedResults = results.map((result) => ({
                    id: result.id,
                    result: result.result === null ? null : result.result,
                    success: result.success,
                    error: result.error
                }));

                // Cleanup
                this.cleanup([outputFile, scriptFile]);
                this.cleanup(inputFiles);
                try {
                    const { rmSync } = require('fs');
                    rmSync(inputDir, { recursive: true, force: true });
                } catch (e) {
                    // Ignore cleanup errors
                }

                return processedResults;
            } else {
                this.log('No batch output file generated');
                this.cleanup([scriptFile]);
                this.cleanup(inputFiles);
                try {
                    const { rmSync } = require('fs');
                    rmSync(inputDir, { recursive: true, force: true });
                } catch (e) {
                    // Ignore cleanup errors
                }
                return items.map(item => ({ id: item.id, result: null, success: false }));
            }

        } catch (error) {
            this.log('Batch decode error:', error.message);
            return items.map(item => ({ id: item.id, result: null, success: false }));
        }
    }

    /**
     * Tạo Swift script để decode batch (giống mac-imessage-api)
     */
    createBatchSwiftScript(inputDir, outputFile) {
        return `
import Foundation
import ObjectiveC

// Dynamic call to avoid deprecation warnings while still supporting sequential archives
func dynamicUnarchiveSequential(_ data: Data) -> NSAttributedString? {
    guard let clsAny: AnyObject = NSClassFromString("NSUnarchiver") else { return nil }
    let selector = NSSelectorFromString("unarchiveObjectWithData:")
    // Get metaclass to access class method
    guard let meta: AnyClass = object_getClass(clsAny) else { return nil }
    guard let method = class_getClassMethod(meta, selector) else { return nil }
    let imp = method_getImplementation(method)
    typealias UnarchiveFunc = @convention(c) (AnyObject, Selector, AnyObject) -> AnyObject?
    let fn = unsafeBitCast(imp, to: UnarchiveFunc.self)
    let nsdata = data as NSData
    if let obj = fn(clsAny, selector, nsdata) as? NSAttributedString {
        return obj
    }
    return nil
}

func decodeSequentialArchive(_ data: Data) -> NSAttributedString? {
    // Nếu là keyed-archive (thường bắt đầu bằng 0x80), dùng NSKeyedUnarchiver:
    if let first = data.first, first == 0x80 {
        // macOS ≥10.13 / iOS ≥11
        if #available(macOS 10.13, iOS 11, *) {
            return try? NSKeyedUnarchiver.unarchivedObject(
                ofClass: NSAttributedString.self,
                from: data
            )
        } else {
            return NSKeyedUnarchiver.unarchiveObject(with: data)
                as? NSAttributedString
        }
    }
    // Ngược lại: sequential archive → dùng dynamic call để tránh cảnh báo deprecated
    return dynamicUnarchiveSequential(data)
}

// Get all .dat files from input directory
let fileManager = FileManager.default
let inputURL = URL(fileURLWithPath: "${inputDir}")
let datFiles = try fileManager.contentsOfDirectory(at: inputURL, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension == "dat" }

var results: [[String: Any]] = []

// Process each file
for fileURL in datFiles {
    let fileName = fileURL.deletingPathExtension().lastPathComponent
    
    do {
        let data = try Data(contentsOf: fileURL)
        
        if let attributed = decodeSequentialArchive(data) {
            let result = attributed.string
            results.append([
                "id": fileName as Any,
                "result": result as Any,
                "success": true as Any
            ])
        } else {
            results.append([
                "id": fileName as Any,
                "result": NSNull() as Any,
                "success": false as Any
            ])
        }
    } catch {
        results.append([
            "id": fileName as Any,
            "result": NSNull() as Any,
            "success": false as Any,
            "error": error.localizedDescription as Any
        ])
    }
}

// Write results to JSON file
do {
    let jsonData = try JSONSerialization.data(withJSONObject: results)
    try jsonData.write(to: URL(fileURLWithPath: "${outputFile}"))
} catch {
    print("Error writing results: \\(error)")
}
`;
    }

    /**
     * Cleanup batch files
     */
    cleanupBatch(inputDir, outputFile, scriptFile, messageFiles) {
        try {
            // Xóa input directory
            if (existsSync(inputDir)) {
                const { rmSync } = require('fs');
                rmSync(inputDir, { recursive: true, force: true });
            }
            
            // Xóa output file
            if (existsSync(outputFile)) {
                unlinkSync(outputFile);
            }
            
            // Xóa script file
            if (existsSync(scriptFile)) {
                unlinkSync(scriptFile);
            }
        } catch (error) {
            this.log('Cleanup error:', error.message);
        }
    }

    /**
     * Decode NSArchiver data using native Foundation (legacy method)
     * @param {Buffer} buffer - Binary archive data
     * @returns {Promise<string|null>} - Decoded text or null
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

            this.log('Decoding with Foundation bridge, buffer length:', buf.length);

            // Create temporary files for data exchange
            const inputFile = join(this.tempDir, `nsarchiver_input_${Date.now()}.dat`);
            const outputFile = join(this.tempDir, `nsarchiver_output_${Date.now()}.txt`);

            try {
                // Write binary data to temp file
                writeFileSync(inputFile, buf);

                // Create Swift script that uses Foundation
                const swiftScript = this.createSwiftScript(inputFile, outputFile);
                const scriptFile = join(this.tempDir, `nsarchiver_script_${Date.now()}.swift`);
                writeFileSync(scriptFile, swiftScript);

                this.log('Created Swift script:', scriptFile);

                // Execute Swift script
                const command = `swift "${scriptFile}"`;
                this.log('Executing command:', command);

                execSync(command, {
                    stdio: this.debug ? 'inherit' : 'pipe',
                    timeout: 10000 // 10 second timeout
                });

                // Read result
                if (existsSync(outputFile)) {
                    const result = readFileSync(outputFile, 'utf8').trim();
                    this.log('Successfully decoded via Foundation');

                    // Cleanup
                    this.cleanup([inputFile, outputFile, scriptFile]);

                    return result || null;
                } else {
                    this.log('No output file generated');
                    this.cleanup([inputFile, scriptFile]);
                    return null;
                }

            } catch (error) {
                this.log('Foundation bridge error:', error.message);
                this.cleanup([inputFile, outputFile, scriptFile]);
                return null;
            }

        } catch (error) {
            this.log('Decode error:', error.message);
            return null;
        }
    }

    /**
     * Create Swift script for NSUnarchiver
     * @param {string} inputFile - Path to input data file
     * @param {string} outputFile - Path to output text file
     * @returns {string} - Swift script content
     */
    createSwiftScript(inputFile, outputFile) {
        return `
import Foundation

func decodeSequentialArchive(_ data: Data) -> NSAttributedString? {
    // Nếu là keyed-archive (thường bắt đầu bằng 0x80), dùng NSKeyedUnarchiver:
    if let first = data.first, first == 0x80 {
        // macOS ≥10.13 / iOS ≥11
        if #available(macOS 10.13, iOS 11, *) {
            return try? NSKeyedUnarchiver.unarchivedObject(
                ofClass: NSAttributedString.self,
                from: data
            )
        } else {
            return NSKeyedUnarchiver.unarchiveObject(with: data)
                as? NSAttributedString
        }
    }
    // Ngược lại: sequential archive → bắt buộc dùng NSUnarchiver
    // (mặc kệ deprecated, đây là API duy nhất decode được)
    return NSUnarchiver.unarchiveObject(with: data)
        as? NSAttributedString
}

// Read input data
guard let data = NSData(contentsOfFile: "${inputFile}") else {
    print("ERROR: Could not read input file")
    exit(1)
}

// Decode using Foundation
if let attributed = decodeSequentialArchive(data as Data) {
    // Write result to output file
    let result = attributed.string
    do {
        try result.write(toFile: "${outputFile}", atomically: true, encoding: .utf8)
        print("SUCCESS: Decoded \\(result.count) characters")
    } catch {
        print("ERROR: Could not write output file: \\(error)")
        exit(1)
    }
} else {
    print("ERROR: Failed to decode the archive")
    exit(1)
}
`;
    }

    /**
     * Cleanup temporary files
     * @param {string[]} files - Array of file paths to cleanup
     */
    cleanup(files) {
        for (const file of files) {
            try {
                if (existsSync(file)) {
                    unlinkSync(file);
                }
            } catch (error) {
                this.log('Cleanup error for', file, ':', error.message);
            }
        }
    }

    /**
     * Test with sample bytes
     * @returns {Promise<string|null>} - Test result
     */
    async testWithSampleBytes() {
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
        return await this.decode(buffer);
    }
}

// Export singleton instance
const foundationBridge = new FoundationBridge();

export default foundationBridge;

// Named exports for convenience
export { FoundationBridge };
export const decode = (buffer) => foundationBridge.decode(buffer);
export const enableDebug = () => foundationBridge.enableDebug();
export const testWithSampleBytes = () => foundationBridge.testWithSampleBytes();