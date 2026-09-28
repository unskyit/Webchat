// draw.js - Algorithmic Resolution-Independent Canvas Controller

const DrawController = {
  canvas: null, ctx: null, 
  isActive: false, isDrawing: false,
  color: '#ff0000', width: 3,
  myStrokes: [], peerStrokes: [], currentPoints: [],
  onSendCommand: null,

  init(canvasId, onSendCommand) {
    this.canvas = document.getElementById(canvasId);
    // FIX: Removed { desynchronized: true } to prevent mobile GPU black-screen rendering bugs
    this.ctx = this.canvas.getContext('2d');
    this.onSendCommand = onSendCommand;
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    const start = (e) => this.startDraw(this.getPos(e));
    const move = (e) => this.draw(this.getPos(e));
    const end = () => this.endDraw();
    
    // Mouse
    this.canvas.addEventListener('mousedown', start);
    this.canvas.addEventListener('mousemove', move);
    this.canvas.addEventListener('mouseup', end);
    this.canvas.addEventListener('mouseout', end);
    // Touch
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

  toggle(state) {
    this.isActive = state;
    this.canvas.classList.toggle('active', state);
  },

  setColor(hex) { this.color = hex; },

  getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    // Calculate proportional vectors (0.0 to 1.0)
    return { x: (e.clientX - rect.left) / this.canvas.width, y: (e.clientY - rect.top) / this.canvas.height };
  },

  startDraw(pos) {
    if (!this.isActive) return;
    this.isDrawing = true;
    this.currentPoints = [pos];
  },

  draw(pos) {
    if (!this.isDrawing) return;
    this.currentPoints.push(pos);
    
    // Immediate local feedback
    this.ctx.beginPath();
    const prev = this.currentPoints[this.currentPoints.length - 2];
    this.ctx.moveTo(prev.x * this.canvas.width, prev.y * this.canvas.height);
    this.ctx.lineTo(pos.x * this.canvas.width, pos.y * this.canvas.height);
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth = this.width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.stroke();
  },

  endDraw() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.currentPoints.length > 1) {
      const stroke = { id: Utils.generateId(), c: this.color, w: this.width, p: this.currentPoints };
      this.myStrokes.push(stroke);
      if (this.onSendCommand) this.onSendCommand(Protocol.createDrawStroke(stroke));
    }
    this.currentPoints = [];
  },

  handleNetworkCommand(msg) {
    if (msg.type === Protocol.TYPES.DRAW) {
      this.peerStrokes.push(msg.stroke);
      this.render();
    } else if (msg.type === Protocol.TYPES.DRAW_UNDO) {
      this.peerStrokes.pop();
      this.render();
    } else if (msg.type === Protocol.TYPES.DRAW_CLEAR) {
      this.peerStrokes = [];
      this.render();
    }
  },
  
  undo(isSelf) {
    if (isSelf) { this.myStrokes.pop(); if (this.onSendCommand) this.onSendCommand(Protocol.createDrawCommand(Protocol.TYPES.DRAW_UNDO)); }
    this.render();
  },

  clear(isSelf) {
    if (isSelf) { this.myStrokes = []; if (this.onSendCommand) this.onSendCommand(Protocol.createDrawCommand(Protocol.TYPES.DRAW_CLEAR)); }
    this.render();
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
