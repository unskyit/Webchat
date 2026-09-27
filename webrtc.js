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
    
    // Using standard public STUN. No TURN (true P2P).
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
    }, 30000); // check every 30s
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
      const msg = Protocol.validateChatMessage(event.data);
      if (msg) this.onMessage(msg);
    };
  }

  // Returns a promise that resolves when ICE gathering is complete
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
      // Fallback timeout in case STUN takes too long or network is restricted
      setTimeout(resolve, 5000); 
    });
  }

  async generateOffer() {
    this._initPC();
    // Host creates the data channel
    const channel = this.pc.createDataChannel('chat', { ordered: true });
    this._setupDataChannel(channel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this._awaitIce();

    return Protocol.createSignal('offer', this.sessionId, this.pc.localDescription);
  }

  async acceptOfferAndGenerateAnswer(offerSignal) {
    this.sessionId = offerSignal.i; // Adopt host's session ID
    this._initPC();
    
    // Guest waits for data channel from host
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

  destroy() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.dc) { this.dc.close(); this.dc = null; }
    if (this.pc) { this.pc.close(); this.pc = null; }
    this.sessionId = null;
  }
}
