import dotenv from 'dotenv';

dotenv.config();

// Application configuration
export const APP_CONFIG = {
    // Server settings
    PORT: process.env.PORT || 3000,
    API_KEY: process.env.API_KEY || 'your_secret_api_key_123',
    
    // Database settings
    MESSAGES_DB_PATH: process.env.MESSAGES_DB_PATH || `${process.env.HOME}/Library/Messages/chat.db`,
    
    // Logging settings
    LOG_PATH: process.env.LOG_PATH || './message-logs.jsonl',
    POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS) || 3000,
    
    // CORS settings
    CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
    
    // Environment
    NODE_ENV: process.env.NODE_ENV || 'development',
    
    // Features
    ENABLE_NGROK: process.env.ENABLE_NGROK === 'true',
    ENABLE_WEBSOCKET: true,
    ENABLE_DATABASE_MONITORING: true
};

// Validation
export function validateConfig() {
    const required = ['API_KEY'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.warn(`⚠️  Missing environment variables: ${missing.join(', ')}`);
    }
    
    return missing.length === 0;
} 