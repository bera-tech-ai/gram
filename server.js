// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse query & JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (like index.html, css, js)
app.use(express.static(path.join(__dirname, "public")));

// API endpoint
app.get("/chat", (req, res) => {
  const q = req.query.q;

  if (!q) {
    return res.status(400).json({
      creator: "Bruce Bera",
      status: 400,
      success: false,
      message: "Missing query parameter ?q=",
    });
  }

  // Example response
  res.json({
    creator: "Bruce Bera",
    status: 200,
    success: true,
    message: `You asked: ${q}`,
    reply: "This is a sample response from your custom API 🚀",
  });
});

// Fallback: always return index.html for root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
