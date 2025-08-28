const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// File upload configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://ellyongiro8:QwXDXE6tyrGpUTNb@cluster0.tyxcmm9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// User Schema - FIXED: Removed email field to prevent duplicate key error
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String, unique: true, sparse: true },
  profile: {
    firstName: String,
    lastName: String,
    bio: { type: String, default: '' },
    avatar: String,
    lastSeen: { type: Date, default: Date.now }
  },
  contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isOnline: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Message Schema
const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
  type: { type: String, default: 'text' }, // text, image, file, audio
  fileUrl: String,
  fileName: String
});

// Group Schema
const groupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  avatar: String,
  createdAt: { type: Date, default: Date.now }
});

// Group Message Schema
const groupMessageSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  type: { type: String, default: 'text' },
  fileUrl: String,
  fileName: String
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Group = mongoose.model('Group', groupSchema);
const GroupMessage = mongoose.model('GroupMessage', groupMessageSchema);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, phone } = req.body;
    
    // Check if user exists by username
    const existingUser = await User.findOne({ username });
    
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // If phone provided, check if it exists
    if (phone) {
      const existingPhone = await User.findOne({ phone });
      if (existingPhone) {
        return res.status(400).json({ error: 'Phone number already exists' });
      }
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = new User({
      username,
      password: hashedPassword,
      phone: phone || undefined,
      profile: {
        firstName: '',
        lastName: '',
        bio: '',
        avatar: ''
      }
    });
    
    await user.save();
    
    // Generate token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET);
    
    res.status(201).json({ 
      message: 'User created successfully', 
      token,
      user: {
        id: user._id,
        username: user.username,
        profile: user.profile
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      // Handle duplicate key error
      const field = Object.keys(error.keyValue)[0];
      res.status(400).json({ error: `${field} already exists` });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Update last seen and online status
    user.profile.lastSeen = new Date();
    user.isOnline = true;
    await user.save();
    
    // Generate token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET);
    
    res.json({ 
      message: 'Login successful', 
      token,
      user: {
        id: user._id,
        username: user.username,
        profile: user.profile,
        isOnline: user.isOnline
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/logout', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (user) {
      user.isOnline = false;
      user.profile.lastSeen = new Date();
      await user.save();
    }
    res.json({ message: 'Logout successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const { firstName, lastName, bio } = req.body;
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    user.profile = {
      firstName: firstName || user.profile.firstName,
      lastName: lastName || user.profile.lastName,
      bio: bio || user.profile.bio,
      avatar: user.profile.avatar,
      lastSeen: user.profile.lastSeen
    };
    
    await user.save();
    res.json({ message: 'Profile updated successfully', profile: user.profile });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/user/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    user.profile.avatar = `/uploads/${req.file.filename}`;
    await user.save();
    
    res.json({ message: 'Avatar updated successfully', avatar: user.profile.avatar });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.userId } }).select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { sender: req.user.userId, receiver: req.params.userId },
        { sender: req.params.userId, receiver: req.user.userId }
      ]
    }).populate('sender', 'username profile').populate('receiver', 'username profile').sort({ timestamp: 1 });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/messages/read/:userId', authenticateToken, async (req, res) => {
  try {
    await Message.updateMany(
      { sender: req.params.userId, receiver: req.user.userId, read: false },
      { $set: { read: true } }
    );
    
    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Group routes
app.post('/api/groups', authenticateToken, async (req, res) => {
  try {
    const { name, description, members } = req.body;
    
    const group = new Group({
      name,
      description,
      admin: req.user.userId,
      members: [...members, req.user.userId]
    });
    
    await group.save();
    await group.populate('members', 'username profile');
    await group.populate('admin', 'username profile');
    
    res.status(201).json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/groups', authenticateToken, async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user.userId })
      .populate('admin', 'username profile')
      .populate('members', 'username profile');
    
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
  try {
    const messages = await GroupMessage.find({ group: req.params.groupId })
      .populate('sender', 'username profile')
      .sort({ timestamp: 1 });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.io for real-time messaging
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined their room`);
  });
  
  socket.on('joinGroup', (groupId) => {
    socket.join(groupId);
    console.log(`User joined group ${groupId}`);
  });
  
  socket.on('sendMessage', async (data) => {
    try {
      const { senderId, receiverId, content, type, fileUrl, fileName } = data;
      
      // Save message to database
      const message = new Message({
        sender: senderId,
        receiver: receiverId,
        content,
        type: type || 'text',
        fileUrl,
        fileName,
        timestamp: new Date()
      });
      
      await message.save();
      
      // Populate sender info
      await message.populate('sender', 'username profile');
      await message.populate('receiver', 'username profile');
      
      // Send to receiver
      socket.to(receiverId).emit('receiveMessage', message);
      
      // Send back to sender for confirmation
      socket.emit('messageSent', message);
    } catch (error) {
      socket.emit('error', { message: 'Failed to send message' });
    }
  });
  
  socket.on('sendGroupMessage', async (data) => {
    try {
      const { groupId, senderId, content, type, fileUrl, fileName } = data;
      
      // Save message to database
      const message = new GroupMessage({
        group: groupId,
        sender: senderId,
        content,
        type: type || 'text',
        fileUrl,
        fileName,
        timestamp: new Date()
      });
      
      await message.save();
      await message.populate('sender', 'username profile');
      
      // Send to all group members
      socket.to(groupId).emit('receiveGroupMessage', message);
      
      // Send back to sender for confirmation
      socket.emit('groupMessageSent', message);
    } catch (error) {
      socket.emit('error', { message: 'Failed to send group message' });
    }
  });
  
  socket.on('typing', (data) => {
    socket.to(data.receiverId).emit('userTyping', {
      senderId: data.senderId,
      isTyping: data.isTyping
    });
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Create uploads directory if it doesn't exist
  const fs = require('fs');
  if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
  }
});
