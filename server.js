// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Setup OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Store this in Render's environment vars
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static dashboard
app.use(express.static(path.join(__dirname, "public")));

// API endpoint that talks to OpenAI
app.get("/chat", async (req, res) => {
  const q = req.query.q;

  if (!q) {
    return res.status(400).json({
      creator: "Bruce Bera",
      status: 400,
      success: false,
      message: "Missing query parameter ?q=",
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // or gpt-4o, gpt-3.5-turbo, etc.
      messages: [{ role: "user", content: q }],
    });

    const reply = completion.choices[0].message.content;

    res.json({
      creator: "Bruce Bera",
      status: 200,
      success: true,
      message: `You asked: ${q}`,
      reply: reply,
    });
  } catch (err) {
    res.status(500).json({
      creator: "Bruce Bera",
      status: 500,
      success: false,
      message: err.message,
    });
  }
});

// Root fallback
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
