import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
// Import configurations
import { APP_CONFIG, validateConfig } from '@blue-relay-tools/config/app.js';
import { initDatabase } from '@blue-relay-tools/config/database.js';
import { startNgrok } from '@blue-relay-tools/config/ngrok.js';
// Import middleware
import { errorHandler, notFoundHandler } from '@blue-relay-tools/middleware/errorHandler.js';
// Import routes
import routes from '@blue-relay-tools/routes/index.js';
// Import services
import messageService from '@blue-relay-tools/services/messageService.js';
import socketService from '@blue-relay-tools/services/socketService.js';
import socketCommandHandler from '@blue-relay-tools/services/socketCommandHandler.js';
// Create Express app
const app = express();
const server = createServer(app);
// Create Socket.IO server
const io = new Server(server, {
    cors: {
        origin: APP_CONFIG.CORS_ORIGIN,
        methods: ['GET', 'POST']
    }
});
// Middleware
app.use(cors({ origin: APP_CONFIG.CORS_ORIGIN }));
app.use(express.json());
// Routes
app.use('/api', routes);
// Error handling
app.use(notFoundHandler);
app.use(errorHandler);
// WebSocket handling
io.on('connection', socket => {
    console.log('🔌 Frontend connected to WebSocket');
    // Send connection info
    socket.emit('connected', {
        timestamp: new Date().toISOString(),
        serverInfo: {
            version: '2.0.0',
            features: ['send', 'receive', 'conversations', 'stats']
        }
    });
    socket.on('disconnect', () => {
        console.log('🔌 Frontend disconnected from WebSocket');
    });
    // Handle commands from API server
    socket.on('device:send_command', async (data) => {
        const { command, data: commandData, requestId } = data || {};
        console.log('🔵 API server command:', data);
        console.log(`📨 API server command: ${command}`, { requestId });
        await socketCommandHandler.handleCommand(command, commandData, requestId, (response) => {
            socket.emit('device:command_response', response);
        });
    });
    // Handle frontend commands
    socket.on('fe:send_command', async (data) => {
        const { deviceId, command, data: commandData, requestId } = data || {};
        console.log(`📨 Frontend command: ${command}`, { deviceId, requestId });
        await socketCommandHandler.handleCommand(command, commandData, requestId, (response) => {
            socket.emit('fe:command_response', response);
        });
    });
    // Handle frontend message sending
    socket.on('fe:send_message', async (data) => {
        const { deviceId, message } = data || {};
        console.log(`📤 Frontend sending message:`, { deviceId, message });
        try {
            const result = await messageService.sendMessage(message.to, message.content);
            if (result.success) {
                socket.emit('fe:message_sent', { success: true, message: 'Message sent successfully' });
            }
            else {
                socket.emit('fe:message_sent', { success: false, message: result.error });
            }
        }
        catch (error) {
            socket.emit('fe:message_sent', { success: false, message: error?.message || 'Unknown error' });
        }
    });
    // Legacy event for client to request conversations
    socket.on('get_conversations', async () => {
        try {
            const result = await messageService.getConversations(50);
            if (result.success) {
                socket.emit('conversations_list', { conversations: result.conversations });
            }
            else {
                socket.emit('conversations_error', { error: result.error });
            }
        }
        catch (error) {
            socket.emit('conversations_error', { error: error?.message || 'Unknown error' });
        }
    });
});
// Initialize application
async function initializeApp() {
    try {
        validateConfig();
        await initDatabase();
        await messageService.initialize();
        if (APP_CONFIG.ENABLE_DATABASE_MONITORING) {
            messageService.startMonitoring((message) => {
                io.emit('message.received', message);
                socketService.sendMessage(message);
            });
        }
        await socketService.initialize();
        console.log('✅ Application initialized successfully');
    }
    catch (error) {
        console.error('❌ Failed to initialize application:', error);
        process.exit(1);
    }
}
// Start server
async function startServer() {
    try {
        await initializeApp();
        server.listen(APP_CONFIG.PORT, async () => {
            console.log(`🔵 Blue Relay Tools Server running on http://localhost:${APP_CONFIG.PORT}`);
            console.log(`📡 WebSocket available on ws://localhost:${APP_CONFIG.PORT}`);
            console.log(`🔑 API Key: ${APP_CONFIG.API_KEY}`);
            console.log(`⏱️  Polling interval: ${APP_CONFIG.POLL_INTERVAL_MS}ms`);
            console.log(`📝 Log file: ${APP_CONFIG.LOG_PATH}`);
            await startNgrok(APP_CONFIG.PORT);
        });
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}
// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');
    messageService.stopMonitoring();
    socketService.disconnect();
    const { closeDatabase } = await import('@blue-relay-tools/config/database.js');
    await closeDatabase();
    const { stopNgrok } = await import('@blue-relay-tools/config/ngrok.js');
    await stopNgrok();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down server...');
    messageService.stopMonitoring();
    socketService.disconnect();
    const { closeDatabase } = await import('@blue-relay-tools/config/database.js');
    await closeDatabase();
    const { stopNgrok } = await import('@blue-relay-tools/config/ngrok.js');
    await stopNgrok();
    process.exit(0);
});
startServer();
//# sourceMappingURL=server.js.map