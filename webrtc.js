// webrtc.js
class P2PConnection {
  constructor(appController) {
    this.pc = null; this.dc = null; this.app = appController; this.sessionId = Utils.generateId();
    this.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    this.fileQueue = []; this.isTransferring = false; this.activeTransfer = null;
    this.metrics = { txBytes: 0, rxBytes: 0 };
  }

  _initPC() {
    this.pc = new RTCPeerConnection(this.config);
    this.pc.oniceconnectionstatechange = () => { if (['disconnected', 'failed', 'closed'].includes(this.pc.iceConnectionState)) { this.app.onStateChange("ERR_PEER_DISCONNECTED", "Session disconnected."); this.destroy(); } };
  }

  _setupDataChannel(channel) {
    this.dc = channel; this.dc.binaryType = "arraybuffer"; this.dc.bufferedAmountLowThreshold = 65536 * 4; 
    this.dc.onopen = () => this.app.onStateChange("CONNECTED");
    this.dc.onclose = () => { this.app.onStateChange("CLOSED", "Connection closed."); this.destroy(); };
    this.dc.onmessage = (event) => {
      this.metrics.rxBytes += event.data.byteLength || event.data.length;
      if (typeof event.data === 'string') { const msg = Protocol.parsePayload(event.data); if (msg) this.app.onMessageRouter(msg); } 
      else { this.app.onBinaryChunkReceived(event.data); }
    };
  }

  async _awaitIce() {
    return new Promise(resolve => { if (this.pc.iceGatheringState === 'complete') return resolve(); const check = () => { if (this.pc.iceGatheringState === 'complete') { this.pc.removeEventListener('icegatheringstatechange', check); resolve(); } }; this.pc.addEventListener('icegatheringstatechange', check); setTimeout(resolve, 5000); });
  }

  async generateOffer() { this._initPC(); const channel = this.pc.createDataChannel('main', { ordered: true }); this._setupDataChannel(channel); const offer = await this.pc.createOffer(); await this.pc.setLocalDescription(offer); await this._awaitIce(); return Protocol.createSignal('offer', this.sessionId, this.pc.localDescription); }
  async acceptOfferAndGenerateAnswer(offerSignal) { this.sessionId = offerSignal.i; this._initPC(); this.pc.ondatachannel = (e) => this._setupDataChannel(e.channel); await this.pc.setRemoteDescription(new RTCSessionDescription(offerSignal.s)); const answer = await this.pc.createAnswer(); await this.pc.setLocalDescription(answer); await this._awaitIce(); return Protocol.createSignal('answer', this.sessionId, this.pc.localDescription); }
  async acceptAnswer(answerSignal) { if (answerSignal.i !== this.sessionId) throw new Error("ERR_SESSION_MISMATCH"); await this.pc.setRemoteDescription(new RTCSessionDescription(answerSignal.s)); }
  
  sendPayload(str) { if (!this.dc || this.dc.readyState !== 'open') return false; this.dc.send(str); this.metrics.txBytes += str.length; return true; }

  // Batch ID support added here
  enqueueFiles(files, batchId = null) {
    const total = files.length;
    for (let i = 0; i < total; i++) this.fileQueue.push({ file: files[i], bId: batchId, bTot: total });
    if (!this.isTransferring) this.processFileQueue();
  }

  async processFileQueue() {
    if (this.fileQueue.length === 0) { this.isTransferring = false; return; }
    this.isTransferring = true;
    
    const item = this.fileQueue.shift();
    const fileId = 'f-' + Utils.generateId();
    this.sendPayload(Protocol.createFileHeader(item.file, fileId, item.bId, item.bTot));
    this.app.onFileTransferStart(fileId, item.file.name, item.file.size, true, item.bId);

    const chunkSize = 65536; let offset = 0;
    this.activeTransfer = { id: fileId, aborted: false };
    const sliceRead = (o) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsArrayBuffer(item.file.slice(o, o + chunkSize)); });

    while (offset < item.file.size && !this.activeTransfer.aborted) {
      if (this.dc.bufferedAmount > this.dc.bufferedAmountLowThreshold) await new Promise(r => { this.dc.onbufferedamountlow = () => { this.dc.onbufferedamountlow = null; r(); }; });
      if (this.activeTransfer.aborted) break;
      const chunk = await sliceRead(offset);
      this.dc.send(chunk); this.metrics.txBytes += chunk.byteLength;
      offset += chunk.byteLength; this.app.onFileTransferProgress(fileId, (offset / item.file.size) * 100);
    }

    this.sendPayload(JSON.stringify({ v: Protocol.VERSION, type: this.activeTransfer.aborted ? Protocol.TYPES.FILE_CANCEL : Protocol.TYPES.FILE_END, id: fileId }));
    this.app.onFileTransferComplete(fileId, null, !this.activeTransfer.aborted);
    this.activeTransfer = null; this.processFileQueue();
  }

  cancelActiveTransfer() { if (this.activeTransfer) this.activeTransfer.aborted = true; }
  getMetrics() { return this.metrics; }
  destroy() { if (this.dc) { this.dc.close(); this.dc = null; } if (this.pc) { this.pc.close(); this.pc = null; } }
}
