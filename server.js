require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const multer = require('multer');
const { GridFSBucket } = require('mongodb');
const { OpenAI } = require('openai');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Environment variables
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/novachat';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// MongoDB connection
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// MongoDB Models
const messageSchema = new mongoose.Schema({
  senderId: String,
  receiverId: String,
  content: String,
  messageType: { type: String, default: 'text' }, // text, image, video, audio, document
  mediaUrl: String,
  fileName: String,
  fileSize: Number,
  timestamp: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  deletedFor: [{ type: String }], // user IDs for whom the message is deleted
  readBy: [{ type: String }] // user IDs who have read the message
});

const aiConversationSchema = new mongoose.Schema({
  userId: String,
  messages: [{
    role: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
  }],
  personality: { type: String, default: 'friendly' }
});

const Message = mongoose.model('Message', messageSchema);
const AIConversation = mongoose.model('AIConversation', aiConversationSchema);

// GridFS for file storage
let gfs;
const conn = mongoose.connection;
conn.once('open', () => {
  gfs = new GridFSBucket(conn.db, {
    bucketName: 'uploads'
  });
});

// User management (using users.json)
const usersFile = path.join(__dirname, 'users.json');

async function readUsers() {
  try {
    const data = await fs.readFile(usersFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, create it with empty array
    if (error.code === 'ENOENT') {
      await fs.writeFile(usersFile, JSON.stringify([]));
      return [];
    }
    console.error('Error reading users:', error);
    return [];
  }
}

async function writeUsers(users) {
  try {
    await fs.writeFile(usersFile, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error('Error writing users:', error);
    throw error;
  }
}

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const users = await readUsers();
    const user = users.find(u => u.id === decoded.userId);
    
    if (!user) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Admin authentication middleware
const authenticateAdmin = async (req, res, next) => {
  const { adminPassword } = req.body;
  
  if (adminPassword === ADMIN_PASSWORD) {
    next();
  } else {
    res.status(403).json({ error: 'Invalid admin password' });
  }
};

// Routes

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'Email, password and display name are required' });
    }
    
    const users = await readUsers();
    
    // Check if user already exists
    if (users.some(user => user.email === email)) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const newUser = {
      id: Date.now().toString(),
      email,
      password: hashedPassword,
      displayName,
      profilePicture: null,
      status: 'Hey there! I am using NovaChat',
      lastSeen: new Date(),
      isOnline: false,
      settings: {
        theme: 'light',
        readReceipts: true,
        lastSeenPrivacy: 'everyone'
      },
      blockedUsers: [],
      createdAt: new Date()
    };
    
    users.push(newUser);
    await writeUsers(users);
    
    // Create AI conversation for the user
    try {
      const aiConversation = new AIConversation({
        userId: newUser.id,
        personality: 'friendly'
      });
      await aiConversation.save();
    } catch (aiError) {
      console.error('Error creating AI conversation:', aiError);
      // Continue even if AI conversation fails
    }
    
    // Generate token
    const token = jwt.sign({ userId: newUser.id }, JWT_SECRET);
    
    // Return user data without password
    const { password: _, ...userWithoutPassword } = newUser;
    
    res.status(201).json({
      message: 'User created successfully',
      token,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const users = await readUsers();
    const user = users.find(u => u.email === email);
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Logout
app.post('/api/logout', authenticateToken, async (req, res) => {
  try {
    const users = await readUsers();
    const userIndex = users.findIndex(u => u.id === req.user.id);
    
    if (userIndex !== -1) {
      users[userIndex].isOnline = false;
      users[userIndex].lastSeen = new Date();
      await writeUsers(users);
    }
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
    // Update user status
    user.isOnline = true;
    user.lastSeen = new Date();
    await writeUsers(users);
    
    // Generate token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        status: user.status
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const users = await readUsers();
    const user = users.find(u => u.id === req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      profilePicture: user.profilePicture,
      status: user.status,
      settings: user.settings
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { displayName, status, profilePicture } = req.body;
    const users = await readUsers();
    const userIndex = users.findIndex(u => u.id === req.user.id);
    
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (displayName) users[userIndex].displayName = displayName;
    if (status) users[userIndex].status = status;
    if (profilePicture) users[userIndex].profilePicture = profilePicture;
    
    await writeUsers(users);
    
    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get users list (excluding current user)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await readUsers();
    const filteredUsers = users
      .filter(user => user.id !== req.user.id)
      .map(user => ({
        id: user.id,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        status: user.status,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen
      }));
    
    res.json(filteredUsers);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get messages between two users
app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, before } = req.query;
    
    let query = {
      $or: [
        { senderId: req.user.id, receiverId: userId },
        { senderId: userId, receiverId: req.user.id }
      ],
      deletedFor: { $ne: req.user.id }
    };
    
    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }
    
    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .exec();
    
    res.json(messages.reverse());
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get AI conversation
app.get('/api/ai/conversation', authenticateToken, async (req, res) => {
  try {
    const conversation = await AIConversation.findOne({ userId: req.user.id });
    
    if (!conversation) {
      // Create new conversation if not exists
      const newConversation = new AIConversation({
        userId: req.user.id,
        personality: 'friendly'
      });
      await newConversation.save();
      return res.json(newConversation);
    }
    
    res.json(conversation);
  } catch (error) {
    console.error('Get AI conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send message to AI
app.post('/api/ai/message', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Message content is required' });
    }
    
    // Get or create AI conversation
    let conversation = await AIConversation.findOne({ userId: req.user.id });
    if (!conversation) {
      conversation = new AIConversation({
        userId: req.user.id,
        personality: 'friendly'
      });
    }
    
    // Add user message to conversation
    conversation.messages.push({
      role: 'user',
      content
    });
    
    // Get AI response
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: `You are Bera AI, a helpful assistant. Your personality is ${conversation.personality || 'friendly'}. 
          Respond to the user in a helpful manner. Keep responses concise.`
        },
        ...conversation.messages.map(msg => ({ role: msg.role, content: msg.content }))
      ],
      max_tokens: 500
    });
    
    const aiResponse = completion.choices[0].message.content;
    
    // Add AI response to conversation
    conversation.messages.push({
      role: 'assistant',
      content: aiResponse
    });
    
    // Save conversation
    await conversation.save();
    
    res.json({ message: aiResponse });
  } catch (error) {
    console.error('AI message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update AI personality
app.put('/api/ai/personality', authenticateToken, async (req, res) => {
  try {
    const { personality } = req.body;
    
    const conversation = await AIConversation.findOne({ userId: req.user.id });
    if (!conversation) {
      return res.status(404).json({ error: 'AI conversation not found' });
    }
    
    conversation.personality = personality;
    await conversation.save();
    
    res.json({ message: 'AI personality updated successfully' });
  } catch (error) {
    console.error('Update AI personality error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin routes
app.post('/api/admin/login', authenticateAdmin, async (req, res) => {
  try {
    const users = await readUsers();
    const messagesCount = await Message.countDocuments();
    
    // Get active connections
    const activeSockets = Array.from(io.sockets.sockets.values()).map(socket => ({
      id: socket.id,
      userId: socket.userId,
      connectedAt: socket.connectedAt
    }));
    
    res.json({
      users: users.length,
      messages: messagesCount,
      activeConnections: activeSockets.length,
      activeSockets
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get admin analytics
app.get('/api/admin/analytics', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin (in a real app, you'd have proper admin roles)
    // For simplicity, we'll just check if ADMIN_PASSWORD is provided in header
    if (req.headers['admin-password'] !== ADMIN_PASSWORD) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const users = await readUsers();
    const messagesCount = await Message.countDocuments();
    
    // Get messages by day for the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const messagesByDay = await Message.aggregate([
      {
        $match: {
          timestamp: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$timestamp" }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);
    
    // Get active users (online in last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const activeUsers = users.filter(user => 
      user.lastSeen && new Date(user.lastSeen) > fiveMinutesAgo
    ).length;
    
    res.json({
      totalUsers: users.length,
      totalMessages: messagesCount,
      activeUsers,
      messagesByDay,
      peakHours: await getPeakActivityHours()
    });
  } catch (error) {
    console.error('Admin analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to get peak activity hours
async function getPeakActivityHours() {
  try {
    const result = await Message.aggregate([
      {
        $group: {
          _id: { $hour: "$timestamp" },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 5
      }
    ]);
    
    return result.map(item => ({
      hour: item._id,
      count: item.count
    }));
  } catch (error) {
    console.error('Error getting peak hours:', error);
    return [];
  }
}

// Socket.IO for real-time messaging
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  socket.connectedAt = new Date();
  
  // Authenticate socket
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const users = await readUsers();
      const user = users.find(u => u.id === decoded.userId);
      
      if (user) {
        socket.userId = user.id;
        socket.join(user.id);
        
        // Update user status
        user.isOnline = true;
        user.lastSeen = new Date();
        await writeUsers(users);
        
        // Notify others that user is online
        socket.broadcast.emit('userStatus', {
          userId: user.id,
          isOnline: true,
          lastSeen: user.lastSeen
        });
        
        console.log('User authenticated:', user.displayName);
      }
    } catch (error) {
      console.error('Socket authentication error:', error);
      socket.disconnect();
    }
  });
  
  // Send message
  socket.on('sendMessage', async (data) => {
    try {
      if (!socket.userId) {
        return socket.emit('error', 'Authentication required');
      }
      
      const { receiverId, content, messageType, mediaUrl, fileName, fileSize } = data;
      
      // Create message
      const message = new Message({
        senderId: socket.userId,
        receiverId,
        content,
        messageType: messageType || 'text',
        mediaUrl,
        fileName,
        fileSize,
        readBy: receiverId === 'ai' ? [socket.userId] : [] // AI messages are automatically read
      });
      
      await message.save();
      
      // If sending to AI, handle AI response
      if (receiverId === 'ai') {
        // Get or create AI conversation
        let conversation = await AIConversation.findOne({ userId: socket.userId });
        if (!conversation) {
          conversation = new AIConversation({
            userId: socket.userId,
            personality: 'friendly'
          });
        }
        
        // Add user message to conversation
        conversation.messages.push({
          role: 'user',
          content
        });
        
        // Get AI response
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            { 
              role: "system", 
              content: `You are Bera AI, a helpful assistant. Your personality is ${conversation.personality || 'friendly'}. 
              Respond to the user in a helpful manner. Keep responses concise.`
            },
            ...conversation.messages.map(msg => ({ role: msg.role, content: msg.content }))
          ],
          max_tokens: 500
        });
        
        const aiResponse = completion.choices[0].message.content;
        
        // Add AI response to conversation
        conversation.messages.push({
          role: 'assistant',
          content: aiResponse
        });
        
        // Save conversation
        await conversation.save();
        
        // Create AI response message
        const aiMessage = new Message({
          senderId: 'ai',
          receiverId: socket.userId,
          content: aiResponse,
          messageType: 'text',
          readBy: [socket.userId]
        });
        
        await aiMessage.save();
        
        // Send AI response to user
        socket.emit('newMessage', aiMessage);
      } else {
        // Send to recipient if they're online
        socket.to(receiverId).emit('newMessage', message);
      }
      
      // Send confirmation to sender
      socket.emit('messageSent', { tempId: data.tempId, message });
    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', 'Failed to send message');
    }
  });
  
  // Message read receipt
  socket.on('messageRead', async (messageId) => {
    try {
      if (!socket.userId) return;
      
      const message = await Message.findById(messageId);
      if (message && message.receiverId === socket.userId && !message.readBy.includes(socket.userId)) {
        message.readBy.push(socket.userId);
        await message.save();
        
        // Notify sender that message was read
        socket.to(message.senderId).emit('messageRead', {
          messageId: message._id,
          readBy: socket.userId,
          readAt: new Date()
        });
      }
    } catch (error) {
      console.error('Message read error:', error);
    }
  });
  
  // Typing indicator
  socket.on('typing', (data) => {
    if (!socket.userId) return;
    
    const { receiverId, isTyping } = data;
    socket.to(receiverId).emit('typing', {
      userId: socket.userId,
      isTyping
    });
  });
  
  // Edit message
  socket.on('editMessage', async (data) => {
    try {
      if (!socket.userId) return;
      
      const { messageId, newContent } = data;
      const message = await Message.findById(messageId);
      
      if (message && message.senderId === socket.userId) {
        message.content = newContent;
        message.edited = true;
        await message.save();
        
        // Notify recipient
        socket.to(message.receiverId).emit('messageEdited', {
          messageId: message._id,
          newContent,
          editedAt: new Date()
        });
        
        // Confirm to sender
        socket.emit('messageEdited', {
          messageId: message._id,
          newContent,
          editedAt: new Date()
        });
      }
    } catch (error) {
      console.error('Edit message error:', error);
      socket.emit('error', 'Failed to edit message');
    }
  });
  
  // Delete message
  socket.on('deleteMessage', async (data) => {
    try {
      if (!socket.userId) return;
      
      const { messageId, forEveryone } = data;
      const message = await Message.findById(messageId);
      
      if (!message) return;
      
      if (forEveryone && message.senderId === socket.userId) {
        // Delete for everyone
        message.deletedFor.push(message.senderId, message.receiverId);
        await message.save();
        
        // Notify recipient
        socket.to(message.receiverId).emit('messageDeleted', {
          messageId: message._id,
          forEveryone: true
        });
        
        // Confirm to sender
        socket.emit('messageDeleted', {
          messageId: message._id,
          forEveryone: true
        });
      } else {
        // Delete for me only
        if (!message.deletedFor.includes(socket.userId)) {
          message.deletedFor.push(socket.userId);
          await message.save();
          
          // Confirm to sender
          socket.emit('messageDeleted', {
            messageId: message._id,
            forEveryone: false
          });
        }
      }
    } catch (error) {
      console.error('Delete message error:', error);
      socket.emit('error', 'Failed to delete message');
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    
    if (socket.userId) {
      try {
        const users = await readUsers();
        const userIndex = users.findIndex(u => u.id === socket.userId);
        
        if (userIndex !== -1) {
          users[userIndex].isOnline = false;
          users[userIndex].lastSeen = new Date();
          await writeUsers(users);
          
          // Notify others that user is offline
          socket.broadcast.emit('userStatus', {
            userId: socket.userId,
            isOnline: false,
            lastSeen: users[userIndex].lastSeen
          });
        }
      } catch (error) {
        console.error('Disconnect error:', error);
      }
    }
  });
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
