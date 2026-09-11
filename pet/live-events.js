'use strict';

const MAX_LINE_BYTES = 1024 * 1024;

function readLiveEvents(stream, onEvent, onEnd) {
  let carry = '';
  let closed = false;

  const cleanUp = () => {
    stream.off('data', receive);
    stream.off('end', finish);
    stream.off('error', finish);
  };

  const receive = (chunk) => {
    carry += chunk;
    if (Buffer.byteLength(carry) > MAX_LINE_BYTES) {
      finish();
      return;
    }
    const lines = carry.split('\n');
    carry = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
      }
    }
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    cleanUp();
    onEnd();
  };

  stream.setEncoding('utf8');
  stream.on('data', receive);
  stream.once('end', finish);
  stream.once('error', finish);
  stream.resume();

  return {
    close() {
      if (closed) return;
      closed = true;
      cleanUp();
    },
  };
}

module.exports = { readLiveEvents };
