import axios from 'axios';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '@blue-relay-tools/utils/logger';
import ICloudDetectionService from '@blue-relay-tools/services/iCloudDetectionService';
const execAsync = promisify(exec);
class AutoDiscoveryService {
    constructor() {
        this.discoveredServers = new Map();
        this.currentServer = null;
        this.deviceInfo = null;
        this.serverConfig = null;
        this.iCloudDetectionService = new ICloudDetectionService();
    }
    async detectDeviceInfo() {
        try {
            logger.info('🔍 Detecting device information...');
            const platform = os.platform();
            const arch = os.arch();
            const hostname = os.hostname();
            const cpus = os.cpus();
            const totalMem = os.totalmem();
            let osVersion = 'Unknown';
            let deviceModel = 'Unknown';
            if (platform === 'darwin') {
                try {
                    const { stdout: swVers } = await execAsync('sw_vers -productVersion');
                    osVersion = swVers.trim();
                }
                catch (error) {
                    logger.warn('Could not get macOS version:', error.message);
                }
                try {
                    const { stdout: model } = await execAsync('sysctl -n hw.model');
                    deviceModel = model.trim();
                }
                catch (error) {
                    logger.warn('Could not get device model:', error.message);
                }
            }
            const iCloudInfo = await this.iCloudDetectionService.getICloudInfo();
            const iCloudEmail = iCloudInfo.email;
            const iCloudPhone = iCloudInfo.phone_number;
            const appleId = iCloudInfo.apple_id;
            this.deviceInfo = {
                platform,
                arch,
                hostname,
                os_version: osVersion,
                device_model: deviceModel,
                cpu_count: cpus.length,
                total_memory: totalMem,
                icloud_email: iCloudEmail,
                icloud_phone: iCloudPhone,
                apple_id: appleId,
                icloud_sources: iCloudInfo.sources,
                icloud_detection_methods: iCloudInfo.detection_methods,
                capabilities: ['send_imessage', 'receive_imessage', 'get_conversations', 'get_messages', 'database_monitoring'],
                device_name: `${deviceModel} (${hostname})`,
                device_type: 'imessage-relay'
            };
            logger.info('✅ Device information detected:', this.deviceInfo);
            return this.deviceInfo;
        }
        catch (error) {
            logger.error('❌ Error detecting device info:', error);
            throw error;
        }
    }
    async discoverServers() {
        try {
            logger.info('🔍 Discovering servers...');
            const commonPorts = [8000, 3000, 8080, 5000];
            const commonHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
            const discovered = [];
            for (const host of commonHosts) {
                for (const port of commonPorts) {
                    const url = `http://${host}:${port}`;
                    try {
                        logger.info(`🔍 Trying ${url}...`);
                        const healthResponse = await axios.get(`${url}/api/health`, { timeout: 2000 });
                        if (healthResponse.data && healthResponse.data.status === 'ok') {
                            logger.info(`✅ Found server at ${url}`);
                            discovered.push({ url, host, port, health: healthResponse.data });
                        }
                    }
                    catch {
                        continue;
                    }
                }
            }
            for (const server of discovered) {
                try {
                    const discoveryResponse = await axios.post(`${server.url}/api/device-discovery/discover`, { device_info: this.deviceInfo, device_capabilities: this.deviceInfo.capabilities }, { timeout: 5000 });
                    if (discoveryResponse.data.success) {
                        logger.info(`✅ Server ${server.url} supports device discovery`);
                        server.discovery = discoveryResponse.data.data;
                        this.discoveredServers.set(server.url, server);
                    }
                }
                catch {
                    logger.warn(`Server ${server.url} does not support device discovery`);
                }
            }
            logger.info(`✅ Discovered ${discovered.length} servers`);
            return Array.from(this.discoveredServers.values());
        }
        catch (error) {
            logger.error('❌ Error discovering servers:', error);
            throw error;
        }
    }
    async connectToBestServer() {
        try {
            if (this.discoveredServers.size === 0)
                throw new Error('No servers discovered');
            const servers = Array.from(this.discoveredServers.values());
            const bestServer = servers.find(s => s.discovery) || servers[0];
            logger.info(`🔌 Connecting to best server: ${bestServer.url}`);
            if (bestServer.discovery) {
                this.serverConfig = bestServer.discovery;
                this.currentServer = bestServer;
                logger.info('✅ Server configuration received:', { server_url: bestServer.url, device_id: this.serverConfig.device_info.device_id, connection_id: this.serverConfig.device_info.connection_id });
                return this.serverConfig;
            }
            else {
                this.currentServer = bestServer;
                this.serverConfig = { server_info: { endpoints: { socket: bestServer.url, api: `${bestServer.url}/api` } }, device_info: { device_id: `mac-relay-${Date.now()}`, connection_id: `conn-${Date.now()}` }, connection_config: { heartbeat_interval: 30000, reconnect_delay: 5000, max_reconnect_attempts: 5, timeout: 10000 } };
                return this.serverConfig;
            }
        }
        catch (error) {
            logger.error('❌ Error connecting to best server:', error);
            throw error;
        }
    }
    async autoDiscoverAndConnect() {
        try {
            logger.info('🚀 Starting auto-discovery and connection...');
            await this.detectDeviceInfo();
            const servers = await this.discoverServers();
            if (servers.length === 0)
                throw new Error('No Blue Relay servers found. Please check if the main server is running.');
            const config = await this.connectToBestServer();
            logger.info('✅ Auto-discovery completed successfully');
            return { deviceInfo: this.deviceInfo, serverConfig: config, currentServer: this.currentServer };
        }
        catch (error) {
            logger.error('❌ Auto-discovery failed:', error);
            throw error;
        }
    }
    getCurrentServer() { return this.currentServer; }
    getServerConfig() { return this.serverConfig; }
    getDeviceInfo() { return this.deviceInfo; }
    async updateDeviceInfo(newInfo) {
        try {
            if (this.currentServer && this.serverConfig) {
                const deviceId = this.serverConfig.device_info.device_id;
                const response = await axios.put(`${this.currentServer.url}/api/device-discovery/config/${deviceId}`, { device_info: { ...this.deviceInfo, ...newInfo }, capabilities: this.deviceInfo.capabilities, status: 'online' }, { timeout: 5000 });
                if (response.data.success) {
                    this.deviceInfo = { ...this.deviceInfo, ...newInfo };
                    logger.info('✅ Device info updated on server');
                    return true;
                }
            }
            return false;
        }
        catch (error) {
            logger.error('❌ Error updating device info:', error);
            return false;
        }
    }
}
export default AutoDiscoveryService;
//# sourceMappingURL=autoDiscoveryService.js.map