export const DEVICE_CONFIG = {
    DEVICE_ID: 'dungkuro-macbook-001',
    DEVICE_NAME: 'Dungkuro MacBook',
    DEVICE_TYPE: 'macbook',
    DEVICE_VERSION: '1.0.0',
    API_URL: 'http://localhost:3001',
    DATABASE_PATH: '/Users/admin/Library/Messages/chat.db'
};
export function validateConfig(config) {
    const requiredFields = ['DEVICE_ID', 'DEVICE_NAME', 'DEVICE_TYPE', 'DEVICE_VERSION', 'API_URL', 'DATABASE_PATH'];
    for (const field of requiredFields) {
        if (!config[field]) {
            console.error(`Missing required device config field: ${field}`);
            return false;
        }
    }
    return true;
}
