import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import messageService from '../services/messageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function main() {
    const to = process.env.TEST_TO || process.argv[2];
    const body = process.env.TEST_BODY || process.argv.slice(3).join(' ') || 'Hello from testSend';
    if (!to) {
        console.error('Usage: TEST_TO=recipient npm run test:send -- "message body"');
        process.exit(1);
    }
    console.log('➡️  Sending test message', { to, bodyPreview: body.slice(0, 120) });
    const result = await messageService.sendMessage(to, body);
    console.log('⬅️  Result', result);

    const outDir = path.resolve(process.cwd(), 'logs');
    ensureDir(outDir);
    const outFile = path.join(outDir, 'test-send.json');
    const record = {
        to,
        body,
        at: new Date().toISOString(),
        result
    };
    try {
        const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf-8')) : [];
        prev.push(record);
        fs.writeFileSync(outFile, JSON.stringify(prev, null, 2), 'utf-8');
        console.log(`✅ Appended result to ${outFile}`);
    } catch (e) {
        console.warn('⚠️  Failed to write test log:', e?.message || e);
    }
}

main().catch(err => {
    console.error('❌ testSend failed:', err?.message || err);
    process.exit(1);
});


