import ICloudDetectionService from '@blue-relay-tools/services/iCloudDetectionService';
const iCloudDetectionService = new ICloudDetectionService();
export const iCloudController = {
    getICloudInfo: async (_req, res) => {
        try {
            const icloudInfo = await iCloudDetectionService.getICloudInfo();
            res.json({ success: true, data: icloudInfo, timestamp: new Date().toISOString() });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error?.message, timestamp: new Date().toISOString() });
        }
    },
    checkICloudStatus: async (_req, res) => {
        try {
            const status = await iCloudDetectionService.isICloudSignedIn();
            res.json({ success: true, data: status, timestamp: new Date().toISOString() });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error?.message, timestamp: new Date().toISOString() });
        }
    },
    getDeviceInfo: async (_req, res) => {
        try {
            const deviceInfo = await iCloudDetectionService.getDetectionDetails();
            res.json({ success: true, data: deviceInfo, timestamp: new Date().toISOString() });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error?.message, timestamp: new Date().toISOString() });
        }
    },
    testICloudConnection: async (_req, res) => {
        try {
            const result = await iCloudDetectionService.detectICloudInfo();
            res.json({ success: true, data: result, timestamp: new Date().toISOString() });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error?.message, timestamp: new Date().toISOString() });
        }
    },
    getICloudServices: async (_req, res) => {
        try {
            const services = await iCloudDetectionService.getAllICloudEmails();
            res.json({ success: true, data: services, timestamp: new Date().toISOString() });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error?.message, timestamp: new Date().toISOString() });
        }
    }
};
//# sourceMappingURL=iCloudController.js.map