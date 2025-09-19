import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import logger from '../utils/logger.js';

const execAsync = promisify(exec);

class ICloudDetectionService {
    constructor() {
        this.iCloudInfo = null;
    }

    // Kiểm tra thông tin iCloud từ nhiều nguồn khác nhau
    async detectICloudInfo() {
        try {
            logger.info('🔍 Detecting iCloud information...');

            const iCloudInfo = {
                email: null,
                phone_number: null,
                apple_id: null,
                sources: [],
                detection_methods: []
            };

            // Method 1: Kiểm tra từ Messages database
            const messagesInfo = await this.getICloudFromMessages();
            if (messagesInfo) {
                iCloudInfo.email = messagesInfo.email || iCloudInfo.email;
                iCloudInfo.phone_number = messagesInfo.phone_number || iCloudInfo.phone_number;
                iCloudInfo.sources.push('messages_database');
                iCloudInfo.detection_methods.push('sqlite_messages_db');
            }

            // Method 2: Kiểm tra từ System Preferences
            const systemInfo = await this.getICloudFromSystem();
            if (systemInfo) {
                iCloudInfo.email = systemInfo.email || iCloudInfo.email;
                iCloudInfo.apple_id = systemInfo.apple_id || iCloudInfo.apple_id;
                iCloudInfo.sources.push('system_preferences');
                iCloudInfo.detection_methods.push('defaults_read');
            }

            // Method 2.5: Lấy thông tin iCloud từ file .env (ưu tiên cao nhất)
            const envInfo = await this.getICloudFromEnv();
            if (envInfo) {
                iCloudInfo.email = envInfo.email || iCloudInfo.email;
                iCloudInfo.phone_number = envInfo.phone_number || iCloudInfo.phone_number;
                iCloudInfo.apple_id = envInfo.apple_id || iCloudInfo.apple_id;
                iCloudInfo.display_name = envInfo.display_name || iCloudInfo.display_name;
                iCloudInfo.first_name = envInfo.first_name || iCloudInfo.first_name;
                iCloudInfo.last_name = envInfo.last_name || iCloudInfo.last_name;
                iCloudInfo.account_dsid = envInfo.account_dsid || iCloudInfo.account_dsid;
                iCloudInfo.account_uuid = envInfo.account_uuid || iCloudInfo.account_uuid;
                iCloudInfo.sources.push('env_file');
                iCloudInfo.detection_methods.push('env_read');
            }

            // Method 2.6: Lấy thông tin iCloud account chính xác từ system (backup)
            if (!envInfo) {
                const accountInfo = await this.getICloudAccountInfo();
                if (accountInfo) {
                    iCloudInfo.email = accountInfo.email || iCloudInfo.email;
                    iCloudInfo.phone_number = accountInfo.phone_number || iCloudInfo.phone_number;
                    iCloudInfo.apple_id = accountInfo.apple_id || iCloudInfo.apple_id;
                    iCloudInfo.display_name = accountInfo.display_name || iCloudInfo.display_name;
                    iCloudInfo.first_name = accountInfo.first_name || iCloudInfo.first_name;
                    iCloudInfo.last_name = accountInfo.last_name || iCloudInfo.last_name;
                    iCloudInfo.account_dsid = accountInfo.account_dsid || iCloudInfo.account_dsid;
                    iCloudInfo.account_uuid = accountInfo.account_uuid || iCloudInfo.account_uuid;
                    iCloudInfo.sources.push('icloud_account');
                    iCloudInfo.detection_methods.push('account_info');
                }
            }

            // Method 3: Kiểm tra từ Keychain
            const keychainInfo = await this.getICloudFromKeychain();
            if (keychainInfo) {
                iCloudInfo.email = keychainInfo.email || iCloudInfo.email;
                iCloudInfo.phone_number = keychainInfo.phone_number || iCloudInfo.phone_number;
                iCloudInfo.sources.push('keychain');
                iCloudInfo.detection_methods.push('security_keychain');
            }

            // Method 4: Kiểm tra từ Mail app
            const mailInfo = await this.getICloudFromMail();
            if (mailInfo) {
                iCloudInfo.email = mailInfo.email || iCloudInfo.email;
                iCloudInfo.sources.push('mail_app');
                iCloudInfo.detection_methods.push('mail_accounts');
            }

            // Method 5: Kiểm tra từ Contacts app
            const contactsInfo = await this.getICloudFromContacts();
            if (contactsInfo) {
                iCloudInfo.email = contactsInfo.email || iCloudInfo.email;
                iCloudInfo.phone_number = contactsInfo.phone_number || iCloudInfo.phone_number;
                iCloudInfo.sources.push('contacts_app');
                iCloudInfo.detection_methods.push('contacts_me_card');
            }

            // Method 6: Kiểm tra từ iCloud Drive
            const iCloudDriveInfo = await this.getICloudFromICloudDrive();
            if (iCloudDriveInfo) {
                iCloudInfo.email = iCloudDriveInfo.email || iCloudInfo.email;
                iCloudInfo.sources.push('icloud_drive');
                iCloudInfo.detection_methods.push('icloud_drive_path');
            }

            this.iCloudInfo = iCloudInfo;

            logger.info('✅ iCloud information detected:', {
                email: iCloudInfo.email,
                phone_number: iCloudInfo.phone_number,
                apple_id: iCloudInfo.apple_id,
                sources: iCloudInfo.sources,
                methods: iCloudInfo.detection_methods
            });

            return iCloudInfo;

        } catch (error) {
            logger.error('❌ Error detecting iCloud info:', error);
            throw error;
        }
    }

