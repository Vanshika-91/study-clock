// ---------- Study Clock ----------
// Rule: a session is saved in pieces. Every time the timer pauses, resets or ends,
// we save only the seconds NOT saved yet (elapsed - logged). So nothing is counted twice.

const $ = id => document.getElementById(id);
const STORE = 'study-clock-v2';
const DAY = 86400000;

let total = 1500;      // session length in seconds
let elapsed = 0;       // seconds studied in this session
let baseElapsed = 0;   // elapsed when the timer was last started
let runStart = 0;      // ms timestamp of last start (0 = not running)
let logged = 0;        // seconds of this session already saved
let timer = null;
let signedIn = false;
let serverSessions = [];
let weekOffset = 0;
let syncing = false;
let audio = null;

// ---------- local storage ----------
function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE)) || { sessions: [] }; }
  catch { return { sessions: [] }; }
}
function writeStore(d) { try { localStorage.setItem(STORE, JSON.stringify(d)); } catch {} }

function saveActive() {
  const d = readStore();
  d.active = elapsed > 0 || runStart ? { total, baseElapsed, runStart, logged } : null;
  writeStore(d);
}
function restoreActive() {
  const a = readStore().active;
  if (!a || a.baseElapsed === undefined) return;
  total = a.total; baseElapsed = a.baseElapsed; logged = a.logged || 0;
  elapsed = baseElapsed;
  if (a.runStart) { runStart = a.runStart; run(); }
  markPreset();
}

// ---------- saving sessions ----------
function addSession(seconds) {
  const d = readStore();
  d.sessions.push({ seconds, at: Date.now(), synced: false });
  d.sessions = d.sessions.slice(-5000);
  writeStore(d);
  syncPending();
}
function saveProgress() {
  const delta = Math.floor(elapsed) - logged;
  if (delta >= 1) { logged += delta; addSession(delta); }
  saveActive();
}
async function syncPending() {
  if (syncing) return;
  const d = readStore();
  const pending = d.sessions.filter(s => !s.synced);
  if (!pending.length) return loadStats();
  syncing = true;
  try {
    const r = await fetch('/api/study-time', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions: pending.map(s => ({ seconds: s.seconds, at: s.at })) })
    });
    if (r.ok) {
      const fresh = readStore();
      fresh.sessions.forEach(s => { if (pending.some(p => p.at === s.at && p.seconds === s.seconds)) s.synced = true; });
      writeStore(fresh);
    }
  } catch {}
  syncing = false;
  loadStats();
}

