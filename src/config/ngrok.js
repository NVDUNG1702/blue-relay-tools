import ngrok from 'ngrok';
import { APP_CONFIG } from './app.js';

let ngrokUrl = null;
let ngrokProcess = null;

/**
 * Start ngrok tunnel
 * @param {number} port - Port to expose
 * @returns {Promise<string>} - Ngrok URL
 */
export async function startNgrok(port) {
    try {
        console.log('🚀 Starting ngrok tunnel...');

        // Configure ngrok
        const config = {
            addr: port,
            authtoken: APP_CONFIG.NGROK_AUTH_TOKEN,
            region: 'us',
            proto: 'http'
        };

        // Start ngrok
        ngrokUrl = await ngrok.connect(config);

        console.log('✅ Ngrok tunnel started successfully');
        console.log('   Public URL:', ngrokUrl);
        console.log('   Local URL:', `http://localhost:${port}`);

        // Save ngrok URL to file for external access
        const fs = await import('fs');
        const path = await import('path');

        const ngrokUrlPath = path.join(process.cwd(), 'ngrok-url.txt');
        fs.writeFileSync(ngrokUrlPath, ngrokUrl);

        console.log('📝 Ngrok URL saved to:', ngrokUrlPath);

        return ngrokUrl;

    } catch (error) {
        console.error('❌ Failed to start ngrok:', error.message);

        // If ngrok fails, continue without it
        console.log('⚠️  Continuing without ngrok tunnel');
        return null;
    }
}

/**
 * Stop ngrok tunnel
 */
export async function stopNgrok() {
    try {
        if (ngrokUrl) {
            await ngrok.kill();
            ngrokUrl = null;
            console.log('🛑 Ngrok tunnel stopped');
        }
    } catch (error) {
        console.error('❌ Error stopping ngrok:', error.message);
    }
}

/**
 * Get current ngrok URL
 * @returns {string|null} - Current ngrok URL
 */
export function getNgrokUrl() {
    return ngrokUrl;
}

/**
 * Check if ngrok is running
 * @returns {boolean} - True if ngrok is running
 */
export function isNgrokRunning() {
    return ngrokUrl !== null;
}

// Handle process termination
process.on('SIGINT', async () => {
    await stopNgrok();
});

process.on('SIGTERM', async () => {
    await stopNgrok();
}); 