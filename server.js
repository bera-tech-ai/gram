// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cors = require("cors");
const bodyParser = require("body-parser");
const multer = require("multer");
const { Configuration, OpenAIApi } = require("openai");

require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// ======================
// MongoDB Connection
// ======================
mongoose
  .connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/novachat", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// ======================
// Schemas
// ======================
const userSchema = new mongoose.Schema({
  displayName: String,
  email: { type: String, unique: true },
  password: String,
  username: { type: String, unique: true, sparse: true }, // ✅ FIX
  profilePicture: String,
  status: String,
  lastSeen: Date,
  isOnline: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  privacy: {
    lastSeen: { type: String, default: "everyone" },
    readReceipts: { type: Boolean, default: true },
  },
  theme: { type: String, default: "light" },
  isAdmin: { type: Boolean, default: false },
});

const User = mongoose.model("User", userSchema);

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  content: String,
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: "sent" },
  isEdited: { type: Boolean, default: false },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
});

const Message = mongoose.model("Message", messageSchema);

// ======================
// Middleware
// ======================
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers["authorization"]?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secretkey");
    req.user = await User.findById(decoded.id);
    if (!req.user) return res.status(401).json({ error: "Invalid user" });

    if (req.user.isBanned) return res.status(403).json({ error: "You are banned" });

    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
};

// ======================
// Auth Routes
// ======================
app.post("/api/register", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    const hashed = await bcrypt.hash(password, 10);

    const user = new User({
      email,
      password: hashed,
      displayName,
      lastSeen: new Date(),
    });

    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "secretkey");
    res.json({ token, user });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "Email already registered" });
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid email" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "secretkey");
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/user/me", authMiddleware, (req, res) => res.json(req.user));

// ======================
// User Routes
// ======================
const upload = multer({ dest: "uploads/" });

app.put("/api/user", authMiddleware, upload.single("profilePicture"), async (req, res) => {
  try {
    const { displayName, status } = req.body;
    if (displayName) req.user.displayName = displayName;
    if (status) req.user.status = status;
    if (req.file) req.user.profilePicture = `/uploads/${req.file.filename}`;
    await req.user.save();
    res.json(req.user);
  } catch {
    res.status(500).json({ error: "Profile update failed" });
  }
});

app.get("/api/users", authMiddleware, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user._id } });
  res.json(users);
});

// ======================
// Messages
// ======================
app.get("/api/messages/:contactId", authMiddleware, async (req, res) => {
  const { contactId } = req.params;
  const messages = await Message.find({
    $or: [
      { sender: req.user._id, recipient: contactId },
      { sender: contactId, recipient: req.user._id },
    ],
  }).sort("timestamp");
  res.json(messages);
});

app.put("/api/message/:id", authMiddleware, async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) return res.status(404).json({ error: "Message not found" });
  if (!message.sender.equals(req.user._id)) return res.status(403).json({ error: "Not your message" });

  message.content = req.body.content;
  message.isEdited = true;
  await message.save();

  io.to(message.recipient.toString()).emit("message_edited", message);
  res.json(message);
});

app.delete("/api/message/:id", authMiddleware, async (req, res) => {
  const { deleteForEveryone } = req.query;
  const message = await Message.findById(req.params.id);
  if (!message) return res.status(404).json({ error: "Message not found" });

  if (deleteForEveryone === "true" && message.sender.equals(req.user._id)) {
    await message.deleteOne();
    io.to(message.recipient.toString()).emit("message_deleted", { id: message._id, everyone: true });
    return res.json({ success: true });
  } else {
    message.deletedFor.push(req.user._id);
    await message.save();
    return res.json({ success: true });
  }
});

// ======================
// AI Chat
// ======================
const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

app.post("/api/ai/chat", authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: message }],
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch {
    res.status(500).json({ error: "AI chat failed" });
  }
});

// ======================
// Admin
// ======================
app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;
  const admin = await User.findOne({ email, isAdmin: true });
  if (!admin) return res.status(400).json({ error: "Not an admin" });

  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) return res.status(400).json({ error: "Invalid password" });

  const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET || "secretkey");
  res.json({ token, admin });
});

app.post("/api/admin/ban/:userId", authMiddleware, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: "Forbidden" });
  await User.findByIdAndUpdate(req.params.userId, { isBanned: true });
  io.to(req.params.userId).emit("banned");
  res.json({ success: true });
});

app.get("/api/admin/stats", authMiddleware, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: "Forbidden" });
  const totalUsers = await User.countDocuments();
  const totalMessages = await Message.countDocuments();
  const activeUsers = await User.countDocuments({ isOnline: true });
  res.json({ totalUsers, totalMessages, activeUsers });
});

// ======================
// Socket.io
// ======================
io.on("connection", (socket) => {
  socket.on("join", (userId) => {
    socket.join(userId);
    User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() }).exec();
  });

  socket.on("send_message", async (data) => {
    const message = new Message({ sender: data.senderId, recipient: data.recipientId, content: data.content });
    await message.save();
    io.to(data.recipientId).emit("new_message", message);
    socket.emit("message_sent", message);
  });

  socket.on("messages_read", async (data) => {
    await Message.updateMany({ _id: { $in: data.messageIds } }, { $set: { status: "read" } });
    io.to(data.readerId).emit("message_status", { messageIds: data.messageIds, status: "read" });
  });

  socket.on("typing_start", (data) => io.to(data.recipientId).emit("typing_start", data));
  socket.on("typing_stop", (data) => io.to(data.recipientId).emit("typing_stop", data));

  socket.on("disconnect", () => console.log("❌ User disconnected:", socket.id));
});

// ======================
// Start Server
// ======================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 NovaChat server running on port ${PORT}`));
