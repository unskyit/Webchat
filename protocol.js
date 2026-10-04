// protocol.js - Data validation, formatting, and constants

const Protocol = {
  VERSION: 2, 
  MAX_MESSAGE_LENGTH: 8192, 
  SIGNAL_EXPIRATION_MS: 5 * 60 * 1000,
  
  TYPES: { 
    CHAT: 'chat', GHOST: 'ghost', 
    DRAW: 'draw_stroke', DRAW_UNDO: 'draw_undo', DRAW_CLEAR: 'draw_clear', 
    DRAW_START: 'd_st', DRAW_PT: 'd_pt', DRAW_FINISH: 'd_end',
    FILE_START: 'file_start', FILE_CHUNK: 'file_chunk', 
    FILE_END: 'file_end', FILE_CANCEL: 'file_cancel', FILE_ACK: 'file_ack', RECEIPT: 'receipt', 
    SCREEN_OFFER: 'screen_offer', SCREEN_ANSWER: 'screen_answer',
    BATTERY_REQ: 'bat_req', BATTERY_RES: 'bat_res',
    WARN_DISCONNECT: 'warn_dc', CANCEL_DISCONNECT: 'cancel_dc'
  },

  createSignal: (type, sessionId, sdp) => JSON.stringify({ v: Protocol.VERSION, t: type, i: sessionId, ts: Date.now(), s: sdp }),
  
  validateSignal: (jsonStr, expectedType) => { 
    try { 
      const d = JSON.parse(jsonStr); 
      return (d.v === Protocol.VERSION && d.t === expectedType && Date.now() - d.ts <= Protocol.SIGNAL_EXPIRATION_MS) ? d : null; 
    } catch (e) { return null; } 
  },
  
  createChatMessage: (text, replyTo = null) => JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.CHAT, id: Utils.generateId(), text: text.slice(0, Protocol.MAX_MESSAGE_LENGTH), reply: replyTo, ts: Date.now() }),
  createGhostTyping: (text, isTyping) => JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.GHOST, text: text.slice(0, 500), active: isTyping }),
  createDrawCommand: (type) => JSON.stringify({ v: Protocol.VERSION, type: type }),
  createFileHeader: (file, id, bId, bTot) => JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.FILE_START, id: id, name: file.name, size: file.size, mime: file.type || 'application/octet-stream', bId: bId, bTot: bTot }),
  createReceipt: (msgId, status) => JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.RECEIPT, id: msgId, status: status }),
  
  parsePayload: (str) => { 
    try { const d = JSON.parse(str); return d.v === Protocol.VERSION ? d : null; } 
    catch (e) { return null; } 
  }
};
