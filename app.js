'use strict';

/* ================= Lưu trữ ================= */
const STORE_KEY = 'speakup_v1';
const todayStr = () => dateStr(new Date());
function dateStr(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function weekKey(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Thứ 2 = 0
  x.setDate(x.getDate() - day);
  return dateStr(x);
}
function daysAgo(s) { return Math.round((parseDate(todayStr()) - parseDate(s)) / 86400000); }

const defaults = () => ({
  startDate: todayStr(), voice: '', days: {}, weeks: {}, dictation: [], reflex: [], free: [],
  measures: [], stories: {}, customShadow: [],
});
let S;
try { S = Object.assign(defaults(), JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); }
catch { S = defaults(); }
localStorage.removeItem('speakup_key'); // xoá API key cũ từ bản có Hội thoại AI
const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(S));
function today() {
  const k = todayStr();
  if (!S.days[k]) S.days[k] = { done: {}, minutes: 0, shadowSec: 0, shadowCount: 0, reflexCount: 0 };
  return S.days[k];
}
function thisWeek() {
  const k = weekKey();
  if (!S.weeks[k]) S.weeks[k] = {};
  return S.weeks[k];
}
function markDone(id) {
  const d = today();
  if (!d.done[id]) { d.done[id] = true; toast('✓ Đã hoàn thành: ' + DATA.daily.find(x => x.id === id).label); }
  save(); renderToday();
}
function addMinutes(min) { today().minutes += min; save(); renderToday(); }

/* ================= Tiện ích ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
const round = (v, d = 0) => v == null || isNaN(v) ? '—' : Number(v).toFixed(d);
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ================= Giọng đọc (TTS) ================= */
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('en'));
  const sel = $('voice-select');
  sel.innerHTML = voices.map((v, i) => `<option value="${esc(v.name)}">${esc(v.name)} (${v.lang})</option>`).join('');
  if (!S.voice && voices.length) {
    const pref = voices.find(v => /natural|online/i.test(v.name) && /en-GB|en-US/i.test(v.lang))
      || voices.find(v => /google/i.test(v.name)) || voices[0];
    S.voice = pref.name; save();
  }
  sel.value = S.voice;
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
$('voice-select').onchange = e => { S.voice = e.target.value; save(); speak('Hi! This is how I sound.'); };

function speak(text, rate = 1) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find(x => x.name === S.voice);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.rate = rate;
    let finished = false;
    const done = () => { if (!finished) { finished = true; clearTimeout(fallback); resolve(); } };
    // Phòng trường hợp trình duyệt không gọi onend
    const fallback = setTimeout(done, 1500 + text.split(/\s+/).length * 600 / rate);
    u.onend = done; u.onerror = done;
    speechSynthesis.speak(u);
  });
}

/* ================= Ghi âm + phân tích giọng nói ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('support-notice').hidden = false;

class SpeechSession {
  constructor({ meter, out, autoMark = true }) {
    this.meterEl = meter; this.outEl = out; this.autoMark = autoMark;
    this.finalText = ''; this.interim = '';
  }
  async open() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    // Đo tiếng ồn nền 300ms để đặt ngưỡng
    const noise = [];
    await new Promise(r => {
      const t = setInterval(() => { noise.push(this.rms()); }, 25);
      setTimeout(() => { clearInterval(t); r(); }, 300);
    });
    const floor = avg(noise) || 0.005;
    this.threshold = Math.max(0.012, floor * 3);
    this.chunks = [];
    try {
      this.mr = new MediaRecorder(this.stream);
      this.mr.ondataavailable = e => e.data.size && this.chunks.push(e.data);
      this.mr.start();
    } catch { this.mr = null; }
    this.tick = setInterval(() => this.loop(), 30);
    if (this.autoMark) this.markStart();
  }
  rms() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0; for (const x of this.buf) s += x * x;
    return Math.sqrt(s / this.buf.length);
  }
  // Mốc 0: lúc người học bắt đầu được phép nói (sau khi nghe xong câu hỏi)
  markStart() {
    this.t0 = performance.now();
    this.speechStart = null; this.lastVoice = null; this.pauses = 0;
    this.voicedRun = 0; this.silent = false; this.started = true;
    this.startRecognition();
  }
  loop() {
    const level = this.rms();
    if (this.meterEl) this.meterEl.style.width = Math.min(100, level / (this.threshold * 4) * 100) + '%';
    if (!this.started) return;
    const now = performance.now();
    if (level > this.threshold) {
      this.voicedRun++;
      if (this.voicedRun >= 3) { // ~90ms liên tục mới tính là đang nói
        if (!this.speechStart) this.speechStart = now - 60;
        if (this.silent) { this.pauses++; this.silent = false; }
        this.lastVoice = now;
      }
    } else {
      this.voicedRun = 0;
      if (this.lastVoice && now - this.lastVoice > 1000) this.silent = true;
    }
  }
  startRecognition() {
    if (!SR) return;
    this.recActive = true;
    const rec = this.rec = new SR();
    rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += r[0].transcript.trim() + ' ';
        else interim += r[0].transcript;
      }
      this.interim = interim;
      this.render();
    };
    rec.onerror = e => { if (e.error === 'not-allowed') { this.recActive = false; toast('Chưa cho phép micro'); } };
    rec.onend = () => {
      if (this.recActive) { try { rec.start(); } catch { } }
      else if (this._recEnded) this._recEnded();
    };
    try { rec.start(); } catch { }
  }
  render() {
    if (!this.outEl) return;
    this.outEl.innerHTML = esc(this.finalText) + `<span class="interim">${esc(this.interim)}</span>`;
  }
  get text() { return (this.finalText + ' ' + this.interim).trim(); }
  async stop() {
    clearInterval(this.tick);
    const endT = performance.now();
    if (this.rec) {
      this.recActive = false;
      await new Promise(r => { this._recEnded = r; try { this.rec.stop(); } catch { r(); } setTimeout(r, 1800); });
    }
    let audioUrl = null;
    if (this.mr && this.mr.state !== 'inactive') {
      await new Promise(r => { this.mr.onstop = r; this.mr.stop(); });
      audioUrl = URL.createObjectURL(new Blob(this.chunks, { type: this.mr.mimeType }));
    }
    this.stream.getTracks().forEach(t => t.stop());
    this.ctx.close();
    if (this.meterEl) this.meterEl.style.width = '0%';
    this.interim && (this.finalText += this.interim, this.interim = '');
    this.render();
    const words = this.text ? this.text.split(/\s+/).filter(Boolean).length : 0;
    const speakSec = this.speechStart ? (this.lastVoice - this.speechStart) / 1000 : 0;
    return {
      text: this.text, words, audioUrl,
      totalSec: this.t0 ? (endT - this.t0) / 1000 : 0,
      speakSec,
      latency: this.speechStart ? (this.speechStart - this.t0) / 1000 : null,
      wpm: speakSec > 3 && words ? words / speakSec * 60 : null,
      pausesPerMin: speakSec > 5 ? this.pauses / (speakSec / 60) : null,
      pauses: this.pauses,
    };
  }
}
function audioPlayer(el, url) { el.innerHTML = url ? `<audio controls src="${url}"></audio>` : ''; }

/* ================= So khớp văn bản ================= */
const norm = w => w.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']/g, '');
function compareText(ref, hyp) {
  const refTok = ref.split(/\s+/).filter(Boolean);
  const a = refTok.map(norm), b = hyp.split(/\s+/).map(norm).filter(Boolean);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] && a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const matched = new Array(n).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] && a[i] === b[j]) { matched[i] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const counted = a.filter(Boolean).length;
  const hits = matched.filter((x, k) => x && a[k]).length;
  const html = refTok.map((w, k) => `<span class="${matched[k] || !a[k] ? 'ok' : 'miss'}">${esc(w)}</span>`).join(' ');
  return { acc: counted ? hits / counted * 100 : 0, html };
}

