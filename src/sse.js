'use strict';
const express = require('express');
const router = express.Router();

const clients = new Map();

function addClient(sessionId, res, userId) {
  if (!clients.has(sessionId)) clients.set(sessionId, new Set());
  const client = { res, userId };
  clients.get(sessionId).add(client);
  return client;
}

function removeClient(sessionId, client) {
  if (!clients.has(sessionId)) return;
  clients.get(sessionId).delete(client);
  if (clients.get(sessionId).size === 0) clients.delete(sessionId);
}

function broadcast(sessionId, event, data) {
  if (!clients.has(sessionId)) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients.get(sessionId)) {
    try { client.res.write(msg); } catch(e) {}
  }
}

function broadcastAll(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, clientSet] of clients) {
    for (const client of clientSet) {
      try { client.res.write(msg); } catch(e) {}
    }
  }
}

router.get('/api/events', (req, res) => {
  if (!req.session?.userId) return res.status(401).end();
  const sessionId = parseInt(req.query.sessionId) || 0;
  const userId = req.session.userId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`event: connected\ndata: {"sessionId":${sessionId}}\n\n`);

  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch(e) { clearInterval(keepalive); }
  }, 25000);

  const client = addClient(sessionId, res, userId);

  req.on('close', () => {
    clearInterval(keepalive);
    removeClient(sessionId, client);
  });
});

module.exports = { sseRouter: router, broadcast, broadcastAll };
