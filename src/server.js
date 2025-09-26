import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

// Import configurations
import { APP_CONFIG, validateConfig } from './config/app.js';
import { initDatabase } from './config/database.js';
import { startNgrok } from './config/ngrok.js';

// Import middleware
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Import routes
import routes from './routes/index.js';

// Import services
import messageService from './services/messageService.js';
import socketService from './services/socketService.js';
import socketCommandHandler from './services/socketCommandHandler.js';

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
        const { command, data: commandData, requestId } = data;

        console.log('🔵 API server command:', data);

        console.log(`📨 API server command: ${command}`, { requestId });

        // Handle command via socket command handler
        await socketCommandHandler.handleCommand(
            command,
            commandData,
            requestId,
            (response) => {
                // Send response back to API server
                socket.emit('device:command_response', response);
            }
        );
    });

    // Handle frontend commands
    socket.on('fe:send_command', async (data) => {
        const { deviceId, command, data: commandData, requestId } = data;

        console.log(`📨 Frontend command: ${command}`, { deviceId, requestId });

        // Handle command via socket command handler
        await socketCommandHandler.handleCommand(
            command,
            commandData,
            requestId,
            (response) => {
                socket.emit('fe:command_response', response);
            }
        );
    });

    // Handle frontend message sending
    socket.on('fe:send_message', async (data) => {
        const { deviceId, message } = data;

        console.log(`📤 Frontend sending message:`, {
            deviceId,
            to: message?.to,
            contentPreview: message?.content?.slice?.(0, 120),
            contentLength: message?.content?.length ?? 0,
            at: new Date().toISOString()
        });

        try {
            const result = await messageService.sendMessage(message.to, message.content);

            if (result.success) {
                console.log('✅ fe:send_message success', { to: message.to });
                socket.emit('fe:message_sent', {
                    success: true,
                    message: 'Message sent successfully',
                    to: message.to,
                    verification: result.verification || null
                });
            } else {
                console.warn('⚠️  fe:send_message failed', { to: message.to, error: result.error });
                socket.emit('fe:message_sent', {
                    success: false,
                    message: result.error,
                    to: message.to
                });
            }
        } catch (error) {
            console.error('❌ fe:send_message error', { to: message?.to, error: error?.message });
            socket.emit('fe:message_sent', {
                success: false,
                message: error.message,
                to: message?.to
            });
        }
    });

    // Legacy event for client to request conversations
    socket.on('get_conversations', async () => {
        try {
            const result = await messageService.getConversations(50);
            if (result.success) {
                socket.emit('conversations_list', { conversations: result.conversations });
            } else {
                socket.emit('conversations_error', { error: result.error });
            }
        } catch (error) {
            socket.emit('conversations_error', { error: error.message });
        }
    });
});

// Initialize application
async function initializeApp() {
    try {
        // Validate configuration
        validateConfig();

        // Initialize database
        await initDatabase();

        // Initialize message service
        await messageService.initialize();

        // Start database monitoring
        if (APP_CONFIG.ENABLE_DATABASE_MONITORING) {
            messageService.startMonitoring((message) => {
                // Emit new message to all connected clients
                io.emit('message.received', message);

                // Also emit to main server via socket service
                socketService.sendMessage(message);
            });
        }

        // Connect to main server via socket service (non-fatal)
        try {
            await socketService.initialize();
        } catch (error) {
            console.warn('⚠️  Socket Service init failed, running in degraded mode:', error?.message || error);
            // Attempt background reconnects using internal logic
            try { socketService.handleReconnect?.(); } catch {}
        }

        console.log('✅ Application initialized successfully (degraded mode if socket failed)');
    } catch (error) {
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

            // Start ngrok tunnel
            await startNgrok(APP_CONFIG.PORT);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');

    // Stop database monitoring
    messageService.stopMonitoring();

    // Disconnect from main server
    socketService.disconnect();

    // Close database connection
    const { closeDatabase } = await import('./config/database.js');
    await closeDatabase();

    // Stop ngrok
    const { stopNgrok } = await import('./config/ngrok.js');
    await stopNgrok();

    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down server...');

    // Stop database monitoring
    messageService.stopMonitoring();

    // Disconnect from main server
    socketService.disconnect();

    // Close database connection
    const { closeDatabase } = await import('./config/database.js');
    await closeDatabase();

    // Stop ngrok
    const { stopNgrok } = await import('./config/ngrok.js');
    await stopNgrok();

    process.exit(0);
});

// Start the server
startServer(); 