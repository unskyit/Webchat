// webrtc.js - WebRTC Backpressure & P2P Engine

class P2PConnection {
  constructor(appController) {
    this.pc = null; 
    this.dc = null;
    this.app = appController;
    this.sessionId = Utils.generateId();
    this.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    
    // Hardware Queues
    this.fileQueue = [];
    this.isTransferring = false;
    this.activeTransfer = null;
    this.metrics = { txBytes: 0, rxBytes: 0 };
  }

  _initPC() {
    this.pc = new RTCPeerConnection(this.config);
    this.pc.oniceconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(this.pc.iceConnectionState)) {
        this.app.onStateChange("ERR_PEER_DISCONNECTED", "Session disconnected.");
        this.destroy();
      }
    };
    // Screen Cast Receiver
    this.pc.ontrack = (event) => {
      if(event.streams && event.streams[0]) this.app.onScreenCastReceived(event.streams[0]);
    };
  }

  _setupDataChannel(channel) {
    this.dc = channel;
    this.dc.binaryType = "arraybuffer"; 
    // SCTP chunk safe threshold limits buffer bloat
    this.dc.bufferedAmountLowThreshold = 65536 * 4; 
    
    this.dc.onopen = () => this.app.onStateChange("CONNECTED");
    this.dc.onclose = () => { this.app.onStateChange("CLOSED", "Connection closed."); this.destroy(); };
    
    this.dc.onmessage = (event) => {
      this.metrics.rxBytes += event.data.byteLength || event.data.length;
      if (typeof event.data === 'string') {
        const msg = Protocol.parsePayload(event.data);
        if (msg) this.app.onMessageRouter(msg); 
      } else {
        this.app.onBinaryChunkReceived(event.data);
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
    const channel = this.pc.createDataChannel('main', { ordered: true });
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

  sendPayload(payloadStr) {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    this.dc.send(payloadStr);
    this.metrics.txBytes += payloadStr.length;
    return true;
  }

  // File Operations & Hardware Chunking
  enqueueFiles(files) {
    for (let i = 0; i < files.length; i++) this.fileQueue.push(files[i]);
    if (!this.isTransferring) this.processFileQueue();
  }

  async processFileQueue() {
    if (this.fileQueue.length === 0) { this.isTransferring = false; return; }
    this.isTransferring = true;
    
    const file = this.fileQueue.shift();
    const fileId = 'f-' + Utils.generateId();
    this.sendPayload(Protocol.createFileHeader(file, fileId));
    this.app.onFileTransferStart(fileId, file.name, file.size, true);

    const chunkSize = 65536; // 64 KB
    let offset = 0;
    this.activeTransfer = { id: fileId, aborted: false };
    
    const sliceRead = (o) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file.slice(o, o + chunkSize));
    });

    while (offset < file.size && !this.activeTransfer.aborted) {
      if (this.dc.bufferedAmount > this.dc.bufferedAmountLowThreshold) {
        await new Promise(resolve => {
          this.dc.onbufferedamountlow = () => { this.dc.onbufferedamountlow = null; resolve(); };
        });
      }
      if (this.activeTransfer.aborted) break;

      const chunk = await sliceRead(offset);
      this.dc.send(chunk);
      this.metrics.txBytes += chunk.byteLength;
      
      offset += chunk.byteLength;
      this.app.onFileTransferProgress(fileId, (offset / file.size) * 100);
    }

    if (this.activeTransfer.aborted) {
      this.sendPayload(JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.FILE_CANCEL, id: fileId }));
      this.app.onFileTransferComplete(fileId, null, false);
    } else {
      this.sendPayload(JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.FILE_END, id: fileId }));
      this.app.onFileTransferComplete(fileId, null, true);
    }
    
    this.activeTransfer = null;
    this.processFileQueue();
  }

  cancelActiveTransfer() {
    if (this.activeTransfer) this.activeTransfer.aborted = true;
  }

  // Screen Casting Trigger
  async toggleScreenCasting() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" }, audio: false });
      const track = stream.getTracks()[0];
      this.pc.addTrack(track, stream);
      
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendPayload(JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.SCREEN_OFFER, s: this.pc.localDescription }));
      
      track.onended = () => { this.pc.getSenders().forEach(s => { if(s.track === track) this.pc.removeTrack(s); }); };
      return true;
    } catch (e) {
      console.warn("Screen cast aborted by user.");
      return false;
    }
  }

  async handleScreenSignal(msg) {
    if (msg.type === Protocol.TYPES.SCREEN_OFFER) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.s));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendPayload(JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.SCREEN_ANSWER, s: this.pc.localDescription }));
    } else if (msg.type === Protocol.TYPES.SCREEN_ANSWER) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.s));
    }
  }

  getMetrics() { return this.metrics; }

  destroy() {
    if (this.dc) { this.dc.close(); this.dc = null; }
    if (this.pc) { this.pc.close(); this.pc = null; }
  }
}
