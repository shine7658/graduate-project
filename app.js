import { GestureRecognizer, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { resetRecordState, markHintTriggered, onGestureSuccess, setCurrentUserId } from "./script.js";

/* ---------------- PWA: register service worker ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW register failed', err));
  });
}

/* ---------------- 閒置時預先載入手勢模型：第一次按「換我試試看」不用再等，也順便存進離線快取 ---------------- */
function preloadModelsWhenIdle(){
  const conn = navigator.connection;
  if(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500));
  idle(() => { ensureRecognizer().catch(() => {}); });
}
if(document.readyState === 'complete') preloadModelsWhenIdle();
else window.addEventListener('load', preloadModelsWhenIdle);

/* ---------------- night-sky background ---------------- */
const starsCanvas = document.getElementById('stars');
const sctx = starsCanvas.getContext('2d');
function sizeStars(){ starsCanvas.width = innerWidth; starsCanvas.height = innerHeight; }
sizeStars();
addEventListener('resize', sizeStars);
const starField = Array.from({length:70}, () => ({ x: Math.random(), y: Math.random(), r: Math.random()*1.4+0.3, tw: Math.random()*Math.PI*2 }));
function drawStars(t){
  sctx.clearRect(0,0,starsCanvas.width, starsCanvas.height);
  sctx.fillStyle = '#FDF6E8';
  for(const s of starField){
    const alpha = 0.25 + 0.55*Math.abs(Math.sin(t/1400 + s.tw));
    sctx.globalAlpha = alpha;
    sctx.beginPath();
    sctx.arc(s.x*starsCanvas.width, s.y*starsCanvas.height, s.r, 0, Math.PI*2);
    sctx.fill();
  }
  sctx.globalAlpha = 1;
  requestAnimationFrame(drawStars);
}
requestAnimationFrame(drawStars);

