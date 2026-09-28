// protocol.js - Advanced Data Validation, Structure & Hardware Handlers

const Protocol = {
  VERSION: 2,
  MAX_MESSAGE_LENGTH: 8192,
  SIGNAL_EXPIRATION_MS: 5 * 60 * 1000, 
  IDLE_TIMEOUT_MS: 60 * 60 * 1000, // Extended to 1 hour for large files

  // Message Type Enumeration for strict routing
  TYPES: {
    CHAT: 'chat',
    GHOST: 'ghost',
    RECEIPT: 'receipt', // sent, delivered, seen
    DRAW: 'draw_stroke',
    DRAW_UNDO: 'draw_undo',
    DRAW_CLEAR: 'draw_clear',
    FILE_START: 'file_start',
    FILE_CHUNK: 'file_chunk',
    FILE_END: 'file_end',
    FILE_CANCEL: 'file_cancel',
    SCREEN_OFFER: 'screen_offer',
    SCREEN_ANSWER: 'screen_answer'
  },

  createSignal: (type, sessionId, sdp) => {
    return JSON.stringify({ v: Protocol.VERSION, t: type, i: sessionId, ts: Date.now(), s: sdp });
  },

  validateSignal: (jsonStr, expectedType) => {
    try {
      const data = JSON.parse(jsonStr);
      if (data.v !== Protocol.VERSION || data.t !== expectedType) return null;
      if (typeof data.i !== 'string' || typeof data.s !== 'object') return null;
      if (Date.now() - data.ts > Protocol.SIGNAL_EXPIRATION_MS) throw new Error("ERR_EXPIRED_LINK");
      return data;
    } catch (e) { return null; }
  },

  // 1. Text & Receipts
  createChatMessage: (text) => {
    return JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.CHAT, id: Utils.generateId(), text: text.slice(0, Protocol.MAX_MESSAGE_LENGTH), ts: Date.now() });
  },
  
  createGhostTyping: (text, isTyping) => {
    return JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.GHOST, text: text.slice(0, 500), active: isTyping });
  },

  createReceipt: (msgId, status) => {
    // status: 1 = delivered, 2 = seen
    return JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.RECEIPT, id: msgId, status: status });
  },

  // 2. Vector Drawing
  createDrawStroke: (strokeObj) => {
    // strokeObj: { id: string, color: string, w: number, points: [[x,y], [x,y]] }
    return JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.DRAW, stroke: strokeObj });
  },

  createDrawCommand: (type) => {
    // type: DRAW_UNDO or DRAW_CLEAR
    return JSON.stringify({ v: Protocol.VERSION, type: type });
  },

  // 3. File streaming
  createFileHeader: (file, id) => {
    return JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.FILE_START, id: id, name: file.name, size: file.size, mime: file.type || 'application/octet-stream' });
  },

  // Parses incoming text messages securely
  parsePayload: (jsonStr) => {
    try {
      const data = JSON.parse(jsonStr);
      if (data.v !== Protocol.VERSION) return null;
      return data;
    } catch (e) {
      return null;
    }
  }
};
