import { io } from 'socket.io-client';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DEVICE_CONFIG, validateConfig } from '../config/device-config.js';
import socketCommandHandler from './socketCommandHandler.js';

const execAsync = promisify(exec);

class SocketService {
    constructor() {
        this.socket = null;
        this.deviceInfo = null;
        this.isConnected = false;
        this.isAuthenticated = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = Number.POSITIVE_INFINITY; // retry vô hạn
        this.baseReconnectDelayMs = 3000; // 3s
        this.maxReconnectDelayMs = 60000; // 60s trần
        this.heartbeatInterval = null;
        this.pendingMessages = [];
        this.messageQueue = [];

        // Use singleton command handler instance
        this.commandHandler = socketCommandHandler;

        // Server configuration
        this.serverUrl = DEVICE_CONFIG.BLUE_RELAY_SERVER_URL;
        this.apiKey = DEVICE_CONFIG.BLUE_RELAY_API_KEY;

        // Device configuration
        this.deviceId = DEVICE_CONFIG.DEVICE_ID;
        this.deviceName = DEVICE_CONFIG.DEVICE_NAME;
        this.icloudEmail = DEVICE_CONFIG.ICLOUD_EMAIL;
        this.icloudPhone = DEVICE_CONFIG.ICLOUD_PHONE;

        // Validate configuration
        if (!validateConfig()) {
            throw new Error('Invalid device configuration');
        }
    }

    async initialize() {
        console.log('🚀 Initializing Socket Service...');

        try {
            // Get device information
            await this.getDeviceInfo();

            // Connect to server
            await this.connect();

            // Set up event handlers
            this.setupEventHandlers();

            // Authenticate device
            await this.authenticate();

            // Start heartbeat
            this.startHeartbeat();

            // Process pending messages
            this.processPendingMessages();

            console.log('✅ Socket Service initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Socket Service:', error.message);
            throw error;
        }
    }

    async getDeviceInfo() {
        try {
            console.log('📱 Getting device information...');

            // Get macOS version
            const { stdout: osVersion } = await execAsync('sw_vers -productVersion');

            // Get device model
            const { stdout: deviceModel } = await execAsync('sysctl -n hw.model');

            // Get serial number
            const { stdout: serialNumber } = await execAsync('system_profiler SPHardwareDataType | grep "Serial Number" | awk "{print \$4}"');

            // Get iCloud account info
            let icloudAccount = 'Unknown';
            try {
                const { stdout: icloudInfo } = await execAsync('defaults read MobileMeAccounts Accounts | grep AccountID | head -1 | cut -d\\" -f2');
                icloudAccount = icloudInfo.trim();
            } catch (e) {
                console.log('⚠️  Could not get iCloud account info');
            }

            // Get network information
            let networkInfo = {};
            try {
                const { stdout: wifiInfo } = await execAsync('networksetup -getairportnetwork en0');
                networkInfo.wifi = wifiInfo.trim();
            } catch (e) {
                networkInfo.wifi = 'Unknown';
            }

            this.deviceInfo = {
                os_version: osVersion.trim(),
                device_model: deviceModel.trim(),
                serial_number: serialNumber.trim(),
                icloud_account: icloudAccount,
                network_info: networkInfo,
                capabilities: {
                    imessage: true,
                    sms: true,
                    calls: false,
                    facetime: true
                },
                metadata: {
                    location: 'Local Device',
                    last_boot: new Date().toISOString(),
                    blue_relay_version: '2.0.0',
                    node_version: process.version,
                    platform: process.platform
                }
            };

            console.log('✅ Device information collected:');
            console.log('   OS Version:', this.deviceInfo.os_version);
            console.log('   Device Model:', this.deviceInfo.device_model);
            console.log('   Serial Number:', this.deviceInfo.serial_number);
            console.log('   iCloud Account:', this.deviceInfo.icloud_account);
            console.log('   Network:', this.deviceInfo.network_info.wifi);

        } catch (error) {
            console.error('❌ Error getting device info:', error.message);
            this.deviceInfo = {
                os_version: 'Unknown',
                device_model: 'Unknown',
                serial_number: 'Unknown',
                icloud_account: this.icloudEmail,
                network_info: { wifi: 'Unknown' },
                capabilities: {
                    imessage: true,
                    sms: true,
                    calls: false,
                    facetime: true
                },
                metadata: {
                    location: 'Local Device',
                    last_boot: new Date().toISOString(),
                    blue_relay_version: '2.0.0',
                    node_version: process.version,
                    platform: process.platform
                }
            };
        }
    }

