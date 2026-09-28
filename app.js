// app.js - UI Architecture, Ghost Typing, History Routing & App State

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsBuyfATYfSCgs3dP8CzVtTl1JCrNyibhOypH5lKyB7adpK6pBMUjk69WKruStFLbpwQ/exec"; 
let connection = null;

// Audio Synthesizer (Zero Dependency Feedback)
const Synthesizer = {
  ctx: null,
  init() { if(!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
  playPop() {
    if(!this.ctx) return;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
    osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime + 0.1);
  },
  playSwoosh() {
    if(!this.ctx) return;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime + 0.2);
  }
};

const App = {
  container: document.getElementById('app-container'),
  settings: { darkMode: false, useCloud: true, qrChunks: 3, ghostTyping: false },
  sessionTimer: null, sessionStartTime: 0,
  metricsInterval: null, lastMetrics: { rxBytes: 0, txBytes: 0 },
  activeIncomingFile: null,

  init() {
    // History API Setup for Physical Back Button
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.view) App.renderState(e.state.view, false);
      else App.renderState('IDLE', false);
    });

    // PWA & Settings Modals
    document.getElementById('btn-settings').onclick = () => document.getElementById('settings-overlay').classList.remove('hidden');
    document.getElementById('btn-close-settings').onclick = () => document.getElementById('settings-overlay').classList.add('hidden');
    
    document.getElementById('toggle-theme').onchange = (e) => {
      App.settings.darkMode = e.target.checked;
      document.body.className = App.settings.darkMode ? 'dark-mode' : 'light-mode';
    };
    document.getElementById('toggle-ghost').onchange = (e) => App.settings.ghostTyping = e.target.checked;
    
    // Total Data Persistence UI
    let savedUsage = JSON.parse(localStorage.getItem('wchat_data') || '{"up":0,"down":0}');
    document.getElementById('data-counter').textContent = `${(savedUsage.up/(1024*1024)).toFixed(2)} MB ⬆ | ${(savedUsage.down/(1024*1024)).toFixed(2)} MB ⬇`;

    App.renderState('IDLE', true);
  },

  renderState(state, pushHistory = true) {
    if (pushHistory) history.pushState({ view: state }, '', `#${state}`);
    App.container.innerHTML = '';
    
    if (state === 'IDLE') App.buildIdleView();
    else if (state === 'CONNECTED') App.buildChatView();
  },

  onStateChange(status, msg) {
    if (status === 'CONNECTED') {
      Synthesizer.init(); // Init audio on human interaction
      App.renderState('CONNECTED', true);
      App.startHUD();
    } else if (status === 'ERR_PEER_DISCONNECTED' || status === 'CLOSED') {
      clearInterval(App.sessionTimer); clearInterval(App.metricsInterval);
      document.getElementById('metrics-hud').classList.add('hidden');
      alert(msg);
      App.renderState('IDLE', true);
    }
  },

  startHUD() {
    document.getElementById('metrics-hud').classList.remove('hidden');
    App.sessionStartTime = Date.now();
    App.sessionTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - App.sessionStartTime) / 1000);
      document.getElementById('session-timer').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    }, 1000);

    App.metricsInterval = setInterval(() => {
      if(!connection) return;
      const current = connection.getMetrics();
      const diffRx = current.rxBytes - App.lastMetrics.rxBytes;
      const diffTx = current.txBytes - App.lastMetrics.txBytes;
      const speed = (diffRx + diffTx) / (1024 * 1024); // MB/s
      document.getElementById('transfer-speed').textContent = `${speed.toFixed(2)} MB/s`;
      App.lastMetrics = { ...current };
      
      // Update Persistent Storage
      let usage = JSON.parse(localStorage.getItem('wchat_data') || '{"up":0,"down":0}');
      usage.up += diffTx; usage.down += diffRx;
      localStorage.setItem('wchat_data', JSON.stringify(usage));
      document.getElementById('data-counter').textContent = `${(usage.up/(1024*1024)).toFixed(2)} MB ⬆ | ${(usage.down/(1024*1024)).toFixed(2)} MB ⬇`;
    }, 1000);
  },

  buildIdleView() {
    const view = Utils.createElement('div', '', 'view card');
    view.innerHTML = `<h1 class="brand" style="margin-top:20px;">Secure Room</h1><p>Generate a secure room to begin.</p>`;
    const btnHost = Utils.createElement('button', 'Create Network');
    btnHost.onclick = () => { connection = new P2PConnection(App); connection.generateOffer().then(o => console.log(o)); /* Integrate QR/OTP flow here from v1 */ };
    view.appendChild(btnHost);
    App.container.appendChild(view);
  },

  buildChatView() {
    const tpl = document.getElementById('tpl-chat').content.cloneNode(true);
    App.container.appendChild(tpl);

    // Setup Tools
    document.getElementById('btn-end').onclick = () => { connection.destroy(); App.renderState('IDLE'); };
    document.getElementById('btn-set-dir').onclick = async () => {
      const ok = await FileSystem.requestDirectory();
      if(ok) document.getElementById('btn-set-dir').style.color = '#10b981';
    };
    
    document.getElementById('btn-screen-cast').onclick = () => connection.toggleScreenCasting();

    // Drawing Canvas
    DrawController.init('chat-canvas', (cmdStr) => connection.sendPayload(cmdStr));
    const drawToolbar = document.getElementById('draw-toolbar');
    document.getElementById('btn-draw-toggle').onclick = () => {
      DrawController.toggle(!DrawController.isActive);
      drawToolbar.classList.toggle('hidden', !DrawController.isActive);
    };
    document.querySelectorAll('.color-swatch').forEach(el => {
      el.onclick = () => { document.querySelector('.color-swatch.active').classList.remove('active'); el.classList.add('active'); DrawController.setColor(el.dataset.color); };
    });
    document.getElementById('btn-draw-undo').onclick = () => DrawController.undo(true);
    document.getElementById('btn-draw-clear').onclick = () => DrawController.clear(true);
    document.getElementById('btn-draw-close').onclick = () => { DrawController.toggle(false); drawToolbar.classList.add('hidden'); };

    // Chat Inputs & Ghosting
    const input = document.getElementById('chat-input');
    let ghostTimeout;
    input.oninput = () => {
      if (App.settings.ghostTyping && connection) {
        connection.sendPayload(Protocol.createGhostTyping(input.value, true));
        clearTimeout(ghostTimeout);
        ghostTimeout = setTimeout(() => connection.sendPayload(Protocol.createGhostTyping('', false)), 2000);
      }
    };
    
    const sendBtn = document.getElementById('btn-send');
    const sendMsg = () => {
      const txt = input.value.trim();
      if (!txt || !connection) return;
      const msg = Protocol.createChatMessage(txt);
      connection.sendPayload(msg);
      if(App.settings.ghostTyping) connection.sendPayload(Protocol.createGhostTyping('', false));
      App.renderMessage(JSON.parse(msg), true);
      Synthesizer.playPop();
      input.value = '';
    };
    
    sendBtn.onclick = sendMsg;
    // Enter sends, Shift+Enter new line. Does not dismiss mobile keyboard natively in textarea.
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } };

    // File Input Unlimited Queue
    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-file').onclick = () => fileInput.click();
    fileInput.onchange = (e) => { if(e.target.files.length) connection.enqueueFiles(e.target.files); fileInput.value = ''; };

    // Read Receipt Observer
    App.receiptObserver = new IntersectionObserver((entries) => {
      entries.forEach(ent => {
        if (ent.isIntersecting && ent.target.dataset.status === 'deliv') {
          ent.target.dataset.status = 'seen';
          connection.sendPayload(Protocol.createReceipt(ent.target.id, 2));
        }
      });
    }, { root: document.getElementById('chat-log'), threshold: 0.5 });
  },

  onMessageRouter(msg) {
    if (msg.type === Protocol.TYPES.CHAT) {
      App.renderMessage(msg, false);
      connection.sendPayload(Protocol.createReceipt(msg.id, 1)); // Send Delivered state
      Synthesizer.playSwoosh();
    }
    else if (msg.type === Protocol.TYPES.GHOST) App.handleGhost(msg);
    else if (msg.type === Protocol.TYPES.RECEIPT) App.updateReceipt(msg.id, msg.status);
    else if ([Protocol.TYPES.DRAW, Protocol.TYPES.DRAW_UNDO, Protocol.TYPES.DRAW_CLEAR].includes(msg.type)) DrawController.handleNetworkCommand(msg);
    else if (msg.type === Protocol.TYPES.FILE_START) App.onIncomingFileStart(msg);
    else if (msg.type === Protocol.TYPES.FILE_END) App.onIncomingFileEnd(msg.id);
    else if (msg.type === Protocol.TYPES.FILE_CANCEL) App.onIncomingFileEnd(msg.id, true);
    else if (msg.type.startsWith('screen_')) connection.handleScreenSignal(msg);
  },

  renderMessage(msg, isSelf) {
    const log = document.getElementById('chat-log');
    const wrap = Utils.createElement('div', '', `msg-wrap ${isSelf ? 'self' : 'peer'}`);
    wrap.id = msg.id;
    wrap.innerHTML = `
      <div class="msg-bubble">${msg.text}</div>
      <div class="msg-meta">
        ${new Date(msg.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
        ${isSelf ? `<span class="msg-ticks" id="tick-${msg.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </span>` : ''}
      </div>`;
    
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    
    if (!isSelf) {
      wrap.dataset.status = 'deliv';
      App.receiptObserver.observe(wrap);
    }
  },

  handleGhost(msg) {
    const cont = document.getElementById('ghost-typing-container');
    const txt = document.getElementById('ghost-text-preview');
    if (msg.active && msg.text) {
      cont.classList.remove('hidden'); txt.textContent = msg.text;
      document.getElementById('chat-log').scrollTop = document.getElementById('chat-log').scrollHeight;
    } else { cont.classList.add('hidden'); txt.textContent = ''; }
  },

  updateReceipt(id, status) {
    const tick = document.getElementById(`tick-${id}`);
    if(!tick) return;
    if(status === 1) tick.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M18 6l-9 11-4-5"/><path d="M22 6l-9 11"/></svg>'; // Double Grey
    if(status === 2) { tick.classList.add('seen'); } // Double Green injected via CSS
  },

  async onIncomingFileStart(msg) {
    let stream = null;
    if (FileSystem.sessionFolder) stream = await FileSystem.createWritable(msg.name);
    
    App.activeIncomingFile = { id: msg.id, name: msg.name, size: msg.size, chunks: [], stream: stream, received: 0 };
    App.onFileTransferStart(msg.id, msg.name, msg.size, false);
  },

  async onBinaryChunkReceived(buffer) {
    const f = App.activeIncomingFile;
    if(!f) return;
    f.received += buffer.byteLength;
    
    if (f.stream) await f.stream.write(buffer);
    else f.chunks.push(buffer);
    
    App.onFileTransferProgress(f.id, (f.received / f.size) * 100);
  },

  async onIncomingFileEnd(id, aborted = false) {
    const f = App.activeIncomingFile;
    if(!f || f.id !== id) return;
    
    if (f.stream) await f.stream.close();
    else if (!aborted) {
      const blob = new Blob(f.chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = f.name; a.click();
    }
    App.onFileTransferComplete(id, null, !aborted);
    App.activeIncomingFile = null;
  },

  onFileTransferStart(id, name, size, isUpload) {
    const log = document.getElementById('chat-log');
    const box = Utils.createElement('div', '', `msg-wrap ${isUpload ? 'self' : 'peer'}`);
    box.id = 'ui-f-' + id;
    box.innerHTML = `<div class="msg-bubble file-bubble" style="width: 240px;">
      <strong style="display:block; overflow:hidden; text-overflow:ellipsis;">${name}</strong>
      <small>${(size/(1024*1024)).toFixed(2)} MB</small>
      <div style="height:6px; background:var(--border); border-radius:3px; margin-top:8px; overflow:hidden;">
        <div id="prog-${id}" style="height:100%; width:0%; background:var(--primary); transition:width 0.1s;"></div>
      </div>
      <small id="text-${id}" style="display:block; margin-top:4px;">${isUpload ? 'Sending' : 'Receiving'}...</small>
    </div>`;
    log.appendChild(box); log.scrollTop = log.scrollHeight;
  },

  onFileTransferProgress(id, percent) {
    const bar = document.getElementById(`prog-${id}`);
    const txt = document.getElementById(`text-${id}`);
    if(bar) bar.style.width = `${percent}%`;
    if(txt) txt.textContent = `Transferring... ${Math.floor(percent)}%`;
  },

  onFileTransferComplete(id, url, success) {
    const txt = document.getElementById(`text-${id}`);
    const bar = document.getElementById(`prog-${id}`);
    if(success && bar) bar.style.width = '100%';
    if(txt) txt.textContent = success ? (url ? 'Received & Saved ✅' : 'Transfer Complete ✅') : '❌ Cancelled';
  },

  onScreenCastReceived(stream) {
    let video = document.getElementById('remote-screen');
    if (!video) {
      video = document.createElement('video'); video.id = 'remote-screen';
      video.autoplay = true; video.style.width = '100%'; video.style.borderRadius = '12px';
      video.style.marginTop = '10px'; video.style.boxShadow = '0 5px 15px rgba(0,0,0,0.1)';
      document.getElementById('chat-log').appendChild(video);
    }
    video.srcObject = stream;
  }
};
