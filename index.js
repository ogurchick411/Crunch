
class ChatConnection {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
    }

    connect(username) {
        // Определяем протокол: ws для локалки, wss для production
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}`;
        
        console.log('🔌 Подключение к:', wsUrl);
        console.log('Protocol:', window.location.protocol);
        console.log('Host:', host);
        
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('✅ WebSocket ОТКРЫТ');
            console.log('ReadyState:', this.ws.readyState);
            this.reconnectAttempts = 0;
            showNotification('Подключено к чату', 'success');
            
            this.send({
                type: 'join',
                username: username,
                timestamp: new Date().toISOString()
            });
        };

        this.ws.onmessage = (event) => {
            console.log('📩 Получено сообщение:', event.data);
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (error) {
                console.error('❌ Ошибка парсинга:', error);
            }
        };

        this.ws.onerror = (error) => {
            console.error('❌ WebSocket ошибка:', error);
            console.log('ReadyState:', this.ws?.readyState);
            showNotification('Ошибка соединения', 'error');
        };

        this.ws.onclose = (event) => {
            console.log('🔌 WebSocket ЗАКРЫТ');
            console.log('Code:', event.code, 'Reason:', event.reason);
            console.log('ReadyState:', this.ws?.readyState);
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                setTimeout(() => {
                    this.reconnectAttempts++;
                    showNotification('Переподключение...', 'error');
                    this.connect(username);
                }, this.reconnectDelay);
            }
        };
    }

    send(data) {
        console.log('📤 Попытка отправки:', data);
        console.log('WebSocket существует?', !!this.ws);
        console.log('ReadyState:', this.ws?.readyState);
        console.log('OPEN = 1, текущий =', this.ws?.readyState);
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('✅ Отправляем данные');
            this.ws.send(JSON.stringify(data));
        } else {
            console.error('❌ WebSocket не готов! ReadyState:', this.ws?.readyState);
            showNotification('WebSocket не подключен', 'error');
        }
    }

    handleMessage(data) {
        switch(data.type) {
            case 'message':
                addMessage(data);
                break;
            case 'userJoined':
                addSystemMessage(`${data.username} присоединился к чату`);
                updateOnlineCount(data.onlineCount);
                break;
            case 'userLeft':
                addSystemMessage(`${data.username} покинул чат`);
                updateOnlineCount(data.onlineCount);
                break;
            case 'onlineCount':
                updateOnlineCount(data.count);
                break;
            case 'typing':
                handleTyping(data);
                break;
            case 'history':
                loadHistory(data.messages);
                break;
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Глобальные переменные
let chatConnection = null;
let currentUsername = '';
let typingTimer = null;
let isTyping = false;

// Элементы DOM
const nameScreen = document.getElementById('nameScreen');
const chatScreen = document.getElementById('chatScreen');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const messagesList = document.getElementById('messagesList');
const currentUsernameEl = document.getElementById('currentUsername');
const onlineCountEl = document.getElementById('onlineCount');
const logoutBtn = document.getElementById('logoutBtn');
const typingIndicator = document.getElementById('typingIndicator');
const messagesContainer = document.getElementById('messagesContainer');

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    const savedUsername = localStorage.getItem('crunch_username');
    if (savedUsername) {
        nameInput.value = savedUsername;
    }

    joinBtn.addEventListener('click', joinChat);
    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinChat();
    });

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    messageInput.addEventListener('input', () => {
        autoResize();
        handleTypingIndicator();
    });

    logoutBtn.addEventListener('click', logout);
});

// Присоединение к чату
function joinChat() {
    const username = nameInput.value.trim();
    
    if (!username) {
        showNotification('Введите имя', 'error');
        return;
    }

    if (username.length < 2) {
        showNotification('Имя должно быть минимум 2 символа', 'error');
        return;
    }

    currentUsername = username;
    localStorage.setItem('crunch_username', username);
    currentUsernameEl.textContent = username;

    // Подключаемся к WebSocket СНАЧАЛА
    chatConnection = new ChatConnection();
    chatConnection.connect(username);

    // Ждём 500ms и переключаем экраны
    setTimeout(() => {
        nameScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');
        messageInput.focus();
    }, 500);
}

// Отправка сообщения
function sendMessage() {
    const text = messageInput.value.trim();
    
    if (!text) {
        console.log('Пустое сообщение');
        return;
    }
    
    if (!chatConnection || !chatConnection.ws || chatConnection.ws.readyState !== WebSocket.OPEN) {
        console.log('WebSocket не подключен');
        showNotification('Нет соединения с сервером', 'error');
        return;
    }

    console.log('Отправка сообщения:', text);
    
    chatConnection.send({
        type: 'message',
        text: text,
        username: currentUsername,
        timestamp: new Date().toISOString()
    });

    messageInput.value = '';
    messageInput.style.height = 'auto';
    stopTyping();
}

// Добавление сообщения в чат
function addMessage(data) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    if (data.username === currentUsername) {
        messageDiv.classList.add('own');
    }

    const time = formatTime(data.timestamp);

    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-author">${escapeHtml(data.username)}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-content">${escapeHtml(data.text)}</div>
    `;

    messagesList.appendChild(messageDiv);
    scrollToBottom();
}

// Системное сообщение
function addSystemMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system';
    messageDiv.innerHTML = `
        <div class="message-content">${escapeHtml(text)}</div>
    `;
    messagesList.appendChild(messageDiv);
    scrollToBottom();
}

// Загрузка истории
function loadHistory(messages) {
    messages.forEach(msg => {
        if (msg.type === 'message') {
            addMessage(msg);
        }
    });
}

// Обновление счетчика онлайн
function updateOnlineCount(count) {
    onlineCountEl.textContent = `${count} онлайн`;
}

// Индикатор печати
function handleTypingIndicator() {
    if (!chatConnection) return;

    clearTimeout(typingTimer);

    if (!isTyping && messageInput.value.length > 0) {
        isTyping = true;
        chatConnection.send({
            type: 'typing',
            username: currentUsername,
            isTyping: true
        });
    }

    typingTimer = setTimeout(() => {
        stopTyping();
    }, 1000);
}

function stopTyping() {
    if (isTyping && chatConnection) {
        isTyping = false;
        chatConnection.send({
            type: 'typing',
            username: currentUsername,
            isTyping: false
        });
    }
}

function handleTyping(data) {
    const typingText = typingIndicator.querySelector('.typing-text');
    
    if (data.users && data.users.length > 0) {
        const filtered = data.users.filter(u => u !== currentUsername);
        if (filtered.length > 0) {
            const text = filtered.length === 1 
                ? `${filtered[0]} печатает...`
                : `${filtered.slice(0, 2).join(', ')} ${filtered.length > 2 ? `и еще ${filtered.length - 2}` : ''} печатают...`;
            typingText.textContent = text;
            typingIndicator.classList.remove('hidden');
        } else {
            typingIndicator.classList.add('hidden');
        }
    } else {
        typingIndicator.classList.add('hidden');
    }
}

// Выход из чата
function logout() {
    if (chatConnection) {
        chatConnection.disconnect();
    }
    
    chatScreen.classList.add('hidden');
    nameScreen.classList.remove('hidden');
    messagesList.innerHTML = '';
    currentUsername = '';
}

// Вспомогательные функции
function autoResize() {
    messageInput.style.height = 'auto';
    messageInput.style.height = messageInput.scrollHeight + 'px';
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    
    setTimeout(() => {
        notification.classList.add('hidden');
    }, 3000);
}