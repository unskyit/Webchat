// draw.js - Algorithmic Resolution-Independent Canvas Controller

const DrawController = {
  canvas: null, ctx: null, 
  isActive: false, isDrawing: false, currentMode: null,
  color: '#ff0000', width: 3,
  myStrokes: [], peerStrokes: [], 
  activeStrokeId: null, activeStroke: null,
  onSendCommand: null,

  init(canvasId, onSendCommand) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.onSendCommand = onSendCommand;
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    const start = (e) => this.startDraw(this.getPos(e));
    const move = (e) => this.draw(this.getPos(e));
    const end = () => this.endDraw();
    
    this.canvas.addEventListener('mousedown', start);
    this.canvas.addEventListener('mousemove', move);
    this.canvas.addEventListener('mouseup', end);
    this.canvas.addEventListener('mouseout', end);
    this.canvas.addEventListener('touchstart', (e) => { if(this.isActive) e.preventDefault(); start(e.touches[0]); }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => { if(this.isActive) e.preventDefault(); move(e.touches[0]); }, { passive: false });
    this.canvas.addEventListener('touchend', end);
  },

  resize() {
    if(!this.canvas) return;
    const parent = this.canvas.parentElement;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
    this.render(); 
  },

  toggle(state, mode = 'chat') {
    this.isActive = state;
    this.currentMode = state ? mode : null;
    this.canvas.classList.toggle('active', state);
    
    const chatLog = document.getElementById('chat-log');
    if (state && mode === 'canvas') {
      this.canvas.classList.add('solid');
      chatLog.classList.add('fade-out');
    } else {
      this.canvas.classList.remove('solid');
      chatLog.classList.remove('fade-out');
    }
  },

  setColor(hex) { this.color = hex; },

  getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / this.canvas.width, y: (e.clientY - rect.top) / this.canvas.height };
  },

  startDraw(pos) {
    if (!this.isActive) return;
    this.isDrawing = true;
    this.activeStrokeId = Utils.generateId();
    const pt = {x: pos.x, y: pos.y};
    
    this.activeStroke = { id: this.activeStrokeId, c: this.color, w: this.width, p: [pt] };
    this.myStrokes.push(this.activeStroke);
    
    if (this.onSendCommand) {
      this.onSendCommand(JSON.stringify({v: 2, type: Protocol.TYPES.DRAW_START, id: this.activeStrokeId, c: this.color, w: this.width, p: pt}));
    }
  },

  draw(pos) {
    if (!this.isDrawing) return;
    const pt = {x: pos.x, y: pos.y};
    this.activeStroke.p.push(pt);
    
    this.ctx.beginPath();
    const prev = this.activeStroke.p[this.activeStroke.p.length - 2];
    this.ctx.moveTo(prev.x * this.canvas.width, prev.y * this.canvas.height);
    this.ctx.lineTo(pt.x * this.canvas.width, pt.y * this.canvas.height);
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth = this.width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.stroke();

    if (this.onSendCommand) {
       this.onSendCommand(JSON.stringify({v: 2, type: Protocol.TYPES.DRAW_PT, id: this.activeStrokeId, p: pt}));
    }
  },

  endDraw() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
  },

  handleNetworkCommand(msg) {
    if (msg.type === Protocol.TYPES.DRAW_START) {
      const stroke = { id: msg.id, c: msg.c, w: msg.w, p: [msg.p] };
      this.peerStrokes.push(stroke);
    } else if (msg.type === Protocol.TYPES.DRAW_PT) {
      const s = this.peerStrokes.find(st => st.id === msg.id);
      if (s) {
        s.p.push(msg.p);
        this.ctx.beginPath();
        const prev = s.p[s.p.length - 2];
        this.ctx.moveTo(prev.x * this.canvas.width, prev.y * this.canvas.height);
        this.ctx.lineTo(msg.p.x * this.canvas.width, msg.p.y * this.canvas.height);
        this.ctx.strokeStyle = s.c;
        this.ctx.lineWidth = s.w;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.stroke();
      }
    } else if (msg.type === Protocol.TYPES.DRAW_UNDO) {
      this.peerStrokes.pop();
      this.render();
    } else if (msg.type === Protocol.TYPES.DRAW_CLEAR) {
      // Safely wipe the peer strokes that were being drawn live, without touching local drawings
      this.peerStrokes = [];
      this.render();
    }
  },

  download() {
    if (this.myStrokes.length === 0 && this.peerStrokes.length === 0) return;
    const link = document.createElement('a');
    link.download = `Drawing-${Date.now()}.png`;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.canvas.width; tempCanvas.height = this.canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.fillStyle = '#ffffff'; tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tCtx.drawImage(this.canvas, 0, 0);
    
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  },
  
  async share() {
    if (this.myStrokes.length === 0 && this.peerStrokes.length === 0) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.canvas.width; tempCanvas.height = this.canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.fillStyle = '#ffffff'; tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tCtx.drawImage(this.canvas, 0, 0);
    
    tempCanvas.toBlob(async (blob) => {
      const file = new File([blob], `Drawing-${Date.now()}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Shared Drawing' }); } catch (err) { console.error("Share failed:", err); }
      } else {
        alert("Sharing not supported on this device/browser.");
      }
    });
  },

  sendAsMessage(isPeer = false) {
    if (this.myStrokes.length === 0 && this.peerStrokes.length === 0) {
      this.clear(false);
      return;
    }
    const dataUrl = this.canvas.toDataURL('image/png');
    App.renderDrawingMessage(dataUrl, !isPeer);
    
    if (!isPeer && this.onSendCommand) {
        this.onSendCommand(JSON.stringify({v: 2, type: Protocol.TYPES.DRAW_FINISH}));
    }
    
    this.clear(false); 
  },
  
  undo(isSelf) {
    if (isSelf) { this.myStrokes.pop(); if (this.onSendCommand) this.onSendCommand(Protocol.createDrawCommand(Protocol.TYPES.DRAW_UNDO)); }
    this.render();
  },

  clear(isSelf) {
    // Only wipe our unsent strokes.
    this.myStrokes = [];
    this.render();
    this.toggle(false);
    
    // Wipe them from the peer's screen instantly
    if (isSelf && this.onSendCommand) {
        this.onSendCommand(Protocol.createDrawCommand(Protocol.TYPES.DRAW_CLEAR));
    }

    const tb = document.getElementById('draw-toolbar');
    if(tb) {
      tb.classList.add('hidden');
      tb.classList.remove('collapsed');
    }
    document.getElementById('btn-draw-canvas').classList.remove('active-green');
    document.getElementById('btn-draw-chat').classList.remove('active-green');
  },

  render() {
    if(!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const drawPath = (s) => {
      if (!s.p || s.p.length < 2) return;
      this.ctx.beginPath();
      this.ctx.moveTo(s.p[0].x * this.canvas.width, s.p[0].y * this.canvas.height);
      for (let i = 1; i < s.p.length; i++) {
        this.ctx.lineTo(s.p[i].x * this.canvas.width, s.p[i].y * this.canvas.height);
      }
      this.ctx.strokeStyle = s.c;
      this.ctx.lineWidth = s.w;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.stroke();
    };
    this.peerStrokes.forEach(drawPath);
    this.myStrokes.forEach(drawPath);
  }
};
