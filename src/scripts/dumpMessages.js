import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function normalizeText(text, attributedBody) {
    if (text && typeof text === 'string') return text;
    if (attributedBody && typeof attributedBody === 'string') return attributedBody;
    return '';
}

async function fetchLastMessages(limit = 100) {
    const db = await getDatabase();
    const rows = await db.all(`
        SELECT 
            m.ROWID as rowid,
            m.guid,
            m.text,
            m.attributedBody,
            m.date,
            datetime(m.date/1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') as readable_date,
            m.is_from_me,
            m.is_sent,
            m.is_delivered,
            m.is_finished,
            m.error,
            m.service,
            m.handle_id,
            h.id as sender,
            h.country
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        WHERE (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
        ORDER BY m.date DESC
        LIMIT ?
    `, [limit]);

    return rows.map(r => ({
        rowid: r.rowid,
        guid: r.guid,
        sender: r.sender || null,
        country: r.country || null,
        handle_id: r.handle_id,
        content: normalizeText(r.text, r.attributedBody),
        message_type: r.service === 'iMessage' ? 'iMessage' : (r.service || 'unknown'),
        direction: r.is_from_me === 1 ? 'outbound' : 'inbound',
        status: r.is_delivered === 1 ? 'delivered' : (r.is_sent === 1 ? 'sent' : (r.is_finished === 1 ? 'finished' : 'received')),
        is_from_me: r.is_from_me,
        is_sent: r.is_sent,
        is_delivered: r.is_delivered,
        is_finished: r.is_finished,
        error: r.error,
        service: r.service,
        date_ns_epoch: r.date,
        readable_date: r.readable_date,
        has_rich_content: !!r.attributedBody
    }));
}

async function main() {
    try {
        const limit = Number(process.env.DUMP_LIMIT || 100);
        const outDir = path.resolve(process.cwd(), 'logs');
        ensureDir(outDir);
        const outFile = path.join(outDir, 'messages.json');

        const messages = await fetchLastMessages(limit);

        fs.writeFileSync(outFile, JSON.stringify(messages, null, 2), 'utf-8');
        console.log(`✅ Wrote ${messages.length} messages to ${outFile}`);
    } catch (err) {
        console.error('❌ dumpMessages failed:', err.message || err);
        process.exit(1);
    }
}

main();





