const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API Proxy Endpoints to avoid CORS issues
app.get('/api/movies/search', async (req, res) => {
  try {
    const { query } = req.query;
    const response = await axios.get(`https://apis.davidcyriltech.my.id/movies/search?query=${encodeURIComponent(query)}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch movies' });
  }
});

app.get('/api/zoom/movie', async (req, res) => {
  try {
    const { url } = req.query;
    const response = await axios.get(`https://apis.davidcyriltech.my.id/zoom/movie?url=${encodeURIComponent(url)}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch movie stream' });
  }
});

app.get('/api/youtube/mp3', async (req, res) => {
  try {
    const { url } = req.query;
    const response = await axios.get(`https://apis.davidcyriltech.my.id/youtube/mp3?url=${encodeURIComponent(url)}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch MP3' });
  }
});

app.get('/api/search/spotify', async (req, res) => {
  try {
    const { text } = req.query;
    const response = await axios.get(`https://apis.davidcyriltech.my.id/search/spotify?text=${encodeURIComponent(text)}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search Spotify' });
  }
});

app.get('/api/youtube/search', async (req, res) => {
  try {
    const { query } = req.query;
    const response = await axios.get(`https://apis.davidcyriltech.my.id/youtube/search?query=${encodeURIComponent(query)}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search YouTube' });
  }
});

app.get('/api/youtube/mp4', async (req, res) => {
  try {
    const { url } = req.query;
    const response = await axios.get(`https://apis.davidcyriltech.my.id/youtube/mp4?url=${encodeURIComponent(url)}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch MP4' });
  }
});

app.get('/api/download/ytmp4', async (req, res) => {
  try {
    const { url } = req.query;
    const response = await axios.get(`https://apis.davidcyriltech.my.id/download/ytmp4?url=${encodeURIComponent(url)}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to download video' });
  }
});

app.get('/api/download/tiktokv3', async (req, res) => {
  try {
    const { url } = req.query;
    const response = await axios.get(`https://apis.davidcyriltech.my.id/download/tiktokv3?url=${encodeURIComponent(url)}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to download TikTok video' });
  }
});

app.get('/api/ai/deepseek-v3', async (req, res) => {
  try {
    const { text } = req.query;
    const response = await axios.get(`https://apis.davidcyriltech.my.id/ai/deepseek-v3?text=${encodeURIComponent(text)}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to process AI request' });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
