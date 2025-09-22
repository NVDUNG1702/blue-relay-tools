// Ngrok Configuration
export const NGROK_CONFIG = {
   // Enable/disable ngrok
   ENABLE_NGROK: true,

   // Your ngrok auth token (optional - for custom domains)
   // Get it from: https://dashboard.ngrok.com/get-started/your-authtoken
   NGROK_AUTH_TOKEN: process.env.NGROK_AUTH_TOKEN || null,

   // Ngrok region (us, eu, au, ap, sa, jp, in)
   REGION: 'us',

   // Custom subdomain (requires paid plan)
   SUBDOMAIN: null,

   // Additional ngrok options
   OPTIONS: {
      // Basic auth (username:password)
      basic_auth: null,

      // Custom headers
      bind_tls: true,

      // Inspect requests (disable for production)
      inspect: false
   }
};

// Usage instructions
export const NGROK_INSTRUCTIONS = `
🌐 Ngrok Integration Instructions:

1. Basic Setup:
   - Set ENABLE_NGROK: true to enable ngrok
   - Server will automatically create a public URL

2. Optional: Get Auth Token (for custom domains):
   - Sign up at https://ngrok.com
   - Get your auth token from dashboard
   - Set NGROK_AUTH_TOKEN in environment

3. Access URLs:
   - Local: http://localhost:4004
   - Public: Check console output or /api/ngrok-url

4. Mobile Testing:
   - Use the ngrok URL on your phone
   - HTTPS is automatically enabled
   - Works with WebSocket connections

5. Security:
   - ngrok URLs are public - be careful with sensitive data
   - Consider using basic auth for additional security
`; 