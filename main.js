const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;
const clients = new Map();
const messageHistory = [];
const MAX_HISTORY = 50;
const typingUsers = new Set();

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

wss.on('connection', (ws) => {
    console.log('Новое подключение');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
    });
});

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
        id: generateId(),
        joinedAt: new Date()
    };
    
    clients.set(ws, clientData);
    
    ws.send(JSON.stringify({
        type: 'history',
        messages: messageHistory
    }));
    
    broadcast({
        type: 'userJoined',
        username: data.username,
        onlineCount: clients.size,
        timestamp: new Date().toISOString()
    });
    
    console.log(`${data.username} присоединился. Онлайн: ${clients.size}`);
}

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

    messageHistory.push(messageData);
    if (messageHistory.length > MAX_HISTORY) {
        messageHistory.shift();
    }

    broadcast(messageData);
    
    console.log(`[${client.username}]: ${data.text}`);
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

function broadcast(data, excludeWs = null) {
    const message = JSON.stringify(data);
    
    clients.forEach((client, ws) => {
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

server.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════╗
    ║              CRUNCH                ║
    ║                                    ║
    ║  Сервер запущен на порту ${PORT}   ║
    ║  http://localhost:${PORT}          ║
    ║                                    ║
    ║  WebSocket: ws://localhost:${PORT} ║
    ╚════════════════════════════════════╝
    `);
});

process.on('SIGTERM', () => {
    console.log('Shutting down server…');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
