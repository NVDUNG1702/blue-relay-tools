import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';
dotenv.config();
export const DB_CONFIG = {
    filename: process.env.MESSAGES_DB_PATH || `${process.env.HOME}/Library/Messages/chat.db`,
    driver: sqlite3.Database
};
let dbConnection = null;
export async function getDatabase() {
    if (!dbConnection) {
        dbConnection = await open(DB_CONFIG);
    }
    return dbConnection;
}
export async function closeDatabase() {
    if (dbConnection) {
        await dbConnection.close();
        dbConnection = null;
    }
}
export async function initDatabase() {
    const db = await getDatabase();
    const result = await db.get('SELECT MAX(ROWID) as maxId FROM message');
    const lastMessageId = result?.maxId || 0;
    console.log(`📊 Database initialized. Last message ID: ${lastMessageId}`);
    return lastMessageId;
}
//# sourceMappingURL=database.js.map