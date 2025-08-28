const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
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

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://ellyongiro8:QwXDXE6tyrGpUTNb@cluster0.tyxcmm9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  avatar: { type: String, default: 'https://i.imgur.com/3Q6ZQ0u.jpeg' },
  status: { type: String, default: 'Online' },
  lastSeen: { type: Date, default: Date.now }
});

// Message Schema
const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

// Models
const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// Authentication routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = new User({
      username,
      email,
      password: hashedPassword
    });
    
    await user.save();
    
    res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;
    
    // Find user by email or username
    const user = await User.findOne({
      $or: [{ email: emailOrUsername }, { username: emailOrUsername }]
    });
    
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Update user status
    user.status = 'Online';
    user.lastSeen = new Date();
    await user.save();
    
    res.json({ 
      message: 'Login successful', 
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        status: user.status
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Socket.io for real-time messaging
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Join user to their room
  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined their room`);
  });
  
  // Handle sending messages
  socket.on('sendMessage', async (data) => {
    try {
      const { senderId, receiverId, content } = data;
      
      // Save message to database
      const message = new Message({
        sender: senderId,
        receiver: receiverId,
        content
      });
      
      await message.save();
      
      // Populate sender info
      await message.populate('sender', 'username avatar');
      
      // Emit to receiver
      socket.to(receiverId).emit('receiveMessage', message);
      
      // Also emit to sender for confirmation
      socket.emit('messageSent', message);
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });
  
  // Handle typing indicators
  socket.on('typing', (data) => {
    socket.to(data.receiverId).emit('userTyping', {
      senderId: data.senderId,
      isTyping: data.isTyping
    });
  });
  
  // Handle message read receipts
  socket.on('markAsRead', async (data) => {
    try {
      const { messageId, userId } = data;
      
      // Update message as read in database
      await Message.findByIdAndUpdate(messageId, { read: true });
      
      // Notify sender that message was read
      socket.to(userId).emit('messageRead', messageId);
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    
    // Update user status to offline
    // This would require storing socketId to userId mapping
  });
});

// Get user messages
app.get('/api/messages/:userId/:contactId', async (req, res) => {
  try {
    const { userId, contactId } = req.params;
    
    const messages = await Message.find({
      $or: [
        { sender: userId, receiver: contactId },
        { sender: contactId, receiver: userId }
      ]
    })
    .populate('sender', 'username avatar')
    .sort({ timestamp: 1 });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user contacts
app.get('/api/contacts/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Find all users that have exchanged messages with the current user
    const contacts = await Message.aggregate([
      {
        $match: {
          $or: [{ sender: mongoose.Types.ObjectId(userId) }, { receiver: mongoose.Types.ObjectId(userId) }]
        }
      },
      {
        $project: {
          contact: {
            $cond: {
              if: { $eq: ['$sender', mongoose.Types.ObjectId(userId)] },
              then: '$receiver',
              else: '$sender'
            }
          },
          lastMessage: '$content',
          timestamp: '$timestamp',
          read: '$read'
        }
      },
      {
        $group: {
          _id: '$contact',
          lastMessage: { $last: '$lastMessage' },
          timestamp: { $last: '$timestamp' },
          unreadCount: {
            $sum: {
              $cond: [{ $eq: ['$read', false] }, 1, 0]
            }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'contactInfo'
        }
      },
      {
        $unwind: '$contactInfo'
      },
      {
        $project: {
          _id: '$contactInfo._id',
          username: '$contactInfo.username',
          avatar: '$contactInfo.avatar',
          status: '$contactInfo.status',
          lastMessage: 1,
          timestamp: 1,
          unreadCount: 1
        }
      },
      {
        $sort: { timestamp: -1 }
      }
    ]);
    
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
