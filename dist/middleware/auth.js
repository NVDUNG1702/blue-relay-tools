import { APP_CONFIG } from '@blue-relay-tools/config/app';
export function authenticateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({ success: false, error: 'API key required', message: 'Please provide x-api-key header' });
    }
    if (apiKey !== APP_CONFIG.API_KEY) {
        return res.status(403).json({ success: false, error: 'Invalid API key', message: 'The provided API key is invalid' });
    }
    next();
}
export function optionalAuth(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && apiKey !== APP_CONFIG.API_KEY) {
        return res.status(403).json({ success: false, error: 'Invalid API key', message: 'The provided API key is invalid' });
    }
    req.isAuthenticated = apiKey === APP_CONFIG.API_KEY;
    next();
}
//# sourceMappingURL=auth.js.map