// app.js - Optimized Architecture, Fixes & Hardware Routing

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsBuyfATYfSCgs3dP8CzVtTl1JCrNyibhOypH5lKyB7adpK6pBMUjk69WKruStFLbpwQ/exec"; 
let connection = null;

const Synthesizer = {
  ctx: null,
  init() { if(!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
  playPop() {
    if(!this.ctx || !App.settings.sound) return;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0, this.ctx.currentTime); gain.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 0.05); gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
    osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime + 0.1);
  },
  playSwoosh() {
    if(!this.ctx || !App.settings.sound) return;
    const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type = 'triangle'; osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime + 0.2);
  }
};

const App = {
  container: document.getElementById('app-container'),
  settings: { darkMode: false, useCloud: true, qrChunks: 3, ghostTyping: false, sound: true },
  sessionTimer: null, sessionStartTime: 0,
  metricsInterval: null, lastMetrics: { rxBytes: 0, txBytes: 0 },
  activeIncomingFile: null, activeBatches: {},

  init() {
    // Exact viewport fix for mobile software keyboards
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        document.body.style.height = window.visualViewport.height + 'px';
        const log = document.getElementById('chat-log');
        if(log) log.scrollTop = log.scrollHeight;
      });
    }

    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.view) App.renderState(e.state.view, false);
      else App.renderState('IDLE', false);
    });

    document.getElementById('btn-close-settings').onclick = () => document.getElementById('settings-overlay').classList.add('hidden');
    document.getElementById('toggle-theme').onchange = (e) => { App.settings.darkMode = e.target.checked; document.body.className = App.settings.darkMode ? 'dark-mode' : 'light-mode'; };
    document.getElementById('toggle-sound').onchange = (e) => App.settings.sound = e.target.checked;
    document.getElementById('toggle-ghost').onchange = (e) => App.settings.ghostTyping = e.target.checked;
    document.getElementById('toggle-mode').onchange = (e) => {
      App.settings.useCloud = e.target.checked;
      document.getElementById('mode-desc').textContent = App.settings.useCloud ? "Cloud OTP" : "Manual/QR";
      App.renderState('IDLE', true);
    };

    let savedUsage = JSON.parse(localStorage.getItem('wchat_data') || '{"up":0,"down":0}');
    document.getElementById('data-counter').textContent = `${(savedUsage.up/(1024*1024)).toFixed(2)} MB ⬆ | ${(savedUsage.down/(1024*1024)).toFixed(2)} MB ⬇`;

    App.renderState('IDLE', true);
  },

  renderState(state, pushHistory = true) {
    if (pushHistory) history.pushState({ view: state }, '', `#${state}`);
    App.container.innerHTML = '';
    
    // Header UI Switch
    const headerActions = document.getElementById('header-actions');
    if (state === 'IDLE') {
      if(DrawController) DrawController.clear(false); // Wipe ink on exit
      headerActions.innerHTML = `<button id="btn-settings-head" class="icon-btn"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button>`;
      document.getElementById('btn-settings-head').onclick = () => document.getElementById('settings-overlay').classList.remove('hidden');
      App.buildIdleView();
    }
    else if (state === 'CONNECTED') {
      headerActions.innerHTML = `<button id="btn-end-head" class="btn-danger">End Session</button>`;
      document.getElementById('btn-end-head').onclick = () => { if(connection) connection.destroy(); App.renderState('IDLE'); };
      App.buildChatView();
    }
  },

  buildIdleView() {
    const view = Utils.createElement('div', '', 'view');
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1 class="brand">New Session</h1><p>${App.settings.useCloud ? 'Enter a PIN to connect.' : 'Create an offline room.'}</p>`;

    if (App.settings.useCloud) {
      const inputOTP = Utils.createElement('input', '', 'otp-input'); inputOTP.placeholder = "e.g. secret45";
      const btnHost = Utils.createElement('button', 'Create Room'); btnHost.onclick = () => { if(inputOTP.value) App.hostCloudRoom(inputOTP.value.trim().toLowerCase()); };
      const btnJoin = Utils.createElement('button', 'Join Room', 'secondary'); btnJoin.onclick = () => { if(inputOTP.value) App.joinCloudRoom(inputOTP.value.trim().toLowerCase()); };
      card.appendChild(inputOTP); card.appendChild(btnHost); card.appendChild(btnJoin);
    }
    view.appendChild(card); App.container.appendChild(view);
  },

  async hostCloudRoom(pin) {
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1 class="brand">Room Created</h1><h2 class="otp-input">${pin}</h2><p>Waiting for friend...</p>`;
    App.container.innerHTML = '<div class="view"></div>'; App.container.firstChild.appendChild(card);
    
    connection = new P2PConnection(App);
    try {
      const offerStr = await connection.generateOffer();
      await fetch(APP_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ room: pin, type: 'offer', payload: offerStr }) });
      const poll = setInterval(async () => {
        const res = await fetch(`${APP_SCRIPT_URL}?room=${pin}&type=get_answer`);
        const data = await res.json();
        if (data.payload) { clearInterval(poll); const answerSignal = Protocol.validateSignal(data.payload, 'answer'); if (answerSignal) connection.acceptAnswer(answerSignal); }
      }, 3000);
    } catch(e) { alert("Network failed."); App.renderState('IDLE'); }
  },

  async joinCloudRoom(pin) {
    const card = Utils.createElement('div', '', 'card');
    card.innerHTML = `<h1>Connecting...</h1><p>PIN: ${pin}</p>`;
    App.container.innerHTML = '<div class="view"></div>'; App.container.firstChild.appendChild(card);
    
    connection = new P2PConnection(App);
    try {
      const res = await fetch(`${APP_SCRIPT_URL}?room=${pin}&type=get_offer`);
      const data = await res.json();
      if (!data.payload) throw new Error("Room not found.");
      const answerStr = await connection.acceptOfferAndGenerateAnswer(Protocol.validateSignal(data.payload, 'offer'));
      await fetch(APP_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ room: pin, type: 'answer', payload: answerStr }) });
    } catch(e) { alert(e.message); App.renderState('IDLE'); }
  },

  buildChatView() {
    const tpl = document.getElementById('tpl-chat').content.cloneNode(true);
    App.container.appendChild(tpl);

    // Dice Menu
    const diceBtn = document.getElementById('btn-dice'); const diceMenu = document.getElementById('dice-menu');
    diceBtn.onclick = (e) => { e.stopPropagation(); diceMenu.classList.toggle('active'); };
    document.addEventListener('click', (e) => { if(diceMenu && !diceMenu.contains(e.target) && e.target !== diceBtn) diceMenu.classList.remove('active'); });

    document.getElementById('btn-set-dir').onclick = async () => { diceMenu.classList.remove('active'); const ok = await FileSystem.requestDirectory(); if(ok) document.getElementById('btn-set-dir').style.color = '#10b981'; };
    document.getElementById('btn-screen-cast').onclick = () => { diceMenu.classList.remove('active'); connection.toggleScreenCasting(); };
    document.getElementById('btn-chat-settings').onclick = () => { diceMenu.classList.remove('active'); document.getElementById('settings-overlay').classList.remove('hidden'); };

    // Batch File Input
    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-file').onclick = () => { diceMenu.classList.remove('active'); fileInput.click(); };
    fileInput.onchange = (e) => {
      if(e.target.files.length && connection) {
        const batchId = 'b-' + Utils.generateId();
        App.activeBatches[batchId] = { count: e.target.files.length, current: 0, ui: null };
        
        // Setup Batch UI immediately if > 1 file
        if (e.target.files.length > 1) {
          const log = document.getElementById('chat-log');
          const wrap = Utils.createElement('div', '', 'msg-wrap self'); wrap.id = 'batch-' + batchId;
          wrap.innerHTML = `<div class="msg-bubble batch-folder"><div class="batch-header">📁 Sending ${e.target.files.length} Files <span style="font-size:12px;">▼</span></div><div class="batch-list" id="blist-${batchId}"></div></div>`;
          wrap.querySelector('.batch-header').onclick = (ev) => ev.currentTarget.nextElementSibling.classList.toggle('open');
          log.appendChild(wrap); log.scrollTop = log.scrollHeight;
          App.activeBatches[batchId].ui = document.getElementById(`blist-${batchId}`);
        }
        connection.enqueueFiles(e.target.files, batchId); 
      }
      fileInput.value = ''; 
    };

    // Draw
    DrawController.init('chat-canvas', (cmdStr) => connection.sendPayload(cmdStr));
    const drawToolbar = document.getElementById('draw-toolbar');
    document.getElementById('btn-draw-toggle').onclick = () => { diceMenu.classList.remove('active'); DrawController.toggle(!DrawController.isActive); drawToolbar.classList.toggle('hidden', !DrawController.isActive); };
    document.querySelectorAll('.color-swatch').forEach(el => { el.onclick = () => { document.querySelector('.color-swatch.active').classList.remove('active'); el.classList.add('active'); DrawController.setColor(el.dataset.color); }; });
    document.getElementById('btn-draw-undo').onclick = () => DrawController.undo(true);
    document.getElementById('btn-draw-clear').onclick = () => DrawController.clear(true);
    document.getElementById('btn-draw-close').onclick = () => { DrawController.toggle(false); drawToolbar.classList.add('hidden'); };

    // Input
    const input = document.getElementById('chat-input'); let ghostTimeout;
    input.oninput = () => {
      if (App.settings.ghostTyping && connection) {
        connection.sendPayload(Protocol.createGhostTyping(input.value, true));
        clearTimeout(ghostTimeout); ghostTimeout = setTimeout(() => connection.sendPayload(Protocol.createGhostTyping('', false)), 2000);
      }
    };
    
    const sendMsg = () => {
      const txt = input.value.trim(); if (!txt || !connection) return;
      const msg = Protocol.createChatMessage(txt); connection.sendPayload(msg);
      if(App.settings.ghostTyping) connection.sendPayload(Protocol.createGhostTyping('', false));
      App.renderMessage(JSON.parse(msg), true); Synthesizer.playPop(); input.value = '';
    };
    document.getElementById('btn-send').onclick = sendMsg;
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } };
    
    input.onfocus = () => { setTimeout(() => { const log = document.getElementById('chat-log'); if(log) log.scrollTop = log.scrollHeight; }, 100); };
  },

  onStateChange(status, msg) {
    if (status === 'CONNECTED') {
      Synthesizer.init(); App.renderState('CONNECTED', true); App.startHUD();
    } else if (status === 'ERR_PEER_DISCONNECTED' || status === 'CLOSED') {
      clearInterval(App.sessionTimer); clearInterval(App.metricsInterval);
      document.getElementById('metrics-hud').style.display = 'none';
      alert(msg); App.renderState('IDLE', true);
    }
  },

  startHUD() {
    document.getElementById('metrics-hud').style.display = 'block';
    App.sessionStartTime = Date.now();
    App.sessionTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - App.sessionStartTime) / 1000);
      document.getElementById('session-timer').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    }, 1000);

    App.metricsInterval = setInterval(() => {
      if(!connection) return; const current = connection.getMetrics();
      const diffRx = current.rxBytes - App.lastMetrics.rxBytes; const diffTx = current.txBytes - App.lastMetrics.txBytes;
      document.getElementById('transfer-speed').textContent = `${((diffRx + diffTx) / (1024 * 1024)).toFixed(2)} MB/s`;
      App.lastMetrics = { ...current };
      let usage = JSON.parse(localStorage.getItem('wchat_data') || '{"up":0,"down":0}');
      usage.up += diffTx; usage.down += diffRx; localStorage.setItem('wchat_data', JSON.stringify(usage));
      document.getElementById('data-counter').textContent = `${(usage.up/(1024*1024)).toFixed(2)} MB ⬆ | ${(usage.down/(1024*1024)).toFixed(2)} MB ⬇`;
    }, 1000);
  },

  onMessageRouter(msg) {
    if (msg.type === Protocol.TYPES.CHAT) { App.renderMessage(msg, false); Synthesizer.playSwoosh(); }
    else if (msg.type === Protocol.TYPES.GHOST) {
      const cont = document.getElementById('ghost-typing-container'); const txt = document.getElementById('ghost-text-preview');
      if (msg.active && msg.text) { cont.classList.remove('hidden'); txt.textContent = msg.text; document.getElementById('chat-log').scrollTop = document.getElementById('chat-log').scrollHeight; } 
      else { cont.classList.add('hidden'); txt.textContent = ''; }
    }
    else if ([Protocol.TYPES.DRAW, Protocol.TYPES.DRAW_UNDO, Protocol.TYPES.DRAW_CLEAR].includes(msg.type)) DrawController.handleNetworkCommand(msg);
    else if (msg.type === Protocol.TYPES.FILE_START) App.onIncomingFileStart(msg);
    else if (msg.type === Protocol.TYPES.FILE_END) App.onIncomingFileEnd(msg.id);
    else if (msg.type === Protocol.TYPES.FILE_CANCEL) App.onIncomingFileEnd(msg.id, true);
  },

  renderMessage(msg, isSelf) {
    const log = document.getElementById('chat-log');
    const wrap = Utils.createElement('div', '', `msg-wrap ${isSelf ? 'self' : 'peer'}`);
    wrap.innerHTML = `<div class="msg-bubble">${msg.text}</div><div class="msg-meta">${new Date(msg.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>`;
    log.appendChild(wrap); log.scrollTop = log.scrollHeight;
  },

  async onIncomingFileStart(msg) {
    let stream = null;
    if (FileSystem.sessionFolder) stream = await FileSystem.createWritable(msg.name);
    
    // Auto-create batch folder UI for receiver if batch info exists
    if(msg.bId && msg.bTot > 1 && !App.activeBatches[msg.bId]) {
      App.activeBatches[msg.bId] = { count: msg.bTot, current: 0, ui: null };
      const log = document.getElementById('chat-log');
      const wrap = Utils.createElement('div', '', 'msg-wrap peer'); wrap.id = 'batch-' + msg.bId;
      wrap.innerHTML = `<div class="msg-bubble batch-folder"><div class="batch-header">📁 Receiving ${msg.bTot} Files <span style="font-size:12px;">▼</span></div><div class="batch-list" id="blist-${msg.bId}"></div></div>`;
      wrap.querySelector('.batch-header').onclick = (ev) => ev.currentTarget.nextElementSibling.classList.toggle('open');
      log.appendChild(wrap); log.scrollTop = log.scrollHeight;
      App.activeBatches[msg.bId].ui = document.getElementById(`blist-${msg.bId}`);
    }

    App.activeIncomingFile = { id: msg.id, name: msg.name, size: msg.size, mime: msg.mime, chunks: [], stream: stream, received: 0, bId: msg.bId };
    App.onFileTransferStart(msg.id, msg.name, msg.size, false, msg.bId);
  },

  async onBinaryChunkReceived(buffer) {
    const f = App.activeIncomingFile; if(!f) return;
    f.received += buffer.byteLength;
    if (f.stream) await f.stream.write(buffer); else f.chunks.push(buffer);
    App.onFileTransferProgress(f.id, (f.received / f.size) * 100);
  },

  async onIncomingFileEnd(id, aborted = false) {
    const f = App.activeIncomingFile; if(!f || f.id !== id) return;
    let url = null;
    
    if (f.stream) await f.stream.close();
    else if (!aborted) {
      const blob = new Blob(f.chunks, {type: f.mime});
      url = URL.createObjectURL(blob);
      if(!f.mime.startsWith('image/') && !f.mime.startsWith('video/')) {
        const a = document.createElement('a'); a.href = url; a.download = f.name; a.click();
      }
    }
    App.onFileTransferComplete(id, url, !aborted, f.mime);
    App.activeIncomingFile = null;
  },

  onFileTransferStart(id, name, size, isUpload, batchId = null) {
    const log = document.getElementById('chat-log');
    const boxHTML = `
      <div class="file-row">
        <strong style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:80%;">${name}</strong>
        ${isUpload ? `<button class="btn-cancel" onclick="connection.cancelActiveTransfer()" title="Cancel">✕</button>` : ''}
      </div>
      <div class="file-row"><small>${(size/(1024*1024)).toFixed(2)} MB</small><small id="text-${id}">${isUpload ? 'Sending' : 'Receiving'}...</small></div>
      <div class="file-progress-bg"><div id="prog-${id}" class="file-progress-fill"></div></div>
    `;

    const el = Utils.createElement('div', '', 'msg-bubble file-bubble');
    el.id = 'ui-f-' + id; el.innerHTML = boxHTML;
    
    const target = (batchId && App.activeBatches[batchId]?.ui) ? App.activeBatches[batchId].ui : log;
    
    if (target === log) {
      const wrap = Utils.createElement('div', '', `msg-wrap ${isUpload ? 'self' : 'peer'}`);
      wrap.appendChild(el); target.appendChild(wrap);
    } else {
      el.style.width = '100%'; el.style.border = '1px solid var(--border)'; target.appendChild(el); target.classList.add('open');
    }
    log.scrollTop = log.scrollHeight;
  },

  onFileTransferProgress(id, percent) {
    const bar = document.getElementById(`prog-${id}`); const txt = document.getElementById(`text-${id}`);
    if(bar) bar.style.width = `${percent}%`; if(txt) txt.textContent = `${Math.floor(percent)}%`;
  },

  onFileTransferComplete(id, url, success, mimeType = '') {
    const box = document.getElementById(`ui-f-${id}`);
    if(!box) return;
    const txt = document.getElementById(`text-${id}`); const bar = document.getElementById(`prog-${id}`);
    if(success && bar) bar.style.width = '100%';
    
    if(!success) { if(txt) txt.textContent = '❌ Cancelled'; return; }
    if(txt) txt.textContent = FileSystem.sessionFolder ? 'Saved ✅' : 'Complete ✅';

    const cancelBtn = box.querySelector('.btn-cancel'); if(cancelBtn) cancelBtn.remove();

    // Media Previews
    if (url) {
      if (mimeType.startsWith('image/')) {
        const img = document.createElement('img'); img.src = url; img.className = 'media-preview'; img.onclick = () => window.open(url);
        box.insertBefore(img, box.firstChild);
      } else if (mimeType.startsWith('video/')) {
        const vid = document.createElement('video'); vid.src = url; vid.className = 'media-preview'; vid.controls = true; vid.muted = true;
        box.insertBefore(vid, box.firstChild);
      }
    }
  }
};

window.onload = () => App.init();
