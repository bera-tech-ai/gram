require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// MongoDB connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/novachat', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// MongoDB Models
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  displayName: { type: String, required: true },
  profilePicture: { type: String, default: '' },
  status: { type: String, default: 'Hey there! I am using NovaChat' },
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  aiSettings: {
    name: { type: String, default: 'Bera AI' },
    personality: { type: String, default: 'friendly' }
  },
  privacy: {
    lastSeen: { type: String, default: 'everyone' }, // everyone, contacts, nobody
    readReceipts: { type: Boolean, default: true }
  },
  theme: { type: String, default: 'light' }
});

const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  isEdited: { type: Boolean, default: false },
  editedAt: { type: Date },
  isDeleted: { type: Boolean, default: false },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, default: 'sent' }, // sent, delivered, read
  isAIMessage: { type: Boolean, default: false }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// JWT authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret', (err, user) => {
    if (err) {
      return res.sendStatus(403);
    }
    req.user = user;
    next();
  });
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Register endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = new User({
      email,
      password: hashedPassword,
      displayName
    });
    
    await user.save();
    
    // Generate JWT
    const token = jwt.sign(
      { userId: user._id }, 
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );
    
    res.status(201).json({ token, user: { id: user._id, email: user.email, displayName: user.displayName } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Check if banned
    if (user.isBanned) {
      return res.status(403).json({ error: 'Your account has been banned' });
    }
    
    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Update last seen and online status
    user.lastSeen = new Date();
    user.isOnline = true;
    await user.save();
    
    // Generate JWT
    const token = jwt.sign(
      { userId: user._id }, 
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );
    
    res.json({ token, user: { 
      id: user._id, 
      email: user.email, 
      displayName: user.displayName,
      profilePicture: user.profilePicture,
      status: user.status
    } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all users (for contacts list)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.userId }, isBanned: false })
      .select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user profile
app.get('/api/user/:id', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user profile
app.put('/api/user', authenticateToken, upload.single('profilePicture'), async (req, res) => {
  try {
    const updates = req.body;
    if (req.file) {
      updates.profilePicture = `/uploads/${req.file.filename}`;
    }
    
    const user = await User.findByIdAndUpdate(
      req.user.userId, 
      updates, 
      { new: true, runValidators: true }
    ).select('-password');
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages between two users
app.get('/api/messages/:recipientId', authenticateToken, async (req, res) => {
  try {
    const { recipientId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const skip = (page - 1) * limit;
    
    const messages = await Message.find({
      $or: [
        { sender: req.user.userId, recipient: recipientId },
        { sender: recipientId, recipient: req.user.userId }
      ],
      isDeleted: false,
      deletedFor: { $ne: req.user.userId }
    })
    .populate('sender', 'displayName profilePicture')
    .populate('recipient', 'displayName profilePicture')
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit);
    
    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit message
app.put('/api/message/:id', authenticateToken, async (req, res) => {
  try {
    const { content } = req.body;
    const message = await Message.findOneAndUpdate(
      { _id: req.params.id, sender: req.user.userId },
      { content, isEdited: true, editedAt: new Date() },
      { new: true }
    );
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found or not authorized' });
    }
    
    // Notify recipient via socket
    io.to(message.recipient.toString()).emit('message_edited', {
      messageId: message._id,
      content: message.content,
      isEdited: message.isEdited,
      editedAt: message.editedAt
    });
    
    res.json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete message
app.delete('/api/message/:id', authenticateToken, async (req, res) => {
  try {
    const { deleteForEveryone } = req.query;
    const message = await Message.findById(req.params.id);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    if (deleteForEveryone === 'true' && message.sender.toString() === req.user.userId) {
      // Delete for everyone
      message.isDeleted = true;
      await message.save();
      
      // Notify recipient via socket
      io.to(message.recipient.toString()).emit('message_deleted', {
        messageId: message._id,
        deletedForEveryone: true
      });
    } else {
      // Delete for me only
      message.deletedFor.push(req.user.userId);
      await message.save();
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin endpoints
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid admin password' });
    }
    
    const token = jwt.sign(
      { isAdmin: true }, 
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '1h' }
    );
    
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/stats', authenticateToken, async (req, res) => {
  try {
    // In a real app, you'd verify the user is an admin
    const totalUsers = await User.countDocuments();
    const totalMessages = await Message.countDocuments();
    const activeUsers = await User.countDocuments({ isOnline: true });
    
    res.json({ totalUsers, totalMessages, activeUsers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/ban/:userId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { isBanned: true },
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Notify user they've been banned via socket
    io.to(user._id.toString()).emit('banned');
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI Assistant endpoint
app.post('/api/ai/chat', authenticateToken, async (req, res) => {
  try {
    const { message, conversationHistory } = req.body;
    const user = await User.findById(req.user.userId);
    
    // Get AI personality based on user settings
    const personality = user.aiSettings.personality || 'friendly';
    const aiName = user.aiSettings.name || 'Bera AI';
    
    let systemMessage = '';
    switch (personality) {
      case 'professional':
        systemMessage = 'You are a professional AI assistant. Provide concise, helpful responses.';
        break;
      case 'funny':
        systemMessage = 'You are a funny, humorous AI assistant. Make jokes and keep things light.';
        break;
      case 'mentor':
        systemMessage = 'You are a wise mentor AI. Provide guidance and thoughtful advice.';
        break;
      default: // friendly
        systemMessage = 'You are a friendly AI assistant. Be warm, helpful, and engaging.';
    }
    
    // Prepare messages for OpenAI
    const messages = [
      { role: 'system', content: systemMessage },
      ...conversationHistory.slice(-10), // Keep last 10 messages for context
      { role: 'user', content: message }
    ];
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      max_tokens: 500,
      temperature: 0.7,
    });
    
    const aiResponse = completion.choices[0].message.content;
    
    // Save AI message to database
    const aiUser = await User.findOne({ email: 'ai@berachat.com' });
    if (!aiUser) {
      // Create AI user if it doesn't exist
      const hashedPassword = await bcrypt.hash(Math.random().toString(36), 10);
      const newAiUser = new User({
        email: 'ai@berachat.com',
        password: hashedPassword,
        displayName: aiName,
        profilePicture: '/ai-avatar.png'
      });
      await newAiUser.save();
    }
    
    // Save user message
    const userMessage = new Message({
      sender: req.user.userId,
      recipient: aiUser ? aiUser._id : newAiUser._id,
      content: message,
      status: 'delivered'
    });
    await userMessage.save();
    
    // Save AI response
    const aiMessage = new Message({
      sender: aiUser ? aiUser._id : newAiUser._id,
      recipient: req.user.userId,
      content: aiResponse,
      status: 'delivered',
      isAIMessage: true
    });
    await aiMessage.save();
    
    // Populate sender info for response
    await aiMessage.populate('sender', 'displayName profilePicture');
    
    res.json({ response: aiResponse, message: aiMessage });
  } catch (error) {
    console.error('AI Error:', error);
    res.status(500).json({ error: 'Failed to get AI response' });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Join user's room for private messaging
  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined room`);
    
    // Update user online status
    User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() })
      .catch(err => console.error('Error updating online status:', err));
  });
  
  // Handle sending messages
  socket.on('send_message', async (data) => {
    try {
      const { senderId, recipientId, content } = data;
      
      // Create message
      const message = new Message({
        sender: senderId,
        recipient: recipientId,
        content: content,
        status: 'sent'
      });
      
      await message.save();
      await message.populate('sender', 'displayName profilePicture');
      await message.populate('recipient', 'displayName profilePicture');
      
      // Emit to sender for confirmation
      socket.emit('message_sent', message);
      
      // Emit to recipient
      socket.to(recipientId).emit('new_message', message);
      
      // Update message status to delivered
      setTimeout(async () => {
        message.status = 'delivered';
        await message.save();
        socket.emit('message_status', { messageId: message._id, status: 'delivered' });
        socket.to(recipientId).emit('message_status', { messageId: message._id, status: 'delivered' });
      }, 1000);
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });
  
  // Handle typing indicators
  socket.on('typing_start', (data) => {
    socket.to(data.recipientId).emit('typing_start', { senderId: data.senderId });
  });
  
  socket.on('typing_stop', (data) => {
    socket.to(data.recipientId).emit('typing_stop', { senderId: data.senderId });
  });
  
  // Handle message read receipts
  socket.on('messages_read', async (data) => {
    try {
      const { readerId, messageIds } = data;
      
      // Update messages as read
      await Message.updateMany(
        { _id: { $in: messageIds }, recipient: readerId },
        { status: 'read' }
      );
      
      // Notify sender that messages were read
      const messages = await Message.find({ _id: { $in: messageIds } });
      const senders = [...new Set(messages.map(m => m.sender.toString()))];
      
      senders.forEach(senderId => {
        socket.to(senderId).emit('messages_read', { readerId, messageIds });
      });
    } catch (error) {
      console.error('Error updating read status:', error);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
