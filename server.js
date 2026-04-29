require('dotenv').config();
const path = require('path');
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// --- Config from env ---
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const USER_NID = process.env.USER_NID;
const V4_CODE = process.env.V4_CODE;
const APP_CODE = process.env.APP_CODE;

if (!AUTH_TOKEN || !USER_NID || !V4_CODE || !APP_CODE) {
  console.error('ERROR: Missing required environment variables.');
  console.error('Create a .env file with: AUTH_TOKEN, USER_NID, V4_CODE, APP_CODE');
  process.exit(1);
}

// --- Upstream headers helper ---
const UPSTREAM_BASE = 'https://cloudapi.polymas.com';
function upstreamHeaders(contentType) {
  const h = {
    'Authorization': AUTH_TOKEN,
    'Origin': 'https://hike-teaching-center.polymas.com',
    'Referer': 'https://hike-teaching-center.polymas.com/',
  };
  if (contentType) h['Content-Type'] = contentType;
  return h;
}

// --- Middleware ---
app.use(morgan(':method :url :status :response-time ms'));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

// Rate limit on chat endpoint (max 15 requests per minute)
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many requests, please try again later' },
});

// --- Helper: fetch with timeout ---
async function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Routes ---

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/config', (req, res) => {
  res.json({ userNid: USER_NID, v4Code: V4_CODE });
});

app.post('/api/chat', chatLimiter, async (req, res) => {
  const { question, msgKey } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }

  const now = Date.now();
  const msgKeyStr = String(msgKey || '1');
  const traceId = String(now);
  const msgId = `${traceId}-${Math.floor(Math.random() * 99999999999999)}-${now}`;

  const payload = {
    appCode: APP_CODE,
    userNid: USER_NID,
    question: question,
    metadata: {
      fromUserNid: V4_CODE,
      toUserNid: USER_NID,
      optPlatform: 'Web',
      msgId: msgId,
      msgKey: `${traceId}_${msgKeyStr}_${now}`,
      msgTime: now,
      traceId: traceId,
      redirectVisual: true,
      model: 'Doubao-Seed-2.0-pro',
      webRetrieve: 1,
      configMsg: {
        webRetrieve: 1,
        useTools: 1,
        model: 'Doubao-Seed-2.0-pro',
        bizCode: 'hike_teach_center',
        agentInstanceId: '',
        useMcp: 0,
        useAgent: 1,
        mcpNidList: [],
      },
      metadata: {
        agentResults: [],
        cleanDate: '',
        originQuestion: question,
        fileIds: [],
        sourceQuestion: question,
      },
      bizCode: 'hike_teach_center',
      sourceOriginQuestion: question,
    },
    msgId: msgId,
  };

  try {
    const upstream = await fetchWithTimeout(
      `${UPSTREAM_BASE}/chatim/v1/robot/chat`,
      {
        method: 'POST',
        headers: {
          ...upstreamHeaders('application/json; charset=utf-8'),
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(payload),
      },
      60000 // 60s timeout for SSE streams
    );

    if (!upstream.ok) {
      const errBody = await upstream.text();
      console.error(`Upstream chat error ${upstream.status}:`, errBody);
      return res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    upstream.body.pipe(res);
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('Chat upstream timeout');
      return res.status(504).json({ error: 'Upstream request timed out' });
    }
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/userState', async (req, res) => {
  try {
    const { v4Code, userNid } = req.query;
    if (!v4Code || !userNid) {
      return res.status(400).json({ error: 'v4Code and userNid are required' });
    }
    const params = new URLSearchParams({ v4Code, userNid });
    const upstream = await fetchWithTimeout(
      `${UPSTREAM_BASE}/insight/v4agent/userState?${params}`,
      { method: 'GET', headers: upstreamHeaders() }
    );
    const data = await upstream.text();
    res.status(upstream.status).type('application/json').send(data);
  } catch (err) {
    console.error('userState query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/userState/patch', async (req, res) => {
  try {
    const upstream = await fetchWithTimeout(
      `${UPSTREAM_BASE}/insight/v4agent/userState/patch`,
      {
        method: 'POST',
        headers: upstreamHeaders('application/json; charset=utf-8'),
        body: JSON.stringify(req.body),
      }
    );
    const data = await upstream.text();
    res.status(upstream.status).send(data);
  } catch (err) {
    console.error('userState patch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/userState/delete', async (req, res) => {
  try {
    const { v4Code, userNid } = req.query;
    if (!v4Code || !userNid) {
      return res.status(400).json({ error: 'v4Code and userNid are required' });
    }
    const params = new URLSearchParams({ v4Code, userNid });
    const upstream = await fetchWithTimeout(
      `${UPSTREAM_BASE}/insight/v4agent/userState/delete?${params}`,
      { method: 'POST', headers: upstreamHeaders() }
    );
    const data = await upstream.text();
    res.status(upstream.status).send(data);
  } catch (err) {
    console.error('userState delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Start server ---
const server = app.listen(PORT, () => {
  console.log(`Proxy running at http://localhost:${PORT}`);
});

// --- Graceful shutdown ---
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
