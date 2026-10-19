'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const allowedSettings = new Set(['AIR_API_KEY', 'OPENAI_BASE_URL', 'ASU_PROPOSER_MODEL', 'ASU_LABELER_MODEL']);

function connection() {
  const settings = {};
  const configuration = path.resolve(__dirname, '../../..', '.env');
  if (fs.existsSync(configuration)) {
    for (const line of fs.readFileSync(configuration, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (!match || !allowedSettings.has(match[1])) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      settings[match[1]] = value;
    }
  }
  for (const name of allowedSettings) if (process.env[name]) settings[name] = process.env[name];
  if (!settings.AIR_API_KEY) throw new Error('The existing ASU gateway credential is unavailable');
  return { key: settings.AIR_API_KEY, baseUrl: (settings.OPENAI_BASE_URL || 'https://openai.rc.asu.edu/v1').replace(/\/$/, ''), proposerModel: settings.ASU_PROPOSER_MODEL, labelerModel: settings.ASU_LABELER_MODEL };
}

function safeError(error, conn) {
  return String(error.message || error).replaceAll(conn.key, '<REDACTED>');
}

async function request(conn, route, body, timeoutMs = 600000) {
  const url = new URL(conn.baseUrl + route);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The gateway requires an HTTP URL');
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const outgoing = transport.request(url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + conn.key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }, (incoming) => {
      let text = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk) => { text += chunk; });
      incoming.on('error', reject);
      incoming.on('end', () => {
        let payload;
        try { payload = JSON.parse(text); } catch { reject(new Error('Gateway returned invalid JSON')); return; }
        if (incoming.statusCode < 200 || incoming.statusCode >= 300) {
          reject(new Error(String(incoming.statusCode) + ' ' + String(payload?.error?.message || 'Gateway rejected the request').replaceAll(conn.key, '<REDACTED>')));
          return;
        }
        resolve(payload);
      });
    });
    outgoing.on('error', reject);
    outgoing.end(body ? JSON.stringify(body) : undefined);
  });
}

async function chat(conn, model, instructions, rows) {
  const response = await request(conn, '/chat/completions', { model, messages: [{ role: 'system', content: instructions }, { role: 'user', content: JSON.stringify(rows) }] });
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Gateway returned no text answer');
  const match = content.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/);
  const decoded = JSON.parse(match ? match[1] : content);
  if (decoded && typeof decoded === 'object') Object.defineProperty(decoded, 'gatewayMetadata', { value: { responseId: response.id || null, requestedModel: model, reportedModel: response.model || null, finishReason: response.choices?.[0]?.finish_reason || null, usage: response.usage || null }, enumerable: false });
  return decoded;
}

if (require.main === module) {
  const conn = connection();
  request(conn, '/models', undefined, 30000).then((payload) => {
    const available = (payload.data || []).map((model) => model.id);
    console.log(JSON.stringify({ gateway: new URL(conn.baseUrl).hostname, proposer: conn.proposerModel, labeler: conn.labelerModel, configuredModelsAvailable: [conn.proposerModel, conn.labelerModel].every((model) => available.includes(model)), availableModels: available }, null, 2));
  }).catch((error) => { console.error(safeError(error, conn)); process.exitCode = 1; });
}

module.exports = { connection, request, chat, safeError };