// ---------- stats (all in the user's local time) ----------
function allSessions() {
  const local = readStore().sessions;
  return signedIn ? serverSessions.concat(local.filter(s => !s.synced)) : local;
}
function sumBetween(from, to) {
  return allSessions().filter(s => s.at >= from && s.at < to).reduce((a, s) => a + s.seconds, 0);
}
function startOfDay(ms) { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
function mondayOf(offset) {
  const d = new Date(startOfDay(Date.now()));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}
function fmt(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm';
}
async function loadStats() {
  try {
    const r = await fetch('/api/study-time');
    const s = await r.json();
    signedIn = !!s.signedIn;
    serverSessions = s.sessions || [];
  } catch { signedIn = false; }
  const t = startOfDay(Date.now());
  $('todayTime').textContent = 'Today · ' + fmt(sumBetween(t, t + DAY));
  renderWeek();
}

// ---------- timer ----------
function render() {
  const left = Math.max(0, Math.ceil(total - elapsed));
  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
  $('timer').textContent = mm + ':' + ss;
  $('progress').style.width = Math.min(100, (elapsed / total) * 100) + '%';
  $('startBtn').textContent = timer ? 'Pause' : elapsed > 0 && elapsed < total ? 'Resume' : 'Start';
  document.title = left > 0 ? mm + ':' + ss + ' · Study Clock' : 'Done · Study Clock';
  growPlant(Math.min(1, elapsed / total));
}
function run() {
  clearInterval(timer);
  timer = setInterval(tick, 250);
  tick();
}
function tick() {
  if (!runStart) return;
  elapsed = baseElapsed + (Date.now() - runStart) / 1000;
  if (elapsed >= total) return finish();
  if (Math.floor(elapsed) % 15 === 0) saveActive();
  render();
}
function pause() {
  if (!timer) return;
  tick();
  clearInterval(timer); timer = null;
  baseElapsed = elapsed; runStart = 0;
  saveProgress(); render();
}
function start() {
  if (timer) return pause();
  if (elapsed >= total) reset();   // finished? Start begins a fresh session
  try { audio = audio || new AudioContext(); audio.resume(); } catch {}
  $('sessionLabel').textContent = 'focus session';
  runStart = Date.now(); baseElapsed = elapsed;
  run(); saveActive();
}
function finish() {
  clearInterval(timer); timer = null; runStart = 0;
  elapsed = baseElapsed = total;
  saveProgress(); render();
  $('sessionLabel').textContent = 'session complete · your plant is in bloom 🌻';
  chime();
}
function reset(newTotal) {
  pause();
  if (newTotal) total = newTotal;
  elapsed = baseElapsed = logged = 0; runStart = 0;
  $('sessionLabel').textContent = 'focus session';
  const d = readStore(); d.active = null; writeStore(d);
  render();
}
function chime() {
  if (!audio) return;
  [660, 880].forEach((f, i) => {
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.25;
    o.frequency.value = f; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.start(t); o.stop(t + 0.55);
  });
}
function markPreset() {
  document.querySelectorAll('[data-min]').forEach(b => b.classList.toggle('active', Number(b.dataset.min) * 60 === total));
}

// ---------- plant (SVG grows with progress) ----------
const MOUTHS = { sad: 'M94 208 Q100 203 106 208', ok: 'M94 206 L106 206', happy: 'M93 204 Q100 212 107 204' };
function growPlant(p) {
  const svg = $('plant');
  $('stem').style.strokeDashoffset = 1 - Math.min(1, p / 0.8);
  svg.querySelectorAll('[data-at]').forEach(el => el.classList.toggle('on', p >= Number(el.dataset.at)));
  svg.classList.toggle('bloom', p >= 1);
  $('mouth').setAttribute('d', p >= 0.7 ? MOUTHS.happy : p >= 0.25 ? MOUTHS.ok : MOUTHS.sad);
  $('plantCaption').textContent = p >= 1 ? 'In bloom!' : p >= 0.7 ? 'Almost there' : p > 0 ? 'Keep growing' : 'Plant a seed';
}

// ---------- history screen ----------
function renderWeek() {
  const mon = mondayOf(weekOffset);
  const days = Array.from({ length: 7 }, (_, i) => {
    const t = new Date(mon); t.setDate(mon.getDate() + i);
    const from = t.getTime(), to = new Date(from).setDate(t.getDate() + 1);
    return { from, seconds: sumBetween(from, to) };
  });
  const sun = new Date(days[6].from), opts = { month: 'short', day: 'numeric' };
  const sum = days.reduce((a, d) => a + d.seconds, 0), max = Math.max(1, ...days.map(d => d.seconds));
  $('weekTitle').textContent = weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : Math.abs(weekOffset) + ' weeks ago';
  $('weekRange').textContent = mon.toLocaleDateString([], opts) + ' – ' + sun.toLocaleDateString([], opts);
  $('bigStat').textContent = fmt(sum);
  $('cuteStat').textContent = sum > 0 ? 'little by little 🌿' : 'start a small one 🌱';
  const chart = $('historyChart'), labels = $('historyLabels');
  chart.innerHTML = labels.innerHTML = '';
  const todayStart = startOfDay(Date.now());
  days.forEach((d, i) => {
    const bar = document.createElement('div');
    bar.className = 'history-bar' + (d.seconds ? ' has-time' : '');
    bar.style.height = Math.max(3, (d.seconds / max) * 100) + '%';
    bar.title = fmt(d.seconds);
    chart.append(bar);
    const l = document.createElement('span');
    l.className = d.from === todayStart ? 'is-today' : '';
    l.innerHTML = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] + '<b>' + (d.seconds ? fmt(d.seconds) : '·') + '</b>';
    labels.append(l);
  });
  $('nextWeek').disabled = weekOffset >= 0;
  $('prevWeek').disabled = weekOffset <= -52;
}
function showStats(show) {
  $('studyBox').hidden = show;
  $('statsView').hidden = !show;
  if (show) { weekOffset = 0; $('signInBtn').hidden = signedIn; renderWeek(); }
}

// ---------- events ----------
$('startBtn').onclick = start;
$('resetBtn').onclick = () => reset();
$('presets').onclick = e => {
  const b = e.target.closest('[data-min]');
  if (!b) return;
  reset(Number(b.dataset.min) * 60); markPreset();
};
$('todayTime').onclick = () => showStats(true);
$('backStats').onclick = () => showStats(false);
$('prevWeek').onclick = () => { weekOffset--; renderWeek(); };
$('nextWeek').onclick = () => { if (weekOffset < 0) { weekOffset++; renderWeek(); } };
$('signInBtn').onclick = () => location.href = '/login?next=/';

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || $('studyBox').hidden) return;
  if (e.code === 'Space' && e.target.tagName !== 'BUTTON') { e.preventDefault(); start(); }
  if (e.key.toLowerCase() === 'r') reset();
});
// when the tab is hidden or closed, save what is done so far (time keeps running from the clock)
const flush = () => { if (timer) { tick(); saveProgress(); } };
document.addEventListener('visibilitychange', () => document.hidden ? flush() : tick());
window.addEventListener('pagehide', flush);

restoreActive(); render(); loadStats();