/* ---------------- sound (chime + speech) ---------------- */
let soundOn = true;
document.getElementById('sound-toggle').onclick = (e) => {
  soundOn = !soundOn;
  e.currentTarget.textContent = soundOn ? '🔊' : '🔇';
};
let audioCtx = null;
function getAudioCtx(){
  if(!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(AC) audioCtx = new AC();
  }
  if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
document.addEventListener('pointerdown', () => { try{ getAudioCtx(); }catch(e){} }, { once:true });

function playChime(){
  if(!soundOn) return;
  try{
    const ctx = getAudioCtx();
    if(!ctx) return;
    const now = ctx.currentTime;
    [523.25,659.25,783.99].forEach((f,i)=>{
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type='sine'; o.frequency.value=f;
      g.gain.setValueAtTime(0.0001, now+i*0.12);
      g.gain.linearRampToValueAtTime(0.25, now+i*0.12+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now+i*0.12+0.35);
      o.connect(g); g.connect(ctx.destination);
      o.start(now+i*0.12); o.stop(now+i*0.12+0.4);
    });
  }catch(e){}
}
const PRAISES = ['太棒了！','你做到了！','好棒喔！','成功了！','真厲害！'];
function speak(text){
  if(!soundOn) return;
  try{
    if(!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang='zh-TW'; u.rate=0.95; u.pitch=1.15;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }catch(e){}
}
function burst(layerId){
  const layer = document.getElementById(layerId);
  layer.innerHTML = '';
  const emojis = ['⭐','✨','🎉','💛'];
  for(let i=0;i<12;i++){
    const p = document.createElement('span');
    p.className = 'burst-particle';
    p.textContent = emojis[Math.floor(Math.random()*emojis.length)];
    const angle = Math.random()*Math.PI*2;
    const dist = 90 + Math.random()*90;
    p.style.setProperty('--bx', Math.cos(angle)*dist + 'px');
    p.style.setProperty('--by', Math.sin(angle)*dist + 'px');
    p.style.setProperty('--br', (Math.random()*360-180)+'deg');
    p.style.animationDelay = (Math.random()*0.15)+'s';
    layer.appendChild(p);
  }
}

/* ---------------- hand skeleton connections ---------------- */
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];
let showSkeleton = true;

/* ---------------- mission data ---------------- */
const MISSIONS = [
  { id:1, name:'招手掰掰', otTag:'揮手（不要／再見）', gesture:'Open_Palm', glyph:'🖐️', animal:'🐘',
    title:'大象耳朵飛起來', lead:'你張開手掌，就像大象揮動大耳朵，可以用來說「掰掰」或「不要」喔。',
    demoHint:'張開手掌，輕輕搖一搖', tip:'可輕握孩子的手腕，帶他張開手掌揮一揮，成功立刻稱讚他。',
    demo:{ type:'static', pose:'Open_Palm' }, steps:['手掌打開','五指張開'],
    hints:['把手掌打開，五根手指都張開喔','手舉高一點，手掌對著鏡頭'] },
  { id:2, name:'指指看', otTag:'指物（要求關注）', gesture:'Pointing_Up', glyph:'☝️', animal:'🐦',
    title:'小鳥啄米指指手', lead:'伸出食指指向東西，是寶寶最早學會表達需求的手勢之一。',
    demoHint:'伸出一根手指指指看', tip:'牽著孩子的手，帶他伸出食指指向他想要的物品。',
    demo:{ type:'static', pose:'Pointing_Up' }, steps:['其他手指收起來','伸出食指'],
    hints:['只伸出一根食指，其他手指收起來','食指往上指，像在指天花板'] },
  { id:3, name:'大拇哥讚', otTag:'表達需求（我要）', gesture:'Thumb_Up', glyph:'👍', animal:'👍',
    title:'大拇哥比讚讚', lead:'豎起大拇指，可以用來代替「我要」，減少用哭鬧表達需求。',
    demoHint:'握拳，豎起大拇指', tip:'握住孩子的手，協助他豎起大拇指，可搭配「讚」的口語。',
    demo:{ type:'static', pose:'Thumb_Up' }, steps:['先握拳','豎起大拇指'],
    hints:['先握拳，再把大拇指豎起來','大拇指往上，其他四根手指握緊'] },
  { id:4, name:'小手握拳', otTag:'抓握手勢', gesture:'Closed_Fist', glyph:'✊', animal:'🐶',
    title:'小狗握緊拳頭鼻', lead:'握緊拳頭是抓握動作的基礎，也是許多精細動作的起點。',
    demoHint:'把五根手指握起來', tip:'陪孩子一起握緊拳頭，可以搭配兒歌增加趣味。',
    demo:{ type:'static', pose:'Closed_Fist' }, steps:['五根手指','全部握起來'],
    hints:['把五根手指都握起來，像握著小球','握緊一點，讓手指靠近手掌'] },
  { id:5, name:'勝利手勢', otTag:'社交手勢延伸', gesture:'Victory', glyph:'✌️', animal:'🐰',
    title:'兔子耳朵比 YA', lead:'比出兔子耳朵，是孩子很喜歡的社交手勢，常搭配拍照使用。',
    demoHint:'比出兩根手指，像兔耳朵', tip:'可先示範比出兩根手指，再引導孩子模仿一次。',
    demo:{ type:'static', pose:'Victory' }, steps:['伸出食指和中指','其他收起來'],
    hints:['伸出食指和中指，像兔子耳朵','另外三根手指收好，兩根手指分開一點'] },
];

let starsEarned = new Set();
let sessionLog = [];
let currentIndex = 0;

/* ---------------- progress persistence ---------------- */
const STORE_KEY = 'shadow-hand-missions:progress:v1';
const MAX_LOG = 300;
function saveProgress(){
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify({
      stars: [...starsEarned],
      log: sessionLog.slice(-MAX_LOG).map(l => ({ id:l.id, name:l.name, time:l.time.toISOString() }))
    }));
  }catch(e){}
}
function loadProgress(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return;
    const d = JSON.parse(raw);
    starsEarned = new Set((d.stars || []).filter(id => MISSIONS.some(m => m.id === id)));
    sessionLog = (d.log || [])
      .map(l => ({ id:l.id, name:l.name, time:new Date(l.time) }))
      .filter(l => !isNaN(l.time) && MISSIONS.some(m => m.name === l.name));
  }catch(e){}
}
loadProgress();

/* ---------------- 示範動畫 ---------------- */
const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;

const FINGER_BASE = { index:[-0.50,-1.00], middle:[-0.17,-1.08], ring:[0.16,-1.02], pinky:[0.46,-0.90] };
const FINGER_LEN  = { index:[0.50,0.30,0.25], middle:[0.55,0.33,0.26], ring:[0.50,0.30,0.25], pinky:[0.40,0.22,0.20] };
const FLEX = [75, 160, 215].map(d => d * DEG);
const FINGER_NAMES = ['index','middle','ring','pinky'];
const THUMB_BASE = [-0.30, -0.15];

