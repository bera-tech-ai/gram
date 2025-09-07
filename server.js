// =======================
// 📌 Imports & Setup
// =======================
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

// =======================
// 📌 MongoDB Setup
// =======================
const MONGODB_URI = process.env.MONGO_URI;

if (!MONGODB_URI) {
  console.error("❌ No MONGO_URI found in environment variables");
  process.exit(1);
}

console.log('Connecting to MongoDB at:', MONGODB_URI);

const connectWithRetry = () => {
  mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  .then(() => {
    console.log('✅ Successfully connected to MongoDB Atlas');
  })
  .catch(err => {
    console.error('❌ Failed to connect to MongoDB:', err.message);
    console.log('Retrying connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  });
};

connectWithRetry();

mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to MongoDB Atlas');
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected');
});

process.on('SIGINT', () => {
  mongoose.connection.close(() => {
    console.log('Mongoose connection closed through app termination');
    process.exit(0);
  });
});

// =======================
// 📌 Schemas & Models
// =======================
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, unique: true, sparse: true, default: null }, // ✅ Fix for duplicate email issue
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

// =======================
// 📌 OpenAI Setup
// =======================
let openai;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
} else {
  console.warn('OPENAI_API_KEY not set. Bera AI functionality will be limited.');
}

// =======================
// 📌 Middleware
// =======================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// =======================
// 📌 Routes (User & Messages)
// =======================

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, name } = req.body;
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword, name });
    await user.save();

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '24h' });
    res.status(201).json({ token, user: { id: user._id, username: user.username, name: user.name } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// (👉 keep going into Part 2 below)
// =======================
// 📌 Login Route
// =======================
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user) return res.status(400).json({ error: 'Invalid username or password' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid username or password' });

    if (user.isBanned) return res.status(403).json({ error: 'User is banned' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '24h' });
    res.json({ token, user: { id: user._id, username: user.username, name: user.name } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =======================
// 📌 Get Messages
// =======================
app.get('/api/messages/:recipientId', authenticateToken, async (req, res) => {
  try {
    const { recipientId } = req.params;
    const messages = await Message.find({
      $or: [
        { sender: req.user.userId, recipient: recipientId },
        { sender: recipientId, recipient: req.user.userId }
      ]
    }).sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =======================
// 📌 Admin – Ban User
// =======================
app.post('/api/admin/ban', async (req, res) => {
  const { username, adminPassword } = req.body;
  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Invalid admin password' });
  }

  try {
    const user = await User.findOneAndUpdate({ username }, { isBanned: true }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: `${username} has been banned`, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =======================
// 📌 Socket.IO Real-time
// =======================
io.on('connection', (socket) => {
  console.log('⚡ User connected:', socket.id);

  socket.on('join', async (userId) => {
    socket.userId = userId;
    await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });
    socket.broadcast.emit('userOnline', userId);
  });

  socket.on('sendMessage', async ({ senderId, recipientId, content }) => {
    const message = new Message({ sender: senderId, recipient: recipientId, content });
    await message.save();

    io.to(recipientId).emit('receiveMessage', message);
    socket.emit('messageSent', message);
  });

  socket.on('typing', ({ senderId, recipientId }) => {
    io.to(recipientId).emit('typing', senderId);
  });

  socket.on('stopTyping', ({ senderId, recipientId }) => {
    io.to(recipientId).emit('stopTyping', senderId);
  });

  socket.on('disconnect', async () => {
    if (socket.userId) {
      await User.findByIdAndUpdate(socket.userId, { isOnline: false, lastSeen: new Date() });
      socket.broadcast.emit('userOffline', socket.userId);
    }
    console.log('❌ User disconnected:', socket.id);
  });
});

// =======================
// 📌 Start Server
// =======================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
