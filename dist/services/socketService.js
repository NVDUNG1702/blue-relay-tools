import { io } from 'socket.io-client';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DEVICE_CONFIG } from '@blue-relay-tools/config/device-config';
import socketCommandHandler from '@blue-relay-tools/services/socketCommandHandler';
import messageService from '@blue-relay-tools/services/messageService';
const execAsync = promisify(exec);
class SocketService {
    constructor() {
        this.socket = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.isConnected = false;
        this.deviceId = DEVICE_CONFIG.DEVICE_ID;
        this.deviceName = DEVICE_CONFIG.DEVICE_NAME;
        this.deviceType = DEVICE_CONFIG.DEVICE_TYPE;
        this.deviceVersion = DEVICE_CONFIG.DEVICE_VERSION;
        this.deviceCapabilities = {
            iMessage: true,
            SMS: true,
            MMS: false,
            RCS: false,
            attachments: true,
            groupChats: true,
            readReceipts: true,
            typingIndicators: false
        };
        this.deviceMetadata = {
            os: 'macOS',
            osVersion: '14.0',
            appVersion: '1.0.0',
            lastSync: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
    }
    async connect() {
        try {
            console.log('🔌 Connecting to blue-relay-api...');
            this.socket = io(DEVICE_CONFIG.API_URL, {
                transports: ['websocket'],
                timeout: 10000,
                forceNew: true
            });
            this.socket.on('connect', () => {
                console.log('✅ Connected to blue-relay-api');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.sendDeviceInfo();
                this.startHeartbeat();
            });
            this.socket.on('disconnect', (reason) => {
                console.log('❌ Disconnected from blue-relay-api:', reason);
                this.isConnected = false;
                this.handleReconnect();
            });
            this.socket.on('connect_error', (error) => {
                console.error('❌ Connection error:', error);
                this.handleReconnect();
            });
            this.socket.on('command', this.handleCommand.bind(this));
        }
        catch (error) {
            console.error('❌ Failed to connect:', error);
            this.handleReconnect();
        }
    }
    async handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`🔄 Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            setTimeout(() => {
                this.connect();
            }, this.reconnectDelay * this.reconnectAttempts);
        }
        else {
            console.error('❌ Max reconnection attempts reached');
        }
    }
    async sendDeviceInfo() {
        if (!this.socket)
            return;
        const deviceInfo = {
            id: this.deviceId,
            name: this.deviceName,
            type: this.deviceType,
            version: this.deviceVersion,
            capabilities: this.deviceCapabilities,
            metadata: this.deviceMetadata,
            status: 'online',
            lastSeen: new Date().toISOString()
        };
        this.socket.emit('device_info', deviceInfo);
        console.log('📱 Device info sent:', deviceInfo);
    }
    startHeartbeat() {
        if (!this.socket)
            return;
        setInterval(() => {
            if (this.isConnected) {
                const heartbeat = {
                    deviceId: this.deviceId,
                    timestamp: new Date().toISOString(),
                    status: 'healthy',
                    memoryUsage: process.memoryUsage(),
                    uptime: process.uptime()
                };
                this.socket.emit('heartbeat', heartbeat);
            }
        }, 30000); // 30 seconds
    }
    async handleCommand(data) {
        try {
            console.log('📨 Received command:', data.command, data.data);
            await socketCommandHandler.handleCommand(data.command, data.data || {}, data.requestId, (response) => {
                if (this.socket) {
                    this.socket.emit('command_response', response);
                }
            });
        }
        catch (error) {
            console.error('❌ Error handling command:', error);
            const errorResponse = {
                requestId: data.requestId,
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error',
                data: null
            };
            if (this.socket) {
                this.socket.emit('command_response', errorResponse);
            }
        }
    }
    async getConversations(params = {}) {
        const { limit = 20, fastMode = false, sinceTimestamp } = params;
        // Sử dụng fast mode để tăng tốc độ
        const result = await messageService.getConversations(limit, {
            fastMode: fastMode,
            includeUnreadCount: true,
            sinceTimestamp: sinceTimestamp
        });
        if (!result.success)
            throw new Error(result.error);
        const conversations = (result.conversations || []).map((conv) => ({
            id: conv.sender,
            sender: conv.sender,
            lastMessage: conv.lastMessage || '',
            lastMessageTime: conv.lastMessageDate ? new Date(conv.lastMessageDate / 1000000000 * 1000 + Date.UTC(2001, 0, 1)).toISOString() : new Date().toISOString(),
            unreadCount: conv.unreadCount || 0,
            messageType: conv.service === 'iMessage' ? 'iMessage' : 'SMS',
            service: conv.service || 'unknown',
            messageCount: conv.messageCount || 0,
            country: conv.country || null,
            lastReceivedMessage: conv.lastReceivedMessage || null,
            lastSentMessage: conv.lastSentMessage || null
        }));
        return { conversations, total: conversations.length };
    }
    async getInboxStats() {
        // Sử dụng fast mode để lấy stats nhanh hơn
        const result = await messageService.getConversations(1000, { fastMode: true });
        if (!result.success)
            throw new Error(result.error);
        const conversations = result.conversations || [];
        const totalConversations = conversations.length;
        const unreadMessages = conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
        const totalMessages = conversations.reduce((sum, conv) => sum + (conv.messageCount || 0), 0);
        return { totalMessages, unreadMessages, totalConversations };
    }
    async sendMessage(messageData) {
        const { recipient, content } = messageData;
        if (!recipient || !content)
            throw new Error('Recipient and content are required');
        const result = await messageService.sendMessage(recipient, content);
        if (!result.success)
            throw new Error(result.error);
        // Tạo message object tương thích với blue-relay-api
        const message = {
            id: Date.now(),
            text: content,
            date: Date.now(),
            isFromMe: true,
            isRead: false,
            isSent: true,
            isDelivered: false,
            sender: 'me',
            recipients: [recipient],
            readableDate: new Date().toISOString(),
            messageType: 'iMessage',
            serviceInfo: {
                type: 'iMessage',
                center: null,
                account: null
            },
            typeBadge: '💬'
        };
        return message;
    }
    async disconnect() {
        if (this.socket) {
            console.log('🔌 Disconnecting from blue-relay-api...');
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
        }
    }
    isConnectedToApi() {
        return this.isConnected;
    }
}
export default new SocketService();
