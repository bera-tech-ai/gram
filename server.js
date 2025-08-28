const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'gram_x_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gram_x', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// User schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  profile: {
    firstName: String,
    lastName: String,
    bio: String,
    avatar: { type: String, default: 'https://i.imgur.com/hwklZjP.jpeg' },
    lastSeen: { type: Date, default: Date.now }
  }
}, { timestamps: true });

// Message schema
const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: { type: String, required: true },
  room: { type: String, default: 'general' },
  isRead: { type: Boolean, default: false }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
}

// API Routes

// Register new user
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, firstName, lastName } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user
    const user = new User({
      username,
      password: hashedPassword,
      profile: { firstName, lastName }
    });
    
    await user.save();
    
    // Set session
    req.session.userId = user._id;
    req.session.username = user.username;
    
    res.json({ 
      message: 'User created successfully', 
      user: { 
        id: user._id, 
        username: user.username, 
        profile: user.profile 
      } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Login user
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    
    // Update last seen
    user.profile.lastSeen = new Date();
    await user.save();
    
    // Set session
    req.session.userId = user._id;
    req.session.username = user.username;
    
    res.json({ 
      message: 'Login successful', 
      user: { 
        id: user._id, 
        username: user.username, 
        profile: user.profile 
      } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Logout user
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logout successful' });
});

// Get current user
app.get('/api/user', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    res.json({ 
      id: user._id, 
      username: user.username, 
      profile: user.profile 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Get all users
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.session.userId } })
      .select('username profile');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Update user profile
app.put('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const { firstName, lastName, bio, avatar } = req.body;
    
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    user.profile = { 
      ...user.profile, 
      firstName, 
      lastName, 
      bio, 
      avatar: avatar || user.profile.avatar 
    };
    
    await user.save();
    
    res.json({ 
      message: 'Profile updated successfully', 
      profile: user.profile 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get messages for a conversation
app.get('/api/messages/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const messages = await Message.find({
      $or: [
        { sender: req.session.userId, receiver: userId },
        { sender: userId, receiver: req.session.userId }
      ]
    })
    .populate('sender', 'username profile')
    .populate('receiver', 'username profile')
    .sort({ createdAt: 1 });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get group messages
app.get('/api/messages/group/:room', requireAuth, async (req, res) => {
  try {
    const { room } = req.params;
    
    const messages = await Message.find({ room })
      .populate('sender', 'username profile')
      .sort({ createdAt: 1 });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Serve the main application
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Join user's personal room
  socket.on('join user', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined their room`);
  });
  
  // Join a conversation
  socket.on('join conversation', (data) => {
    if (data.userId) {
      socket.join(data.userId);
    } else if (data.room) {
      socket.join(data.room);
    }
  });
  
  // Handle private messages
  socket.on('private message', async (data) => {
    try {
      const message = new Message({
        sender: data.senderId,
        receiver: data.receiverId,
        text: data.text
      });
      
      await message.save();
      
      // Populate sender info
      await message.populate('sender', 'username profile');
      
      // Send to both sender and receiver
      io.to(data.senderId).emit('new private message', message);
      io.to(data.receiverId).emit('new private message', message);
    } catch (error) {
      console.error('Error saving private message:', error);
    }
  });
  
  // Handle group messages
  socket.on('group message', async (data) => {
    try {
      const message = new Message({
        sender: data.senderId,
        text: data.text,
        room: data.room
      });
      
      await message.save();
      
      // Populate sender info
      await message.populate('sender', 'username profile');
      
      // Send to everyone in the room
      io.to(data.room).emit('new group message', message);
    } catch (error) {
      console.error('Error saving group message:', error);
    }
  });
  
  // Handle typing indicators
  socket.on('typing', (data) => {
    if (data.conversationType === 'private') {
      socket.to(data.receiverId).emit('user typing', {
        userId: data.senderId,
        isTyping: data.isTyping
      });
    } else {
      socket.to(data.room).emit('user typing', {
        userId: data.senderId,
        isTyping: data.isTyping
      });
    }
  });
  
  // Handle message read status
  socket.on('mark as read', async (data) => {
    try {
      await Message.updateMany(
        { 
          sender: data.senderId, 
          receiver: data.receiverId, 
          isRead: false 
        },
        { isRead: true }
      );
      
      socket.to(data.senderId).emit('messages read', {
        readerId: data.receiverId
      });
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Gram_X server running on port ${PORT}`);
});
