import express from "express";
import cors from "cors";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files (index.html, css, js)
app.use(express.static(path.join(__dirname, "public")));

// Proxy helper
async function proxyRequest(res, url, params = {}) {
  try {
    const response = await axios.get(url, { params });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/* =====================
     API PROXIES
===================== */

// Movies Search
app.get("/api/movies/search", (req, res) => {
  proxyRequest(res, "https://apis.davidcyriltech.my.id/movies/search", {
    query: req.query.q
  });
});

// Movies Zoom Stream
app.get("/api/movies/zoom", (req, res) => {
  proxyRequest(res, "https://apis.davidcyriltech.my.id/zoom/movie", {
    url: req.query.url
  });
});

// YouTube Search
app.get("/api/youtube/search", (req, res) => {
  proxyRequest(res, "https://apis.davidcyriltech.my.id/youtube/search", {
    query: req.query.q
  });
});

// YouTube MP3
app.get("/api/youtube/mp3", (req, res) => {
  proxyRequest(res, "https://apis.davidcyriltech.my.id/youtube/mp3", {
    url: req.query.url
  });
});

// YouTube MP4
app.get("/api/youtube/mp4", (req, res) => {
  proxyRequest(res, "https://apis.davidcyriltech.my.id/youtube/mp4", {
    url: req.query.url
  });
});

// Spotify Search
app.get("/api/spotify/search", (req, res) => {
  proxyRequest(res, "https://apis.davidcyriltech.my.id/search/spotify", {
    text: req.query.q
  });
});

// TikTok Download
app.get("/api/tiktok/download", (req, res) => {
  proxyRequest(res, "https://api.giftedtech.co.ke/api/download/tiktok", {
    apikey: "gifted",
    url: req.query.url
  });
});

// AI Chat
app.get("/api/ai/chat", (req, res) => {
  proxyRequest(res, "https://apis.davidcyriltech.my.id/ai/deepseek-v3", {
    text: req.query.text
  });
});

// AI Vision
app.get("/api/ai/vision", (req, res) => {
  proxyRequest(res, "https://api.giftedtech.co.ke/api/ai/vision", {
    apikey: "gifted",
    url: req.query.url,
    prompt: req.query.prompt
  });
});

// AI Image Generator
app.get("/api/ai/image", (req, res) => {
  proxyRequest(res, "https://api.giftedtech.co.ke/api/ai/sd", {
    apikey: "gifted",
    prompt: req.query.prompt
  });
});

// Adult Search
app.get("/api/adult/search", (req, res) => {
  proxyRequest(res, "https://apis.davidcyriltech.my.id/search/xnxx", {
    query: req.query.q
  });
});

// Adult Download
app.get("/api/adult/download", (req, res) => {
  proxyRequest(res, "https://api.giftedtech.co.ke/api/download/xnxxdl", {
    apikey: "gifted",
    url: req.query.url
  });
});

// Fallback route - serve index.html for any non-API request
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 BeraStream server running on http://localhost:${PORT}`);
});
