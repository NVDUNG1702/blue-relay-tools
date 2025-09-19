# Blue Relay Tools

Node.js Relay Service cho iMessage trên macOS, cho phép gửi và nhận tin nhắn iMessage qua REST API và WebSocket.

## Tính năng

- ✅ Gửi tin nhắn iMessage qua REST API
- ✅ Nhận tin nhắn iMessage realtime qua WebSocket
- ✅ Ghi log tất cả tin nhắn gửi/nhận
- ✅ Bảo mật với API key
- ✅ CORS support cho frontend
- ✅ Health check endpoint

## Yêu cầu hệ thống

- macOS ≥ 10.15 (Catalina+)
- Node.js ≥ 16
- Messages.app đã đăng nhập iMessage
- Quyền Automation cho Terminal/Node.js

## Cài đặt

```bash
# Clone hoặc tạo project
mkdir blue-relay-tools && cd blue-relay-tools

# Cài đặt dependencies
npm install

# Cấu hình môi trường
cp .env.example .env
# Chỉnh sửa file .env theo nhu cầu
```

## Cấu hình

Tạo file `.env` với các biến sau:

```env
PORT=3000
WS_PORT=3001
API_KEY=your_secret_api_key_123
LOG_PATH=./messages.log.json
POLL_INTERVAL_MS=3000
```

## Sử dụng

### Khởi chạy server

```bash
# Chạy cả REST API và WebSocket
npm start

# Hoặc chạy riêng lẻ
npm run send    # Chỉ REST API
npm run receive # Chỉ WebSocket
```

### API Endpoints

#### 1. Health Check
```bash
GET http://localhost:3000/api/health
```

#### 2. Gửi tin nhắn
```bash
POST http://localhost:3000/api/send
Content-Type: application/json
x-api-key: your_secret_api_key_123

{
  "to": "+84123456789",
  "body": "Xin chào từ Blue Relay!"
}
```

#### 3. Xem logs
```bash
GET http://localhost:3000/api/logs
x-api-key: your_secret_api_key_123
```

### WebSocket

Kết nối WebSocket để nhận tin nhắn realtime:

```javascript
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Đã kết nối WebSocket');
});

socket.on('message.received', (message) => {
  console.log('Tin nhắn mới:', message);
  // message = { sender, text, date }
});
```

## Ví dụ sử dụng

### Test với curl

```bash
# Test health check
curl http://localhost:3000/api/health

# Test gửi tin nhắn
curl -X POST http://localhost:3000/api/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_secret_api_key_123" \
  -d '{"to":"+84123456789","body":"Test từ Blue Relay"}'

# Xem logs
curl -H "x-api-key: your_secret_api_key_123" \
  http://localhost:3000/api/logs
```

### Test WebSocket với wscat

```bash
# Cài đặt wscat
npm install -g wscat

# Kết nối WebSocket
wscat -c ws://localhost:3000
```

## Cấu trúc project

```
blue-relay-tools/
├── src/
│   ├── server.js    # Server chính (REST + WebSocket)
│   ├── index.js     # REST API server
│   ├── send.js      # Module gửi tin nhắn
│   └── receive.js   # Module nhận tin nhắn
├── .env             # Cấu hình môi trường
├── package.json
└── README.md
```

## Troubleshooting

### Lỗi quyền AppleScript
Khi lần đầu chạy, macOS sẽ yêu cầu cấp quyền Automation cho Terminal/Node.js. Chọn "Allow" trong popup.

### Lỗi Messages.app
Đảm bảo:
- Messages.app đã đăng nhập iMessage
- Có kết nối internet
- Số điện thoại đích đã đăng ký iMessage

### Lỗi WebSocket
- Kiểm tra port không bị conflict
- Đảm bảo CORS được cấu hình đúng

## Mở rộng

Để mở rộng tính năng, bạn có thể:

- Thêm database (SQLite, PostgreSQL)
- Tích hợp Redis cho cache
- Thêm authentication phức tạp hơn
- Tạo web interface
- Thêm support cho SMS

## License

ISC # blue-relay-tools
# blue-relay-tools
