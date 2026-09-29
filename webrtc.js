// webrtc.js
class P2PConnection {
  constructor(appController) {
    this.pc = null; 
    this.dc = null; 
    this.app = appController; 
    this.sessionId = Utils.generateId();
    this.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    this.fileQueue = []; 
    this.isTransferring = false; 
    this.activeTransfer = null;
    this.metrics = { txBytes: 0, rxBytes: 0 };
    
    this.screenStream = null;
    this.screenSender = null;
  }

  _initPC() {
    this.pc = new RTCPeerConnection(this.config);
    this.pc.oniceconnectionstatechange = () => { 
      if (['disconnected', 'failed', 'closed'].includes(this.pc.iceConnectionState)) { 
        this.app.onStateChange("ERR_PEER_DISCONNECTED", "Session disconnected."); 
        this.destroy(); 
      } 
    };
    
    this.pc.ontrack = (event) => {
      if (event.streams && event.streams.length > 0) {
        this.app.onScreenCastReceived(event.streams[0]);
      }
    };
  }

  _setupDataChannel(channel) {
    this.dc = channel; 
    this.dc.binaryType = "arraybuffer"; 
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
      const check = () => { 
        if (this.pc.iceGatheringState === 'complete') { 
          this.pc.removeEventListener('icegatheringstatechange', check); resolve(); 
        } 
      }; 
      this.pc.addEventListener('icegatheringstatechange', check); 
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
    this.pc.ondatachannel = (e) => this._setupDataChannel(e.channel); 
    await this.pc.setRemoteDescription(new RTCSessionDescription(offerSignal.s)); 
    const answer = await this.pc.createAnswer(); 
    await this.pc.setLocalDescription(answer); 
    await this._awaitIce(); 
    return Protocol.createSignal('answer', this.sessionId, this.pc.localDescription); 
  }
  
  async acceptAnswer(answerSignal) { 
    if (answerSignal.i !== this.sessionId) throw new Error("ERR_SESSION_MISMATCH"); 
    
    // FIX: Block consecutive resolution calls to immediately halt "InvalidStateError"
    if (this.pc.signalingState !== 'have-local-offer') return; 
    
    await this.pc.setRemoteDescription(new RTCSessionDescription(answerSignal.s)); 
  }
  
  sendPayload(str) { 
    if (!this.dc || this.dc.readyState !== 'open') return false; 
    this.dc.send(str); 
    this.metrics.txBytes += str.length; 
    return true; 
  }

  async toggleScreenCasting() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert("Screen sharing is not supported on this device/browser.");
      return;
    }
    
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
      if (this.screenSender) {
        this.pc.removeTrack(this.screenSender);
        this.screenSender = null;
      }
      this.sendPayload(JSON.stringify({v: Protocol.VERSION, type: 'screen_stop'}));
      return;
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = this.screenStream.getVideoTracks()[0];
      
      track.onended = () => this.toggleScreenCasting(); 
      
      this.screenSender = this.pc.addTrack(track, this.screenStream);
      
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendPayload(JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.SCREEN_OFFER, sdp: this.pc.localDescription }));
    } catch (e) {
      console.warn("Screen casting failed or cancelled:", e);
    }
  }

  async handleScreenSignal(msg) {
    if (msg.type === Protocol.TYPES.SCREEN_OFFER) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendPayload(JSON.stringify({ v: Protocol.VERSION, type: Protocol.TYPES.SCREEN_ANSWER, sdp: this.pc.localDescription }));
    } else if (msg.type === Protocol.TYPES.SCREEN_ANSWER) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    } else if (msg.type === 'screen_stop') {
      const cont = document.getElementById('media-container');
      if (cont) cont.classList.add('hidden');
      const vid = document.getElementById('remote-screen');
      if (vid && vid.srcObject) vid.srcObject = null;
    }
  }

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
    
    this.app.onFileTransferStart(fileId, item.file.name, item.file.size, true, item.bId, item.file);

    // FIX: Explicitly revert to 16KB to prevent silent truncations on mobile implementations
    const chunkSize = 16384; 
    let offset = 0;
    this.activeTransfer = { id: fileId, aborted: false };

    while (offset < item.file.size && !this.activeTransfer.aborted) {
      if (this.dc.readyState !== 'open') break;

      // FIX: Solid, non-locking polling function
      if (this.dc.bufferedAmount >= this.dc.bufferedAmountLowThreshold) {
        await new Promise(resolve => {
          const check = () => {
            if (this.dc.readyState !== 'open' || this.dc.bufferedAmount <= this.dc.bufferedAmountLowThreshold) resolve();
            else setTimeout(check, 5); 
          };
          check();
        });
      }
      
      if (this.activeTransfer.aborted || this.dc.readyState !== 'open') break;
      
      try {
        const chunk = await item.file.slice(offset, offset + chunkSize).arrayBuffer();
        this.dc.send(chunk); 
        this.metrics.txBytes += chunk.byteLength;
        offset += chunk.byteLength; 
        this.app.onFileTransferProgress(fileId, (offset / item.file.size) * 100);
      } catch (err) {
        console.error("Transmission error: ", err);
        break; 
      }
    }

    if (this.dc.readyState === 'open') {
       this.sendPayload(JSON.stringify({ v: Protocol.VERSION, type: this.activeTransfer.aborted ? Protocol.TYPES.FILE_CANCEL : Protocol.TYPES.FILE_END, id: fileId }));
    }
    
    this.app.onFileTransferComplete(fileId, null, !this.activeTransfer.aborted);
  }
  
  onFileAck(id) {
    if (this.activeTransfer && this.activeTransfer.id === id) {
      this.activeTransfer = null;
      this.processFileQueue(); 
    }
  }

  cancelActiveTransfer() { if (this.activeTransfer) this.activeTransfer.aborted = true; }
  getMetrics() { return this.metrics; }
  destroy() { 
    if (this.dc) { this.dc.close(); this.dc = null; } 
    if (this.pc) { this.pc.close(); this.pc = null; } 
    if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); }
  }
}
