export const APP_CONFIG = {
    DATABASE_PATH: '/Users/admin/Library/Messages/chat.db',
    API_URL: 'http://localhost:3001',
    DEVICE_ID: 'dungkuro-macbook-001',
    DEVICE_NAME: 'Dungkuro MacBook',
    DEVICE_TYPE: 'macbook',
    DEVICE_VERSION: '1.0.0',
    NGROK_AUTH_TOKEN: process.env.NGROK_AUTH_TOKEN,
    NGROK_REGION: process.env.NGROK_REGION || 'us'
};
export function validateConfig(config) {
    const requiredFields = ['DATABASE_PATH', 'API_URL', 'DEVICE_ID', 'DEVICE_NAME'];
    for (const field of requiredFields) {
        if (!config[field]) {
            console.error(`Missing required config field: ${field}`);
            return false;
        }
    }
    return true;
}
