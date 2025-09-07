const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OpenAI } = require('openai');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// MongoDB connection with better error handling and retry logic
// Default changed to 127.0.0.1 instead of "mongo"
const MONGODB_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/novachat';

console.log('Connecting to MongoDB at:', MONGODB_URI);

const connectWithRetry = () => {
  mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  .then(() => {
    console.log('✅ Successfully connected to MongoDB');
  })
  .catch(err => {
    console.error('❌ Failed to connect to MongoDB:', err.message);
    console.log('Retrying connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  });
};

// Initial connection attempt
connectWithRetry();

// MongoDB connection events
mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to MongoDB');
});
mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});
mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected from MongoDB');
});
process.on('SIGINT', () => {
  mongoose.connection.close(() => {
    console.log('Mongoose connection disconnected through app termination');
    process.exit(0);
  });
});
// MongoDB Models
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  profilePicture: { type: String, default: '' },
  status: { type: String, default: 'Hey there! I am using NovaChat' },
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  privacy: {
    lastSeen: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    readReceipts: { type: Boolean, default: true }
  },
  theme: { type: String, enum: ['light', 'dark'], default: 'light' },
  beraAISettings: {
    name: { type: String, default: 'Bera AI' },
    personality: { type: String, default: 'friendly' }
  },
  contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: { type: String, required: true },
  isAI: { type: Boolean, default: false },
  isEdited: { type: Boolean, default: false },
  editedAt: { type: Date },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isDeletedForEveryone: { type: Boolean, default: false }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// OpenAI setup
let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
} else {
  console.warn('OPENAI_API_KEY not set. Bera AI functionality will be limited.');
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.sendStatus(403);
    }
    req.user = user;
    next();
  });
};

// Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, name } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = new User({
      username,
      password: hashedPassword,
      name
    });
    
    await user.save();
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id }, 
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    res.status(201).json({ token, user: { id: user._id, username: user.username, name: user.name } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Find user
    const user = await User.findOne({ username });
    if (!user || user.isBanned) {
      return res.status(401).json({ error: 'Invalid credentials or account banned' });
    }
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last seen and online status
    user.lastSeen = new Date();
    user.isOnline = true;
    await user.save();
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id }, 
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({ token, user: { id: user._id, username: user.username, name: user.name } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.userId }, isBanned: false })
      .select('username name profilePicture status isOnline lastSeen');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;
    
    const messages = await Message.find({
      $or: [
        { sender: currentUserId, recipient: userId },
        { sender: userId, recipient: currentUserId }
      ],
      isDeletedForEveryone: false,
      deletedFor: { $ne: currentUserId }
    })
    .populate('sender', 'name username profilePicture')
    .populate('recipient', 'name username profilePicture')
    .sort({ createdAt: 1 });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const currentUserId = req.user.userId;
    
    const message = await Message.findOne({
      _id: messageId,
      sender: currentUserId
    });
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found or unauthorized' });
    }
    
    message.content = content;
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();
    
    // Populate before emitting
    await message.populate('sender', 'name username profilePicture');
    await message.populate('recipient', 'name username profilePicture');
    
    // Emit the edited message to both users
    io.to(message.sender._id.toString()).to(message.recipient._id.toString()).emit('messageEdited', message);
    
    res.json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { deleteForEveryone } = req.body;
    const currentUserId = req.user.userId;
    
    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    if (deleteForEveryone && message.sender.toString() === currentUserId) {
      message.isDeletedForEveryone = true;
      await message.save();
      
      // Notify both users about the deletion
      io.to(message.sender.toString()).to(message.recipient.toString()).emit('messageDeleted', {
        messageId,
        deletedForEveryone: true
      });
    } else {
      // Delete for me only
      message.deletedFor.push(currentUserId);
      await message.save();
      
      // Notify the current user about the deletion
      io.to(currentUserId).emit('messageDeleted', {
        messageId,
        deletedForEveryone: false
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const { name, profilePicture, status, privacy, theme } = req.body;
    const currentUserId = req.user.userId;
    
    const user = await User.findById(currentUserId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (name) user.name = name;
    if (profilePicture) user.profilePicture = profilePicture;
    if (status) user.status = status;
    if (privacy) user.privacy = { ...user.privacy, ...privacy };
    if (theme) user.theme = theme;
    
    await user.save();
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/bera-ai/settings', authenticateToken, async (req, res) => {
  try {
    const { name, personality } = req.body;
    const currentUserId = req.user.userId;
    
    const user = await User.findById(currentUserId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (name) user.beraAISettings.name = name;
    if (personality) user.beraAISettings.personality = personality;
    
    await user.save();
    
    res.json(user.beraAISettings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/block-user/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;
    
    const user = await User.findById(currentUserId);
    if (!user.blockedUsers.includes(userId)) {
      user.blockedUsers.push(userId);
      await user.save();
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/unblock-user/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;
    
    await User.findByIdAndUpdate(currentUserId, {
      $pull: { blockedUsers: userId }
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin routes
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid admin password' });
    }
    
    const token = jwt.sign(
      { isAdmin: true }, 
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '1h' }
    );
    
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/stats', authenticateToken, async (req, res) => {
  try {
    // In a real app, you'd verify admin privileges here
    
    const totalUsers = await User.countDocuments();
    const totalMessages = await Message.countDocuments();
    const activeUsers = await User.countDocuments({ isOnline: true });
    
    res.json({ totalUsers, totalMessages, activeUsers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    const users = await User.find()
      .select('username name isOnline lastSeen isBanned createdAt')
      .sort({ createdAt: -1 });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/ban-user/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findByIdAndUpdate(
      userId,
      { isBanned: true },
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Notify the user if they're online
    io.to(userId).emit('userBanned');
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/unban-user/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findByIdAndUpdate(
      userId,
      { isBanned: false },
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve the main page
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO logic
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // User authentication via socket
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      const user = await User.findById(decoded.userId);
      
      if (!user || user.isBanned) {
        socket.emit('authenticationFailed');
        return;
      }
      
      socket.userId = decoded.userId;
      onlineUsers.set(decoded.userId, socket.id);
      
      // Update user's online status
      await User.findByIdAndUpdate(decoded.userId, { isOnline: true });
      
      // Join user to their own room for private messages
      socket.join(decoded.userId);
      
      socket.emit('authenticated', { userId: decoded.userId });
      
      // Notify all users that this user is online
      socket.broadcast.emit('userOnline', { userId: decoded.userId });
    } catch (error) {
      socket.emit('authenticationFailed');
    }
  });
  
  // Handle sending messages
  socket.on('sendMessage', async (data) => {
    try {
      const { recipientId, content, isAI = false } = data;
      
      if (!socket.userId) {
        socket.emit('error', 'Not authenticated');
        return;
      }
      
      // Check if sender is banned
      const sender = await User.findById(socket.userId);
      if (sender.isBanned) {
        socket.emit('error', 'Your account has been banned');
        return;
      }
      
      // Check if recipient is blocked
      if (sender.blockedUsers.includes(recipientId)) {
        socket.emit('error', 'You have blocked this user');
        return;
      }
      
      const recipient = await User.findById(recipientId);
      if (recipient && recipient.blockedUsers.includes(socket.userId)) {
        socket.emit('error', 'You are blocked by this user');
        return;
      }
      
      // Create message
      const message = new Message({
        sender: socket.userId,
        recipient: recipientId,
        content,
        isAI,
        deliveredTo: [socket.userId] // Message is delivered to sender immediately
      });
      
      await message.save();
      
      // Populate sender info
      await message.populate('sender', 'name username profilePicture');
      await message.populate('recipient', 'name username profilePicture');
      
      // Emit to sender
      socket.emit('messageSent', message);
      
      // Emit to recipient if online
      const recipientSocketId = onlineUsers.get(recipientId);
      if (recipientSocketId) {
        message.deliveredTo.push(recipientId);
        await message.save();
        
        io.to(recipientSocketId).emit('newMessage', message);
      }
      
      // If message is to Bera AI, generate response
      if (isAI && openai) {
        // Get user's Bera AI settings
        const user = await User.findById(socket.userId);
        const aiName = user.beraAISettings.name;
        const personality = user.beraAISettings.personality;
        
        // Generate AI response based on personality
        let prompt = `You are ${aiName}, an AI assistant. `;
        
        switch (personality) {
          case 'professional':
            prompt += 'Respond in a professional and formal manner. ';
            break;
          case 'funny':
            prompt += 'Respond in a humorous and funny way. ';
            break;
          case 'mentor':
            prompt += 'Respond as a wise mentor providing guidance. ';
            break;
          default: // friendly
            prompt += 'Respond in a friendly and helpful manner. ';
        }
        
        prompt += `The user said: "${content}"`;
        
        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: prompt },
              { role: "user", content: content }
            ],
            max_tokens: 150
          });
          
          const aiResponse = completion.choices[0].message.content;
          
          // Create AI response message
          const aiMessage = new Message({
            sender: recipientId, // Bera AI is the sender
            recipient: socket.userId,
            content: aiResponse,
            isAI: true,
            deliveredTo: [recipientId] // AI message is delivered to AI immediately
          });
          
          await aiMessage.save();
          
          // Populate sender info
          await aiMessage.populate('sender', 'name username profilePicture');
          await aiMessage.populate('recipient', 'name username profilePicture');
          
          // Emit AI response to user
          socket.emit('newMessage', aiMessage);
          
          // Mark as delivered to user if online
          if (onlineUsers.get(socket.userId)) {
            aiMessage.deliveredTo.push(socket.userId);
            await aiMessage.save();
          }
        } catch (error) {
          console.error('OpenAI error:', error);
          // Send error message to user
          const errorMessage = new Message({
            sender: recipientId,
            recipient: socket.userId,
            content: "Sorry, I'm having trouble responding right now. Please try again later.",
            isAI: true
          });
          
          await errorMessage.save();
          await errorMessage.populate('sender', 'name username profilePicture');
          await errorMessage.populate('recipient', 'name username profilePicture');
          
          socket.emit('newMessage', errorMessage);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', 'Failed to send message');
    }
  });
  
  // Handle typing indicators
  socket.on('typingStart', (data) => {
    const { recipientId } = data;
    if (recipientId && onlineUsers.has(recipientId)) {
      socket.to(recipientId).emit('userTyping', { userId: socket.userId });
    }
  });
  
  socket.on('typingStop', (data) => {
    const { recipientId } = data;
    if (recipientId && onlineUsers.has(recipientId)) {
      socket.to(recipientId).emit('userStoppedTyping', { userId: socket.userId });
    }
  });
  
  // Handle message read receipts
  socket.on('markAsRead', async (data) => {
    try {
      const { messageId } = data;
      
      const message = await Message.findById(messageId);
      if (message && message.recipient.toString() === socket.userId) {
        if (!message.readBy.includes(socket.userId)) {
          message.readBy.push(socket.userId);
          await message.save();
          
          // Notify sender that message was read
          const senderSocketId = onlineUsers.get(message.sender.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit('messageRead', { messageId, readerId: socket.userId });
          }
        }
      }
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      
      // Update user's online status and last seen
      await User.findByIdAndUpdate(socket.userId, {
        isOnline: false,
        lastSeen: new Date()
      });
      
      // Notify all users that this user is offline
      socket.broadcast.emit('userOffline', { userId: socket.userId });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
