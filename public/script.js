class NovaChat {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.currentChat = null;
        this.messages = [];
        this.contacts = [];
        this.unreadMessages = {};
        this.typingTimers = {};
        this.isTyping = {};
        
        this.initializeApp();
    }
    
    initializeApp() {
        this.checkAuthStatus();
        this.setupEventListeners();
        this.registerServiceWorker();
    }
    
    async checkAuthStatus() {
        const token = localStorage.getItem('token');
        if (token) {
            try {
                // Verify token is still valid
                const response = await fetch('/api/user/me', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.ok) {
                    const user = await response.json();
                    this.currentUser = user;
                    this.showChatScreen();
                    this.connectSocket();
                    this.loadContacts();
                } else {
                    this.showAuthScreen();
                }
            } catch (error) {
                console.error('Auth check failed:', error);
                this.showAuthScreen();
            }
        } else {
            this.showAuthScreen();
        }
    }
    
    showAuthScreen() {
        this.hideAllScreens();
        document.getElementById('auth-screen').classList.add('active');
    }
    
    showChatScreen() {
        this.hideAllScreens();
        document.getElementById('chat-screen').classList.add('active');
        
        // Update user info in UI
        document.getElementById('user-name').textContent = this.currentUser.displayName;
        document.getElementById('user-avatar').src = this.currentUser.profilePicture || '/default-avatar.png';
    }
    
    showSettingsScreen() {
        this.hideAllScreens();
        document.getElementById('settings-screen').classList.add('active');
        
        // Populate settings with current user data
        document.getElementById('settings-avatar').src = this.currentUser.profilePicture || '/default-avatar.png';
        document.getElementById('profile-name').value = this.currentUser.displayName;
        document.getElementById('profile-status').value = this.currentUser.status || '';
        document.getElementById('last-seen-setting').value = this.currentUser.privacy?.lastSeen || 'everyone';
        document.getElementById('read-receipts-setting').checked = this.currentUser.privacy?.readReceipts !== false;
        
        // Set AI settings
        document.getElementById('ai-name').value = this.currentUser.aiSettings?.name || 'Bera AI';
        document.getElementById('ai-personality').value = this.currentUser.aiSettings?.personality || 'friendly';
        
        // Set theme
        document.querySelector(`input[name="theme"][value="${this.currentUser.theme || 'light'}"]`).checked = true;
    }
    
    showAdminLoginScreen() {
        this.hideAllScreens();
        document.getElementById('admin-login-screen').classList.add('active');
    }
    
    showAdminScreen() {
        this.hideAllScreens();
        document.getElementById('admin-screen').classList.add('active');
        this.loadAdminStats();
        this.loadUsersList();
    }
    
    hideAllScreens() {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
    }
    
    setupEventListeners() {
        // Auth screen events
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                this.switchAuthTab(tab);
            });
        });
        
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.login();
        });
        
        document.getElementById('register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.register();
        });
        
        // Chat screen events
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.showSettingsScreen();
        });
        
        document.getElementById('back-to-chat').addEventListener('click', () => {
            this.showChatScreen();
        });
        
        document.getElementById('send-btn').addEventListener('click', () => {
            this.sendMessage();
        });
        
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
        
        document.getElementById('message-input').addEventListener('input', () => {
            this.handleTyping();
        });
        
        document.getElementById('admin-btn').addEventListener('click', () => {
            this.showAdminLoginScreen();
        });
        
        document.getElementById('admin-back-btn').addEventListener('click', () => {
            this.showSettingsScreen();
        });
        
        document.getElementById('admin-login-btn').addEventListener('click', () => {
            this.adminLogin();
        });
        
        document.getElementById('admin-back').addEventListener('click', () => {
            this.showSettingsScreen();
        });
        
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
        });
        
        document.getElementById('save-profile').addEventListener('click', () => {
            this.saveProfile();
        });
        
        // Contact list click
        document.getElementById('contacts-container').addEventListener('click', (e) => {
            const contactItem = e.target.closest('.contact-item');
            if (contactItem) {
                const contactId = contactItem.dataset.id;
                this.selectChat(contactId);
            }
        });
        
        // AI contact click
        document.querySelector('.ai-contact').addEventListener('click', () => {
            this.selectChat('ai');
        });
    }
    
    switchAuthTab(tab) {
        // Update active tab
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
        
        // Show correct form
        document.querySelectorAll('.auth-form').forEach(form => {
            form.classList.remove('active');
        });
        document.getElementById(`${tab}-form`).classList.add('active');
    }
    
    async login() {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                localStorage.setItem('token', data.token);
                this.currentUser = data.user;
                this.showChatScreen();
                this.connectSocket();
                this.loadContacts();
            } else {
                document.getElementById('auth-error').textContent = data.error;
            }
        } catch (error) {
            document.getElementById('auth-error').textContent = 'Login failed. Please try again.';
        }
    }
    
    async register() {
        const displayName = document.getElementById('register-name').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password, displayName })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                localStorage.setItem('token', data.token);
                this.currentUser = data.user;
                this.showChatScreen();
                this.connectSocket();
                this.loadContacts();
            } else {
                document.getElementById('auth-error').textContent = data.error;
            }
        } catch (error) {
            document.getElementById('auth-error').textContent = 'Registration failed. Please try again.';
        }
    }
    
    connectSocket() {
        this.socket = io();
        
        this.socket.emit('join', this.currentUser.id);
        
        this.socket.on('new_message', (message) => {
            this.handleNewMessage(message);
        });
        
        this.socket.on('message_sent', (message) => {
            this.handleMessageSent(message);
        });
        
        this.socket.on('message_status', (data) => {
            this.updateMessageStatus(data.messageId, data.status);
        });
        
        this.socket.on('typing_start', (data) => {
            this.showTypingIndicator(data.senderId);
        });
        
        this.socket.on('typing_stop', (data) => {
            this.hideTypingIndicator(data.senderId);
        });
        
        this.socket.on('message_edited', (data) => {
            this.updateEditedMessage(data);
        });
        
        this.socket.on('message_deleted', (data) => {
            this.removeMessage(data.messageId);
        });
        
        this.socket.on('banned', () => {
            alert('Your account has been banned.');
            this.logout();
        });
    }
    
    async loadContacts() {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/users', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                this.contacts = await response.json();
                this.renderContacts();
            }
        } catch (error) {
            console.error('Failed to load contacts:', error);
        }
    }
    
    renderContacts() {
        const contactsContainer = document.getElementById('contacts-container');
        contactsContainer.innerHTML = '';
        
        this.contacts.forEach(contact => {
            const contactElement = document.createElement('div');
            contactElement.className = 'contact-item';
            contactElement.dataset.id = contact._id;
            
            const lastSeen = this.formatLastSeen(contact.lastSeen);
            const unreadCount = this.unreadMessages[contact._id] || 0;
            
            contactElement.innerHTML = `
                <img src="${contact.profilePicture || '/default-avatar.png'}" alt="${contact.displayName}">
                <div class="contact-info">
                    <span class="contact-name">${contact.displayName}</span>
                    <span class="contact-status">${contact.isOnline ? 'Online' : lastSeen}</span>
                </div>
                ${unreadCount > 0 ? `<span class="unread-count">${unreadCount}</span>` : ''}
            `;
            
            contactsContainer.appendChild(contactElement);
        });
    }
    
    async selectChat(contactId) {
        // Clear previous chat selection
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Highlight selected contact
        document.querySelector(`.contact-item[data-id="${contactId}"]`)?.classList.add('active');
        
        this.currentChat = contactId;
        
        // Update chat header
        if (contactId === 'ai') {
            document.getElementById('chat-name').textContent = 'Bera AI';
            document.getElementById('chat-avatar').src = '/ai-avatar.png';
            document.getElementById('chat-status').textContent = 'AI Assistant';
        } else {
            const contact = this.contacts.find(c => c._id === contactId);
            if (contact) {
                document.getElementById('chat-name').textContent = contact.displayName;
                document.getElementById('chat-avatar').src = contact.profilePicture || '/default-avatar.png';
                document.getElementById('chat-status').textContent = contact.isOnline ? 'Online' : this.formatLastSeen(contact.lastSeen);
            }
        }
        
        // Load messages
        await this.loadMessages(contactId);
        
        // Mark messages as read
        this.markMessagesAsRead();
    }
    
    async loadMessages(contactId) {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/messages/${contactId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                this.messages = await response.json();
                this.renderMessages();
                
                // Scroll to bottom
                const messagesContainer = document.getElementById('messages-list');
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        } catch (error) {
            console.error('Failed to load messages:', error);
        }
    }
    
    renderMessages() {
        const messagesList = document.getElementById('messages-list');
        messagesList.innerHTML = '';
        
        this.messages.forEach(message => {
            const messageElement = document.createElement('div');
            messageElement.className = `message ${message.sender._id === this.currentUser.id ? 'sent' : 'received'}`;
            messageElement.dataset.id = message._id;
            
            const time = this.formatTime(message.timestamp);
            const editedBadge = message.isEdited ? '<span class="message-edited">(edited)</span>' : '';
            
            messageElement.innerHTML = `
                <div class="message-content">${message.content}</div>
                <div class="message-time">${time} ${editedBadge}</div>
                <div class="message-actions">
                    ${message.sender._id === this.currentUser.id ? `
                        <button class="edit-btn" title="Edit">✏️</button>
                        <button class="delete-btn" title="Delete">🗑️</button>
                    ` : ''}
                </div>
            `;
            
            messagesList.appendChild(messageElement);
            
            // Add event listeners for message actions
            if (message.sender._id === this.currentUser.id) {
                const editBtn = messageElement.querySelector('.edit-btn');
                const deleteBtn = messageElement.querySelector('.delete-btn');
                
                editBtn.addEventListener('click', () => {
                    this.editMessage(message._id);
                });
                
                deleteBtn.addEventListener('click', () => {
                    this.deleteMessage(message._id);
                });
            }
        });
    }
    
    async sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();
        
        if (!content || !this.currentChat) return;
        
        // Clear input
        input.value = '';
        
        if (this.currentChat === 'ai') {
            // Handle AI chat
            this.sendMessageToAI(content);
        } else {
            // Send regular message
            this.socket.emit('send_message', {
                senderId: this.currentUser.id,
                recipientId: this.currentChat,
                content: content
            });
        }
    }
    
    async sendMessageToAI(content) {
        try {
            const token = localStorage.getItem('token');
            
            // Add user message to UI immediately
            const userMessage = {
                _id: 'temp-' + Date.now(),
                sender: { _id: this.currentUser.id, displayName: this.currentUser.displayName },
                recipient: { _id: 'ai', displayName: 'Bera AI' },
                content: content,
                timestamp: new Date(),
                status: 'sent'
            };
            
            this.messages.push(userMessage);
            this.renderMessages();
            
            // Scroll to bottom
            const messagesContainer = document.getElementById('messages-list');
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            
            // Prepare conversation history
            const conversationHistory = this.messages.slice(-10).map(msg => ({
                role: msg.sender._id === this.currentUser.id ? 'user' : 'assistant',
                content: msg.content
            }));
            
            // Call AI API
            const response = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    message: content,
                    conversationHistory: conversationHistory
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                
                // Add AI response to messages
                this.messages.push(data.message);
                this.renderMessages();
                
                // Scroll to bottom
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            } else {
                throw new Error('AI request failed');
            }
        } catch (error) {
            console.error('Error communicating with AI:', error);
            alert('Failed to get response from Bera AI. Please try again.');
        }
    }
    
    handleNewMessage(message) {
        // Add message to current chat if it's the active one
        if (this.currentChat === message.sender._id) {
            this.messages.push(message);
            this.renderMessages();
            
            // Scroll to bottom
            const messagesContainer = document.getElementById('messages-list');
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            
            // Mark as read if chat is active
            this.markMessagesAsRead();
        } else {
            // Update unread count
            this.unreadMessages[message.sender._id] = (this.unreadMessages[message.sender._id] || 0) + 1;
            this.renderContacts();
        }
    }
    
    handleMessageSent(message) {
        // Replace temporary message with the one from server
        const index = this.messages.findIndex(m => m._id === message._id);
        if (index !== -1) {
            this.messages[index] = message;
        } else {
            this.messages.push(message);
        }
        
        this.renderMessages();
    }
    
    updateMessageStatus(messageId, status) {
        const message = this.messages.find(m => m._id === messageId);
        if (message) {
            message.status = status;
            this.renderMessages();
        }
    }
    
    handleTyping() {
        if (!this.currentChat || this.currentChat === 'ai') return;
        
        // Clear previous timer
        if (this.typingTimers[this.currentChat]) {
            clearTimeout(this.typingTimers[this.currentChat]);
        }
        
        // Emit typing start if not already typing
        if (!this.isTyping[this.currentChat]) {
            this.socket.emit('typing_start', {
                senderId: this.currentUser.id,
                recipientId: this.currentChat
            });
            this.isTyping[this.currentChat] = true;
        }
        
        // Set timer to stop typing indicator
        this.typingTimers[this.currentChat] = setTimeout(() => {
            this.socket.emit('typing_stop', {
                senderId: this.currentUser.id,
                recipientId: this.currentChat
            });
            this.isTyping[this.currentChat] = false;
        }, 1000);
    }
    
    showTypingIndicator(userId) {
        if (this.currentChat === userId) {
            const contact = this.contacts.find(c => c._id === userId);
            if (contact) {
                document.getElementById('typing-indicator').textContent = `${contact.displayName} is typing...`;
            }
        }
    }
    
    hideTypingIndicator(userId) {
        if (this.currentChat === userId) {
            document.getElementById('typing-indicator').textContent = '';
        }
    }
    
    markMessagesAsRead() {
        if (!this.currentChat || this.currentChat === 'ai') return;
        
        const unreadMessageIds = this.messages
            .filter(m => m.sender._id === this.currentChat && m.status !== 'read')
            .map(m => m._id);
        
        if (unreadMessageIds.length > 0) {
            this.socket.emit('messages_read', {
                readerId: this.currentUser.id,
                messageIds: unreadMessageIds
            });
            
            // Update UI immediately
            this.messages.forEach(m => {
                if (unreadMessageIds.includes(m._id)) {
                    m.status = 'read';
                }
            });
            
            this.renderMessages();
            
            // Clear unread count
            if (this.unreadMessages[this.currentChat]) {
                delete this.unreadMessages[this.currentChat];
                this.renderContacts();
            }
        }
    }
    
    async editMessage(messageId) {
        const message = this.messages.find(m => m._id === messageId);
        if (!message) return;
        
        const newContent = prompt('Edit your message:', message.content);
        if (newContent && newContent !== message.content) {
            try {
                const token = localStorage.getItem('token');
                const response = await fetch(`/api/message/${messageId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ content: newContent })
                });
                
                if (response.ok) {
                    // Message updated successfully
                    message.content = newContent;
                    message.isEdited = true;
                    message.editedAt = new Date();
                    this.renderMessages();
                } else {
                    alert('Failed to edit message.');
                }
            } catch (error) {
                console.error('Error editing message:', error);
                alert('Failed to edit message.');
            }
        }
    }
    
    async deleteMessage(messageId) {
        if (!confirm('Delete this message? Choose an option:')) return;
        
        const deleteForEveryone = confirm('Delete for everyone? Click OK for everyone, Cancel for just yourself.');
        
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/message/${messageId}?deleteForEveryone=${deleteForEveryone}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                if (deleteForEveryone) {
                    // Remove from UI
                    this.messages = this.messages.filter(m => m._id !== messageId);
                    this.renderMessages();
                } else {
                    // Just hide from current user
                    const message = this.messages.find(m => m._id === messageId);
                    if (message) {
                        message.deletedFor = message.deletedFor || [];
                        message.deletedFor.push(this.currentUser.id);
                        this.renderMessages();
                    }
                }
            } else {
                alert('Failed to delete message.');
            }
        } catch (error) {
            console.error('Error deleting message:', error);
            alert('Failed to delete message.');
        }
    }
    
    updateEditedMessage(data) {
        const message = this.messages.find(m => m._id === data.messageId);
        if (message) {
            message.content = data.content;
            message.isEdited = data.isEdited;
            message.editedAt = data.editedAt;
            this.renderMessages();
        }
    }
    
    removeMessage(messageId) {
        this.messages = this.messages.filter(m => m._id !== messageId);
        this.renderMessages();
    }
    
    async saveProfile() {
        try {
            const formData = new FormData();
            formData.append('displayName', document.getElementById('profile-name').value);
            formData.append('status', document.getElementById('profile-status').value);
            formData.append('privacy[lastSeen]', document.getElementById('last-seen-setting').value);
            formData.append('privacy[readReceipts]', document.getElementById('read-receipts-setting').checked);
            formData.append('aiSettings[name]', document.getElementById('ai-name').value);
            formData.append('aiSettings[personality]', document.getElementById('ai-personality').value);
            
            const theme = document.querySelector('input[name="theme"]:checked').value;
            formData.append('theme', theme);
            
            const avatarInput = document.getElementById('avatar-input');
            if (avatarInput.files[0]) {
                formData.append('profilePicture', avatarInput.files[0]);
            }
            
            const token = localStorage.getItem('token');
            const response = await fetch('/api/user', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });
            
            if (response.ok) {
                const updatedUser = await response.json();
                this.currentUser = updatedUser;
                
                // Update UI
                document.getElementById('user-name').textContent = updatedUser.displayName;
                document.getElementById('user-avatar').src = updatedUser.profilePicture || '/default-avatar.png';
                document.getElementById('settings-avatar').src = updatedUser.profilePicture || '/default-avatar.png';
                
                // Apply theme
                document.documentElement.setAttribute('data-theme', updatedUser.theme || 'light');
                
                alert('Profile updated successfully!');
            } else {
                alert('Failed to update profile.');
            }
        } catch (error) {
            console.error('Error updating profile:', error);
            alert('Failed to update profile.');
        }
    }
    
    async adminLogin() {
        const password = document.getElementById('admin-password').value;
        
        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                localStorage.setItem('adminToken', data.token);
                this.showAdminScreen();
            } else {
                document.getElementById('admin-error').textContent = data.error;
            }
        } catch (error) {
            document.getElementById('admin-error').textContent = 'Admin login failed.';
        }
    }
    
    async loadAdminStats() {
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/admin/stats', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const stats = await response.json();
                document.getElementById('total-users').textContent = stats.totalUsers;
                document.getElementById('total-messages').textContent = stats.totalMessages;
                document.getElementById('active-users').textContent = stats.activeUsers;
            }
        } catch (error) {
            console.error('Failed to load admin stats:', error);
        }
    }
    
    async loadUsersList() {
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch('/api/users', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const users = await response.json();
                this.renderUsersTable(users);
            }
        } catch (error) {
            console.error('Failed to load users list:', error);
        }
    }
    
    renderUsersTable(users) {
        const tableBody = document.getElementById('users-table-body');
        tableBody.innerHTML = '';
        
        users.forEach(user => {
            const row = document.createElement('tr');
            
            row.innerHTML = `
                <td>${user.displayName}</td>
                <td>${user.email}</td>
                <td>${user.isOnline ? 'Online' : 'Offline'}</td>
                <td>${this.formatLastSeen(user.lastSeen)}</td>
                <td>
                    ${!user.isBanned ? `
                        <button class="ban-btn" data-id="${user._id}">Ban</button>
                    ` : 'Banned'}
                </td>
            `;
            
            tableBody.appendChild(row);
            
            // Add event listener for ban button
            if (!user.isBanned) {
                const banBtn = row.querySelector('.ban-btn');
                banBtn.addEventListener('click', () => {
                    this.banUser(user._id);
                });
            }
        });
    }
    
    async banUser(userId) {
        if (!confirm('Are you sure you want to ban this user?')) return;
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/admin/ban/${userId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                alert('User banned successfully.');
                this.loadUsersList();
            } else {
                alert('Failed to ban user.');
            }
        } catch (error) {
            console.error('Error banning user:', error);
            alert('Failed to ban user.');
        }
    }
    
    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('adminToken');
        
        if (this.socket) {
            this.socket.disconnect();
        }
        
        this.currentUser = null;
        this.currentChat = null;
        this.messages = [];
        this.contacts = [];
        
        this.showAuthScreen();
    }
    
    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    formatLastSeen(timestamp) {
        if (!timestamp) return 'Never';
        
        const now = new Date();
        const lastSeen = new Date(timestamp);
        const diffMs = now - lastSeen;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours} hr ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        
        return lastSeen.toLocaleDateString();
    }
    
    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js')
                .then(registration => {
                    console.log('SW registered: ', registration);
                })
                .catch(registrationError => {
                    console.log('SW registration failed: ', registrationError);
                });
            });
        }
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new NovaChat();
});