    // Lấy thông tin iCloud từ Messages database
    async getICloudFromMessages() {
        try {
            const { stdout: homeDir } = await execAsync('echo $HOME');
            const messagesDbPath = `${homeDir.trim()}/Library/Messages/chat.db`;

            // Kiểm tra xem có thể đọc Messages database không
            const { stdout: testQuery } = await execAsync(`sqlite3 "${messagesDbPath}" "SELECT COUNT(*) FROM handle LIMIT 1;"`);
            if (testQuery.trim() === '') {
                return null;
            }

            const result = {
                email: null,
                phone_number: null
            };

            // Tìm iCloud email
            try {
                const { stdout: emailQuery } = await execAsync(`sqlite3 "${messagesDbPath}" "SELECT DISTINCT id FROM handle WHERE id LIKE '%@icloud.com' OR id LIKE '%@me.com' OR id LIKE '%@mac.com' ORDER BY id LIMIT 1;"`);
                if (emailQuery.trim()) {
                    result.email = emailQuery.trim();
                }
            } catch (error) {
                logger.warn('Could not get iCloud email from Messages database:', error.message);
            }

            // Tìm số điện thoại (Apple ID phone number)
            try {
                const { stdout: phoneQuery } = await execAsync(`sqlite3 "${messagesDbPath}" "SELECT DISTINCT id FROM handle WHERE id REGEXP '^[+]?[0-9]+$' ORDER BY id LIMIT 1;"`);
                if (phoneQuery.trim()) {
                    result.phone_number = phoneQuery.trim();
                }
            } catch (error) {
                logger.warn('Could not get phone number from Messages database:', error.message);
            }

            return result.email || result.phone_number ? result : null;

        } catch (error) {
            logger.warn('Could not read Messages database:', error.message);
            return null;
        }
    }

    // Lấy thông tin iCloud từ System Preferences
    async getICloudFromSystem() {
        try {
            const result = {
                email: null,
                apple_id: null
            };

            // Method 1: Lấy từ iCloud preferences
            try {
                const { stdout: icloudAccounts } = await execAsync('defaults read MobileMeAccounts 2>/dev/null');
                if (icloudAccounts) {
                    // Parse plist để lấy AccountID
                    const accountMatch = icloudAccounts.match(/AccountID\s*=\s*"([^"]+)"/);
                    if (accountMatch && accountMatch[1]) {
                        result.apple_id = accountMatch[1];
                        result.email = accountMatch[1];
                    }
                }
            } catch (error) {
                logger.warn('Could not read MobileMeAccounts:', error.message);
            }

            // Method 2: Lấy từ cloudd preferences
            if (!result.email) {
                try {
                    const { stdout: clouddAccounts } = await execAsync('defaults read com.apple.cloudd 2>/dev/null');
                    if (clouddAccounts) {
                        const accountMatch = clouddAccounts.match(/AccountID\s*=\s*"([^"]+)"/);
                        if (accountMatch && accountMatch[1]) {
                            result.apple_id = accountMatch[1];
                            result.email = accountMatch[1];
                        }
                    }
                } catch (error) {
                    logger.warn('Could not read com.apple.cloudd:', error.message);
                }
            }

