require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { validationResult, body } = require('express-validator');

// Initialize Express app
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
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gram_x', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  avatar: { type: String, default: null },
  displayName: { type: String, default: '' },
  bio: { type: String, default: '' },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

// Chat Schema
const chatSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  isGroup: { type: Boolean, default: false },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  avatar: { type: String, default: null },
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
}, { timestamps: true });

const Chat = mongoose.model('Chat', chatSchema);

// Message Schema
const messageSchema = new mongoose.Schema({
  chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: {
    text: { type: String, default: '' },
    media: [{
      type: { type: String },
      url: { type: String },
      name: { type: String },
      size: { type: Number }
    }]
  },
  type: { type: String, enum: ['text', 'image', 'video', 'audio', 'file'], default: 'text' },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  edited: { type: Boolean, default: false },
  deleted: { type: Boolean, default: false },
  readBy: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now }
  }],
  deliveredTo: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({ message: 'Access token required' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) return res.status(401).json({ message: 'Invalid token' });

    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

// Generate JWT tokens
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId }, 
    process.env.JWT_SECRET || 'fallback_secret', 
    { expiresIn: '15m' }
  );
  
  const refreshToken = jwt.sign(
    { userId }, 
    process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret', 
    { expiresIn: '7d' }
  );
  
  return { accessToken, refreshToken };
};

// Routes
app.post('/api/auth/register', [
  body('username').isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('email').isEmail().withMessage('Must be a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;
    
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = new User({ username, email, password });
    await user.save();

    const { accessToken, refreshToken } = generateTokens(user._id);
    
    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    const { accessToken, refreshToken } = generateTokens(user._id);
    
    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        displayName: user.displayName
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.get('/api/users/me', authenticateToken, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      avatar: req.user.avatar,
      displayName: req.user.displayName,
      bio: req.user.bio,
      isOnline: req.user.isOnline,
      lastSeen: req.user.lastSeen
    }
  });
});

app.get('/api/chats', authenticateToken, async (req, res) => {
  try {
    const chats = await Chat.find({ participants: req.user._id })
      .populate('participants', 'username avatar displayName isOnline lastSeen')
      .populate('lastMessage')
      .sort({ updatedAt: -1 });
    
    res.json(chats);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.post('/api/chats', authenticateToken, async (req, res) => {
  try {
    const { participantIds, isGroup, name } = req.body;
    
    if (!isGroup && participantIds.length !== 1) {
      return res.status(400).json({ message: '1:1 chat requires exactly one participant' });
    }

    const participants = [req.user._id, ...participantIds];
    
    let chat = await Chat.findOne({
      isGroup: false,
      participants: { $all: participants, $size: participants.length }
    }).populate('participants', 'username avatar displayName');

    if (!chat && !isGroup) {
      chat = new Chat({
        participants,
        isGroup: false
      });
      await chat.save();
      chat = await Chat.findById(chat._id).populate('participants', 'username avatar displayName');
    } else if (isGroup) {
      chat = new Chat({
        name,
        participants,
        isGroup: true,
        admin: req.user._id
      });
      await chat.save();
      chat = await Chat.findById(chat._id).populate('participants', 'username avatar displayName');
    }

    res.status(201).json(chat);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.get('/api/chats/:chatId/messages', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    
    const chat = await Chat.findOne({
      _id: chatId,
      participants: req.user._id
    });
    
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const messages = await Message.find({ chat: chatId, deleted: false })
      .populate('sender', 'username avatar displayName')
      .populate('replyTo')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-chat', (chatId) => {
    socket.join(chatId);
    console.log(`User joined chat: ${chatId}`);
  });

  socket.on('leave-chat', (chatId) => {
    socket.leave(chatId);
    console.log(`User left chat: ${chatId}`);
  });

  socket.on('send-message', async (data) => {
    try {
      const { chatId, content, type, replyTo } = data;
      
      const chat = await Chat.findOne({
        _id: chatId,
        participants: socket.userId
      });
      
      if (!chat) {
        return socket.emit('error', { message: 'Chat not found' });
      }

      const message = new Message({
        chat: chatId,
        sender: socket.userId,
        content,
        type,
        replyTo
      });

      await message.save();
      
      // Update chat's last message
      chat.lastMessage = message._id;
      await chat.save();

      const populatedMessage = await Message.findById(message._id)
        .populate('sender', 'username avatar displayName')
        .populate('replyTo');

      // Emit to all users in the chat
      io.to(chatId).emit('new-message', populatedMessage);
      
      // Emit delivery status to sender
      socket.emit('message-delivered', { messageId: message._id });
    } catch (error) {
      socket.emit('error', { message: 'Failed to send message', error: error.message });
    }
  });

  socket.on('typing-start', (data) => {
    socket.to(data.chatId).emit('user-typing', {
      userId: socket.userId,
      chatId: data.chatId
    });
  });

  socket.on('typing-stop', (data) => {
    socket.to(data.chatId).emit('user-stop-typing', {
      userId: socket.userId,
      chatId: data.chatId
    });
  });

  socket.on('mark-as-read', async (data) => {
    try {
      const { messageId, chatId } = data;
      
      await Message.updateOne(
        { _id: messageId },
        { $addToSet: { readBy: { user: socket.userId, timestamp: new Date() } } }
      );
      
      socket.to(chatId).emit('message-read', {
        messageId,
        userId: socket.userId
      });
    } catch (error) {
      socket.emit('error', { message: 'Failed to mark as read', error: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Serve the frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
