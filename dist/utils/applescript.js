export async function sendMessage(to, body) {
    try {
        // Placeholder implementation - sẽ được thay thế bằng AppleScript thực tế
        console.log(`📱 Sending message to ${to}: ${body}`);
        return 'success';
    }
    catch (error) {
        console.error('Error sending message:', error);
        return 'failed';
    }
}
export default {
    sendMessage
};