            // Method 3: Lấy từ iCloud Drive preferences
            if (!result.email) {
                try {
                    const { stdout: icloudDrive } = await execAsync('defaults read com.apple.bird 2>/dev/null');
                    if (icloudDrive) {
                        const accountMatch = icloudDrive.match(/AccountID\s*=\s*"([^"]+)"/);
                        if (accountMatch && accountMatch[1]) {
                            result.apple_id = accountMatch[1];
                            result.email = accountMatch[1];
                        }
                    }
                } catch (error) {
                    logger.warn('Could not read com.apple.bird:', error.message);
                }
            }

            // Method 4: Lấy từ System Preferences bằng AppleScript
            if (!result.email) {
                try {
                    const { stdout: appleScriptResult } = await execAsync('osascript -e "tell application \\"System Events\\" to get value of text field 1 of group 1 of window 1 of process \\"System Preferences\\"" 2>/dev/null');
                    if (appleScriptResult && appleScriptResult.trim()) {
                        result.apple_id = appleScriptResult.trim();
                        result.email = appleScriptResult.trim();
                    }
                } catch (error) {
                    logger.warn('Could not get iCloud info via AppleScript:', error.message);
                }
            }

            return result.apple_id ? result : null;

        } catch (error) {
            logger.warn('Could not read system preferences:', error.message);
            return null;
        }
    }

    // Lấy thông tin iCloud từ Keychain
    async getICloudFromKeychain() {
        try {
            const result = {
                email: null,
                phone_number: null
            };

            // Tìm iCloud account trong keychain
            try {
                const { stdout: keychainQuery } = await execAsync('security find-internet-password -s "www.icloud.com" 2>/dev/null | grep "acct" | sed "s/.*acct<blob>=\\(.*\\)/\\1/"');
                if (keychainQuery.trim()) {
                    result.email = keychainQuery.trim();
                }
            } catch (error) {
                // Thử tìm với domain khác
                try {
                    const { stdout: keychainQuery2 } = await execAsync('security find-internet-password -s "idmsa.apple.com" 2>/dev/null | grep "acct" | sed "s/.*acct<blob>=\\(.*\\)/\\1/"');
                    if (keychainQuery2.trim()) {
                        result.email = keychainQuery2.trim();
                    }
                } catch (error2) {
                    logger.warn('Could not get iCloud info from keychain:', error2.message);
                }
            }

            return result.email ? result : null;

        } catch (error) {
            logger.warn('Could not access keychain:', error.message);
            return null;
        }
    }

    // Lấy thông tin iCloud từ Mail app
    async getICloudFromMail() {
        try {
            const result = {
                email: null
            };

            // Kiểm tra Mail accounts
            try {
                const { stdout: mailAccounts } = await execAsync('defaults read com.apple.mail 2>/dev/null | grep -A 5 "AccountName" | grep "string" | sed "s/.*<string>\\(.*\\)<\\/string>.*/\\1/"');
                if (mailAccounts.trim()) {
                    const emails = mailAccounts.trim().split('\n').filter(email =>
                        email.includes('@icloud.com') ||
                        email.includes('@me.com') ||
                        email.includes('@mac.com')
                    );
                    if (emails.length > 0) {
                        result.email = emails[0];
                    }
                }
            } catch (error) {
                logger.warn('Could not get iCloud email from Mail app:', error.message);
            }

            return result.email ? result : null;

        } catch (error) {
            logger.warn('Could not read Mail app preferences:', error.message);
            return null;
        }
    }

    // Lấy thông tin iCloud từ Contacts app
    async getICloudFromContacts() {
        try {
            const result = {
                email: null,
                phone_number: null
            };

            // Kiểm tra "Me" card trong Contacts
            try {
                const { stdout: homeDir } = await execAsync('echo $HOME');
                const contactsDbPath = `${homeDir.trim()}/Library/Application Support/AddressBook/AddressBook-v22.abcddb`;

                // Thử đọc Contacts database
                const { stdout: contactQuery } = await execAsync(`sqlite3 "${contactsDbPath}" "SELECT DISTINCT value FROM ZABCDEMAILADDRESS WHERE ZOWNER = (SELECT Z_PK FROM ZABCDRECORD WHERE ZFIRSTNAME = 'Me' OR ZLASTNAME = 'Me' LIMIT 1) LIMIT 1;" 2>/dev/null`);
                if (contactQuery.trim()) {
                    result.email = contactQuery.trim();
                }

                // Thử lấy số điện thoại
                const { stdout: phoneQuery } = await execAsync(`sqlite3 "${contactsDbPath}" "SELECT DISTINCT value FROM ZABCDPHONENUMBER WHERE ZOWNER = (SELECT Z_PK FROM ZABCDRECORD WHERE ZFIRSTNAME = 'Me' OR ZLASTNAME = 'Me' LIMIT 1) LIMIT 1;" 2>/dev/null`);
                if (phoneQuery.trim()) {
                    result.phone_number = phoneQuery.trim();
                }
            } catch (error) {
                logger.warn('Could not get iCloud info from Contacts app:', error.message);
            }

            return (result.email || result.phone_number) ? result : null;

        } catch (error) {
            logger.warn('Could not read Contacts app:', error.message);
            return null;
        }
    }

    // Lấy thông tin iCloud từ iCloud Drive path
    async getICloudFromICloudDrive() {
        try {
            const result = {
                email: null
            };

            // Kiểm tra iCloud Drive path
            try {
                const { stdout: homeDir } = await execAsync('echo $HOME');
                const iCloudDrivePath = `${homeDir.trim()}/Library/Mobile Documents/com~apple~CloudDocs`;

                if (require('fs').existsSync(iCloudDrivePath)) {
                    // Thử đọc từ iCloud Drive folder name
                    const { stdout: folderName } = await execAsync(`ls -la "${homeDir.trim()}/Library/Mobile Documents/" | grep "com~apple~CloudDocs" | head -1`);

                    // Extract email từ folder name nếu có
                    const emailMatch = folderName.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                    if (emailMatch) {
                        result.email = emailMatch[1];
                    }
                }
            } catch (error) {
                logger.warn('Could not get iCloud info from iCloud Drive:', error.message);
            }

            return result.email ? result : null;

        } catch (error) {
            logger.warn('Could not check iCloud Drive:', error.message);
            return null;
        }
    }

    // Lấy thông tin iCloud từ file .env
    async getICloudFromEnv() {
        try {
            const result = {
                email: null,
                phone_number: null,
                apple_id: null,
                display_name: null,
                first_name: null,
                last_name: null,
                account_dsid: null,
                account_uuid: null
            };

            // Đọc file .env bằng cat
            try {
                const { stdout: envContent } = await execAsync('cat .env 2>/dev/null');
                if (envContent) {
                    // Parse ICLOUD_EMAIL
                    const emailMatch = envContent.match(/ICLOUD_EMAIL\s*=\s*([^\s]+)/);
                    if (emailMatch && emailMatch[1]) {
                        result.email = emailMatch[1];
                        result.apple_id = emailMatch[1];
                    }

                    // Parse ICLOUD_PHONE
                    const phoneMatch = envContent.match(/ICLOUD_PHONE\s*=\s*([^\s]+)/);
                    if (phoneMatch && phoneMatch[1]) {
                        result.phone_number = phoneMatch[1];
                    }

                    // Parse ICLOUD_DISPLAY_NAME
                    const displayNameMatch = envContent.match(/ICLOUD_DISPLAY_NAME\s*=\s*([^\r\n]+)/);
                    if (displayNameMatch && displayNameMatch[1]) {
                        result.display_name = displayNameMatch[1].trim();
                    }

                    // Parse ICLOUD_FIRST_NAME
                    const firstNameMatch = envContent.match(/ICLOUD_FIRST_NAME\s*=\s*([^\r\n]+)/);
                    if (firstNameMatch && firstNameMatch[1]) {
                        result.first_name = firstNameMatch[1].trim();
                    }

                    // Parse ICLOUD_LAST_NAME
                    const lastNameMatch = envContent.match(/ICLOUD_LAST_NAME\s*=\s*([^\r\n]+)/);
                    if (lastNameMatch && lastNameMatch[1]) {
                        result.last_name = lastNameMatch[1].trim();
                    }

                    // Parse ICLOUD_ACCOUNT_DSID
                    const dsidMatch = envContent.match(/ICLOUD_ACCOUNT_DSID\s*=\s*([^\r\n]+)/);
                    if (dsidMatch && dsidMatch[1]) {
                        result.account_dsid = dsidMatch[1].trim();
                    }

                    // Parse ICLOUD_ACCOUNT_UUID
                    const uuidMatch = envContent.match(/ICLOUD_ACCOUNT_UUID\s*=\s*([^\r\n]+)/);
                    if (uuidMatch && uuidMatch[1]) {
                        result.account_uuid = uuidMatch[1].trim();
                    }
                }
            } catch (error) {
                logger.warn('Could not read .env file:', error.message);
            }

            return (result.email || result.phone_number) ? result : null;

        } catch (error) {
            logger.warn('Could not get iCloud info from .env:', error.message);
            return null;
        }
    }

    // Ghi thông tin iCloud vào file .env
    async writeICloudToEnv(icloudInfo) {
        try {
            const envFile = '.env';

            // Đọc file .env hiện tại
            let envContent = '';
            try {
                const { stdout } = await execAsync(`cat ${envFile} 2>/dev/null`);
                envContent = stdout;
            } catch (error) {
                logger.warn('Could not read existing .env file:', error.message);
            }

            // Tạo nội dung mới
            const newEnvLines = [];
            const existingLines = envContent.split('\n').filter(line => line.trim() && !line.startsWith('ICLOUD_'));

            // Thêm các dòng hiện tại (không phải ICLOUD_)
            newEnvLines.push(...existingLines);

            // Thêm thông tin iCloud mới
            if (icloudInfo.email) {
                newEnvLines.push(`ICLOUD_EMAIL=${icloudInfo.email}`);
            }
            if (icloudInfo.phone_number) {
                newEnvLines.push(`ICLOUD_PHONE=${icloudInfo.phone_number}`);
            }
            if (icloudInfo.display_name) {
                newEnvLines.push(`ICLOUD_DISPLAY_NAME=${icloudInfo.display_name}`);
            }
            if (icloudInfo.first_name) {
                newEnvLines.push(`ICLOUD_FIRST_NAME=${icloudInfo.first_name}`);
            }
            if (icloudInfo.last_name) {
                newEnvLines.push(`ICLOUD_LAST_NAME=${icloudInfo.last_name}`);
            }
            if (icloudInfo.account_dsid) {
                newEnvLines.push(`ICLOUD_ACCOUNT_DSID=${icloudInfo.account_dsid}`);
            }
            if (icloudInfo.account_uuid) {
                newEnvLines.push(`ICLOUD_ACCOUNT_UUID=${icloudInfo.account_uuid}`);
            }

            // Ghi vào file .env
            const newContent = newEnvLines.join('\n') + '\n';
            await fs.writeFile(envFile, newContent, 'utf8');

            logger.info('✅ iCloud information written to .env file');
            return true;

        } catch (error) {
            logger.error('❌ Could not write iCloud info to .env:', error.message);
            return false;
        }
    }

    // Lấy thông tin iCloud account chính xác từ system (backup method)
    async getICloudAccountInfo() {
        try {
            const result = {
                email: null,
                phone_number: null,
                apple_id: null,
                display_name: null,
                first_name: null,
                last_name: null,
                account_dsid: null,
                account_uuid: null
            };

            // Method 1: Lấy từ iCloud account info bằng plutil (chính xác nhất)
            try {
                const { stdout: plistInfo } = await execAsync('plutil -p ~/Library/Preferences/MobileMeAccounts.plist 2>/dev/null');
                if (plistInfo) {
                    // Parse email
                    const emailMatch = plistInfo.match(/"AccountID"\s*=>\s*"([^"]+)"/);
                    if (emailMatch && emailMatch[1] && emailMatch[1].includes('@')) {
                        result.email = emailMatch[1];
                        result.apple_id = emailMatch[1];
                    }

                    // Parse phone number (nếu có)
                    const phoneMatch = plistInfo.match(/"PhoneNumber"\s*=>\s*"([^"]+)"/);
                    if (phoneMatch && phoneMatch[1]) {
                        result.phone_number = phoneMatch[1];
                    }

                    // Parse display name
                    const displayNameMatch = plistInfo.match(/"DisplayName"\s*=>\s*"([^"]+)"/);
                    if (displayNameMatch && displayNameMatch[1]) {
                        result.display_name = displayNameMatch[1];
                    }

                    // Parse first name
                    const firstNameMatch = plistInfo.match(/"firstName"\s*=>\s*"([^"]+)"/);
                    if (firstNameMatch && firstNameMatch[1]) {
                        result.first_name = firstNameMatch[1];
                    }

                    // Parse last name
                    const lastNameMatch = plistInfo.match(/"lastName"\s*=>\s*"([^"]+)"/);
                    if (lastNameMatch && lastNameMatch[1]) {
                        result.last_name = lastNameMatch[1];
                    }

                    // Parse account DSID
                    const dsidMatch = plistInfo.match(/"AccountDSID"\s*=>\s*"([^"]+)"/);
                    if (dsidMatch && dsidMatch[1]) {
                        result.account_dsid = dsidMatch[1];
                    }

                    // Parse account UUID
                    const uuidMatch = plistInfo.match(/"AccountUUID"\s*=>\s*"([^"]+)"/);
                    if (uuidMatch && uuidMatch[1]) {
                        result.account_uuid = uuidMatch[1];
                    }
                }
            } catch (error) {
                logger.warn('Could not read iCloud plist:', error.message);
            }

            // Method 2: Lấy từ iCloud account info bằng defaults (backup)
            if (!result.email) {
                try {
                    const { stdout: accountInfo } = await execAsync('defaults read MobileMeAccounts 2>/dev/null | grep -A 10 -B 5 "AccountID"');
                    if (accountInfo) {
                        // Parse email
                        const emailMatch = accountInfo.match(/AccountID\s*=\s*"([^"]+)"/);
                        if (emailMatch && emailMatch[1] && emailMatch[1].includes('@')) {
                            result.email = emailMatch[1];
                            result.apple_id = emailMatch[1];
                        }

                        // Parse phone number
                        const phoneMatch = accountInfo.match(/PhoneNumber\s*=\s*"([^"]+)"/);
                        if (phoneMatch && phoneMatch[1]) {
                            result.phone_number = phoneMatch[1];
                        }
                    }
                } catch (error) {
                    logger.warn('Could not read iCloud account info:', error.message);
                }
            }

            // Method 3: Lấy từ iCloud account bằng AppleScript (backup)
            if (!result.email) {
                try {
                    const { stdout: appleScriptResult } = await execAsync('osascript -e "tell application \\"System Events\\" to tell process \\"System Preferences\\" to get value of text field 1 of group 1 of window 1" 2>/dev/null');
                    if (appleScriptResult && appleScriptResult.trim() && appleScriptResult.trim().includes('@')) {
                        result.email = appleScriptResult.trim();
                        result.apple_id = appleScriptResult.trim();
                    }
                } catch (error) {
                    logger.warn('Could not get iCloud account via AppleScript:', error.message);
                }
            }

            // Method 4: Lấy từ iCloud account bằng security command (backup)
            if (!result.email) {
                try {
                    const { stdout: securityResult } = await execAsync('security find-internet-password -s "www.icloud.com" -a "*" 2>/dev/null | grep "acct" | head -1 | sed "s/.*acct<blob>=\\(.*\\)/\\1/"');
                    if (securityResult && securityResult.trim() && securityResult.trim().includes('@')) {
                        result.email = securityResult.trim();
                        result.apple_id = securityResult.trim();
                    }
                } catch (error) {
                    logger.warn('Could not get iCloud account via security:', error.message);
                }
            }

            return (result.email || result.phone_number) ? result : null;

        } catch (error) {
            logger.warn('Could not get iCloud account info:', error.message);
            return null;
        }
    }

    // Lấy thông tin iCloud hiện tại (cached hoặc detect mới)
    async getICloudInfo(forceRefresh = false) {
        if (!forceRefresh && this.iCloudInfo) {
            return this.iCloudInfo;
        }

        return await this.detectICloudInfo();
    }

    // Lấy email iCloud chính
    async getPrimaryICloudEmail() {
        const info = await this.getICloudInfo();
        return info.email;
    }

    // Lấy số điện thoại iCloud
    async getICloudPhoneNumber() {
        const info = await this.getICloudInfo();
        return info.phone_number;
    }

    // Lấy Apple ID
    async getAppleID() {
        const info = await this.getICloudInfo();
        return info.apple_id;
    }

    // Kiểm tra xem có iCloud account nào được đăng nhập không
    async isICloudSignedIn() {
        const info = await this.getICloudInfo();
        return !!(info.email || info.phone_number || info.apple_id);
    }

    // Lấy danh sách tất cả email iCloud tìm được
    async getAllICloudEmails() {
        const info = await this.getICloudInfo();
        const emails = [];

        if (info.email) emails.push(info.email);
        if (info.apple_id && info.apple_id.includes('@')) emails.push(info.apple_id);

        return [...new Set(emails)]; // Remove duplicates
    }

    // Lấy thông tin chi tiết về việc detect
    async getDetectionDetails() {
        const info = await this.getICloudInfo();
        return {
            detected_info: {
                email: info.email,
                phone_number: info.phone_number,
                apple_id: info.apple_id
            },
            sources: info.sources,
            methods: info.detection_methods,
            is_signed_in: !!(info.email || info.phone_number || info.apple_id)
        };
    }
}

export default ICloudDetectionService; 