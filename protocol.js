// protocol.js - Data structuring, validation, and constants

const Protocol = {
  VERSION: 1,
  MAX_MESSAGE_LENGTH: 4096,
  SIGNAL_EXPIRATION_MS: 5 * 60 * 1000, // 5 minutes
  IDLE_TIMEOUT_MS: 5 * 60 * 1000,      // 5 minutes

  // Creates a strictly formatted signaling payload
  createSignal: (type, sessionId, sdp) => {
    return JSON.stringify({
      v: Protocol.VERSION,
      t: type,            // 'offer' or 'answer'
      i: sessionId,
      ts: Date.now(),
      s: sdp
    });
  },

  // Validates incoming signaling payloads
  validateSignal: (jsonStr, expectedType) => {
    try {
      const data = JSON.parse(jsonStr);
      if (data.v !== Protocol.VERSION) throw new Error("ERR_PROTOCOL_MISMATCH");
      if (data.t !== expectedType) throw new Error("ERR_INVALID_SIGNAL_TYPE");
      if (typeof data.i !== 'string' || typeof data.s !== 'object') throw new Error("ERR_MALFORMED_SIGNAL");
      
      const age = Date.now() - data.ts;
      if (age > Protocol.SIGNAL_EXPIRATION_MS || age < -10000) {
        throw new Error("ERR_EXPIRED_LINK");
      }
      return data;
    } catch (e) {
      console.error("Signal validation failed:", e.message);
      return null;
    }
  },

  // Creates a chat message payload
  createChatMessage: (text) => {
    return JSON.stringify({
      v: Protocol.VERSION,
      type: 'chat',
      id: Utils.generateId(),
      text: text.slice(0, Protocol.MAX_MESSAGE_LENGTH)
    });
  },

  // Validates incoming chat messages
  validateChatMessage: (jsonStr) => {
    try {
      if (jsonStr.length > Protocol.MAX_MESSAGE_LENGTH + 500) throw new Error("ERR_MESSAGE_TOO_LARGE");
      const data = JSON.parse(jsonStr);
      if (data.v !== Protocol.VERSION || data.type !== 'chat') return null;
      if (typeof data.text !== 'string') return null;
      return data;
    } catch (e) {
      return null;
    }
  }
};
