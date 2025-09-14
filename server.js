// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠️ Hardcoded API key (unsafe in production!)
const openai = new OpenAI({
  apiKey: "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",
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from "public"
app.use(express.static(path.join(__dirname, "public")));

// /chat endpoint
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
      model: "gpt-4o-mini",
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

// Fallback route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
