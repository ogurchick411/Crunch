const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const db = new Database('crunch.db');

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'crunch_secret_key_change_in_production';

console.log('='.repeat(50));
console.log('CRUNCH MESSENGER');
console.log('PORT:', PORT);
console.log('='.repeat(50));

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        text TEXT NOT NULL,
        encrypted BOOLEAN DEFAULT 0,
        edited BOOLEAN DEFAULT 0,
        deleted BOOLEAN DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
`);

const wss = new WebSocket.Server({ 
    server,
    clientTracking: true,
    perMessageDeflate: false
});

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        if (username.length < 2 || password.length < 6) {
            return res.status(400).json({ error: 'Username min 2 chars, password min 6 chars' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
        const result = stmt.run(username, hashedPassword);
        
        const token = jwt.sign({ userId: result.lastInsertRowid, username }, JWT_SECRET);
        
        db.prepare('INSERT INTO sessions (user_id, token) VALUES (?, ?)').run(result.lastInsertRowid, token);
        
        console.log('👤 Registered:', username);
        
        res.json({ token, username, userId: result.lastInsertRowid });
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            res.status(400).json({ error: 'Username already exists' });
        } else {
            console.error('Register error:', error);
            res.status(500).json({ error: 'Registration failed' });
        }
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
        
        db.prepare('INSERT INTO sessions (user_id, token) VALUES (?, ?)').run(user.id, token);
        
        console.log('Login:', username);
        
        res.json({ token, username: user.username, userId: user.id });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/verify', (req, res) => {
    try {
        const { token } = req.body;
        const decoded = jwt.verify(token, JWT_SECRET);
        const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
        
        if (!session) {
            return res.status(401).json({ error: 'Invalid session' });
        }
        
        res.json({ valid: true, username: decoded.username, userId: decoded.userId });
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

const clients = new Map();
const typingUsers = new Set();

wss.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log('Connection from:', ip);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Message error:', error.message);
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error('WS error:', error.message);
    });
});

const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

function handleMessage(ws, data) {
    switch(data.type) {
        case 'auth':
            handleAuth(ws, data);
            break;
        case 'message':
            handleChatMessage(ws, data);
            break;
        case 'edit':
            handleEdit(ws, data);
            break;
        case 'delete':
            handleDelete(ws, data);
            break;
        case 'typing':
            handleTyping(ws, data);
            break;
    }
}

function handleAuth(ws, data) {
    try {
        const decoded = jwt.verify(data.token, JWT_SECRET);
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
        
        if (!user) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid user' }));
            return ws.close();
        }

        const clientData = {
            userId: user.id,
            username: user.username,
            joinedAt: new Date()
        };
        
        clients.set(ws, clientData);
        
        const messages = db.prepare(`
            SELECT * FROM messages 
            WHERE deleted = 0 
            ORDER BY id DESC 
            LIMIT 50
        `).all().reverse();
        
        ws.send(JSON.stringify({
            type: 'history',
            messages: messages.map(m => ({
                id: m.id,
                type: 'message',
                text: m.text,
                username: m.username,
                timestamp: m.timestamp,
                edited: Boolean(m.edited),
                userId: m.user_id
            }))
        }));
        
        broadcast({
            type: 'userJoined',
            username: user.username,
            onlineCount: clients.size,
            timestamp: new Date().toISOString()
        });
        
        console.log(user.username, 'authenticated. Online:', clients.size);
    } catch (error) {
        console.error('Auth error:', error.message);
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
        ws.close();
    }
}

function handleChatMessage(ws, data) {
    const client = clients.get(ws);
    if (!client) return;

    const stmt = db.prepare(`
        INSERT INTO messages (user_id, username, text) 
        VALUES (?, ?, ?)
    `);
    
    const result = stmt.run(client.userId, client.username, data.text);
    
    const messageData = {
        id: result.lastInsertRowid,
        type: 'message',
        text: data.text,
        username: client.username,
        timestamp: new Date().toISOString(),
        edited: false,
        userId: client.userId
    };

    broadcast(messageData);
    
    console.log('💬', client.username + ':', data.text.substring(0, 50));
}

function handleEdit(ws, data) {
    const client = clients.get(ws);
    if (!client) return;

    const message = db.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?').get(data.messageId, client.userId);
    
    if (!message) return;

    db.prepare('UPDATE messages SET text = ?, edited = 1 WHERE id = ?').run(data.text, data.messageId);

    broadcast({
        type: 'messageEdited',
        messageId: data.messageId,
        text: data.text,
        timestamp: new Date().toISOString()
    });

    console.log('✏️', client.username, 'edited message', data.messageId);
}

function handleDelete(ws, data) {
    const client = clients.get(ws);
    if (!client) return;

    const message = db.prepare('SELECT * FROM messages WHERE id = ? AND user_id = ?').get(data.messageId, client.userId);
    
    if (!message) return;

    db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(data.messageId);

    broadcast({
        type: 'messageDeleted',
        messageId: data.messageId
    });

    console.log('🗑️', client.username, 'deleted message', data.messageId);
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

    console.log(client.username, 'left. Online:', clients.size);
}

function broadcast(data, excludeWs = null) {
    const message = JSON.stringify(data);
    
    clients.forEach((client, ws) => {
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('SERVER RUNNING');
    console.log('Port:', PORT);
    console.log('🔌 WebSocket ready');
    console.log('💾 Database ready');
    console.log('='.repeat(50) + '\n');
});

process.on('SIGTERM', () => {
    console.log('Shutting down...');
    db.close();
    wss.clients.forEach(ws => ws.close());
    server.close(() => {
        console.log('Server stopped');
        process.exit(0);
    });
});