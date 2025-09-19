import ngrok from 'ngrok';
import { APP_CONFIG } from '@blue-relay-tools/config/app';
import fs from 'fs';
import path from 'path';
let ngrokUrl = null;
export async function startNgrok(port) {
    try {
        console.log('🚀 Starting ngrok tunnel...');
        const config = {
            addr: port,
            authtoken: APP_CONFIG.NGROK_AUTH_TOKEN,
            region: 'us',
            proto: 'http'
        };
        ngrokUrl = await ngrok.connect(config);
        console.log('✅ Ngrok tunnel started successfully');
        const ngrokUrlPath = path.join(process.cwd(), 'ngrok-url.txt');
        fs.writeFileSync(ngrokUrlPath, ngrokUrl);
        return ngrokUrl;
    }
    catch (error) {
        console.error('❌ Failed to start ngrok:', error?.message || error);
        console.log('⚠️  Continuing without ngrok tunnel');
        return null;
    }
}
export async function stopNgrok() {
    try {
        if (ngrokUrl) {
            await ngrok.kill();
            ngrokUrl = null;
            console.log('🛑 Ngrok tunnel stopped');
        }
    }
    catch (error) {
        console.error('❌ Error stopping ngrok:', error?.message || error);
    }
}
export function getNgrokUrl() {
    return ngrokUrl;
}
export function isNgrokRunning() {
    return ngrokUrl !== null;
}
process.on('SIGINT', async () => { await stopNgrok(); });
process.on('SIGTERM', async () => { await stopNgrok(); });
//# sourceMappingURL=ngrok.js.map