function fingerPoints(name, curl, spreadDeg){
  const [bx, by] = FINGER_BASE[name], L = FINGER_LEN[name];
  const a = spreadDeg * DEG, dx = Math.sin(a), dy = -Math.cos(a);
  const pts = [[bx, by]];
  let x = bx, y = by;
  for(let i = 0; i < 3; i++){
    const len = L[i] * Math.cos(FLEX[i] * curl);
    x += dx * len; y += dy * len;
    pts.push([x, y]);
  }
  return pts;
}
function handLandmarks(pose){
  const lm = [[0, 0], THUMB_BASE, ...pose.thumb];
  FINGER_NAMES.forEach((n, i) => lm.push(...fingerPoints(n, pose.curl[i], pose.spread[i])));
  return lm;
}
const HAND_POSES = {
  relaxed:     { thumb:[[-0.48,-0.40],[-0.55,-0.62],[-0.55,-0.82]], curl:[0.45,0.45,0.45,0.45], spread:[-4,0,3,6] },
  Open_Palm:   { thumb:[[-0.60,-0.40],[-0.82,-0.58],[-0.98,-0.76]], curl:[0,0,0,0],             spread:[-8,-2,4,12] },
  Pointing_Up: { thumb:[[-0.20,-0.42],[0.02,-0.52],[0.20,-0.45]],   curl:[0,1,1,1],             spread:[0,0,0,0] },
  Thumb_Up:    { thumb:[[-0.58,-0.60],[-0.76,-1.10],[-0.86,-1.52]], curl:[1,1,1,1],             spread:[0,0,0,0] },
  Closed_Fist: { thumb:[[-0.18,-0.45],[0.08,-0.60],[0.30,-0.55]],   curl:[1,1,1,1],             spread:[0,0,0,0] },
  Victory:     { thumb:[[-0.20,-0.42],[0.02,-0.50],[0.20,-0.42]],   curl:[0,0,1,1],             spread:[-12,10,0,0] },
};
function lerpPose(a, b, t){
  return {
    thumb:  a.thumb.map((p, i) => [lerp(p[0], b.thumb[i][0], t), lerp(p[1], b.thumb[i][1], t)]),
    curl:   a.curl.map((v, i) => lerp(v, b.curl[i], t)),
    spread: a.spread.map((v, i) => lerp(v, b.spread[i], t)),
  };
}

const PALM_OUTLINE = [[-0.32,0.05],[-0.44,-0.25],[-0.56,-1.00],[-0.17,-1.12],[0.16,-1.06],[0.52,-0.90],[0.34,0.05]];
const FINGER_WIDTH = [0.20, 0.21, 0.20, 0.17];
const SIL_FILL = '#3F5088', SIL_EDGE = '#8FA0D6';
const DEMO_CREAM = 'rgba(253,246,232,0.92)';
const DEMO_GOLD  = 'rgba(245,169,63,1)';

