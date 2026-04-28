const express = require('express');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const app = express();

app.use(express.json());
app.use(express.static('.'));

// ⚠️ 把你从 DevTools 里复制的 Authorization token 粘贴到这里
const AUTH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJsb2dpblR5cGUiOiJsb2dpbiIsImxvZ2luSWQiOiI2MXRwTzhseGR4Iiwicm5TdHIiOiI4V0VIb0JGdm5OZzRGY0Y3NkVHZ011NmNIQW5LOWJvRyIsInR5cGUiOiJaSFMiLCJ1c2VyTmlkIjoiNjF0cE84bHhkeCJ9.7y0nNGfs7h9L-ISVXzGKMeKUYBlEpTLl4Fb-9halmGI';

app.post('/api/chat', async (req, res) => {
  const { question, msgKey } = req.body;

  const now = Date.now();
  const msgKeyStr = String(msgKey || '1');
  const traceId = String(now);
  const msgId = `${traceId}-${Math.floor(Math.random() * 99999999999999)}-${now}`;

  const payload = {
    appCode: 'CzN1mKDGp4',
    userNid: '61tpO8lxdx',
    question: question,
    metadata: {
      fromUserNid: 'u9QaKqc7qM',
      toUserNid: '61tpO8lxdx',
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
    const upstream = await fetch('https://cloudapi.polymas.com/chatim/v1/robot/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'text/event-stream',
        'Authorization': AUTH_TOKEN,
        'Origin': 'https://hike-teaching-center.polymas.com',
        'Referer': 'https://hike-teaching-center.polymas.com/',
      },
      body: JSON.stringify(payload),
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    upstream.body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log('✅ 代理已启动 → http://localhost:3000');
});
