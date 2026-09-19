'use strict';

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { defaultConfigRoot } = require('../guard/lib/config');

function controlSocketPath(root = defaultConfigRoot()) {
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\border-collie-pet-control'
    : path.join(root, 'pet-control.sock');
}

function sendControl(control, root = defaultConfigRoot()) {
  return new Promise((resolve) => {
    const socket = net.createConnection(controlSocketPath(root));
    const finish = (applied) => {
      socket.destroy();
      resolve(applied);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('connect', () => socket.end(JSON.stringify(control) + '\n'));
    socket.once('close', () => resolve(true));
  });
}

function startControlServer(onControl, root = defaultConfigRoot()) {
  const socket = controlSocketPath(root);
  if (process.platform !== 'win32') {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    try { fs.unlinkSync(socket); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const server = net.createServer((connection) => {
    connection.setEncoding('utf8');
    let input = '';
    connection.on('data', (chunk) => { input += chunk; });
    connection.on('end', () => {
      try { onControl(JSON.parse(input)); } catch {
      }
    });
  });
  server.on('error', () => {});
  server.listen(socket, () => { if (process.platform !== 'win32') fs.chmodSync(socket, 0o600); });
  return {
    close() {
      server.close();
      if (process.platform !== 'win32') {
        try { fs.unlinkSync(socket); } catch {
        }
      }
    },
  };
}

module.exports = { controlSocketPath, sendControl, startControlServer };
