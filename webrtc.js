// webrtc.js - Core WebRTC and Connection State

class P2PConnection {
  constructor(onStateChange, onMessage) {
    this.pc = null;
    this.dc = null;
    this.sessionId = Utils.generateId();
    this.onStateChange = onStateChange;
    this.onMessage = onMessage;
    this.idleTimer = null;
    this.lastActivity = Date.now();
    
    this.config = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };
  }

  resetIdleTimer() {
    this.lastActivity = Date.now();
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = setInterval(() => {
      if (Date.now() - this.lastActivity > Protocol.IDLE_TIMEOUT_MS) {
        this.onStateChange("ERR_CONNECTION_TIMEOUT", "Room closed due to inactivity.");
        this.destroy();
      }
    }, 30000);
  }

  _initPC() {
    this.pc = new RTCPeerConnection(this.config);
    this.pc.oniceconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(this.pc.iceConnectionState)) {
        this.onStateChange("ERR_PEER_DISCONNECTED", "Your friend disconnected.");
        this.destroy();
      }
    };
  }

  _setupDataChannel(channel) {
    this.dc = channel;
    this.dc.binaryType = "arraybuffer"; 
    this.dc.onopen = () => {
      this.resetIdleTimer();
      this.onStateChange("CONNECTED");
    };
    this.dc.onclose = () => {
      this.onStateChange("CLOSED", "Connection closed.");
      this.destroy();
    };
    this.dc.onmessage = (event) => {
      this.resetIdleTimer();
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          this.onMessage(msg); 
        } catch(e) {}
      } else {
        this.onMessage({ type: 'file_chunk', data: event.data });
      }
    };
  }

  async _awaitIce() {
    return new Promise(resolve => {
      if (this.pc.iceGatheringState === 'complete') return resolve();
      const checkState = () => {
        if (this.pc.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', checkState);
      setTimeout(resolve, 5000); 
    });
  }

  async generateOffer() {
    this._initPC();
    const channel = this.pc.createDataChannel('chat', { ordered: true });
    this._setupDataChannel(channel);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this._awaitIce();
    return Protocol.createSignal('offer', this.sessionId, this.pc.localDescription);
  }

  async acceptOfferAndGenerateAnswer(offerSignal) {
    this.sessionId = offerSignal.i; 
    this._initPC();
    this.pc.ondatachannel = (event) => this._setupDataChannel(event.channel);
    await this.pc.setRemoteDescription(new RTCSessionDescription(offerSignal.s));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this._awaitIce();
    return Protocol.createSignal('answer', this.sessionId, this.pc.localDescription);
  }

  async acceptAnswer(answerSignal) {
    if (answerSignal.i !== this.sessionId) throw new Error("ERR_SESSION_MISMATCH");
    await this.pc.setRemoteDescription(new RTCSessionDescription(answerSignal.s));
  }

  sendMessage(text) {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    const payload = Protocol.createChatMessage(text);
    this.dc.send(payload);
    this.resetIdleTimer();
    return true;
  }

  // FIX: Passes exact file type (mimeType), and supports onComplete callback
  async sendFile(file, onProgress, onComplete) {
    if (!this.dc || this.dc.readyState !== 'open') return;
    const fileId = Utils.generateId();
    
    this.dc.send(JSON.stringify({ 
      type: 'file_start', 
      name: file.name, 
      size: file.size, 
      mimeType: file.type || 'application/octet-stream', 
      id: fileId 
    }));
    
    const chunkSize = 16384;
    let offset = 0;
    
    const readSlice = (o) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file.slice(o, o + chunkSize));
    });

    while (offset < file.size) {
      const chunk = await readSlice(offset);
      while (this.dc.bufferedAmount > 1024 * 1024) { 
        await new Promise(r => setTimeout(r, 50));
      }
      this.dc.send(chunk);
      offset += chunk.byteLength;
      if (onProgress) onProgress(offset / file.size);
    }
    
    this.dc.send(JSON.stringify({ type: 'file_end', id: fileId }));
    if (onComplete) onComplete();
  }

  destroy() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.dc) { this.dc.close(); this.dc = null; }
    if (this.pc) { this.pc.close(); this.pc = null; }
    this.sessionId = null;
  }
}
