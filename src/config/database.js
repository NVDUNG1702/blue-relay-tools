import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';

dotenv.config();

// Database configuration
export const DB_CONFIG = {
    filename: process.env.MESSAGES_DB_PATH || `${process.env.HOME}/Library/Messages/chat.db`,
    driver: sqlite3.Database
};

console.log('DEBUG DB_CONFIG.filename:', DB_CONFIG.filename);

// Database connection pool
let dbConnection = null;

/**
 * Get database connection
 * @returns {Promise<Database>}
 */
export async function getDatabase() {
    if (!dbConnection) {
        dbConnection = await open(DB_CONFIG);
    }
    return dbConnection;
}

/**
 * Close database connection
 */
export async function closeDatabase() {
    if (dbConnection) {
        await dbConnection.close();
        dbConnection = null;
    }
}

/**
 * Initialize database and get last message ID
 * @returns {Promise<number>}
 */
export async function initDatabase() {
    try {
        const db = await getDatabase();
        const result = await db.get('SELECT MAX(ROWID) as maxId FROM message');
        const lastMessageId = result.maxId || 0;
        console.log(`📊 Database initialized. Last message ID: ${lastMessageId}`);
        return lastMessageId;
    } catch (err) {
        console.error('❌ Database init error:', err);
        throw err;
    }
} 