function tx(p, pl){
  const X = pl.mirror ? -p[0] : p[0], c = Math.cos(pl.rot || 0), s = Math.sin(pl.rot || 0);
  return [pl.ox + (X * c - p[1] * s) * pl.scale, pl.oy + (X * s + p[1] * c) * pl.scale];
}
function drawHandFigure(ctx, lm, pl, H){
  const palm = PALM_OUTLINE.map(p => tx(p, pl));
  const strokes = FINGER_NAMES.map((n, i) => ({ pts:[5+i*4, 6+i*4, 7+i*4, 8+i*4].map(k => tx(lm[k], pl)), w:FINGER_WIDTH[i] * pl.scale }));
  strokes.push({ pts:[1, 2, 3, 4].map(k => tx(lm[k], pl)), w:0.28 * pl.scale });
  const path = (pts, close) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if(close) ctx.closePath(); };
  const pass = (extra, color) => {
    ctx.save();
    ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 0.14 * pl.scale + extra; path(palm, true); ctx.fill(); ctx.stroke();
    for(const s of strokes){ ctx.lineWidth = s.w + extra; path(s.pts, false); ctx.stroke(); }
    ctx.restore();
  };
  pass(H * 0.018, SIL_EDGE);
  pass(0, SIL_FILL);

  const pts = lm.map(p => tx(p, pl));
  ctx.save();
  ctx.strokeStyle = DEMO_CREAM; ctx.lineWidth = Math.max(1.5, H * 0.011); ctx.lineCap = 'round';
  for(const [a, b] of HAND_CONNECTIONS){ ctx.beginPath(); ctx.moveTo(pts[a][0], pts[a][1]); ctx.lineTo(pts[b][0], pts[b][1]); ctx.stroke(); }
  pts.forEach((p, i) => {
    const tip = [4, 8, 12, 16, 20].includes(i);
    ctx.beginPath(); ctx.arc(p[0], p[1], H * (tip ? 0.022 : 0.012), 0, Math.PI * 2);
    ctx.fillStyle = tip ? DEMO_GOLD : DEMO_CREAM; ctx.fill();
  });
  ctx.restore();
}
function glow(ctx, x, y, r, alpha){
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(245,169,63,${alpha})`); g.addColorStop(1, 'rgba(245,169,63,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function holdCurve(p){
  if(p < 0.15) return 0;
  if(p < 0.40) return easeInOut((p - 0.15) / 0.25);
  if(p < 0.85) return 1;
  return 1 - easeInOut((p - 0.85) / 0.15);
}
const DEMO_CYCLE_MS = 3400;

function renderDemo(ctx, H, m, t){
  ctx.clearRect(0, 0, H, H);
  const k = holdCurve((t % DEMO_CYCLE_MS) / DEMO_CYCLE_MS);
  const lm = handLandmarks(lerpPose(HAND_POSES.relaxed, HAND_POSES[m.demo.pose], k));
  if(k === 1) glow(ctx, H/2, H*0.48, H*0.44, 0.16 + 0.05 * Math.sin(t / 180));
  drawHandFigure(ctx, lm, { ox:H/2, oy:H*0.90, scale:H*0.34, rot:0, mirror:false }, H);
}

const demoCanvasBig  = document.getElementById('demo-canvas');
const demoCanvasMini = document.getElementById('mini-demo');
let demoCanvas = null, demoCtx = null, demoSize = 0, demoMission = null;
let demoRaf = null, demoT0 = 0, onDemoCycleEnd = null;

function setDemoTarget(canvas, mission){
  if(demoRaf) cancelAnimationFrame(demoRaf);
  demoRaf = null; onDemoCycleEnd = null;
  demoCanvas = (canvas && mission) ? canvas : null;
  demoMission = mission || null;
  if(!demoCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  const css = Math.round(demoCanvas.getBoundingClientRect().width) || demoCanvas.clientWidth || 96;
  demoSize = css;
  demoCanvas.width = Math.round(css * dpr); demoCanvas.height = Math.round(css * dpr);
  demoCtx = demoCanvas.getContext('2d');
  demoCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  demoT0 = performance.now();
  demoRaf = requestAnimationFrame(demoTick);
}
function restartDemo(){ setDemoTarget(demoCanvas, demoMission); }
function demoTick(now){
  if(!demoCanvas) return;
  demoRaf = requestAnimationFrame(demoTick);
  const t = now - demoT0;
  renderDemo(demoCtx, demoSize, demoMission, t);
  if(onDemoCycleEnd && t >= DEMO_CYCLE_MS){
    const cb = onDemoCycleEnd; onDemoCycleEnd = null; cb();
  }
}

/* ---------------- screen navigation ---------------- */
const screens = {};
document.querySelectorAll('.screen').forEach(s => screens[s.id] = s);
function showScreen(id){
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[id].classList.add('active');
  if(id !== 'screen-play') stopCamera();
  if(id === 'screen-demo') setDemoTarget(demoCanvasBig, MISSIONS[currentIndex]);
  else if(id === 'screen-play') setDemoTarget(demoCanvasMini, currentMission);
  else setDemoTarget(null, null);
}

const childIdInput = document.getElementById('child-id-input');
const savedChildId = localStorage.getItem('current_child_id');
if (savedChildId && childIdInput) {
  childIdInput.value = savedChildId;
}

document.getElementById('btn-enter').onclick = () => {
  const val = childIdInput.value.trim().toUpperCase();
  if (!val) {
    alert('請先輸入兒童編號再開始練習喔！');
    childIdInput.focus();
    return;
  }
  setCurrentUserId(val);
  goToDemo(currentIndex);
};
// 切換個案清空按鈕
document.getElementById('btn-clear-id').onclick = () => {
  childIdInput.value = '';
  localStorage.removeItem('current_child_id');
  childIdInput.focus();
};

// 第3階段提示時的「先跳過這題」功能（不計入星星，直接進入下一題示範）
document.getElementById('hint-skip-mission').onclick = () => {
  stopCamera();
  const next = currentIndex + 1;
  if(next >= MISSIONS.length){
    showScreen('screen-complete');
    burst('burst-layer-2');
  } else {
    goToDemo(next);
  }
};
function openParentPanel(){ renderParentPanel(); showScreen('screen-parent'); }

(function setupParentGate(){
  const link = document.getElementById('btn-open-parent');
  const HOLD = 1200;
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; link.classList.remove('pressing'); };
  link.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    link.classList.add('pressing');
    timer = setTimeout(() => { cancel(); openParentPanel(); }, HOLD);
  });
  ['pointerup','pointerleave','pointercancel'].forEach(ev => link.addEventListener(ev, cancel));
  link.addEventListener('contextmenu', e => e.preventDefault());
})();

document.getElementById('btn-parent-back').onclick = () => showScreen('screen-start');
document.getElementById('btn-complete-to-parent').onclick = openParentPanel;
document.getElementById('btn-restart').onclick = () => {
  starsEarned = new Set(); currentIndex = 0;
  saveProgress();
  showScreen('screen-start');
};
document.getElementById('btn-clear-log').onclick = () => {
  if(!confirm('確定要清除所有練習紀錄與星星嗎？此動作無法復原。')) return;
  starsEarned = new Set(); sessionLog = []; currentIndex = 0;
  saveProgress();
  renderParentPanel();
};

/* ---------------- demo screen ---------------- */
function renderDots(activeIdx){
  const dots = document.getElementById('demo-dots');
  dots.innerHTML = '';
  MISSIONS.forEach((m,i) => {
    const d = document.createElement('span');
    if(starsEarned.has(m.id)) d.className = 'done';
    if(i === activeIdx) d.className += ' current';
    dots.appendChild(d);
  });
}
const demoSeen = new Set();
function goToDemo(index){
  currentIndex = index;
  const m = MISSIONS[index];
  document.getElementById('demo-glyph').textContent = m.glyph;
  document.getElementById('demo-name').textContent = m.name;
  document.getElementById('demo-hint').textContent = m.demoHint;
  document.getElementById('demo-steps').innerHTML = m.steps.map((t, i) => `<span>${i+1} ${t}</span>`).join('');
  renderDots(index);
  showScreen('screen-demo');
  armDemoGate(m);
  speak('看我做一次。' + m.demoHint);
}
function armDemoGate(m){
  const btn = document.getElementById('btn-my-turn');
  const bar = document.getElementById('demo-progress');
  bar.classList.remove('run'); void bar.offsetWidth;
  if(demoSeen.has(m.id)){
    btn.disabled = false; btn.textContent = '換我試試看'; bar.style.visibility = 'hidden';
    return;
  }
  btn.disabled = true; btn.textContent = '看我做一次…'; bar.style.visibility = 'visible';
  bar.style.setProperty('--demo-ms', DEMO_CYCLE_MS + 'ms');
  bar.classList.add('run');
  onDemoCycleEnd = () => {
    demoSeen.add(m.id);
    btn.disabled = false; btn.textContent = '換我試試看';
    bar.style.visibility = 'hidden';
  };
}
document.getElementById('btn-replay').onclick = () => {
  restartDemo();
  armDemoGate(MISSIONS[currentIndex]);
  speak(MISSIONS[currentIndex].demoHint);
};
document.getElementById('btn-my-turn').onclick = () => startMission(MISSIONS[currentIndex]);
document.getElementById('btn-see-demo-again').onclick = () => goToDemo(currentIndex);
document.getElementById('hint-back-demo').onclick = () => goToDemo(currentIndex);

document.getElementById('btn-next-mission').onclick = () => {
  const next = currentIndex + 1;
  if(next >= MISSIONS.length){
    showScreen('screen-complete');
    burst('burst-layer-2');
  } else {
    goToDemo(next);
  }
};

/* ---------------- parent panel ---------------- */
function renderParentPanel(){
  const grid = document.getElementById('parent-mission-grid');
  grid.innerHTML = '';
  MISSIONS.forEach((m,i) => {
    const card = document.createElement('button');
    card.className = 'mission-card' + (starsEarned.has(m.id) ? ' done' : '');
    card.innerHTML = `
      <span class="star">⭐</span>
      <span class="glyph">${m.glyph}</span>
      <span class="m-name">${m.name}</span>
      <span class="ot-tag">${m.otTag}</span>
    `;
    card.onclick = () => { goToDemo(i); };
    grid.appendChild(card);
  });

  const logEl = document.getElementById('parent-log');
  if(sessionLog.length === 0){
    logEl.textContent = '尚未開始練習';
  } else {
    const todayStr = new Date().toDateString();
    const today = sessionLog.filter(l => l.time.toDateString() === todayStr);
    const days = new Set(sessionLog.map(l => l.time.toDateString())).size;
    const todayHtml = today.length
      ? today.map(l => `<span class="ok">✔</span> ${l.name} ${l.time.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`).join('<br>')
      : '今天還沒有練習';
    logEl.innerHTML = `${todayHtml}<br><br><span style="color:var(--gold-soft)">累計：共完成 ${sessionLog.length} 次練習，分佈在 ${days} 天</span>`;
  }
}

/* ---------------- camera + gesture recognition ---------------- */
const video = document.getElementById('video');
const camCanvas = document.getElementById('cam-canvas');
const camCtx = camCanvas.getContext('2d');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const loadingSpinner = document.getElementById('loading-spinner');
const btnRetry = document.getElementById('btn-retry');
const hintBanner = document.getElementById('hint-banner');

let gestureRecognizer = null;
let recognizerLoading = null;
let rafId = null;
let stream = null;
let holdStart = null;
let currentMission = null;
const HOLD_MS = 1000;
const SCORE_THRESHOLD = 0.42;

btnRetry.onclick = () => startCamera();
document.getElementById('btn-exit-play').onclick = () => showScreen('screen-start');
document.getElementById('btn-skeleton-toggle').onclick = (e) => {
  showSkeleton = !showSkeleton;
  e.currentTarget.classList.toggle('off', !showSkeleton);
};

const GESTURE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const WASM_URL          = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

let visionFilesetPromise = null;
function getVisionFileset(){
  if(!visionFilesetPromise){
    visionFilesetPromise = FilesetResolver.forVisionTasks(WASM_URL)
      .catch(e => { visionFilesetPromise = null; throw e; });
  }
  return visionFilesetPromise;
}

async function createWithFallback(factory){
  try{ return await factory('GPU'); }
  catch(e){
    console.warn('GPU delegate 失敗，改用 CPU', e);
    return await factory('CPU');
  }
}

async function ensureRecognizer(){
  if(gestureRecognizer) return gestureRecognizer;
  if(recognizerLoading) return recognizerLoading;
  recognizerLoading = (async () => {
    const vision = await getVisionFileset();
    gestureRecognizer = await createWithFallback((delegate) =>
      GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: 1
      })
    );
    return gestureRecognizer;
  })().catch(e => { recognizerLoading = null; throw e; });
  return recognizerLoading;
}

function startMission(m){
  currentMission = m;
  currentMatchScore = 0;
  resetRecordState();
  document.getElementById('target-glyph').textContent = m.glyph;
  document.getElementById('target-name').textContent = m.name;
  setMsg('把手放進畫面裡，跟著做做看');
  hideHint();
  setHoldProgress(0);
  showScreen('screen-play');
  startCamera();
}

let camSession = 0;

async function startCamera(){
  const session = ++camSession;
  loadingOverlay.classList.remove('hidden');
  loadingSpinner.style.display = 'block';
  btnRetry.style.display = 'none';
  loadingText.textContent = '正在開啟鏡頭與載入手勢辨識模型，第一次載入約需幾秒鐘…';

  try{
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:'user', width:640, height:480 },
      audio:false
    });
    if(session !== camSession){ s.getTracks().forEach(t => t.stop()); return; }
    stream = s;
    video.srcObject = s;
    await video.play();
    if(session !== camSession) return;
    await ensureRecognizer();
    if(session !== camSession) return;

    camCanvas.width = video.videoWidth || 480;
    camCanvas.height = video.videoHeight || 640;
    loadingOverlay.classList.add('hidden');
    holdStart = null;
    lastDetectAt = 0; lastVideoTime = -1; lastHandLms = null;
    setHoldProgress(0);
    resetHints();
    loop();
  }catch(err){
    if(session !== camSession) return;
    loadingSpinner.style.display = 'none';
    btnRetry.style.display = 'inline-block';
    if(err && err.name === 'NotAllowedError'){
      loadingText.innerHTML = '<span class="err">沒有取得鏡頭權限</span><br>請允許瀏覽器使用鏡頭，才能開始練習手勢喔。';
    } else if(err && err.name === 'NotFoundError'){
      loadingText.innerHTML = '<span class="err">找不到鏡頭</span><br>請確認裝置有前鏡頭，且沒有被其他程式佔用。';
    } else {
      loadingText.innerHTML = '<span class="err">鏡頭或辨識模型載入失敗</span><br>請確認網路連線正常，再按「再試一次」。';
    }
    console.error(err);
  }
}

function stopCamera(){
  camSession++;
  if(rafId) cancelAnimationFrame(rafId);
  rafId = null;
  hideHint();
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
}

let resumeAfterVisible = false;
document.addEventListener('visibilitychange', () => {
  const playing = screens['screen-play'].classList.contains('active');
  if(document.hidden){
    if(playing){ resumeAfterVisible = true; stopCamera(); }
  } else if(resumeAfterVisible){
    resumeAfterVisible = false;
    if(playing) startCamera();
  }
});

function setHoldProgress(p){
  const ring = document.getElementById('hold-ring-fg');
  const circumference = 113;
  ring.style.strokeDashoffset = String(circumference * (1-p));
}

const msgEl = document.getElementById('play-msg');
function setMsg(text){ if(msgEl.textContent !== text) msgEl.textContent = text; }

/* ---------------- 分階段提示 ---------------- */
const HINT_AT_MS = [8000, 18000, 30000];
const UNSEEN_AFTER_MS = 3000;
let hintLevel = 0, lastProgressAt = 0, lastSeenAt = 0, lastHintKey = null;
const hintTitleEl = document.getElementById('hint-title');
const hintTextEl  = document.getElementById('hint-text');
const miniDemoWrap = document.getElementById('mini-demo-wrap');

function hideHint(){
  hintLevel = 0;
  hintBanner.classList.remove('show', 'lv1', 'lv2', 'lv3');
  miniDemoWrap.classList.remove('attention');
}
function resetHints(){
  const now = performance.now();
  lastProgressAt = now; lastSeenAt = now; lastHintKey = null;
  hideHint();
}
function hintFor(level, unseen){
  const m = currentMission;
  if(unseen){
    const base = '我看不到你的手喔，把手舉到圈圈裡面';
    return level === 3 ? { title:'家長小幫手', text: base + '（可以協助調整鏡頭位置與光線）' }
                       : { title:'小提示', text: base };
  }
  if(level === 3) return { title:'家長小幫手', text: m.tip };
  return { title: level === 1 ? '小提示' : '再試試看', text: m.hints[level - 1] };
}
function checkHints(now){
  const idle = now - lastProgressAt;
  if (idle >= 10000) markHintTriggered();
  let level = 0;
  HINT_AT_MS.forEach((ms, i) => { if(idle >= ms) level = i + 1; });
  const unseen = (now - lastSeenAt) > UNSEEN_AFTER_MS;
  const key = level + (unseen ? 'u' : 'n');
  if(level === 0 || key === lastHintKey) return;
  lastHintKey = key;
  hintLevel = level;
  const h = hintFor(level, unseen);
  hintTitleEl.textContent = h.title;
  hintTextEl.textContent = h.text;
  hintBanner.classList.remove('lv1', 'lv2', 'lv3');
  hintBanner.classList.add('show', 'lv' + level);
  miniDemoWrap.classList.add('attention');
  if(level < 3) speak(h.text);
}

/* ---------------- main loop ---------------- */
const DETECT_INTERVAL_MS = 50;
let lastDetectAt = 0;
let lastVideoTime = -1;
let lastHandLms = null;

let backdropGradient = null, backdropKey = '';
let currentMatchScore = 0; // 記錄目前目標手勢的辨識信心度 (0 ~ 1)

function drawBackdrop(){
  const w = camCanvas.width, h = camCanvas.height;
  camCtx.drawImage(video, 0, 0, w, h);
  const cx = w/2, cy = h*0.52, r = Math.min(w,h)*0.44;
  const key = `${w}x${h}`;
  if(key !== backdropKey){
    backdropGradient = camCtx.createRadialGradient(cx,cy,r*0.25, cx,cy,r*1.35);
    backdropGradient.addColorStop(0, 'rgba(13,20,36,0)');
    backdropGradient.addColorStop(0.6, 'rgba(13,20,36,0.12)');
    backdropGradient.addColorStop(1, 'rgba(13,20,36,0.82)');
    backdropKey = key;
  }
  camCtx.save();
  camCtx.fillStyle = backdropGradient;
  camCtx.fillRect(0,0,w,h);

  // 1. 繪製半透明「目標手影輪廓」在圓圈中央（左右鏡像對齊鏡頭畫面）
  if(currentMission && HAND_POSES[currentMission.demo.pose]){
    const targetLm = handLandmarks(HAND_POSES[currentMission.demo.pose]);
    camCtx.save();
    camCtx.globalAlpha = 0.22;
    drawHandFigure(camCtx, targetLm, { ox: cx, oy: cy + r*0.72, scale: r*0.65, rot: 0, mirror: true }, r*1.8);
    camCtx.restore();
  }

  // 2. 根據辨識信心度動態調整外圍光環粗細與亮度
  const progressRatio = Math.min(1, currentMatchScore / SCORE_THRESHOLD);
  const isClose = progressRatio > 0.5;
  camCtx.strokeStyle = progressRatio >= 1 
    ? 'rgba(111, 217, 184, 0.95)' // 達標變薄荷綠光
    : `rgba(245, 169, 63, ${0.35 + progressRatio * 0.6})`;
  camCtx.lineWidth = 3 + progressRatio * 5;
  camCtx.shadowColor = isClose ? 'rgba(245, 169, 63, 0.8)' : 'transparent';
  camCtx.shadowBlur = isClose ? 16 : 0;

  camCtx.beginPath();
  camCtx.arc(cx,cy,r,0,Math.PI*2);
  camCtx.stroke();
  camCtx.restore();
}

function loop(){
  rafId = requestAnimationFrame(loop);
  if(video.readyState < 2 || !gestureRecognizer) return;

  drawBackdrop();

  const now = performance.now();
  if(now - lastDetectAt >= DETECT_INTERVAL_MS && video.currentTime !== lastVideoTime){
    lastDetectAt = now;
    lastVideoTime = video.currentTime;
    updateHold(detectHandFrame(now));
    checkHints(now);
  }

  if(showSkeleton && lastHandLms){
    for(const lm of lastHandLms) drawHandSkeleton(lm, camCanvas.width, camCanvas.height);
  }
}

function detectHandFrame(now){
  const res = gestureRecognizer.recognizeForVideo(video, now);
  lastHandLms = (res.landmarks && res.landmarks.length > 0) ? res.landmarks : null;
  if(lastHandLms) lastSeenAt = now;

  let targetScore = 0;
  if(res.gestures && res.gestures.length > 0){
    const targetCandidate = res.gestures[0].find(g => g.categoryName === currentMission.gesture);
    if(targetCandidate) targetScore = targetCandidate.score;
  }
  currentMatchScore = targetScore;
  return targetScore > SCORE_THRESHOLD;
}

function updateHold(isMatch){
  if(isMatch){
    setMsg('好棒，保持住～');
    lastProgressAt = performance.now();
    if(hintLevel > 0){ lastHintKey = null; hideHint(); }
    if(holdStart === null) holdStart = performance.now();
    const elapsed = performance.now() - holdStart;
    setHoldProgress(Math.min(1, elapsed / HOLD_MS));
    if(elapsed >= HOLD_MS){
      holdStart = null;
      onMissionSuccess();
    }
  } else {
    holdStart = null;
    setHoldProgress(0);
    setMsg('跟著示範做做看，你可以的！');
  }
}

function drawHandSkeleton(handLm, w, h){
  camCtx.save();
  camCtx.strokeStyle = 'rgba(253,246,232,0.85)';
  camCtx.lineWidth = 3;
  camCtx.lineCap = 'round';
  for(const [a,b] of HAND_CONNECTIONS){
    const pa = handLm[a], pb = handLm[b];
    camCtx.beginPath();
    camCtx.moveTo(pa.x*w, pa.y*h);
    camCtx.lineTo(pb.x*w, pb.y*h);
    camCtx.stroke();
  }
  handLm.forEach((pt, i) => {
    const isTip = [4,8,12,16,20].includes(i);
    camCtx.beginPath();
    camCtx.arc(pt.x*w, pt.y*h, isTip ? 6 : 4, 0, Math.PI*2);
    camCtx.fillStyle = isTip ? 'rgba(245,169,63,0.95)' : 'rgba(253,246,232,0.9)';
    camCtx.fill();
  });
  camCtx.restore();
}

function onMissionSuccess(){
  stopCamera();
  onGestureSuccess(currentMission.id, currentMission.name);
  starsEarned.add(currentMission.id);
  sessionLog.push({ id: currentMission.id, name: currentMission.name, time: new Date() });
  saveProgress();
  document.getElementById('success-glyph').textContent = currentMission.animal;
  document.getElementById('success-title').textContent = currentMission.title;
  document.getElementById('success-lead').textContent = currentMission.lead;
  document.getElementById('success-star-count').textContent = `⭐ 已點亮 ${starsEarned.size} / ${MISSIONS.length} 顆星星`;
  showScreen('screen-success');
  burst('burst-layer');
  playChime();
  speak(PRAISES[Math.floor(Math.random()*PRAISES.length)]);
}