export async function logSentMessage(messageData) {
    console.log('📤 Message sent:', messageData);
}
export async function logError(error, context) {
    console.error('❌ Error:', error, context);
}
export default {
    logSentMessage,
    logError
};
