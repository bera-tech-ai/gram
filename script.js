class NovaChat {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.currentChat = null;
        this.contacts = [];
        this.messages = new Map();
        this.typingTimers = new Map();
        this.theme = 'light';
        this.emojiPicker = null;
        this.offlineMessages = [];
        this.isOnline = navigator.onLine;
        
        this.init();
    }
    
    init() {
        this.checkAuth();
        this.setupEventListeners();
        this.setupServiceWorker();
        this.detectThemePreference();
        this.setupOnlineOfflineListeners();
    }
    
    checkAuth() {
        const token = localStorage.getItem('token');
        if (token) {
            this.validateToken(token);
        } else {
            this.showAuthScreen();
        }
    }
    
    async validateToken(token) {
        try {
            const response = await fetch('/api/profile', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const user = await response.json();
                this.currentUser = user;
                this.setupSocketConnection(token);
                this.loadUserData();
                this.showChatScreen();
            } else {
                localStorage.removeItem('token');
                this.showAuthScreen();
            }
        } catch (error) {
            console.error('Token validation error:', error);
            localStorage.removeItem('token');
            this.showAuthScreen();
        }
    }
    
    setupSocketConnection(token) {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            this.socket.emit('authenticate', token);
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });
        
        this.socket.on('newMessage', (message) => {
            this.handleNewMessage(message);
        });
        
        this.socket.on('messageSent', (data) => {
            this.handleMessageSent(data);
        });
        
        this.socket.on('messageRead', (data) => {
            this.handleMessageRead(data);
        });
        
        this.socket.on('messageEdited', (data) => {
            this.handleMessageEdited(data);
        });
        
        this.socket.on('messageDeleted', (data) => {
            this.handleMessageDeleted(data);
        });
        
        this.socket.on('typing', (data) => {
            this.handleTypingIndicator(data);
        });
        
        this.socket.on('userStatus', (data) => {
            this.handleUserStatus(data);
        });
        
        this.socket.on('error', (error) => {
            this.showMessage(error, 'error');
        });
    }
    
    setupEventListeners() {
        // Auth forms
        document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('register-form').addEventListener('submit', (e) => this.handleRegister(e));
        
        // Auth tabs
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                this.switchAuthTab(tab);
            });
        });
        
        // Chat actions
        document.getElementById('menu-btn').addEventListener('click', () => this.toggleSettings());
        document.getElementById('close-settings').addEventListener('click', () => this.toggleSettings());
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());
        
        // Message input
        document.getElementById('message-input').addEventListener('input', (e) => this.handleMessageInput(e));
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        document.getElementById('send-btn').addEventListener('click', () => this.sendMessage());
        
        // Emoji and attachment
        document.getElementById('emoji-btn').addEventListener('click', () => this.toggleEmojiPicker());
        document.getElementById('attach-btn').addEventListener('click', () => this.toggleAttachmentMenu());
        
        // Settings
        document.getElementById('save-profile').addEventListener('click', () => this.saveProfile());
        document.getElementById('theme-select').addEventListener('change', (e) => this.changeTheme(e.target.value));
        document.getElementById('save-ai-settings').addEventListener('click', () => this.saveAISettings());
        
        // Admin
        document.getElementById('admin-login-btn').addEventListener('click', () => this.showAdminLogin());
        document.getElementById('admin-login-submit').addEventListener('click', () => this.handleAdminLogin());
        document.querySelector('.close-modal').addEventListener('click', () => this.hideAdminLogin());
        document.getElementById('back-to-chat').addEventListener('click', () => this.showChatScreen());
        
        // Admin tabs
        document.querySelectorAll('.admin-nav-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const tab = e.target.dataset.tab;
                this.switchAdminTab(tab);
            });
        });
        
        // Contact search
        document.getElementById('search-contacts').addEventListener('input', (e) => this.filterContacts(e.target.value));
        
        // Contact clicks
        document.addEventListener('click', (e) => {
            if (e.target.closest('.contact')) {
                const contact = e.target.closest('.contact');
                const userId = contact.dataset.id;
                this.selectChat(userId);
            }
            
            // Close emoji picker and attachment menu when clicking outside
            if (!e.target.closest('#emoji-picker') && !e.target.closest('#emoji-btn')) {
                this.hideEmojiPicker();
            }
            
            if (!e.target.closest('#attachment-menu') && !e.target.closest('#attach-btn')) {
                this.hideAttachmentMenu();
            }
            
            // Close context menu
            if (!e.target.closest('#message-context-menu') && !e.target.closest('.message-bubble')) {
                this.hideContextMenu();
            }
        });
        
        // Message context menu
        document.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.message-bubble')) {
                e.preventDefault();
                const messageElement = e.target.closest('.message');
                const messageId = messageElement.dataset.messageId;
                this.showContextMenu(e, messageId);
            }
        });
        
        // Handle file upload
        document.getElementById('avatar-upload').addEventListener('change', (e) => this.handleAvatarUpload(e));
    }
    
    setupServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js')
                    .then((registration) => {
                        console.log('SW registered: ', registration);
                    })
                    .catch((registrationError) => {
                        console.log('SW registration failed: ', registrationError);
                    });
            });
        }
    }
    
    detectThemePreference() {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const savedTheme = localStorage.getItem('theme');
        
        if (savedTheme) {
            this.theme = savedTheme;
        } else {
            this.theme = prefersDark ? 'dark' : 'light';
        }
        
        this.applyTheme();
    }
    
    setupOnlineOfflineListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.showMessage('You are back online', 'success');
            this.sendOfflineMessages();
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.showMessage('You are offline. Messages will be sent when you reconnect.', 'warning');
        });
    }
    
    async handleLogin(e) {
        e.preventDefault();
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
                this.setupSocketConnection(data.token);
                this.loadUserData();
                this.showChatScreen();
            } else {
                this.showMessage(data.error, 'error');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showMessage('Login failed. Please try again.', 'error');
        }
    }
    
    async handleRegister(e) {
  e.preventDefault();
  const displayName = document.getElementById('register-name').value;
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const confirmPassword = document.getElementById('register-confirm').value;
  
  if (password !== confirmPassword) {
    this.showMessage('Passwords do not match', 'error');
    return;
  }
  
  if (password.length < 6) {
    this.showMessage('Password must be at least 6 characters', 'error');
    return;
  }
  
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
      this.showMessage('Registration successful. Please login.', 'success');
      this.switchAuthTab('login');
      // Clear form
      document.getElementById('register-form').reset();
    } else {
      this.showMessage(data.error || 'Registration failed', 'error');
    }
  } catch (error) {
    console.error('Registration error:', error);
    this.showMessage('Registration failed. Please try again.', 'error');
  }
}    
    switchAuthTab(tab) {
        document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
        document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
        
        document.getElementById(`${tab}-form`).classList.add('active');
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    }
    
    showAuthScreen() {
        document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
        document.getElementById('auth-screen').classList.add('active');
    }
    
    showChatScreen() {
        document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
        document.getElementById('chat-screen').classList.add('active');
        
        this.updateUserProfile();
        this.loadContacts();
    }
    
    showAdminDashboard() {
        document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
        document.getElementById('admin-dashboard').classList.add('active');
        
        this.loadAdminData();
    }
    
    async loadUserData() {
        await this.loadContacts();
        this.loadUserSettings();
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
            console.error('Error loading contacts:', error);
        }
    }
    
    renderContacts() {
        const contactsList = document.querySelector('.contacts-list');
        // Clear existing contacts except AI
        const aiContact = contactsList.querySelector('.ai-contact');
        contactsList.innerHTML = '';
        contactsList.appendChild(aiContact);
        
        this.contacts.forEach(contact => {
            const contactElement = document.createElement('div');
            contactElement.className = 'contact';
            contactElement.dataset.id = contact.id;
            
            const avatar = contact.profilePicture 
                ? `<img src="${contact.profilePicture}" alt="${contact.displayName}">`
                : `<div>${contact.displayName.charAt(0).toUpperCase()}</div>`;
            
            const status = contact.isOnline 
                ? '<span class="online-dot"></span>Online'
                : `Last seen ${this.formatTime(contact.lastSeen)}`;
            
            contactElement.innerHTML = `
                <div class="contact-avatar">${avatar}</div>
                <div class="contact-info">
                    <div class="contact-name">${contact.displayName}</div>
                    <div class="contact-status">${status}</div>
                </div>
                <div class="contact-time"></div>
            `;
            
            contactsList.appendChild(contactElement);
        });
    }
    
    async selectChat(userId) {
        this.currentChat = userId;
        
        // Update UI
        document.querySelectorAll('.contact').forEach(contact => contact.classList.remove('active'));
        document.querySelector(`.contact[data-id="${userId}"]`).classList.add('active');
        
        // Update chat header
        const chatHeader = document.querySelector('.chat-header');
        const contact = userId === 'ai' 
            ? { displayName: 'Bera AI', isOnline: true } 
            : this.contacts.find(c => c.id === userId);
        
        if (contact) {
            chatHeader.querySelector('.partner-name').textContent = contact.displayName;
            chatHeader.querySelector('.partner-status').innerHTML = contact.isOnline 
                ? '<span class="online-dot"></span>Online'
                : `Last seen ${this.formatTime(contact.lastSeen)}`;
            
            // Enable call buttons for real users, disable for AI
            const callBtn = document.getElementById('call-btn');
            const videoCallBtn = document.getElementById('video-call-btn');
            if (userId === 'ai') {
                callBtn.disabled = true;
                videoCallBtn.disabled = true;
            } else {
                callBtn.disabled = false;
                videoCallBtn.disabled = false;
            }
        }
        
        // Enable message input
        document.getElementById('message-input').disabled = false;
        document.getElementById('send-btn').disabled = false;
        
        // Load messages
        await this.loadMessages(userId);
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
                
                // Mark messages as read
                messages.forEach(message => {
                    if (message.senderId !== this.currentUser.id && !message.readBy.includes(this.currentUser.id)) {
                        this.socket.emit('messageRead', message._id);
                    }
                });
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }
    
    renderMessages(messages) {
        const messagesContainer = document.querySelector('.messages-container');
        messagesContainer.innerHTML = '';
        
        if (messages.length === 0) {
            messagesContainer.innerHTML = `
                <div class="no-chat-selected">
                    <p>No messages yet. Start a conversation!</p>
                </div>
            `;
            return;
        }
        
        messages.forEach(message => {
            this.renderMessage(message);
        });
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    renderMessage(message) {
        const messagesContainer = document.querySelector('.messages-container');
        const messageElement = document.createElement('div');
        
        messageElement.className = `message ${message.senderId === this.currentUser.id ? 'sent' : message.senderId === 'ai' ? 'ai' : 'received'}`;
        messageElement.dataset.messageId = message._id;
        
        let messageContent = '';
        
        switch (message.messageType) {
            case 'image':
                messageContent = `<div class="media-message"><img src="${message.mediaUrl}" alt="Image"></div>`;
                break;
            case 'video':
                messageContent = `<div class="media-message"><video controls><source src="${message.mediaUrl}"></video></div>`;
                break;
            case 'audio':
                messageContent = `
                    <div class="audio-message">
                        <audio controls></audio>
                        <span>Audio message</span>
                    </div>
                `;
                break;
            case 'document':
                messageContent = `
                    <div class="document-message">
                        <div class="document-icon">📄</div>
                        <div class="document-info">
                            <div class="document-name">${message.fileName}</div>
                            <div class="document-size">${this.formatFileSize(message.fileSize)}</div>
                        </div>
                    </div>
                `;
                break;
            default:
                messageContent = `<div class="message-content">${this.escapeHtml(message.content)}</div>`;
        }
        
        const statusIcon = message.senderId === this.currentUser.id
            ? this.getMessageStatusIcon(message)
            : '';
        
        const editedBadge = message.edited ? '<span class="message-edited">(edited)</span>' : '';
        
        messageElement.innerHTML = `
            <div class="message-bubble">
                ${messageContent}
                <div class="message-meta">
                    <span class="message-time">${this.formatTime(message.timestamp)}</span>
                    ${statusIcon}
                    ${editedBadge}
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(messageElement);
        
        // Add audio element for audio messages
        if (message.messageType === 'audio') {
            const audioElement = messageElement.querySelector('audio');
            const sourceElement = document.createElement('source');
            sourceElement.src = message.mediaUrl;
            audioElement.appendChild(sourceElement);
        }
    }
    
    getMessageStatusIcon(message) {
        if (message.readBy && message.readBy.includes(message.receiverId)) {
            return '✓✓✓';
        } else if (message.receiverId === 'ai' || message.readBy && message.readBy.length > 0) {
            return '✓✓';
        } else {
            return '✓';
        }
    }
    
    handleMessageInput(e) {
        if (this.currentChat) {
            this.socket.emit('typing', {
                receiverId: this.currentChat,
                isTyping: true
            });
            
            // Clear previous timer
            if (this.typingTimers.has(this.currentChat)) {
                clearTimeout(this.typingTimers.get(this.currentChat));
            }
            
            // Set new timer to stop typing indicator
            const timer = setTimeout(() => {
                this.socket.emit('typing', {
                    receiverId: this.currentChat,
                    isTyping: false
                });
            }, 1000);
            
            this.typingTimers.set(this.currentChat, timer);
        }
    }
    
    sendMessage() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();
        
        if (!content || !this.currentChat) return;
        
        // Generate temporary ID for optimistic UI
        const tempId = `temp-${Date.now()}`;
        
        // Create optimistic message
        const tempMessage = {
            _id: tempId,
            senderId: this.currentUser.id,
            receiverId: this.currentChat,
            content,
            messageType: 'text',
            timestamp: new Date(),
            readBy: this.currentChat === 'ai' ? [this.currentUser.id] : []
        };
        
        // Add to UI immediately
        this.renderMessage(tempMessage);
        
        // Scroll to bottom
        document.querySelector('.messages-container').scrollTop = document.querySelector('.messages-container').scrollHeight;
        
        // Clear input
        input.value = '';
        
        // Send via socket
        if (this.isOnline) {
            this.socket.emit('sendMessage', {
                receiverId: this.currentChat,
                content,
                tempId
            });
        } else {
            // Store for sending when online
            this.offlineMessages.push({
                receiverId: this.currentChat,
                content,
                tempId
            });
            this.showMessage('Message will be sent when you are back online', 'warning');
        }
    }
    
    handleNewMessage(message) {
        // Check if this message is for the current chat
        if (this.currentChat && 
            (message.senderId === this.currentChat || 
             (message.senderId === this.currentUser.id && message.receiverId === this.currentChat))) {
            
            // Check if we already have this message (optimistic update)
            const messages = this.messages.get(this.currentChat) || [];
            const existingIndex = messages.findIndex(m => m._id === message._id);
            
            if (existingIndex === -1) {
                messages.push(message);
                this.messages.set(this.currentChat, messages);
                this.renderMessage(message);
                
                // Scroll to bottom
                document.querySelector('.messages-container').scrollTop = document.querySelector('.messages-container').scrollHeight;
                
                // Mark as read if it's not our own message
                if (message.senderId !== this.currentUser.id) {
                    this.socket.emit('messageRead', message._id);
                }
            }
        }
        
        // Show notification if chat is not active
        if (!this.currentChat || (message.senderId !== this.currentChat && message.senderId !== this.currentUser.id)) {
            this.showNotification(message);
        }
    }
    
    handleMessageSent(data) {
        // Replace temporary message with real one
        const tempMessage = document.querySelector(`[data-message-id="${data.tempId}"]`);
        if (tempMessage) {
            tempMessage.remove();
            this.renderMessage(data.message);
            
            // Update messages map
            const messages = this.messages.get(this.currentChat) || [];
            const tempIndex = messages.findIndex(m => m._id === data.tempId);
            if (tempIndex !== -1) {
                messages[tempIndex] = data.message;
            } else {
                messages.push(data.message);
            }
            this.messages.set(this.currentChat, messages);
        }
    }
    
    handleMessageRead(data) {
        // Update message status in UI
        const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (messageElement) {
            const statusElement = messageElement.querySelector('.message-status');
            if (statusElement) {
                statusElement.textContent = '✓✓✓';
            }
        }
        
        // Update messages map
        const messages = this.messages.get(this.currentChat) || [];
        const messageIndex = messages.findIndex(m => m._id === data.messageId);
        if (messageIndex !== -1) {
            if (!messages[messageIndex].readBy.includes(data.readBy)) {
                messages[messageIndex].readBy.push(data.readBy);
            }
        }
    }
    
    handleMessageEdited(data) {
        // Update message in UI
        const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (messageElement) {
            const contentElement = messageElement.querySelector('.message-content');
            if (contentElement) {
                contentElement.textContent = data.newContent;
            }
            
            // Add edited badge if not already there
            if (!messageElement.querySelector('.message-edited')) {
                const metaElement = messageElement.querySelector('.message-meta');
                const editedBadge = document.createElement('span');
                editedBadge.className = 'message-edited';
                editedBadge.textContent = '(edited)';
                metaElement.appendChild(editedBadge);
            }
        }
        
        // Update messages map
        const messages = this.messages.get(this.currentChat) || [];
        const messageIndex = messages.findIndex(m => m._id === data.messageId);
        if (messageIndex !== -1) {
            messages[messageIndex].content = data.newContent;
            messages[messageIndex].edited = true;
        }
    }
    
    handleMessageDeleted(data) {
        // Remove message from UI
        const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (messageElement) {
            messageElement.remove();
        }
        
        // Update messages map
        if (data.forEveryone) {
            const messages = this.messages.get(this.currentChat) || [];
            const messageIndex = messages.findIndex(m => m._id === data.messageId);
            if (messageIndex !== -1) {
                messages.splice(messageIndex, 1);
            }
        }
    }
    
    handleTypingIndicator(data) {
        const typingIndicator = document.getElementById('typing-indicator');
        
        if (data.isTyping) {
            const contact = this.contacts.find(c => c.id === data.userId);
            if (contact) {
                typingIndicator.textContent = `${contact.displayName} is typing...`;
                typingIndicator.classList.remove('hidden');
            }
        } else {
            typingIndicator.classList.add('hidden');
        }
    }
    
    handleUserStatus(data) {
        // Update contact in list
        const contactElement = document.querySelector(`.contact[data-id="${data.userId}"]`);
        if (contactElement) {
            const statusElement = contactElement.querySelector('.contact-status');
            if (statusElement) {
                statusElement.innerHTML = data.isOnline 
                    ? '<span class="online-dot"></span>Online'
                    : `Last seen ${this.formatTime(data.lastSeen)}`;
            }
        }
        
        // Update current chat header if needed
        if (this.currentChat === data.userId) {
            const statusElement = document.querySelector('.partner-status');
            if (statusElement) {
                statusElement.innerHTML = data.isOnline 
                    ? '<span class="online-dot"></span>Online'
                    : `Last seen ${this.formatTime(data.lastSeen)}`;
            }
        }
        
        // Update contacts array
        const contactIndex = this.contacts.findIndex(c => c.id === data.userId);
        if (contactIndex !== -1) {
            this.contacts[contactIndex].isOnline = data.isOnline;
            this.contacts[contactIndex].lastSeen = data.lastSeen;
        }
    }
    
    showNotification(message) {
        if ('Notification' in window && Notification.permission === 'granted') {
            const sender = message.senderId === 'ai' 
                ? 'Bera AI' 
                : this.contacts.find(c => c.id === message.senderId)?.displayName || 'Unknown';
            
            const notification = new Notification(`New message from ${sender}`, {
                body: message.content,
                icon: '/icon-192.png'
            });
            
            notification.onclick = () => {
                window.focus();
                if (message.senderId !== this.currentChat) {
                    this.selectChat(message.senderId);
                }
            };
        }
    }
    
    sendOfflineMessages() {
        while (this.offlineMessages.length > 0) {
            const message = this.offlineMessages.shift();
            this.socket.emit('sendMessage', message);
        }
    }
    
    toggleSettings() {
        document.querySelector('.settings-panel').classList.toggle('active');
    }
    
    updateUserProfile() {
        if (this.currentUser) {
            document.getElementById('user-name').textContent = this.currentUser.displayName;
            
            const avatarElement = document.getElementById('user-avatar');
            if (this.currentUser.profilePicture) {
                avatarElement.src = this.currentUser.profilePicture;
                avatarElement.style.display = 'block';
            } else {
                avatarElement.style.display = 'none';
                avatarElement.parentElement.querySelector('div').textContent = this.currentUser.displayName.charAt(0).toUpperCase();
            }
            
            // Update settings form
            document.getElementById('profile-name').value = this.currentUser.displayName;
            document.getElementById('profile-status').value = this.currentUser.status || '';
            
            const settingsAvatar = document.getElementById('settings-avatar');
            if (this.currentUser.profilePicture) {
                settingsAvatar.src = this.currentUser.profilePicture;
            } else {
                settingsAvatar.src = '';
                settingsAvatar.style.display = 'none';
            }
        }
    }
    
    async saveProfile() {
        const displayName = document.getElementById('profile-name').value;
        const status = document.getElementById('profile-status').value;
        
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ displayName, status })
            });
            
            if (response.ok) {
                this.currentUser.displayName = displayName;
                this.currentUser.status = status;
                this.updateUserProfile();
                this.showMessage('Profile updated successfully', 'success');
            } else {
                this.showMessage('Failed to update profile', 'error');
            }
        } catch (error) {
            console.error('Error updating profile:', error);
            this.showMessage('Failed to update profile', 'error');
        }
    }
    
    async handleAvatarUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        // Check if file is an image
        if (!file.type.startsWith('image/')) {
            this.showMessage('Please select an image file', 'error');
            return;
        }
        
        // Check file size (max 2MB)
        if (file.size > 2 * 1024 * 1024) {
            this.showMessage('Image must be less than 2MB', 'error');
            return;
        }
        
        // Read file as data URL
        const reader = new FileReader();
        reader.onload = async (event) => {
            const profilePicture = event.target.result;
            
            try {
                const token = localStorage.getItem('token');
                const response = await fetch('/api/profile', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ profilePicture })
                });
                
                if (response.ok) {
                    this.currentUser.profilePicture = profilePicture;
                    this.updateUserProfile();
                    this.showMessage('Profile picture updated successfully', 'success');
                } else {
                    this.showMessage('Failed to update profile picture', 'error');
                }
            } catch (error) {
                console.error('Error updating profile picture:', error);
                this.showMessage('Failed to update profile picture', 'error');
            }
        };
        
        reader.readAsDataURL(file);
    }
    
    loadUserSettings() {
        const theme = localStorage.getItem('theme') || 'light';
        document.getElementById('theme-select').value = theme;
        this.changeTheme(theme);
        
        // Load AI settings
        this.loadAISettings();
    }
    
    changeTheme(theme) {
        this.theme = theme;
        localStorage.setItem('theme', theme);
        
        document.documentElement.setAttribute('data-theme', theme);
        document.getElementById('theme-select').value = theme;
    }
    
    async loadAISettings() {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/ai/conversation', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.ok) {
                const conversation = await response.json();
                document.getElementById('ai-personality').value = conversation.personality || 'friendly';
            }
        } catch (error) {
            console.error('Error loading AI settings:', error);
        }
    }
    
    async saveAISettings() {
        const personality = document.getElementById('ai-personality').value;
        
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/ai/personality', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ personality })
            });
            
            if (response.ok) {
                this.showMessage('AI settings updated successfully', 'success');
            } else {
                this.showMessage('Failed to update AI settings', 'error');
            }
        } catch (error) {
            console.error('Error updating AI settings:', error);
            this.showMessage('Failed to update AI settings', 'error');
        }
    }
    
    showAdminLogin() {
        document.getElementById('admin-modal').classList.add('active');
    }
    
    hideAdminLogin() {
        document.getElementById('admin-modal').classList.remove('active');
    }
    
    async handleAdminLogin() {
        const password = document.getElementById('admin-password').value;
        
        try {
            const response = await fetch('/api/admin/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ adminPassword: password })
            });
            
            if (response.ok) {
                this.hideAdminLogin();
                this.showAdminDashboard();
            } else {
                this.showMessage('Invalid admin password', 'error');
            }
        } catch (error) {
            console.error('Admin login error:', error);
            this.showMessage('Admin login failed', 'error');
        }
    }
    
    switchAdminTab(tab) {
        document.querySelectorAll('.admin-nav-btn').forEach(button => button.classList.remove('active'));
        document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.remove('active'));
        
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
        document.getElementById(`${tab}-tab`).classList.add('active');
    }
    
    async loadAdminData() {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/api/admin/analytics', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Admin-Password': document.getElementById('admin-password').value
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.renderAdminData(data);
            } else {
                this.showMessage('Failed to load admin data', 'error');
            }
        } catch (error) {
            console.error('Error loading admin data:', error);
            this.showMessage('Failed to load admin data', 'error');
        }
    }
    
    renderAdminData(data) {
        // Update stats
        document.getElementById('total-users').textContent = data.totalUsers;
        document.getElementById('total-messages').textContent = data.totalMessages;
        document.getElementById('active-users').textContent = data.activeUsers;
        document.getElementById('active-connections').textContent = data.activeConnections;
        
        // Render charts
        this.renderMessagesChart(data.messagesByDay);
        this.renderActivityChart(data.peakHours);
        
        // TODO: Render other admin data (users, moderation, monitoring, system health)
    }
    
    renderMessagesChart(messagesByDay) {
        const ctx = document.getElementById('messages-chart').getContext('2d');
        
        const labels = messagesByDay.map(item => item._id);
        const data = messagesByDay.map(item => item.count);
        
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Messages',
                    data: data,
                    backgroundColor: '#128C7E',
                    borderColor: '#075E54',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }
    
    renderActivityChart(peakHours) {
        const ctx = document.getElementById('activity-chart').getContext('2d');
        
        const labels = peakHours.map(item => `${item.hour}:00`);
        const data = peakHours.map(item => item.count);
        
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Messages per hour',
                    data: data,
                    backgroundColor: 'rgba(18, 140, 126, 0.2)',
                    borderColor: '#128C7E',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }
    
    toggleEmojiPicker() {
        const emojiPicker = document.getElementById('emoji-picker');
        if (emojiPicker.classList.contains('hidden')) {
            this.showEmojiPicker();
        } else {
            this.hideEmojiPicker();
        }
    }
    
    showEmojiPicker() {
        const emojiPicker = document.getElementById('emoji-picker');
        emojiPicker.classList.remove('hidden');
        
        // TODO: Load emojis into the picker
        // This is a simplified version - in a real app, you'd use a proper emoji library
        emojiPicker.innerHTML = `
            <div class="emoji-category">
                <h4>Smileys & People</h4>
                <div class="emoji-grid">
                    <span class="emoji">😀</span>
                    <span class="emoji">😃</span>
                    <span class="emoji">😄</span>
                    <span class="emoji">😁</span>
                    <span class="emoji">😆</span>
                    <span class="emoji">😅</span>
                    <span class="emoji">😂</span>
                    <span class="emoji">🤣</span>
                    <span class="emoji">😊</span>
                    <span class="emoji">😇</span>
                    <span class="emoji">🙂</span>
                    <span class="emoji">🙃</span>
                    <span class="emoji">😉</span>
                    <span class="emoji">😌</span>
                    <span class="emoji">😍</span>
                    <span class="emoji">🥰</span>
                    <span class="emoji">😘</span>
                    <span class="emoji">😗</span>
                    <span class="emoji">😙</span>
                    <span class="emoji">😚</span>
                    <span class="emoji">😋</span>
                    <span class="emoji">😛</span>
                    <span class="emoji">😝</span>
                    <span class="emoji">😜</span>
                    <span class="emoji">🤪</span>
                    <span class="emoji">🤨</span>
                    <span class="emoji">🧐</span>
                    <span class="emoji">🤓</span>
                    <span class="emoji">😎</span>
                    <span class="emoji">🤩</span>
                    <span class="emoji">🥳</span>
                </div>
            </div>
        `;
        
        // Add emoji click handlers
        emojiPicker.querySelectorAll('.emoji').forEach(emoji => {
            emoji.addEventListener('click', () => {
                this.insertEmoji(emoji.textContent);
                this.hideEmojiPicker();
            });
        });
    }
    
    hideEmojiPicker() {
        document.getElementById('emoji-picker').classList.add('hidden');
    }
    
    insertEmoji(emoji) {
        const input = document.getElementById('message-input');
        input.value += emoji;
        input.focus();
    }
    
    toggleAttachmentMenu() {
        const attachmentMenu = document.getElementById('attachment-menu');
        if (attachmentMenu.classList.contains('hidden')) {
            this.showAttachmentMenu();
        } else {
            this.hideAttachmentMenu();
        }
    }
    
    showAttachmentMenu() {
        const attachmentMenu = document.getElementById('attachment-menu');
        attachmentMenu.classList.remove('hidden');
    }
    
    hideAttachmentMenu() {
        document.getElementById('attachment-menu').classList.add('hidden');
    }
    
    showContextMenu(e, messageId) {
        const contextMenu = document.getElementById('message-context-menu');
        contextMenu.classList.remove('hidden');
        
        // Position the context menu
        contextMenu.style.top = `${e.pageY}px`;
        contextMenu.style.left = `${e.pageX}px`;
        
        // Store the message ID for context menu actions
        contextMenu.dataset.messageId = messageId;
        
        // Add event listeners to context menu buttons
        contextMenu.querySelectorAll('button').forEach(button => {
            button.onclick = (event) => {
                event.stopPropagation();
                this.handleContextMenuAction(button.dataset.action, messageId);
                this.hideContextMenu();
            };
        });
    }
    
    hideContextMenu() {
        document.getElementById('message-context-menu').classList.add('hidden');
    }
    
    handleContextMenuAction(action, messageId) {
        const message = this.findMessageById(messageId);
        if (!message) return;
        
        switch (action) {
            case 'reply':
                this.replyToMessage(message);
                break;
            case 'edit':
                this.editMessage(message);
                break;
            case 'delete':
                this.deleteMessage(messageId, false);
                break;
            case 'deleteEveryone':
                this.deleteMessage(messageId, true);
                break;
            case 'forward':
                this.forwardMessage(message);
                break;
        }
    }
    
    findMessageById(messageId) {
        for (const [chatId, messages] of this.messages) {
            const message = messages.find(m => m._id === messageId);
            if (message) return message;
        }
        return null;
    }
    
    replyToMessage(message) {
        const input = document.getElementById('message-input');
        input.value = `Replying to: ${message.content}\n`;
        input.focus();
    }
    
    editMessage(message) {
        if (message.senderId !== this.currentUser.id) return;
        
        const input = document.getElementById('message-input');
        input.value = message.content;
        input.focus();
        
        // Store the message ID being edited
        input.dataset.editingMessageId = message._id;
        
        // Change send button to edit button
        const sendButton = document.getElementById('send-btn');
        sendButton.textContent = '✏️';
        sendButton.onclick = () => this.finishEditMessage(message._id, input.value);
    }
    
    finishEditMessage(messageId, newContent) {
        this.socket.emit('editMessage', {
            messageId,
            newContent
        });
        
        // Reset UI
        const input = document.getElementById('message-input');
        input.value = '';
        delete input.dataset.editingMessageId;
        
        const sendButton = document.getElementById('send-btn');
        sendButton.textContent = '➤';
        sendButton.onclick = () => this.sendMessage();
    }
    
    deleteMessage(messageId, forEveryone) {
        this.socket.emit('deleteMessage', {
            messageId,
            forEveryone
        });
    }
    
    forwardMessage(message) {
        // TODO: Implement message forwarding
        this.showMessage('Message forwarding not implemented yet', 'warning');
    }
    
    async handleLogout() {
        try {
            const token = localStorage.getItem('token');
            await fetch('/api/logout', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            localStorage.removeItem('token');
            this.currentUser = null;
            
            if (this.socket) {
                this.socket.disconnect();
                this.socket = null;
            }
            
            this.showAuthScreen();
        }
    }
    
    filterContacts(query) {
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
    
    showMessage(message, type) {
        const messageElement = document.getElementById('auth-message');
        messageElement.textContent = message;
        messageElement.className = `message ${type}`;
        
        // Auto hide after 3 seconds
        setTimeout(() => {
            messageElement.textContent = '';
            messageElement.className = 'message';
        }, 3000);
    }
    
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) { // Less than 1 minute
            return 'just now';
        } else if (diff < 3600000) { // Less than 1 hour
            const minutes = Math.floor(diff / 60000);
            return `${minutes} min ago`;
        } else if (diff < 86400000) { // Less than 1 day
            const hours = Math.floor(diff / 3600000);
            return `${hours} hr ago`;
        } else if (diff < 604800000) { // Less than 1 week
            const days = Math.floor(diff / 86400000);
            return `${days} day${days > 1 ? 's' : ''} ago`;
        } else {
            return date.toLocaleDateString();
        }
    }
    
    formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1048576).toFixed(1)} MB`;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new NovaChat();
});
