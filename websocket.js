// TANK-10: Pure Node.js WebSocket (RFC 6455) Server
const crypto = require('crypto');
const EventEmitter = require('events');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WebSocketClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.isOpen = true;

    socket.on('data', chunk => this._onData(chunk));
    socket.on('close', () => this._onClose());
    socket.on('error', err => {
      this.emit('error', err);
      this._onClose();
    });
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this._processFrames();
  }

  _processFrames() {
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];

      const fin = (firstByte & 0x80) !== 0;
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;

      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < offset + 2) return;
        payloadLength = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (this.buffer.length < offset + 8) return;
        const high = this.buffer.readUInt32BE(offset);
        const low = this.buffer.readUInt32BE(offset + 4);
        payloadLength = (high * 0x100000000) + low;
        offset += 8;
      }

      let maskKey = null;
      if (isMasked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLength) {
        // Wait for more data
        return;
      }

      const payload = this.buffer.subarray(offset, offset + payloadLength);
      this.buffer = this.buffer.subarray(offset + payloadLength);

      // Unmask
      const unmasked = Buffer.alloc(payload.length);
      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          unmasked[i] = payload[i] ^ maskKey[i % 4];
        }
      } else {
        payload.copy(unmasked);
      }

      // Handle Opcode
      if (opcode === 0x1) {
        // Text frame
        const text = unmasked.toString('utf8');
        this.emit('message', text);
      } else if (opcode === 0x8) {
        // Close frame
        this.close();
        return;
      } else if (opcode === 0x9) {
        // Ping -> respond with Pong (0xA)
        this._sendFrame(0xa, unmasked);
      } else if (opcode === 0xa) {
        // Pong
        this.emit('pong');
      }
    }
  }

  send(data) {
    if (!this.isOpen || this.socket.destroyed) return;
    const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
    this._sendFrame(0x1, payload);
  }

  _sendFrame(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return;

    const length = payload.length;
    let header;

    if (length <= 125) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | (opcode & 0x0f); // FIN = 1
      header[1] = length;                 // Mask = 0
    } else if (length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | (opcode & 0x0f);
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | (opcode & 0x0f);
      header[1] = 127;
      header.writeUInt32BE(Math.floor(length / 0x100000000), 2);
      header.writeUInt32BE(length & 0xffffffff, 6);
    }

    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (e) {
      this._onClose();
    }
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    try {
      this._sendFrame(0x8, Buffer.alloc(0));
      this.socket.end();
    } catch (e) {}
    this._onClose();
  }

  _onClose() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.emit('close');
  }
}

class WebSocketServer extends EventEmitter {
  constructor(httpServer) {
    super();
    this.clients = new Set();

    httpServer.on('upgrade', (req, socket, head) => {
      this._handleUpgrade(req, socket, head);
    });
  }

  _handleUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n'
    ];

    socket.write(responseHeaders.join('\r\n'));

    const ws = new WebSocketClient(socket);
    this.clients.add(ws);

    if (head && head.length > 0) {
      ws._onData(head);
    }

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    this.emit('connection', ws, req);
  }

  broadcast(data, excludeWs = null) {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const client of this.clients) {
      if (client !== excludeWs && client.isOpen) {
        client.send(payload);
      }
    }
  }
}

module.exports = { WebSocketServer, WebSocketClient };
