const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;

console.log('='.repeat(50));
console.log('🚀 CRUNCH MESSENGER');
console.log('PORT:', PORT);
console.log('='.repeat(50));

// WebSocket с правильными настройками
const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: false
});

const clients = new Map();
const messageHistory = [];
const MAX_HISTORY = 50;
const typingUsers = new Set();

// Статика
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Проверка здоровья для Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        clients: clients.size,
        uptime: process.uptime()
    });
});

// WebSocket подключение
wss.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log('✅ Новое подключение от:', ip);
    console.log('📊 Всего клиентов:', wss.clients.size);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Получено:', data.type, data.username || '');
            handleMessage(ws, data);
        } catch (error) {
            console.error('❌ Ошибка:', error.message);
        }
    });

    ws.on('close', () => {
        console.log('❌ Клиент отключился');
        handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error('❌ WS ошибка:', error.message);
    });
});

// Heartbeat
const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
            console.log('💀 Закрываем мёртвое соединение');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

function handleMessage(ws, data) {
    switch(data.type) {
        case 'join':
            handleJoin(ws, data);
            break;
        case 'message':
            handleChatMessage(ws, data);
            break;
        case 'typing':
            handleTyping(ws, data);
            break;
    }
}

function handleJoin(ws, data) {
    const clientData = {
        username: data.username,
        id: Date.now() + Math.random(),
        joinedAt: new Date()
    };
    
    clients.set(ws, clientData);
    console.log('👤', data.username, 'присоединился. Онлайн:', clients.size);
    
    // Отправляем историю
    ws.send(JSON.stringify({
        type: 'history',
        messages: messageHistory
    }));
    
    // Уведомляем всех
    broadcast({
        type: 'userJoined',
        username: data.username,
        onlineCount: clients.size,
        timestamp: new Date().toISOString()
    });
}

function handleChatMessage(ws, data) {
    const client = clients.get(ws);
    if (!client) {
        console.log('⚠️ Сообщение от неизвестного клиента');
        return;
    }

    const messageData = {
        type: 'message',
        text: data.text,
        username: client.username,
        timestamp: data.timestamp || new Date().toISOString(),
        id: Date.now() + Math.random()
    };

    console.log('💬', client.username + ':', data.text.substring(0, 50));

    messageHistory.push(messageData);
    if (messageHistory.length > MAX_HISTORY) {
        messageHistory.shift();
    }

    broadcast(messageData);
}

function handleTyping(ws, data) {
    const client = clients.get(ws);
    if (!client) return;

    if (data.isTyping) {
        typingUsers.add(client.username);
    } else {
        typingUsers.delete(client.username);
    }

    broadcast({
        type: 'typing',
        users: Array.from(typingUsers)
    });
}

function handleDisconnect(ws) {
    const client = clients.get(ws);
    if (!client) return;

    console.log('👋', client.username, 'вышел. Онлайн:', clients.size - 1);
    
    typingUsers.delete(client.username);
    clients.delete(ws);

    broadcast({
        type: 'userLeft',
        username: client.username,
        onlineCount: clients.size,
        timestamp: new Date().toISOString()
    });
}

function broadcast(data, excludeWs = null) {
    const message = JSON.stringify(data);
    let sent = 0;
    
    clients.forEach((client, ws) => {
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
            ws.send(message);
            sent++;
        }
    });
    
    if (data.type === 'message') {
        console.log('📤 Разослано', sent, 'клиентам');
    }
}

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('✅ СЕРВЕР ЗАПУЩЕН');
    console.log('🌐 Порт:', PORT);
    console.log('🔌 WebSocket готов');
    console.log('='.repeat(50) + '\n');
});

process.on('SIGTERM', () => {
    console.log('Остановка сервера...');
    wss.clients.forEach(ws => ws.close());
    server.close(() => {
        console.log('Сервер остановлен');
        process.exit(0);
    });
});