    async connect() {
        try {
            console.log(`🔌 Connecting to BlueRelay server: ${this.serverUrl}`);

            this.socket = io(this.serverUrl, {
                transports: ['websocket', 'polling'],
                timeout: 10000,
                forceNew: true,
                reconnection: true,
                // Không đặt reconnectionAttempts để dùng mặc định (không giới hạn)
                // delay/backoff do handleReconnect quản lý bổ sung
                query: {
                    device_id: this.deviceId,
                    device_type: 'mac_relay'
                }
            });

            // Wait for connection
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000);

                this.socket.on('connect', () => {
                    clearTimeout(timeout);
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    console.log('✅ Connected to BlueRelay server');
                    console.log('   Socket ID:', this.socket.id);
                    resolve();
                });

                this.socket.on('connect_error', (error) => {
                    clearTimeout(timeout);
                    console.error('❌ Connection error:', error.message);
                    reject(error);
                });
            });

        } catch (error) {
            console.error('❌ Failed to connect:', error.message);
            throw error;
        }
    }

    async authenticate() {
        try {
            console.log('🔐 Authenticating device...');

            const authData = {
                device_id: this.deviceId,
                device_name: this.deviceName,
                icloud_email: this.icloudEmail,
                icloud_phone: this.icloudPhone,
                device_info: this.deviceInfo,
                api_key: this.apiKey,
                timestamp: new Date().toISOString()
            };

            this.socket.emit('device:authenticate', authData);

            // Wait for authentication response
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Authentication timeout'));
                }, 10000);

                this.socket.once('device:authenticated', (data) => {
                    clearTimeout(timeout);
                    this.isAuthenticated = true;
                    console.log('✅ Device authenticated successfully');
                    console.log('   MacRelay ID:', data.mac_relay_id);
                    console.log('   User ID:', data.user_id);
                    console.log('   Status:', data.status);
                    resolve(data);
                });

                this.socket.once('device:auth_error', (error) => {
                    clearTimeout(timeout);
                    console.error('❌ Authentication failed:', error.message);
                    reject(new Error(error.message));
                });
            });

        } catch (error) {
            console.error('❌ Authentication error:', error.message);
            throw error;
        }
    }

    setupEventHandlers() {
        if (!this.socket) return;

        // Connection events
        this.socket.on('disconnect', (reason) => {
            console.log('🔌 Disconnected from server:', reason);
            this.isConnected = false;
            this.isAuthenticated = false;
            this.stopHeartbeat();
            this.handleReconnect();
        });

        this.socket.on('connect', () => {
            console.log('🔌 Reconnected to server');
            this.isConnected = true;
            this.reconnectAttempts = 0;
        });

        // Device events
        this.socket.on('device:ping', async (data) => {
            console.log('🏓 Received ping from server');
            this.socket.emit('device:pong', {
                device_id: this.deviceId,
                timestamp: new Date().toISOString(),
                status: 'online',
                device_info: this.deviceInfo
            });
        });

        this.socket.on('device:update_status', async (data) => {
            console.log('📝 Updating device status:', data.status);
            this.socket.emit('device:status_updated', {
                device_id: this.deviceId,
                status: data.status,
                timestamp: new Date().toISOString()
            });
        });

        // Message events
        this.socket.on('device:send_message', async (data) => {
            console.log('📤 Received message send request:', data);
            try {
                // Here you would implement the actual message sending
                // For now, just acknowledge
                this.socket.emit('device:message_sent', {
                    request_id: data.requestId,
                    message_id: data.message_id || 'temp-id',
                    status: 'sent',
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                this.socket.emit('device:message_error', {
                    request_id: data.requestId,
                    error: error.message
                });
            }
        });

        // Command events
        this.socket.on('device:command', async (data) => {
            console.log('⚡ Received command:', data.command);
            try {
                const result = await this.executeCommand(data.command, data.params);
                this.sendCommandResponse(data.request_id, true, result, 'Command executed successfully');
            } catch (error) {
                this.sendCommandResponse(data.request_id, false, null, error.message);
            }
        });

        // API server commands
        this.socket.on('device:send_command', async (data) => {
            console.log('⚡ Received API server command:', data.command);
            try {
                const result = await this.executeCommand(data.command, data.data);
                this.sendCommandResponse(data.requestId, true, result, 'Command executed successfully');
            } catch (error) {
                this.sendCommandResponse(data.requestId, false, null, error.message);
            }
        });

        // Error events
        this.socket.on('error', (error) => {
            console.error('❌ Socket error:', error);
        });

        this.socket.on('device:error', (error) => {
            console.error('❌ Device error:', error);
        });
    }

    async executeCommand(command, params = {}) {
        console.log(`⚡ Executing command: ${command}`);

        switch (command) {
            case 'get_device_info':
                return this.deviceInfo;

            case 'get_icloud_status':
                return await this.getICloudStatus();

            case 'send_message':
                return await this.commandHandler.handleSendMessage(params);

            case 'get_messages':
                return await this.getMessages(params);

            case 'ping':
                return { pong: true, timestamp: new Date().toISOString() };

            case 'get_conversations':
                return await this.getConversations(params);

            case 'get_conversation_messages':
                return await this.getConversationMessages(params);

            case 'mark_as_read':
                return await this.markAsRead(params);

            case 'check_imessage_support':
                return await this.checkIMessageSupport(params);

            case 'get_inbox_stats':
                return await this.getInboxStats();

            default:
                throw new Error(`Unknown command: ${command}`);
        }
    }

    async getICloudStatus() {
        try {
            const { stdout } = await execAsync('defaults read MobileMeAccounts Accounts | grep AccountID | head -1 | cut -d\\" -f2');
            return {
                signed_in: true,
                account: stdout.trim(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                signed_in: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async sendIMessage(params) {
        // Placeholder for iMessage sending
        return {
            success: true,
            message: 'Message sent (placeholder)',
            timestamp: new Date().toISOString()
        };
    }

    async getMessages(params) {
        // Placeholder for getting messages
        return {
            messages: [],
            count: 0,
            timestamp: new Date().toISOString()
        };
    }

    handleReconnect() {
        // Tính delay theo exponential backoff + jitter
        const attempt = ++this.reconnectAttempts;
        const expo = Math.min(this.baseReconnectDelayMs * Math.pow(2, attempt - 1), this.maxReconnectDelayMs);
        const jitter = Math.floor(Math.random() * 1000); // 0-1s
        const delay = expo + jitter;

        console.log(`🔄 Attempting to reconnect in ${delay}ms... (attempt #${attempt})`);

        setTimeout(async () => {
            try {
                await this.connect();
                await this.authenticate();
                this.startHeartbeat();
                console.log('✅ Reconnected and re-authenticated');
            } catch (error) {
                console.error('❌ Reconnection failed:', error.message);
                this.handleReconnect();
            }
        }, delay);
    }

    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected && this.isAuthenticated) {
                this.socket.emit('device:heartbeat', {
                    device_id: this.deviceId,
                    timestamp: new Date().toISOString(),
                    status: 'online',
                    device_info: {
                        os_version: this.deviceInfo?.os_version || 'Unknown',
                        uptime: process.uptime(),
                        memory_usage: process.memoryUsage()
                    }
                });
            }
        }, 30000); // Send heartbeat every 30 seconds

        console.log('💓 Heartbeat started');
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            console.log('💓 Heartbeat stopped');
        }
    }

    disconnect() {
        console.log('🔌 Disconnecting from server...');

        this.stopHeartbeat();

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        this.isConnected = false;
        this.isAuthenticated = false;
        console.log('✅ Disconnected from server');
    }

    // Message handling methods
    sendMessage(messageData) {
        if (!this.isConnected || !this.isAuthenticated) {
            console.log('⚠️  Device not connected, queuing message');
            this.messageQueue.push(messageData);
            return;
        }

        try {
            this.socket.emit('device:new_message', {
                device_id: this.deviceId,
                ...messageData,
                timestamp: new Date().toISOString()
            });
            console.log('📤 Message sent to server');
        } catch (error) {
            console.error('❌ Error sending message:', error.message);
            this.messageQueue.push(messageData);
        }
    }

    processPendingMessages() {
        if (this.messageQueue.length > 0 && this.isConnected && this.isAuthenticated) {
            console.log(`📤 Processing ${this.messageQueue.length} pending messages`);
            while (this.messageQueue.length > 0) {
                const message = this.messageQueue.shift();
                this.sendMessage(message);
            }
        }
    }

    sendCommandResponse(requestId, success, data, message) {
        if (!this.socket) {
            console.error('❌ Socket not connected');
            return;
        }

        const response = {
            requestId,
            success,
            data,
            message: message || (success ? 'Command executed successfully' : 'Command failed')
        };

        console.log(`📨 Sending command response:`, response);
        this.socket.emit('device:command_response', response);
    }

    // Public methods for external use
    isDeviceConnected() {
        return this.isConnected && this.isAuthenticated;
    }

    getDeviceInfo() {
        return {
            deviceId: this.deviceId,
            deviceName: this.deviceName,
            icloudEmail: this.icloudEmail,
            icloudPhone: this.icloudPhone,
            serverUrl: this.serverUrl,
            isConnected: this.isConnected,
            isAuthenticated: this.isAuthenticated,
            deviceInfo: this.deviceInfo
        };
    }

    // Health check method
    getHealthStatus() {
        return {
            device_id: this.deviceId,
            device_name: this.deviceName,
            status: this.isConnected ? 'online' : 'offline',
            authenticated: this.isAuthenticated,
            last_heartbeat: new Date().toISOString(),
            device_info: this.deviceInfo
        };
    }

    // New methods for conversations and messages
    async getConversations(params = {}) {
        try {
            console.log('📋 Getting conversations...');
            const messageService = await import('./messageService.js');
            const result = await messageService.default.getConversations(params.limit || 20);

            if (!result.success) {
                throw new Error(result.error);
            }

            // Transform data for frontend - keeping original format but using improved data
            const conversations = result.conversations.map(conv => ({
                id: conv.sender,
                sender: conv.sender,
                lastMessage: conv.lastMessage || '',
                lastMessageTime: conv.lastMessageDate
                    ? new Date(conv.lastMessageDate / 1000000000 * 1000 + Date.UTC(2001, 0, 1)).toISOString()
                    : new Date().toISOString(),
                unreadCount: conv.unreadCount || 0,
                messageType: conv.service === 'iMessage' ? 'iMessage' : 'SMS',
                service: conv.service || 'unknown',
                // Additional internal fields for debugging (not exposed in API spec)
                messageCount: conv.messageCount || 0,
                country: conv.country || null,
                lastReceivedMessage: conv.lastReceivedMessage || null,
                lastSentMessage: conv.lastSentMessage || null
            }));

            return {
                conversations,
                total: conversations.length
            };
        } catch (error) {
            console.error('Error getting conversations:', error);
            throw error;
        }
    }

    async getConversationMessages(params = {}) {
        try {
            console.log('📨 SocketService: getConversationMessages called with:', params);
            const { sender, limit = 50, page = 1, offset = 0 } = params;

            if (!sender || sender.trim() === '') {
                throw new Error('Sender is required');
            }

            // Validate and sanitize parameters
            const parsedLimit = Math.min(parseInt(limit) || 50, 200);
            const parsedPage = Math.max(parseInt(page) || 1, 1);
            const parsedOffsetInput = Math.max(parseInt(offset) || 0, 0);
            const computedOffset = parsedOffsetInput > 0 ? parsedOffsetInput : (parsedPage - 1) * parsedLimit;

            console.log(`📞 SocketService: Calling messageService with sender: ${sender}, limit: ${parsedLimit}, page: ${parsedPage}, computedOffset: ${computedOffset}`);
            const messageService = await import('./messageService.js');
            const result = await messageService.default.getMessages(sender.trim(), parsedLimit, computedOffset);
            console.log(`📨 SocketService: messageService result:`, { success: result.success, messageCount: result.messages?.length, total: result.total, page: result.page, totalPages: result.totalPages });

            if (!result.success) {
                throw new Error(result.error || 'Failed to get messages from messageService');
            }

            // Data đã được format đúng từ messageService
            const messages = result.messages || [];

            // Get total count for correct pagination
            const totalCountResult = await messageService.default.getMessageCount(sender.trim());
            const totalMessages = totalCountResult.success ? totalCountResult.count : (result.total || 0);

            console.log(`✅ SocketService: Returning ${messages.length} messages for page ${parsedPage}, total: ${totalMessages}`);
            return {
                messages,
                total: totalMessages,
                page: parsedPage,
                limit: parsedLimit,
                hasMore: messages.length === parsedLimit && (computedOffset + messages.length) < totalMessages
            };
        } catch (error) {
            console.error('Error getting conversation messages:', error);
            throw error;
        }
    }

    async markAsRead(params = {}) {
        try {
            console.log('✅ Marking as read...');
            const { sender } = params;

            if (!sender) {
                throw new Error('Sender is required');
            }

            const messageService = await import('./messageService.js');
            const result = await messageService.default.markAsRead(sender);

            if (!result.success) {
                throw new Error(result.error);
            }

            return { success: true };
        } catch (error) {
            console.error('Error marking as read:', error);
            throw error;
        }
    }

    async checkIMessageSupport(params = {}) {
        try {
            console.log('🔍 Checking iMessage support...');
            const { recipient } = params;

            if (!recipient) {
                throw new Error('Recipient is required');
            }

            // Simple check: email = iMessage, phone = SMS
            const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);

            return {
                supportsIMessage: isEmail,
                message: isEmail ? 'Supports iMessage' : 'SMS only (phone number)'
            };
        } catch (error) {
            console.error('Error checking iMessage support:', error);
            throw error;
        }
    }

    async getInboxStats() {
        try {
            console.log('📊 Getting inbox stats...');
            const messageService = await import('./messageService.js');
            const result = await messageService.default.getConversations(1000);

            if (!result.success) {
                throw new Error(result.error);
            }

            const conversations = result.conversations;
            const totalConversations = conversations.length;
            const unreadMessages = conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
            const totalMessages = conversations.reduce((sum, conv) => sum + (conv.messageCount || 0), 0);

            return {
                totalMessages,
                unreadMessages,
                totalConversations
            };
        } catch (error) {
            console.error('Error getting inbox stats:', error);
            throw error;
        }
    }
}

// Create singleton instance
const socketService = new SocketService();

export default socketService; 