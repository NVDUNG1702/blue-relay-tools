import ICloudDetectionService from '../services/iCloudDetectionService.js';
import { APP_CONFIG } from '../config/app.js';

const iCloudDetectionService = new ICloudDetectionService();

const iCloudController = {
    /**
     * Get iCloud account information
     */
    getICloudInfo: async (req, res) => {
        try {
            console.log('📱 Getting iCloud information...');

            const icloudInfo = await iCloudDetectionService.getICloudInfo();

            res.json({
                success: true,
                data: icloudInfo,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error getting iCloud info:', error.message);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    },

    /**
     * Check iCloud login status
     */
    checkICloudStatus: async (req, res) => {
        try {
            console.log('🔍 Checking iCloud status...');

            const status = await iCloudDetectionService.isICloudSignedIn();

            res.json({
                success: true,
                data: status,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error checking iCloud status:', error.message);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    },

    /**
     * Get device information
     */
    getDeviceInfo: async (req, res) => {
        try {
            console.log('📱 Getting device information...');

            const deviceInfo = await iCloudDetectionService.getDetectionDetails();

            res.json({
                success: true,
                data: deviceInfo,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error getting device info:', error.message);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    },

    /**
     * Test iCloud connection
     */
    testICloudConnection: async (req, res) => {
        try {
            console.log('🧪 Testing iCloud connection...');

            const result = await iCloudDetectionService.detectICloudInfo();

            res.json({
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error testing iCloud connection:', error.message);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    },

    /**
     * Get iCloud services status
     */
    getICloudServices: async (req, res) => {
        try {
            console.log('🔧 Getting iCloud services status...');

            const services = await iCloudDetectionService.getAllICloudEmails();

            res.json({
                success: true,
                data: services,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error getting iCloud services:', error.message);
            res.status(500).json({
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
};

export { iCloudController };