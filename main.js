// Серверная часть на Node.js с WebSocket
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Настройки
const PORT = process.env.PORT || 10000;

console.log('🚀 Запуск сервера...');
console.log('PORT:', PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);

// WebSocket сервер с правильными настройками для production
const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: false
});

console.log('✅ WebSocket сервер создан');

// Хранилище
const clients = new Map(); // Map<WebSocket, {username, id}>
const messageHistory = []; // История последних 50 сообщений
const MAX_HISTORY = 50;
const typingUsers = new Set();

// Раздача статики
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// WebSocket обработка
wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log('🔌 Новое подключение от:', clientIp);
    console.log('Всего клиентов:', wss.clients.size);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Получено:', data.type, 'от', data.username || 'unknown');
            handleMessage(ws, data);
        } catch (error) {
            console.error('❌ Ошибка обработки сообщения:', error);
        }
    });

    ws.on('close', () => {
        console.log('❌ Клиент отключился');
        handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket ошибка:', error);
    });

    // Пинг для поддержания соединения
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// Heartbeat для поддержания соединения
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('💀 Мёртвое соединение, закрываем');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

// Обработка сообщений
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

// Присоединение пользователя
function handleJoin(ws, data) {
    const clientData = {
        username: data.username,
        id: generateId(),
        joinedAt: new Date()
    };
    
    clients.set(ws, clientData);
    
    // Отправляем историю новому пользователю
    ws.send(JSON.stringify({
        type: 'history',
        messages: messageHistory
    }));
    
    // Уведомляем всех о новом пользователе
    broadcast({
        type: 'userJoined',
        username: data.username,
        onlineCount: clients.size,
        timestamp: new Date().toISOString()
    });
    
    console.log(`${data.username} присоединился. Онлайн: ${clients.size}`);
}

// Обработка сообщения чата
function handleChatMessage(ws, data) {
    const client = clients.get(ws);
    if (!client) return;

    const messageData = {
        type: 'message',
        text: data.text,
        username: client.username,
        timestamp: data.timestamp || new Date().toISOString(),
        id: generateId()
    };

    // Добавляем в историю
    messageHistory.push(messageData);
    if (messageHistory.length > MAX_HISTORY) {
        messageHistory.shift();
    }

    // Рассылаем всем
    broadcast(messageData);
    
    console.log(`[${client.username}]: ${data.text}`);
}

// Обработка индикатора печати
function handleTyping(ws, data) {
    const client = clients.get(ws);
    if (!client) return;

    if (data.isTyping) {
        typingUsers.add(client.username);
    } else {
        typingUsers.delete(client.username);
    }

    // Отправляем всем список печатающих
    broadcast({
        type: 'typing',
        users: Array.from(typingUsers)
    });
}

// Отключение пользователя
function handleDisconnect(ws) {
    const client = clients.get(ws);
    if (!client) return;

    typingUsers.delete(client.username);
    clients.delete(ws);

    broadcast({
        type: 'userLeft',
        username: client.username,
        onlineCount: clients.size,
        timestamp: new Date().toISOString()
    });

    console.log(`${client.username} покинул чат. Онлайн: ${clients.size}`);
}

// Рассылка всем клиентам
function broadcast(data, excludeWs = null) {
    const message = JSON.stringify(data);
    
    clients.forEach((client, ws) => {
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

// Генерация ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔════════════════════════════════════╗
    ║             CRUNCH                 ║
    ║                                    ║
    ║  Сервер запущен на порту ${PORT}   ║
    ║  Listening on 0.0.0.0:${PORT}     ║
    ║                                    ║
    ║  WebSocket готов к подключениям   ║
    ╚════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Закрытие сервера...');
    server.close(() => {
        console.log('Сервер закрыт');
        process.exit(0);
    });
});