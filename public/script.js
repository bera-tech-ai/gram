class NovaChat {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.currentChat = null;
        this.contacts = [];
        this.messages = new Map();
        this.isTyping = false;
        this.typingTimer = null;
        
        this.initializeApp();
    }
    
    initializeApp() {
        this.checkAuthStatus();
        this.setupEventListeners();
        this.loadTheme();
    }
    
    checkAuthStatus() {
        const token = localStorage.getItem('token');
        if (token) {
            this.validateToken(token);
        } else {
            this.showAuthScreen();
        }
    }
    
    validateToken(token) {
        fetch('/api/users', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => {
            if (response.ok) {
                return response.json();
            } else {
                throw new Error('Invalid token');
            }
        })
        .then(users => {
            this.currentUser = JSON.parse(localStorage.getItem('user'));
            this.setupSocketConnection(token);
            this.showChatScreen();
            this.loadContacts();
        })
        .catch(error => {
            console.error('Token validation failed:', error);
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            this.showAuthScreen();
        });
    }
    
    setupSocketConnection(token) {
        this.socket = io();
        
        this.socket.on('connect', () => {
            this.socket.emit('authenticate', token);
        });
        
        this.socket.on('authenticated', (data) => {
            console.log('Authenticated with socket');
        });
        
        this.socket.on('authenticationFailed', () => {
            console.error('Socket authentication failed');
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            this.showAuthScreen();
        });
        
        this.socket.on('newMessage', (message) => {
            this.handleNewMessage(message);
        });
        
        this.socket.on('messageSent', (message) => {
            this.handleMessageSent(message);
        });
        
        this.socket.on('messageEdited', (message) => {
            this.handleMessageEdited(message);
        });
        
        this.socket.on('messageDeleted', (data) => {
            this.handleMessageDeleted(data);
        });
        
        this.socket.on('messageRead', (data) => {
            this.handleMessageRead(data);
        });
        
        this.socket.on('userTyping', (data) => {
            this.showTypingIndicator(data.userId);
        });
        
        this.socket.on('userStoppedTyping', (data) => {
            this.hideTypingIndicator(data.userId);
        });
        
        this.socket.on('userOnline', (data) => {
            this.updateUserStatus(data.userId, true);
        });
        
        this.socket.on('userOffline', (data) => {
            this.updateUserStatus(data.userId, false);
        });
        
        this.socket.on('userBanned', () => {
            alert('Your account has been banned');
            this.logout();
        });
        
        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            alert(error);
        });
    }
    
    setupEventListeners() {
        // Auth forms
        document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('register-form').addEventListener('submit', (e) => this.handleRegister(e));
        
        // Auth tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                this.switchAuthTab(tab);
            });
        });
        
        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        
        // Theme toggle
        document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());
        
        // Settings
        document.getElementById('settings-btn').addEventListener('click', () => this.openSettings());
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => this.closeModals());
        });
        
        // Settings tabs
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                this.switchSettingsTab(tabName);
            });
        });
        
        // Save settings
        document.getElementById('save-profile').addEventListener('click', () => this.saveProfile());
        document.getElementById('save-privacy').addEventListener('click', () => this.savePrivacy());
        document.getElementById('save-ai-settings').addEventListener('click', () => this.saveAISettings());
        
        // Admin login
        document.getElementById('admin-login-btn').addEventListener('click', () => this.adminLogin());
        
        // Message input
        document.getElementById('message-input').addEventListener('input', () => this.handleTyping());
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Send button
        document.getElementById('send-btn').addEventListener('click', () => this.sendMessage());
        
        // Chat info
        document.getElementById('chat-info-btn').addEventListener('click', () => this.toggleInfoPanel());
        document.getElementById('close-info').addEventListener('click', () => this.toggleInfoPanel());
        
        // Block and clear chat
        document.getElementById('block-btn').addEventListener('click', () => this.blockUser());
        document.getElementById('clear-chat-btn').addEventListener('click', () => this.clearChat());
        
        // Search contacts
        document.getElementById('search-contacts').addEventListener('input', (e) => this.searchContacts(e.target.value));
        
        // Context menu
        document.addEventListener('click', () => this.hideContextMenu());
    }
    
    switchAuthTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
        
        document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
        document.getElementById(`${tab}-form`).classList.add('active');
    }
    
    async handleLogin(e) {
        e.preventDefault();
        
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                this.currentUser = data.user;
                this.setupSocketConnection(data.token);
                this.showChatScreen();
                this.loadContacts();
            } else {
                this.showAuthError(data.error);
            }
        } catch (error) {
            this.showAuthError('Login failed. Please try again.');
        }
    }
    
    async handleRegister(e) {
        e.preventDefault();
        
        const name = document.getElementById('register-name').value;
        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password, name })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                this.currentUser = data.user;
                this.setupSocketConnection(data.token);
                this.showChatScreen();
                this.loadContacts();
            } else {
                this.showAuthError(data.error);
            }
        } catch (error) {
            this.showAuthError('Registration failed. Please try again.');
        }
    }
    
    showAuthError(message) {
        const errorElement = document.getElementById('auth-error');
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        
        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 5000);
    }
    
    showAuthScreen() {
        document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
        document.getElementById('auth-screen').classList.add('active');
    }
    
    showChatScreen() {
        document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
        document.getElementById('chat-screen').classList.add('active');
        
        // Update user info in sidebar
        document.getElementById('user-name').textContent = this.currentUser.name;
        document.getElementById('user-avatar').src = this.currentUser.profilePicture || 'https://via.placeholder.com/40';
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
            } else {
                console.error('Failed to load contacts');
            }
        } catch (error) {
            console.error('Error loading contacts:', error);
        }
    }
    
    renderContacts() {
        const contactsList = document.querySelector('.contacts-list');
        
        // Clear existing contacts (except Bera AI)
        const aiContact = contactsList.querySelector('.ai-contact');
        contactsList.innerHTML = '';
        contactsList.appendChild(aiContact);
        
        // Add all other contacts
        this.contacts.forEach(contact => {
            const contactElement = document.createElement('div');
            contactElement.className = 'contact';
            contactElement.dataset.id = contact._id;
            
            const isOnline = contact.isOnline ? 'online' : 'offline';
            const status = contact.isOnline ? 'Online' : this.formatLastSeen(contact.lastSeen);
            
            contactElement.innerHTML = `
                <div class="contact-avatar">
                    <img src="${contact.profilePicture || 'https://via.placeholder.com/50'}" alt="${contact.name}">
                </div>
                <div class="contact-info">
                    <div class="contact-name">${contact.name}</div>
                    <div class="contact-status">${status}</div>
                </div>
            `;
            
            contactElement.addEventListener('click', () => this.openChat(contact));
            contactsList.appendChild(contactElement);
        });
    }
    
    formatLastSeen(timestamp) {
        if (!timestamp) return 'Never';
        
        const now = new Date();
        const lastSeen = new Date(timestamp);
        const diffInMinutes = Math.floor((now - lastSeen) / (1000 * 60));
        
        if (diffInMinutes < 1) return 'Just now';
        if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
        if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} hours ago`;
        
        return `${Math.floor(diffInMinutes / 1440)} days ago`;
    }
    
    async openChat(contact) {
        this.currentChat = contact;
        
        // Update UI
        document.querySelectorAll('.contact').forEach(c => c.classList.remove('active'));
        document.querySelector(`.contact[data-id="${contact._id}"]`).classList.add('active');
        
        document.getElementById('partner-name').textContent = contact.name;
        document.getElementById('partner-avatar').src = contact.profilePicture || 'https://via.placeholder.com/40';
        document.getElementById('partner-status').textContent = contact.isOnline ? 'Online' : this.formatLastSeen(contact.lastSeen);
        
        // Update info panel
        document.getElementById('info-name').textContent = contact.name;
        document.getElementById('info-avatar').src = contact.profilePicture || 'https://via.placeholder.com/100';
        document.getElementById('info-status').textContent = contact.status || 'Hey there! I am using NovaChat';
        
        // Load messages
        await this.loadMessages(contact._id);
        
        // Mark messages as read
        this.markMessagesAsRead();
    }
    
    async loadMessages(userId) {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`/api/messages/${userId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const messages = await response.json();
                this.messages.set(userId, messages);
                this.renderMessages(messages);
            } else {
                console.error('Failed to load messages');
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }
    
    renderMessages(messages) {
        const messagesContainer = document.querySelector('.messages');
        messagesContainer.innerHTML = '';
        
        messages.forEach(message => {
            this.appendMessageToUI(message);
        });
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    appendMessageToUI(message) {
        const messagesContainer = document.querySelector('.messages');
        const messageElement = document.createElement('div');
        
        const isOutgoing = message.sender._id === this.currentUser.id;
        const messageTime = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageElement.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
        messageElement.dataset.id = message._id;
        
        let statusIcon = '✓';
        if (message.deliveredTo && message.deliveredTo.includes(message.recipient._id)) {
            statusIcon = '✓✓';
        }
        if (message.readBy && message.readBy.includes(message.recipient._id)) {
            statusIcon = '✓✓✓';
        }
        
        messageElement.innerHTML = `
            <div class="message-content">${message.content}</div>
            <div class="message-time">${messageTime}</div>
            ${isOutgoing ? `<div class="message-status">${statusIcon}</div>` : ''}
            ${message.isEdited ? `<div class="message-edited">edited</div>` : ''}
        `;
        
        // Add context menu
        if (isOutgoing) {
            messageElement.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e, message);
            });
        }
        
        messagesContainer.appendChild(messageElement);
    }
    
    async sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();
        
        if (!content || !this.currentChat) return;
        
        const isAI = this.currentChat._id === 'bera-ai';
        
        this.socket.emit('sendMessage', {
            recipientId: isAI ? 'bera-ai' : this.currentChat._id,
            content,
            isAI
        });
        
        input.value = '';
        this.stopTyping();
    }
    
    handleNewMessage(message) {
        // Check if this message belongs to the current chat
        const isCurrentChat = (
            (message.sender._id === this.currentChat?._id && message.recipient._id === this.currentUser.id) ||
            (message.recipient._id === this.currentChat?._id && message.sender._id === this.currentUser.id)
        );
        
        if (isCurrentChat) {
            this.appendMessageToUI(message);
            
            // Scroll to bottom
            document.querySelector('.messages').scrollTop = document.querySelector('.messages').scrollHeight;
            
            // Mark as read if it's the current chat
            if (message.sender._id !== this.currentUser.id) {
                this.socket.emit('markAsRead', { messageId: message._id });
            }
        }
        
        // Update the message in our local storage
        const chatId = message.sender._id === this.currentUser.id ? message.recipient._id : message.sender._id;
        const chatMessages = this.messages.get(chatId) || [];
        chatMessages.push(message);
        this.messages.set(chatId, chatMessages);
        
        // Update contact list if needed
        this.updateContactLastMessage(chatId, message);
    }
    
    handleMessageSent(message) {
        // This is just for confirmation, the message is already in the UI
        // We might update the status icon here
        const messageElement = document.querySelector(`.message[data-id="${message._id}"]`);
        if (messageElement) {
            const statusElement = messageElement.querySelector('.message-status');
            if (statusElement) {
                statusElement.textContent = '✓✓';
            }
        }
    }
    
    handleMessageEdited(message) {
        const messageElement = document.querySelector(`.message[data-id="${message._id}"]`);
        if (messageElement) {
            const contentElement = messageElement.querySelector('.message-content');
            const editedElement = messageElement.querySelector('.message-edited') || document.createElement('div');
            
            contentElement.textContent = message.content;
            
            if (!messageElement.contains(editedElement)) {
                editedElement.className = 'message-edited';
                editedElement.textContent = 'edited';
                messageElement.appendChild(editedElement);
            }
        }
        
        // Update the message in our local storage
        const chatId = message.sender._id === this.currentUser.id ? message.recipient._id : message.sender._id;
        const chatMessages = this.messages.get(chatId) || [];
        const index = chatMessages.findIndex(m => m._id === message._id);
        if (index !== -1) {
            chatMessages[index] = message;
            this.messages.set(chatId, chatMessages);
        }
    }
    
    handleMessageDeleted(data) {
        const { messageId, deletedForEveryone } = data;
        
        if (deletedForEveryone) {
            const messageElement = document.querySelector(`.message[data-id="${messageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }
        } else {
            // Just remove from UI, keep in storage for the other user
            const messageElement = document.querySelector(`.message[data-id="${messageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }
        }
        
        // Update the message in our local storage
        if (this.currentChat) {
            const chatMessages = this.messages.get(this.currentChat._id) || [];
            const index = chatMessages.findIndex(m => m._id === messageId);
            if (index !== -1) {
                if (deletedForEveryone) {
                    chatMessages.splice(index, 1);
                } else {
                    // Just mark as deleted for me
                    chatMessages[index].deletedFor = chatMessages[index].deletedFor || [];
                    chatMessages[index].deletedFor.push(this.currentUser.id);
                }
                this.messages.set(this.currentChat._id, chatMessages);
            }
        }
    }
    
    handleMessageRead(data) {
        const { messageId } = data;
        const messageElement = document.querySelector(`.message[data-id="${messageId}"]`);
        if (messageElement) {
            const statusElement = messageElement.querySelector('.message-status');
            if (statusElement) {
                statusElement.textContent = '✓✓✓';
            }
        }
    }
    
    handleTyping() {
        if (!this.isTyping) {
            this.isTyping = true;
            this.socket.emit('typingStart', { recipientId: this.currentChat._id });
        }
        
        clearTimeout(this.typingTimer);
        this.typingTimer = setTimeout(() => {
            this.stopTyping();
        }, 1000);
    }
    
    stopTyping() {
        this.isTyping = false;
        this.socket.emit('typingStop', { recipientId: this.currentChat._id });
    }
    
    showTypingIndicator(userId) {
        if (this.currentChat && this.currentChat._id === userId) {
            document.getElementById('typing-indicator').classList.add('active');
        }
    }
    
    hideTypingIndicator(userId) {
        if (this.currentChat && this.currentChat._id === userId) {
            document.getElementById('typing-indicator').classList.remove('active');
        }
    }
    
    updateUserStatus(userId, isOnline) {
        // Update in contacts list
        const contactElement = document.querySelector(`.contact[data-id="${userId}"]`);
        if (contactElement) {
            const statusElement = contactElement.querySelector('.contact-status');
            if (statusElement) {
                statusElement.textContent = isOnline ? 'Online' : this.formatLastSeen(new Date());
            }
        }
        
        // Update in chat header if this is the current chat
        if (this.currentChat && this.currentChat._id === userId) {
            document.getElementById('partner-status').textContent = isOnline ? 'Online' : this.formatLastSeen(new Date());
        }
        
        // Update in our contacts array
        const contact = this.contacts.find(c => c._id === userId);
        if (contact) {
            contact.isOnline = isOnline;
            contact.lastSeen = new Date();
        }
    }
    
    updateContactLastMessage(contactId, message) {
        // This would update the contact list with the last message preview
        // Implementation would depend on your UI requirements
    }
    
    markMessagesAsRead() {
        if (!this.currentChat) return;
        
        const messages = this.messages.get(this.currentChat._id) || [];
        messages.forEach(message => {
            if (message.sender._id !== this.currentUser.id && 
                (!message.readBy || !message.readBy.includes(this.currentUser.id))) {
                this.socket.emit('markAsRead', { messageId: message._id });
            }
        });
    }
    
    showContextMenu(e, message) {
        const contextMenu = document.getElementById('message-context-menu');
        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.pageX}px`;
        contextMenu.style.top = `${e.pageY}px`;
        
        contextMenu.dataset.messageId = message._id;
        
        // Add event listeners to menu items
        contextMenu.querySelectorAll('li').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                this.handleMessageAction(message, action);
                contextMenu.style.display = 'none';
            });
        });
    }
    
    hideContextMenu() {
        document.getElementById('message-context-menu').style.display = 'none';
    }
    
    handleMessageAction(message, action) {
        switch (action) {
            case 'reply':
                // Implement reply functionality
                break;
            case 'edit':
                this.editMessage(message);
                break;
            case 'delete-me':
                this.deleteMessage(message, false);
                break;
            case 'delete-everyone':
                this.deleteMessage(message, true);
                break;
        }
    }
    
    editMessage(message) {
        const newContent = prompt('Edit your message:', message.content);
        if (newContent !== null && newContent.trim() !== '') {
            const token = localStorage.getItem('token');
            
            fetch(`/api/messages/${message._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ content: newContent.trim() })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to edit message');
                }
            })
            .catch(error => {
                console.error('Error editing message:', error);
                alert('Failed to edit message');
            });
        }
    }
    
    deleteMessage(message, deleteForEveryone) {
        const token = localStorage.getItem('token');
        
        fetch(`/api/messages/${message._id}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ deleteForEveryone })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to delete message');
            }
        })
        .catch(error => {
            console.error('Error deleting message:', error);
            alert('Failed to delete message');
        });
    }
    
    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        
        // Update icon
        const themeIcon = document.querySelector('#theme-toggle i');
        themeIcon.className = newTheme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
        
        // Save to server if user is logged in
        if (this.currentUser) {
            const token = localStorage.getItem('token');
            
            fetch('/api/user/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ theme: newTheme })
            }).catch(error => {
                console.error('Error saving theme:', error);
            });
        }
    }
    
    loadTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        
        // Update icon
        const themeIcon = document.querySelector('#theme-toggle i');
        if (themeIcon) {
            themeIcon.className = savedTheme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
        }
    }
    
    openSettings() {
        document.getElementById('settings-modal').classList.add('active');
        this.loadUserSettings();
    }
    
    closeModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
    }
    
    switchSettingsTab(tabName) {
        document.querySelectorAll('.settings-tab').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.settings-panel').forEach(panel => panel.classList.remove('active'));
        
        document.querySelector(`.settings-tab[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}-settings`).classList.add('active');
    }
    
    async loadUserSettings() {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/users', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const users = await response.json();
                const currentUser = users.find(u => u._id === this.currentUser.id);
                
                if (currentUser) {
                    // Profile settings
                    document.getElementById('profile-name').value = currentUser.name;
                    document.getElementById('profile-status').value = currentUser.status;
                    document.getElementById('profile-avatar').src = currentUser.profilePicture || 'https://via.placeholder.com/100';
                    
                    // Privacy settings
                    document.getElementById('last-seen-privacy').value = currentUser.privacy?.lastSeen || 'everyone';
                    document.getElementById('read-receipts').checked = currentUser.privacy?.readReceipts !== false;
                    
                    // AI settings
                    document.getElementById('ai-name').value = currentUser.beraAISettings?.name || 'Bera AI';
                    document.getElementById('ai-personality').value = currentUser.beraAISettings?.personality || 'friendly';
                    
                    // Load blocked users
                    this.loadBlockedUsers();
                }
            }
        } catch (error) {
            console.error('Error loading user settings:', error);
        }
    }
    
    async loadBlockedUsers() {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/users', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const users = await response.json();
                const currentUser = users.find(u => u._id === this.currentUser.id);
                
                if (currentUser && currentUser.blockedUsers) {
                    const blockedUsersList = document.getElementById('blocked-users-list');
                    blockedUsersList.innerHTML = '';
                    
                    currentUser.blockedUsers.forEach(async userId => {
                        const blockedUser = users.find(u => u._id === userId);
                        if (blockedUser) {
                            const userElement = document.createElement('div');
                            userElement.className = 'blocked-user';
                            userElement.innerHTML = `
                                <span>${blockedUser.name}</span>
                                <button class="unblock-btn" data-userid="${userId}">Unblock</button>
                            `;
                            blockedUsersList.appendChild(userElement);
                            
                            userElement.querySelector('.unblock-btn').addEventListener('click', () => {
                                this.unblockUser(userId);
                            });
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Error loading blocked users:', error);
        }
    }
    
    async saveProfile() {
        try {
            const token = localStorage.getItem('token');
            const name = document.getElementById('profile-name').value;
            const status = document.getElementById('profile-status').value;
            
            const response = await fetch('/api/user/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name, status })
            });
            
            if (response.ok) {
                alert('Profile updated successfully');
                
                // Update UI
                this.currentUser.name = name;
                document.getElementById('user-name').textContent = name;
                localStorage.setItem('user', JSON.stringify(this.currentUser));
            } else {
                alert('Failed to update profile');
            }
        } catch (error) {
            console.error('Error saving profile:', error);
            alert('Failed to update profile');
        }
    }
    
    async savePrivacy() {
        try {
            const token = localStorage.getItem('token');
            const lastSeen = document.getElementById('last-seen-privacy').value;
            const readReceipts = document.getElementById('read-receipts').checked;
            
            const response = await fetch('/api/user/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    privacy: { 
                        lastSeen, 
                        readReceipts 
                    } 
                })
            });
            
            if (response.ok) {
                alert('Privacy settings updated successfully');
            } else {
                alert('Failed to update privacy settings');
            }
        } catch (error) {
            console.error('Error saving privacy settings:', error);
            alert('Failed to update privacy settings');
        }
    }
    
    async saveAISettings() {
        try {
            const token = localStorage.getItem('token');
            const name = document.getElementById('ai-name').value;
            const personality = document.getElementById('ai-personality').value;
            
            const response = await fetch('/api/bera-ai/settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name, personality })
            });
            
            if (response.ok) {
                alert('Bera AI settings updated successfully');
            } else {
                alert('Failed to update Bera AI settings');
            }
        } catch (error) {
            console.error('Error saving AI settings:', error);
            alert('Failed to update Bera AI settings');
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
                document.getElementById('admin-login-form').style.display = 'none';
                document.getElementById('admin-dashboard').style.display = 'block';
                this.loadAdminDashboard();
            } else {
                alert(data.error);
            }
        } catch (error) {
            console.error('Admin login error:', error);
            alert('Admin login failed');
        }
    }
    
    async loadAdminDashboard() {
        try {
            const token = localStorage.getItem('adminToken');
            
            // Load stats
            const statsResponse = await fetch('/api/admin/stats', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (statsResponse.ok) {
                const stats = await statsResponse.json();
                document.getElementById('total-users').textContent = stats.totalUsers;
                document.getElementById('total-messages').textContent = stats.totalMessages;
                document.getElementById('active-users').textContent = stats.activeUsers;
            }
            
            // Load users
            const usersResponse = await fetch('/api/admin/users', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (usersResponse.ok) {
                const users = await usersResponse.json();
                this.renderAdminUsers(users);
            }
        } catch (error) {
            console.error('Error loading admin dashboard:', error);
        }
    }
    
    renderAdminUsers(users) {
        const usersList = document.querySelector('.users-list');
        usersList.innerHTML = '';
        
        users.forEach(user => {
            const userElement = document.createElement('div');
            userElement.className = 'user-item';
            
            userElement.innerHTML = `
                <div>
                    <span class="user-status ${user.isOnline ? 'online' : 'offline'}"></span>
                    <span>${user.name} (${user.username})</span>
                </div>
                <div>
                    ${user.isBanned ? 
                        `<button class="unban-btn" data-userid="${user._id}">Unban</button>` :
                        `<button class="ban-btn" data-userid="${user._id}">Ban</button>`
                    }
                </div>
            `;
            
            usersList.appendChild(userElement);
            
            // Add event listeners
            const banBtn = userElement.querySelector('.ban-btn');
            const unbanBtn = userElement.querySelector('.unban-btn');
            
            if (banBtn) {
                banBtn.addEventListener('click', () => {
                    this.banUser(user._id);
                });
            }
            
            if (unbanBtn) {
                unbanBtn.addEventListener('click', () => {
                    this.unbanUser(user._id);
                });
            }
        });
    }
    
    async banUser(userId) {
        try {
            const token = localStorage.getItem('adminToken');
            
            const response = await fetch(`/api/admin/ban-user/${userId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                alert('User banned successfully');
                this.loadAdminDashboard();
            } else {
                alert('Failed to ban user');
            }
        } catch (error) {
            console.error('Error banning user:', error);
            alert('Failed to ban user');
        }
    }
    
    async unbanUser(userId) {
        try {
            const token = localStorage.getItem('adminToken');
            
            const response = await fetch(`/api/admin/unban-user/${userId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                alert('User unbanned successfully');
                this.loadAdminDashboard();
            } else {
                alert('Failed to unban user');
            }
        } catch (error) {
            console.error('Error unbanning user:', error);
            alert('Failed to unban user');
        }
    }
    
    async blockUser() {
        if (!this.currentChat) return;
        
        try {
            const token = localStorage.getItem('token');
            
            const response = await fetch(`/api/block-user/${this.currentChat._id}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                alert('User blocked successfully');
                this.toggleInfoPanel();
            } else {
                alert('Failed to block user');
            }
        } catch (error) {
            console.error('Error blocking user:', error);
            alert('Failed to block user');
        }
    }
    
    async unblockUser(userId) {
        try {
            const token = localStorage.getItem('token');
            
            const response = await fetch(`/api/unblock-user/${userId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                alert('User unblocked successfully');
                this.loadBlockedUsers();
            } else {
                alert('Failed to unblock user');
            }
        } catch (error) {
            console.error('Error unblocking user:', error);
            alert('Failed to unblock user');
        }
    }
    
    clearChat() {
        if (!this.currentChat) return;
        
        if (confirm('Are you sure you want to clear this chat? This action cannot be undone.')) {
            // This would be implemented with a proper API endpoint
            // For now, we'll just clear the UI and local messages
            this.messages.set(this.currentChat._id, []);
            document.querySelector('.messages').innerHTML = '';
            alert('Chat cleared');
        }
    }
    
    toggleInfoPanel() {
        const infoPanel = document.querySelector('.info-panel');
        infoPanel.style.display = infoPanel.style.display === 'flex' ? 'none' : 'flex';
    }
    
    searchContacts(query) {
        const contacts = document.querySelectorAll('.contact');
        
        contacts.forEach(contact => {
            const name = contact.querySelector('.contact-name').textContent.toLowerCase();
            if (name.includes(query.toLowerCase())) {
                contact.style.display = 'flex';
            } else {
                contact.style.display = 'none';
            }
        });
    }
    
    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('adminToken');
        
        if (this.socket) {
            this.socket.disconnect();
        }
        
        this.showAuthScreen();
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new NovaChat();
});

// Service Worker Registration for PWA
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
