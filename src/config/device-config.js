import dotenv from 'dotenv';
dotenv.config();

// Device Configuration for Blue Relay Tools
export const DEVICE_CONFIG = {
    // Server Configuration
    BLUE_RELAY_SERVER_URL: process.env.BLUE_RELAY_SERVER_URL || 'http://localhost:8000',
    BLUE_RELAY_API_KEY: process.env.BLUE_RELAY_API_KEY || 'your-api-key-here',

    // Device Configuration
    DEVICE_ID: process.env.DEVICE_ID || 'dungkuro-macbook-001',
    DEVICE_NAME: process.env.DEVICE_NAME || 'Dungkuro MacBook',
    ICLOUD_EMAIL: process.env.ICLOUD_EMAIL || 'dungkuro1702@gmail.com',
    ICLOUD_PHONE: process.env.ICLOUD_PHONE || '+84346477714',

    // iMessage Database Configuration
    MESSAGES_DB_PATH: process.env.MESSAGES_DB_PATH || '/Users/admin/Library/Messages/chat.db',
    LOG_PATH: process.env.LOG_PATH || './logs/messages.log',
    POLL_INTERVAL_MS: process.env.POLL_INTERVAL_MS || 1000,

    // API Configuration
    API_KEY: process.env.API_KEY || 'your-local-api-key',
    PORT: process.env.PORT || 3000,

    // Ngrok Configuration (optional)
    NGROK_AUTH_TOKEN: process.env.NGROK_AUTH_TOKEN || 'your-ngrok-auth-token'
};

// Validate required configuration
export function validateConfig() {
    const required = ['DEVICE_ID', 'ICLOUD_EMAIL'];
    const missing = required.filter(key => !DEVICE_CONFIG[key]);

    if (missing.length > 0) {
        console.error('❌ Missing required configuration:', missing);
        console.error('Please set these environment variables or update device-config.js');
        return false;
    }

    return true;
} 