/* ================= Tabs ================= */
$('nav').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  showTab(b.dataset.tab);
};
function showTab(name) {
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('section.tab').forEach(x => x.classList.toggle('active', x.id === 'tab-' + name));
  if (name === 'progress') renderProgress();
  window.scrollTo(0, 0);
}

/* ================= Hôm nay ================= */
function weekNumber() { return Math.max(1, Math.floor(daysAgo(S.startDate) / 7) + 1); }
function streak() {
  let n = 0; const d = new Date();
  const has = k => S.days[k] && Object.values(S.days[k].done).some(Boolean);
  if (!has(dateStr(d))) d.setDate(d.getDate() - 1);
  while (has(dateStr(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderToday() {
  const d = today(), w = thisWeek();
  const now = new Date();
  $('today-date').textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const wk = weekNumber();
  $('today-week').textContent = `Tuần ${wk} của lộ trình · hôm nay đã luyện ${Math.round(d.minutes)} phút`;
  $('streak').textContent = streak();
  const ym = todayStr().slice(0, 7);
  const mins = Object.entries(S.days).filter(([k]) => k.startsWith(ym)).reduce((s, [, v]) => s + v.minutes, 0);
  $('month-hours').textContent = (mins / 60).toFixed(1);
  $('start-date').value = S.startDate;

  $('daily-list').innerHTML = DATA.daily.map(t => `
    <li><input type="checkbox" data-daily="${t.id}" ${d.done[t.id] ? 'checked' : ''}>
      <span>${esc(t.label)}</span> <a data-go="${t.tab}" data-mode="${t.id}">mở</a>
      <span class="min">${t.min} phút</span></li>`).join('');

  const lastMeasure = S.measures.length ? S.measures[S.measures.length - 1].date : null;
  $('weekly-list').innerHTML = DATA.weekly.map(t => {
    if (t.biweekly) {
      const ok = lastMeasure && daysAgo(lastMeasure) < 14;
      return `<li><input type="checkbox" disabled ${ok ? 'checked' : ''}><span>${esc(t.label)}</span>
        <a data-go="${t.tab}">mở</a><span class="min">${ok ? 'đã đo ' + daysAgo(lastMeasure) + ' ngày trước' : 'cần đo'}</span></li>`;
    }
    const n = w[t.id] || 0;
    return `<li><input type="checkbox" disabled ${n >= t.target ? 'checked' : ''}>
      <span>${esc(t.label)}${t.tip ? `<br><span class="hint" style="font-size:.8rem">${esc(t.tip)}</span>` : ''}</span>
      ${t.tab ? `<a data-go="${t.tab}" data-mode="432">mở</a>` : ''}
      <span class="min"><button class="icon" data-wk="${t.id}" data-delta="-1">−</button>${n}/${t.target}<button class="icon" data-wk="${t.id}" data-delta="1">+</button></span></li>`;
  }).join('');

  $('milestones').innerHTML = DATA.milestones.map(m =>
    `<div class="milestone ${wk >= m.from && wk <= m.to ? 'current' : ''}"><b>${esc(m.title)}</b><br>${esc(m.text)}</div>`).join('');
}
$('daily-list').onchange = e => {
  const id = e.target.dataset.daily; if (!id) return;
  today().done[id] = e.target.checked; save(); renderToday();
};
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) {
    e.preventDefault();
    showTab(go.dataset.go);
    const m = go.dataset.mode;
    if (go.dataset.go === 'free' && ['journal', 'lecture', '432'].includes(m)) { $('free-mode').value = m; updateFreeMode(); }
  }
  const wk = e.target.closest('[data-wk]');
  if (wk) {
    const w = thisWeek(); w[wk.dataset.wk] = Math.max(0, (w[wk.dataset.wk] || 0) + Number(wk.dataset.delta));
    save(); renderToday();
  }
});
$('start-date').onchange = e => { S.startDate = e.target.value || todayStr(); save(); renderToday(); };
$('export-btn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
  a.download = `speakup-backup-${todayStr()}.json`; a.click();
};
$('import-btn').onclick = () => $('import-file').click();
$('import-file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { S = Object.assign(defaults(), JSON.parse(await f.text())); save(); location.reload(); }
  catch { toast('File không hợp lệ'); }
};

/* ================= Nghe chép ================= */
let dictStartedAt = null;
function ytId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function renderDictVideo() {
  const id = ytId($('dict-url').value.trim());
  if (id) {
    $('dict-video').innerHTML = `<div class="video-wrap"><iframe src="https://www.youtube.com/embed/${id}" allowfullscreen></iframe></div>
      <p class="hint" style="margin-top:6px">Mẹo: phím <b>,</b> và <b>.</b> trên YouTube để lùi/tiến từng khung; tốc độ 0.75× khi mới bắt đầu.</p>`;
  } else {
    $('dict-video').innerHTML = `<div class="row"><button class="btn secondary" id="dict-say">🔊 Đọc transcript</button>
      <button class="btn secondary" id="dict-say-slow">🐢 Đọc chậm</button><button class="btn secondary" id="dict-say-stop">■</button></div>`;
    $('dict-say').onclick = () => speak($('dict-ref').value, 1);
    $('dict-say-slow').onclick = () => speak($('dict-ref').value, 0.8);
    $('dict-say-stop').onclick = () => speechSynthesis.cancel();
  }
}
$('dict-url').oninput = renderDictVideo;
$('dict-hide').onclick = () => {
  const r = $('dict-ref'); const hidden = r.style.filter;
  r.style.filter = hidden ? '' : 'blur(6px)';
  $('dict-hide').textContent = hidden ? 'Ẩn transcript' : 'Hiện transcript';
};
$('dict-tts').onclick = e => {
  e.preventDefault();
  $('dict-url').value = ''; $('dict-ref').value = DATA.sampleDictation;
  $('dict-ref').style.filter = 'blur(6px)'; $('dict-hide').textContent = 'Hiện transcript';
  renderDictVideo(); toast('Bấm 🔊 để nghe, rồi chép lại');
};
$('dict-input').oninput = () => { if (!dictStartedAt) dictStartedAt = Date.now(); };
let lastDict = null;
$('dict-check').onclick = () => {
  const ref = $('dict-ref').value.trim();
  if (!ref) return toast('Cần dán transcript gốc trước');
  const r = compareText(ref, $('dict-input').value);
  lastDict = r;
  $('dict-diff').innerHTML = r.html;
  $('dict-result').hidden = false;
  $('dict-score').innerHTML = `<span class="pill ${r.acc < 85 ? 'warn' : ''}">Chính xác ${r.acc.toFixed(0)}%</span>`;
};
$('dict-save').onclick = () => {
  if (!lastDict) return;
  const url = $('dict-url').value.trim();
  S.dictation.push({ date: todayStr(), title: url ? 'YouTube ' + (ytId(url) || '') : 'Clip/bài mẫu', acc: Math.round(lastDict.acc), reason: $('dict-reason').value });
  const mins = dictStartedAt ? Math.min(30, Math.max(5, (Date.now() - dictStartedAt) / 60000)) : 15;
  dictStartedAt = null; save();
  addMinutes(mins); markDone('listen'); renderDictHistory();
  toast('Đã lưu. Giờ shadowing chính đoạn này nhé!');
};
function renderDictHistory() {
  $('dict-history').innerHTML = S.dictation.slice(-10).reverse().map(x =>
    `<tr><td>${x.date}</td><td>${esc(x.title)}</td><td>${x.acc}%</td><td>${esc(x.reason || '')}</td></tr>`).join('')
    || '<tr><td colspan="4" class="hint">Chưa có</td></tr>';
}
$('connected-rules').innerHTML = DATA.connected.map(g => `
  <h3>${esc(g.rule)}</h3>
  ${g.examples.map(([w, s]) => `<div class="phrase"><button class="icon" data-say="${esc(s)}">🔊</button>
    <span>${esc(w)}</span><span class="vi">nghe như: <i>${esc(s)}</i></span></div>`).join('')}`).join('');
document.addEventListener('click', e => {
  const b = e.target.closest('[data-say]'); if (b) speak(b.dataset.say, Number(b.dataset.rate || 1));
});

/* ================= Shadowing ================= */
let shadowSentence = null, shadowSession = null;
function shadowSets() {
  const sets = { ...DATA.shadowSets };
  if (S.customShadow.length) sets['Câu của tôi'] = S.customShadow.map(t => [t, '']);
  return sets;
}
function renderShadowSets() {
  const sel = $('shadow-set'), cur = sel.value;
  sel.innerHTML = Object.keys(shadowSets()).map(k => `<option>${esc(k)}</option>`).join('');
  if (cur && shadowSets()[cur]) sel.value = cur;
  renderShadowList();
}
function renderShadowList() {
  const set = shadowSets()[$('shadow-set').value] || [];
  const custom = $('shadow-set').value === 'Câu của tôi';
  $('shadow-list').innerHTML = set.map(([t, s], i) => `
    <div class="sentence-item ${shadowSentence === t ? 'active' : ''}" data-shadow="${i}">
      <div style="flex:1">${esc(t)}${s ? `<br><span class="sounds">${esc(s)}</span>` : ''}</div>
      ${custom ? `<button class="icon" data-delshadow="${i}" title="Xoá">✕</button>` : ''}
    </div>`).join('');
}
$('shadow-set').onchange = renderShadowList;
$('shadow-list').onclick = e => {
  const del = e.target.closest('[data-delshadow]');
  if (del) { S.customShadow.splice(Number(del.dataset.delshadow), 1); save(); renderShadowSets(); return; }
  const it = e.target.closest('[data-shadow]'); if (!it) return;
  shadowSentence = shadowSets()[$('shadow-set').value][Number(it.dataset.shadow)][0];
  $('shadow-current').textContent = shadowSentence;
  $('shadow-out').innerHTML = ''; $('shadow-score').innerHTML = ''; $('shadow-audio').innerHTML = '';
  renderShadowList();
  playShadow(1);
};
$('shadow-add').onclick = () => {
  const lines = $('shadow-new').value.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return;
  S.customShadow.push(...lines); save(); $('shadow-new').value = '';
  renderShadowSets(); $('shadow-set').value = 'Câu của tôi'; renderShadowList();
};
async function playShadow(rate) {
  if (!shadowSentence) return toast('Chọn một câu trước');
  await speak(shadowSentence, rate);
  if ($('shadow-auto').checked && !shadowSession) toggleShadowRec();
}
$('shadow-play').onclick = () => playShadow(1);
$('shadow-slow').onclick = () => playShadow(0.75);
$('shadow-rec').onclick = () => toggleShadowRec();
async function toggleShadowRec() {
  if (!shadowSentence) return toast('Chọn một câu trước');
  if (shadowSession) {
    const s = shadowSession; shadowSession = null;
    $('shadow-rec').textContent = '🎙 Nói theo';
    clearTimeout(toggleShadowRec._t);
    const r = await s.stop();
    const c = compareText(shadowSentence, r.text);
    $('shadow-out').innerHTML = esc(r.text) || '<span class="hint">(không nhận được giọng nói)</span>';
    $('shadow-score').innerHTML = `<div class="diff">${c.html}</div>
      <span class="pill ${c.acc < 80 ? 'warn' : ''}">Khớp ${c.acc.toFixed(0)}%</span>
      ${c.acc >= 90 ? ' Tốt! Thử lại và bắt chước ngữ điệu sát hơn.' : ' Nghe lại, chú ý chỗ gạch chân.'}`;
    audioPlayer($('shadow-audio'), r.audioUrl);
    const d = today();
    d.shadowCount++; d.shadowSec += Math.max(5, r.totalSec) * 2.5; // gồm cả thời gian nghe & lặp
    save();
    if (d.shadowSec >= 600 && !d.done.shadow) { addMinutes(10); markDone('shadow'); }
    renderShadowCount();
    return;
  }
  shadowSession = new SpeechSession({ meter: $('shadow-meter'), out: $('shadow-out') });
  $('shadow-out').innerHTML = '';
  try { await shadowSession.open(); }
  catch { shadowSession = null; return toast('Không mở được micro'); }
  $('shadow-rec').innerHTML = '<span class="rec-dot"></span>Dừng';
  const maxSec = Math.max(5, shadowSentence.split(' ').length * 0.7 + 3);
  toggleShadowRec._t = setTimeout(() => shadowSession && toggleShadowRec(), maxSec * 1000);
}
function renderShadowCount() {
  const d = today();
  $('shadow-count').textContent = d.shadowCount;
  $('shadow-mins').textContent = Math.round(d.shadowSec / 60);
}

/* ================= Phản xạ ================= */
let reflexQ = null, reflexSession = null, reflexTimer = null;
$('reflex-cat').innerHTML = ['Tất cả', ...Object.keys(DATA.reflexQuestions)].map(k => `<option>${esc(k)}</option>`).join('');
function nextQuestion() {
  const cat = $('reflex-cat').value;
  const pool = cat === 'Tất cả' ? Object.values(DATA.reflexQuestions).flat() : DATA.reflexQuestions[cat];
  let q; do { q = pick(pool); } while (q === reflexQ && pool.length > 1);
  return q;
}
$('reflex-start').onclick = async () => {
  if (reflexSession) return;
  reflexQ = nextQuestion();
  $('reflex-q').textContent = $('reflex-show').checked ? reflexQ : '🎧 Hãy nghe câu hỏi...';
  $('reflex-out').innerHTML = ''; $('reflex-stats').innerHTML = ''; $('reflex-audio').innerHTML = '';
  $('reflex-start').disabled = true;
  reflexSession = new SpeechSession({ meter: $('reflex-meter'), out: $('reflex-out'), autoMark: false });
  try { await reflexSession.open(); }
  catch { reflexSession = null; $('reflex-start').disabled = false; return toast('Không mở được micro'); }
  $('reflex-status').textContent = 'Đang đọc câu hỏi...';
  await speak(reflexQ, 1);
  if (!reflexSession) return;
  reflexSession.markStart();
  $('reflex-status').innerHTML = '<span class="rec-dot"></span>Trả lời ngay!';
  $('reflex-stop').disabled = false; $('reflex-repeat').disabled = false;
  const len = Number($('reflex-len').value), t0 = Date.now();
  reflexTimer = setInterval(() => {
    const left = len - (Date.now() - t0) / 1000;
    $('reflex-timer').textContent = fmtTime(Math.max(0, left));
    if (left <= 0) stopReflex();
  }, 200);
};
$('reflex-repeat').onclick = () => {
  // Nghe lại = không tính độ trễ cho câu này
  if (reflexSession) reflexSession.repeated = true;
  $('reflex-q').textContent = reflexQ;
};
$('reflex-stop').onclick = () => stopReflex();
async function stopReflex() {
  if (!reflexSession) return;
  clearInterval(reflexTimer);
  const s = reflexSession; reflexSession = null;
  $('reflex-stop').disabled = true; $('reflex-repeat').disabled = true;
  $('reflex-status').textContent = 'Đang xử lý...';
  const r = await s.stop();
  $('reflex-start').disabled = false; $('reflex-status').textContent = '';
  $('reflex-q').textContent = reflexQ;
  if (s.repeated) r.latency = null;
  audioPlayer($('reflex-audio'), r.audioUrl);
  $('reflex-stats').innerHTML = statCards(r);
  if (r.speakSec < 3) return toast('Chưa ghi được câu trả lời. Kiểm tra micro nhé.');
  S.reflex.push({ date: todayStr(), q: reflexQ, latency: r.latency, wpm: r.wpm, pauses: r.pausesPerMin });
  const d = today(); d.reflexCount++; d.minutes += r.totalSec / 60 + 0.3; save();
  if (d.reflexCount >= 3) markDone('reflex'); else renderToday();
  renderReflexHistory();
}
function metricClass(id, v) {
  if (v == null) return '';
  const m = DATA.metrics.find(x => x.id === id);
  return (m.dir > 0 ? v >= m.target : v <= m.target) ? 'good' : 'warn';
}
function statCards(r) {
  const cards = [
    ['latency', 'Bắt đầu nói sau', round(r.latency, 1) + ' s', 'mục tiêu ≤ 2 s', r.latency],
    ['wpm', 'Tốc độ nói', round(r.wpm) + ' từ/phút', 'mục tiêu 120–130', r.wpm],
    ['pauses', 'Ngừng >1 giây', round(r.pausesPerMin, 1) + ' /phút', `${r.pauses} lần · mục tiêu ≤ 3/phút`, r.pausesPerMin],
  ];
  return cards.map(([id, l, v, sub, raw]) => `<div class="stat ${metricClass(id, raw)}"><div class="label">${l}</div>
    <div class="value">${v}</div><div class="sub">${sub}</div></div>`).join('')
    + `<div class="stat"><div class="label">Số từ</div><div class="value">${r.words}</div><div class="sub">${round(r.speakSec)} giây nói</div></div>`;
}
function renderReflexHistory() {
  $('reflex-history').innerHTML = S.reflex.slice(-10).reverse().map(x =>
    `<tr><td>${x.date}</td><td>${esc(x.q)}</td><td>${round(x.latency, 1)} s</td><td>${round(x.wpm)}</td><td>${round(x.pauses, 1)}</td></tr>`).join('')
    || '<tr><td colspan="5" class="hint">Chưa có</td></tr>';
}

/* ================= Nói tự do ================= */
const FREE = {
  journal: { name: 'Nhật ký', rounds: [300], minDone: 180, needTopic: false,
    desc: 'Nói liên tục 3–5 phút về ngày hôm nay hoặc điều bạn đang nghĩ. Không dừng lại để sửa lỗi. Quên từ thì diễn giải. Bấm Dừng sau ít nhất 3 phút.' },
  lecture: { name: 'Tóm tắt bài giảng', rounds: [120], minDone: 90, needTopic: true,
    desc: 'Tóm tắt nội dung chính của bài giảng hôm nay trong 2 phút. Luyện cả trí nhớ lẫn diễn đạt học thuật.' },
  summary: { name: 'Tóm tắt podcast', rounds: [120], minDone: 60, needTopic: true,
    desc: 'Nghe 1–2 phút podcast rồi dừng lại và tóm tắt to. Tăng dần lên 5, rồi 10 phút nghe mỗi lần tóm tắt.' },
  '432': { name: '4-3-2', rounds: [240, 180, 120], minDone: 0, needTopic: true,
    desc: 'Kể CÙNG một câu chuyện 3 lần: 4 phút, 3 phút, rồi 2 phút. Lần sau phải nói nhanh và gọn hơn. Kỹ thuật này đã được nghiên cứu chứng minh giúp nói trôi chảy hơn.' },
};
let freeSession = null, freeTimer = null, freeRound = 0, freeResults = [];
function updateFreeMode() {
  const m = FREE[$('free-mode').value];
  $('free-desc').textContent = m.desc;
  $('free-topic-row').style.display = m.needTopic ? '' : 'none';
  $('free-timer').textContent = fmtTime(m.rounds[0]);
  $('free-round').textContent = ''; $('free-results').innerHTML = '';
}
$('free-mode').onchange = updateFreeMode;
$('free-random').onclick = () => { $('free-topic').value = pick(DATA.freeTopics); };
$('free-start').onclick = async () => {
  if (freeSession) return;
  const mode = $('free-mode').value, m = FREE[mode];
  if (freeRound === 0) freeResults = [];
  freeSession = new SpeechSession({ meter: $('free-meter'), out: $('free-out') });
  $('free-out').innerHTML = '';
  try { await freeSession.open(); }
  catch { freeSession = null; return toast('Không mở được micro'); }
  $('free-start').disabled = true; $('free-stop').disabled = false; $('free-mode').disabled = true;
  const len = m.rounds[freeRound], t0 = Date.now();
  $('free-round').innerHTML = `<span class="rec-dot"></span>` + (m.rounds.length > 1 ? `Lần ${freeRound + 1}/3 · ${len / 60} phút` : 'Đang ghi');
  freeTimer = setInterval(() => {
    const left = len - (Date.now() - t0) / 1000;
    $('free-timer').textContent = fmtTime(Math.max(0, left));
    if (left <= 0) stopFree();
  }, 250);
};
$('free-stop').onclick = () => stopFree();
async function stopFree() {
  if (!freeSession) return;
  clearInterval(freeTimer);
  const s = freeSession; freeSession = null;
  $('free-stop').disabled = true; $('free-round').textContent = 'Đang xử lý...';
  const r = await s.stop();
  const mode = $('free-mode').value, m = FREE[mode];
  audioPlayer($('free-audio'), r.audioUrl);
  freeResults.push(r);
  today().minutes += r.totalSec / 60; save();
  if (mode === '432' && freeRound < 2) {
    freeRound++;
    $('free-round').textContent = `Xong lần ${freeRound}. Nghỉ chút rồi kể lại trong ${m.rounds[freeRound] / 60} phút.`;
    $('free-start').disabled = false; $('free-start').textContent = `🎙 Lần ${freeRound + 1}`;
    $('free-timer').textContent = fmtTime(m.rounds[freeRound]);
    renderFreeResults(mode);
    return;
  }
  freeRound = 0;
  $('free-start').disabled = false; $('free-start').textContent = '🎙 Bắt đầu'; $('free-mode').disabled = false;
  $('free-round').textContent = 'Hoàn thành!';
  renderFreeResults(mode);
  const totalSec = freeResults.reduce((a, x) => a + x.totalSec, 0);
  const wpms = freeResults.map(x => x.wpm).filter(x => x != null);
  const ps = freeResults.map(x => x.pausesPerMin).filter(x => x != null);
  S.free.push({ date: todayStr(), mode, topic: $('free-topic').value || '', dur: totalSec,
    wpm: avg(wpms), pauses: avg(ps), rounds: freeResults.map(x => Math.round(x.wpm || 0)) });
  save();
  if (mode === 'journal' && totalSec >= m.minDone) markDone('journal');
  else if (mode === 'lecture' && totalSec >= m.minDone) markDone('lecture');
  else if (mode === '432') { const w = thisWeek(); w.k432 = (w.k432 || 0) + 1; save(); renderToday(); }
  else if (mode === 'journal') toast('Chưa đủ 3 phút. Lần sau cố nói lâu hơn nhé!');
  renderFreeHistory();
}
function renderFreeResults(mode) {
  if (mode !== '432') { $('free-results').innerHTML = `<div class="stat-row">${statCards(freeResults[0])}</div>`; return; }
  const rows = freeResults.map((r, i) => `<tr><td>Lần ${i + 1}</td><td>${round(r.speakSec)} s</td><td>${round(r.wpm)}</td><td>${round(r.pausesPerMin, 1)}</td></tr>`).join('');
  let note = '';
  if (freeResults.length === 3 && freeResults[0].wpm && freeResults[2].wpm) {
    const gain = (freeResults[2].wpm / freeResults[0].wpm - 1) * 100;
    note = `<p>Lần 3 nhanh hơn lần 1: <b>${gain.toFixed(0)}%</b> ${gain >= 15 ? '(đạt mức kỳ vọng 15–20%)' : '(kỳ vọng 15–20%: lần sau cắt bớt chi tiết phụ, giữ ý chính)'}</p>`;
  }
  $('free-results').innerHTML = `<table><thead><tr><th></th><th>Thời gian nói</th><th>Từ/phút</th><th>Ngừng/phút</th></tr></thead><tbody>${rows}</tbody></table>${note}`;
}
function renderFreeHistory() {
  $('free-history').innerHTML = S.free.slice(-10).reverse().map(x =>
    `<tr><td>${x.date}</td><td>${FREE[x.mode].name}</td><td>${esc(x.topic)}</td><td>${fmtTime(x.dur)}</td>
      <td>${x.mode === '432' ? x.rounds.join(' → ') : round(x.wpm)}</td><td>${round(x.pauses, 1)}</td></tr>`).join('')
    || '<tr><td colspan="6" class="hint">Chưa có</td></tr>';
}

/* ================= Cụm từ ================= */
$('phrase-groups').innerHTML = DATA.phrases.map(g => `<div class="card"><h2>${esc(g.group)}</h2>
  ${g.items.map(([en, vi]) => `<div class="phrase"><button class="icon" data-say="${esc(en)}">🔊</button><span>${esc(en)}</span><span class="vi">${esc(vi)}</span></div>`).join('')}</div>`).join('');
// Thẻ phản xạ: câu hỏi tiếng Anh về chủ đề ngẫu nhiên
let flash = null, flashSession = null, flashTimer = null;
const flashFixed = Object.entries(DATA.flashTopics).flatMap(([topic, t]) => t.questions.map(q => ({ topic, q })));
const flashRecent = [];
// Sinh một câu hỏi ngẫu nhiên từ mẫu câu (vài nghìn tổ hợp)
function makeQuestion() {
  const G = DATA.flashGen, r = Math.random();
  if (r < 0.35) {
    const [ing, base, past, topic] = pick(G.activities);
    return { topic, q: pick(G.actTemplates).replace('{ing}', ing).replace('{base}', base).replace('{past}', past) };
  }
  if (r < 0.7) {
    const [n, topic] = pick(G.things);
    const q = pick(G.thingTemplates).replace('{n}', n);
    return { topic, q: q[0].toUpperCase() + q.slice(1) };
  }
  if (r < 0.85) {
    const a = pick(G.rather); let b; do { b = pick(G.rather); } while (b === a);
    return { topic: 'Hypothetical', q: `Would you rather ${a} or ${b}? Why?` };
  }
  return pick(flashFixed);
}
$('flash-next').onclick = async () => {
  if (flashSession) await stopFlash();
  // Không lặp lại trong 100 câu gần nhất
  let f, tries = 0;
  do { f = makeQuestion(); } while (flashRecent.includes(f.q) && ++tries < 50);
  flashRecent.push(f.q); if (flashRecent.length > 100) flashRecent.shift();
  flash = f;
  $('flash-topic').innerHTML = `<span class="pill">${esc(f.topic)}</span>`;
  $('flash-q').textContent = f.q; $('flash-out').innerHTML = ''; $('flash-ans').innerHTML = '';
  askFlash();
};
async function askFlash() {
  if (!flash) return;
  if ($('flash-auto').checked && !flashSession) {
    // Mở micro trước, đọc câu hỏi, rồi mới bắt đầu tính thời gian phản xạ
    const s = new SpeechSession({ out: $('flash-out'), autoMark: false });
    try { await s.open(); } catch { return toast('Không mở được micro'); }
    flashSession = s;
    await speak(flash.q, 1);
    if (flashSession !== s) return;
    s.markStart();
    $('flash-rec').innerHTML = '<span class="rec-dot"></span>Dừng';
    flashTimer = setTimeout(() => flashSession === s && stopFlash(), 45000);
  } else {
    await speak(flash.q, 1);
  }
}
$('flash-repeat').onclick = () => flash && speak(flash.q, 0.9);
$('flash-show').onclick = () => {
  if (!flash) return;
  const vocab = DATA.flashTopics[flash.topic].vocab;
  $('flash-ans').innerHTML = `<b>Từ vựng gợi ý:</b> ${vocab.map(v => `<span class="pill" style="margin:2px">${esc(v)}</span>`).join(' ')}
    <br><b>Câu mở đầu:</b> ${DATA.flashStarters.map(v => `<i>${esc(v)}</i> <button class="icon" data-say="${esc(v)}">🔊</button>`).join(' ')}`;
};
async function stopFlash() {
  const s = flashSession; if (!s) return;
  flashSession = null; clearTimeout(flashTimer);
  $('flash-rec').textContent = '🎙 Nói';
  const r = await s.stop();
  const pills = [];
  if (r.latency != null) pills.push(`<span class="pill ${r.latency > 2 ? 'warn' : ''}">bắt đầu sau ${r.latency.toFixed(1)} s</span>`);
  if (r.wpm) pills.push(`<span class="pill ${r.wpm < 120 ? 'warn' : ''}">${Math.round(r.wpm)} từ/phút</span>`);
  if (r.pausesPerMin != null) pills.push(`<span class="pill ${r.pausesPerMin > 3 ? 'warn' : ''}">${r.pausesPerMin.toFixed(1)} ngừng/phút</span>`);
  $('flash-out').innerHTML = (esc(r.text) || '<span class="hint">(không nghe thấy)</span>') + ' ' + pills.join(' ');
  if (r.speakSec >= 3) {
    today().minutes += r.totalSec / 60; save(); renderToday();
  }
}
$('flash-rec').onclick = async () => {
  if (!flash) return toast('Bấm “Câu hỏi mới” trước');
  if (flashSession) return stopFlash();
  speechSynthesis.cancel();
  const s = new SpeechSession({ out: $('flash-out') });
  try { await s.open(); } catch { return toast('Không mở được micro'); }
  flashSession = s;
  $('flash-rec').innerHTML = '<span class="rec-dot"></span>Dừng';
  flashTimer = setTimeout(() => flashSession === s && stopFlash(), 45000);
};

/* ================= Câu chuyện ================= */
function renderStories() {
  $('story-list').innerHTML = DATA.stories.map(s => `
    <div style="padding:12px 0;border-bottom:1px solid var(--line)">
      <div class="row"><b>${esc(s.title)}</b><span class="hint" style="margin:0">${esc(s.prompt)}</span>
        <button class="icon" data-say="${esc(s.prompt)}">🔊</button>
        <button class="btn secondary" data-story="${s.id}" style="margin-left:auto">Luyện kể 4-3-2</button></div>
      <textarea data-notes="${s.id}" placeholder="Từ khoá, ý chính, cụm từ hay..." style="margin-top:8px;min-height:60px">${esc(S.stories[s.id] || '')}</textarea>
    </div>`).join('');
}
$('story-list').oninput = e => { const id = e.target.dataset.notes; if (id) { S.stories[id] = e.target.value; save(); } };
$('story-list').onclick = e => {
  const b = e.target.closest('[data-story]'); if (!b) return;
  const s = DATA.stories.find(x => x.id === b.dataset.story);
  showTab('free'); $('free-mode').value = '432'; updateFreeMode();
  $('free-topic').value = `${s.title}: ${s.prompt}`;
};

/* ================= Tiến độ ================= */
function autoMetrics() {
  const recent = arr => arr.filter(x => daysAgo(x.date) < 14);
  const spk = [...recent(S.reflex), ...recent(S.free)];
  const lastRecall = [...S.measures].reverse().find(x => x.recall != null);
  return {
    wpm: avg(spk.map(x => x.wpm).filter(x => x != null)),
    pauses: avg(spk.map(x => x.pauses).filter(x => x != null)),
    latency: avg(recent(S.reflex).map(x => x.latency).filter(x => x != null)),
    dict: avg(recent(S.dictation).map(x => x.acc)),
    recall: lastRecall ? lastRecall.recall : null,
  };
}
function renderProgress() {
  const a = autoMetrics(), first = S.measures[0];
  $('metric-cards').innerHTML = DATA.metrics.map(m => {
    const v = a[m.id];
    let delta = '';
    if (first && first[m.id] != null && v != null) {
      const d = v - first[m.id];
      delta = ` · ${d >= 0 ? '+' : ''}${d.toFixed(m.digits)} so với lần đo đầu`;
    }
    return `<div class="stat ${metricClass(m.id, v)}"><div class="label">${m.label}</div>
      <div class="value">${round(v, m.digits)}</div>
      <div class="sub">${m.unit} · ban đầu ${m.baseline} · mục tiêu ${m.dir > 0 ? '≥' : '≤'} ${m.target}${delta}</div></div>`;
  }).join('');
  const last = S.measures[S.measures.length - 1];
  $('measure-reminder').innerHTML = !last
    ? '<div class="notice">Bạn chưa có lần đo đầu vào. Hãy đo ngay tuần này để có mốc so sánh.</div>'
    : daysAgo(last.date) >= 14 ? `<div class="notice">Đã ${daysAgo(last.date)} ngày từ lần đo trước. Đến lúc đo lại rồi!</div>` : '';
  $('m-date').value = todayStr();
  $('m-history').innerHTML = S.measures.map((x, i) => `<tr><td>${x.date}</td><td>${round(x.wpm)}</td><td>${round(x.pauses, 1)}</td>
    <td>${round(x.latency, 1)}</td><td>${x.dict == null ? '—' : round(x.dict) + '%'}</td><td>${x.recall == null ? '—' : round(x.recall) + '/6'}</td>
    <td><button class="icon" data-delm="${i}" title="Xoá">✕</button></td></tr>`).join('')
    || '<tr><td colspan="7" class="hint">Chưa có</td></tr>';
  renderCharts();
}
$('m-fill').onclick = () => {
  const a = autoMetrics();
  [['wpm', 0], ['pauses', 1], ['latency', 1], ['dict', 0], ['recall', 0]].forEach(([k, d]) => {
    if (a[k] != null) $('m-' + k).value = Number(a[k]).toFixed(d);
  });
};
$('m-save').onclick = () => {
  const num = id => { const v = $(id).value; return v === '' ? null : Number(v); };
  const rec = { date: $('m-date').value || todayStr(), wpm: num('m-wpm'), pauses: num('m-pauses'),
    latency: num('m-latency'), dict: num('m-dict'), recall: num('m-recall') };
  if (Object.values(rec).slice(1).every(v => v == null)) return toast('Nhập ít nhất một chỉ số');
  S.measures.push(rec); S.measures.sort((x, y) => x.date.localeCompare(y.date)); save();
  ['m-wpm', 'm-pauses', 'm-latency', 'm-dict', 'm-recall'].forEach(id => $(id).value = '');
  renderProgress(); renderToday(); toast('Đã lưu lần đo');
};
$('m-history').onclick = e => {
  const b = e.target.closest('[data-delm]'); if (!b) return;
  if (!confirm('Xoá lần đo này?')) return;
  S.measures.splice(Number(b.dataset.delm), 1); save(); renderProgress();
};
function renderCharts() {
  $('charts').innerHTML = DATA.metrics.map(m => `<div class="chart-wrap"><h4>${m.label} (${m.unit})</h4><canvas id="ch-${m.id}"></canvas></div>`).join('');
  DATA.metrics.forEach(m => drawChart($('ch-' + m.id), S.measures.filter(x => x[m.id] != null).map(x => [x.date, x[m.id]]), m));
}
function drawChart(cv, pts, m) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim(), muted = css.getPropertyValue('--muted').trim(), line = css.getPropertyValue('--line').trim();
  g.font = '12px Segoe UI, system-ui, sans-serif';
  if (!pts.length) { g.fillStyle = muted; g.fillText('Chưa có lần đo nào', 10, H / 2); return; }
  const vals = [...pts.map(p => p[1]), m.target];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.2 || Math.max(1, hi * 0.2); lo = Math.max(0, lo - pad); hi += pad;
  const L = 40, R = 12, T = 10, B = 24;
  const x = i => pts.length === 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (pts.length - 1);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  g.strokeStyle = line; g.fillStyle = muted; g.lineWidth = 1;
  for (let k = 0; k <= 3; k++) {
    const v = lo + (hi - lo) * k / 3, yy = y(v);
    g.beginPath(); g.moveTo(L, yy); g.lineTo(W - R, yy); g.stroke();
    g.fillText(v.toFixed(m.digits), 4, yy + 4);
  }
  g.setLineDash([5, 4]); g.strokeStyle = muted;
  g.beginPath(); g.moveTo(L, y(m.target)); g.lineTo(W - R, y(m.target)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = accent; g.lineWidth = 2; g.beginPath();
  pts.forEach((p, i) => i ? g.lineTo(x(i), y(p[1])) : g.moveTo(x(i), y(p[1]))); g.stroke();
  g.fillStyle = accent;
  pts.forEach((p, i) => {
    g.beginPath(); g.arc(x(i), y(p[1]), 4, 0, 7); g.fill();
    g.save(); g.fillStyle = muted; g.textAlign = 'center'; g.fillText(p[0].slice(5), x(i), H - 6); g.restore();
  });
}
window.addEventListener('resize', () => { if ($('tab-progress').classList.contains('active')) renderCharts(); });

/* ================= Khởi động ================= */
renderToday(); renderDictVideo(); renderDictHistory(); renderShadowSets(); renderShadowCount();
renderReflexHistory(); updateFreeMode(); renderFreeHistory(); renderStories();
