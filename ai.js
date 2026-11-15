// Hội thoại bằng giọng nói với Claude (Anthropic TypeScript SDK, chạy thẳng trong trình duyệt).
// Dùng chung các hàm của app.js: $, esc, toast, speak, SpeechSession, S, save, today, renderToday...

const MODEL = 'claude-opus-5-5';
const KEY_STORE = 'speakup_key';
const SDK_URL = 'https://esm.sh/@anthropic-ai/sdk';

const SCENARIOS = {
  club: { label: 'Câu lạc bộ tiếng Anh: làm quen',
    prompt: "You are Lucas, a friendly 27-year-old from Ghent, at an English conversation club in Belgium. You're meeting the learner for the first time over drinks. Chat casually: where they're from, what they do, life in Belgium, hobbies." },
  tandem: { label: 'Tandem 1-1 với bạn người Bỉ',
    prompt: "You are Emma, a Belgian PhD student from Leuven doing a language tandem with the learner over coffee. You're curious about Vietnam and happy to share things about Belgian life." },
  classmate: { label: 'Bạn cùng lớp sau giờ học',
    prompt: "You are Marco, an Italian classmate in the learner's master's programme. You've just walked out of a lecture together. Chat about the lecture, deadlines, group work and weekend plans. You speak quickly and casually and use reductions like gonna, wanna, kinda." },
  group: { label: 'Thảo luận nhóm trên lớp',
    prompt: "You are Sofia, a Spanish classmate working on a group assignment with the learner. Pick a plausible social-science topic, discuss how to split the work, share opinions, and sometimes ask the learner to explain or justify their view." },
  office: { label: 'Gặp giảng viên (office hours)',
    prompt: "You are Dr. Peeters, a friendly lecturer holding office hours. The learner has come to ask about an assignment or their dissertation. Be supportive, and ask clarifying questions that make the learner explain their ideas." },
  ielts: { label: 'Thi thử IELTS Speaking',
    prompt: "You are an IELTS Speaking examiner. Run Part 1 (4-5 short questions on familiar topics), then Part 2 (read out a cue-card topic, say they have one minute to think and should then speak for one to two minutes, and wait for their long answer), then Part 3 (3-4 discussion questions linked to Part 2). Ask one question per turn. Give no feedback during the test.",
    noCorrection: true },
  free: { label: 'Trò chuyện tự do',
    prompt: "You are a warm, curious conversation partner. Let the learner choose topics; if they have none, suggest something light." },
};

const LEARNER = `About the learner: a Vietnamese master's student living in Belgium. Fairly introverted. Understands English well (IELTS Listening 7.5) but speaks less fluently (Speaking 6.5): tends to plan sentences in their head first, hesitates, and loses words mid-sentence. This conversation is for building spoken fluency and quick reactions, not perfect grammar.`;

const STYLE = `How to talk:
- Your replies are read aloud by text-to-speech, so write only natural spoken English: 1-3 short sentences, usually under 40 words. No lists, markdown, emoji or stage directions.
- Sound like a real person: contractions, everyday phrasing, small reactions ("Oh nice", "No way"), and now and then a small detail about yourself.
- End most turns with one easy, open question that keeps the learner talking. Avoid yes/no questions.
- The learner's turns come from speech recognition. Ignore missing punctuation, odd capitalisation and obviously mis-recognised words, and go with the meaning they most likely intended.
- If the learner seems stuck or gives a very short answer, make your next question simpler, or offer two options to choose from.
- If the learner writes in Vietnamese, answer in English and help them say it in English.`;

const CORRECTION = {
  end: '- Do not correct mistakes during the conversation; keep it flowing. Feedback comes separately afterwards.',
  light: '- Gentle correction: if the learner\'s last turn had a clear mistake that would confuse a listener or sounds clearly unnatural, add ONE final line starting with "💡 " giving a more natural way to say that part (15 words max). Skip it when the turn was fine. Never correct more than one thing.',
};

/* ---------- Trạng thái ---------- */
let Anthropic = null, client = null;
let history = [];        // messages gửi lên API (assistant giữ nguyên content blocks)
let log = [];            // [{who:'ai'|'me', text}] để hiển thị & nhận xét
let turns = [];          // số liệu từng lượt nói của người học
let active = false, busy = false;
let listen = null, watcher = null, startedAt = 0;

const keyInput = $('ai-key');
keyInput.value = localStorage.getItem(KEY_STORE) || '';
$('ai-scenario').innerHTML = Object.entries(SCENARIOS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
$('ai-key-save').onclick = () => {
  const k = keyInput.value.trim();
  if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE);
  client = null;
  toast(k ? 'Đã lưu API key' : 'Đã xoá API key');
};

async function getClient() {
  const key = localStorage.getItem(KEY_STORE) || keyInput.value.trim();
  if (!key) throw new UserError('Hãy nhập Anthropic API key trước.');
  if (!Anthropic) {
    try { ({ default: Anthropic } = await import(SDK_URL)); }
    catch { throw new UserError('Không tải được thư viện Anthropic. Kiểm tra kết nối mạng.'); }
  }
  if (!client || client.apiKey !== key) client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  return client;
}
class UserError extends Error {}
function errorText(e) {
  if (e instanceof UserError) return e.message;
  if (Anthropic) {
    if (e instanceof Anthropic.AuthenticationError) return 'API key không đúng hoặc đã bị thu hồi.';
    if (e instanceof Anthropic.PermissionDeniedError) return 'API key không có quyền dùng model này.';
    if (e instanceof Anthropic.RateLimitError) return 'Đang gửi quá nhiều yêu cầu. Đợi vài giây rồi thử lại.';
    if (e instanceof Anthropic.APIConnectionError) return 'Không kết nối được tới Anthropic. Kiểm tra mạng.';
    if (e instanceof Anthropic.APIError) return `Lỗi từ API (${e.status ?? '?'}): ${e.message}`;
  }
  return 'Có lỗi: ' + (e?.message || e);
}
const textOf = msg => msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

function systemPrompt() {
  const sc = SCENARIOS[$('ai-scenario').value];
  const corr = sc.noCorrection ? CORRECTION.end : CORRECTION[$('ai-correct').value];
  return `${sc.prompt}\n\n${LEARNER}\n\n${STYLE}\n${corr}`;
}

// Gọi Claude có streaming; trả về message hoàn chỉnh. Refusal được chuyển sang model dự phòng phía server.
async function streamClaude({ system, messages, effort, onText }) {
  const c = await getClient();
  const stream = c.beta.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort },
    system,
    messages,
  });
  if (onText) stream.on('text', onText);
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new UserError('Claude không trả lời được nội dung này. Thử nói theo cách khác nhé.');
  return msg;
}

/* ---------- Giao diện chat ---------- */
function setStatus(t) { $('ai-status').textContent = t; }
function splitTip(text) {
  const i = text.indexOf('💡');
  return i < 0 ? { say: text.trim(), tip: '' } : { say: text.slice(0, i).trim(), tip: text.slice(i).trim() };
}
function addBubble(cls, html) {
  const b = document.createElement('div');
  b.className = 'bubble ' + cls; b.innerHTML = html;
  $('ai-chat').appendChild(b);
  $('ai-chat').scrollTop = $('ai-chat').scrollHeight;
  return b;
}
function renderAi(b, text) {
  const { say, tip } = splitTip(text);
  b.innerHTML = esc(say) + (tip ? `<span class="tip">${esc(tip)}</span>` : '') +
    `<button class="icon" title="Nghe lại" data-say="${esc(say)}">🔊</button>`;
  $('ai-chat').scrollTop = $('ai-chat').scrollHeight;
}
function setInputs(on) {
  ['ai-mic', 'ai-text', 'ai-send', 'ai-hint'].forEach(id => $(id).disabled = !on);
}

/* ---------- Luồng hội thoại ---------- */
$('ai-begin').onclick = async () => {
  try { await getClient(); } catch (e) { return toast(errorText(e)); }
  $('ai-chat').innerHTML = ''; $('ai-feedback-card').hidden = true;
  history = [{ role: 'user', content: '[The learner has just joined. Greet them and open the conversation naturally, in character.]' }];
  log = []; turns = []; active = true; startedAt = Date.now();
  $('ai-begin').disabled = true; $('ai-end').disabled = false;
  $('ai-scenario').disabled = true; $('ai-correct').disabled = true;
  await claudeTurn();
};

async function claudeTurn() {
  busy = true; setInputs(false); setStatus('Đang trả lời...');
  const bubble = addBubble('ai', '…');
  let shown = '';
  try {
    const msg = await streamClaude({
      system: systemPrompt(), messages: history, effort: 'low',
      onText: d => { shown += d; renderAi(bubble, shown); },
    });
    history.push({ role: 'assistant', content: msg.content }); // giữ nguyên mọi block để gửi lại
    const text = textOf(msg);
    renderAi(bubble, text);
    log.push({ who: 'ai', text: splitTip(text).say });
    busy = false; setInputs(true);
    if (!active) return;
    setStatus('🔊 Đang nói...');
    await speak(splitTip(text).say, 1);
    if (!active) return;
    setStatus('');
    if ($('ai-handsfree').checked) startListening();
    else setStatus('Bấm 🎙 để trả lời');
  } catch (e) {
    bubble.remove();
    if (history.length && history[history.length - 1].role === 'user' && log.length) {
      // Bỏ lượt người học chưa được trả lời để có thể gửi lại
      history.pop(); turns.pop();
      const last = log.pop(); if (last) $('ai-text').value = last.text;
      $('ai-chat').lastElementChild?.remove();
    }
    busy = false; setInputs(true); setStatus('');
    toast(errorText(e));
    if (!log.length) resetControls();
  }
}

async function startListening() {
  if (listen || busy || !active) return;
  speechSynthesis.cancel();
  listen = new SpeechSession({ meter: $('ai-meter'), out: $('ai-live'), autoMark: false });
  try { await listen.open(); }
  catch { listen = null; return toast('Không mở được micro'); }
  listen.markStart();
  $('ai-mic').innerHTML = '<span class="rec-dot"></span>Gửi';
  setStatus('🎙 Đang nghe...');
  const t0 = performance.now();
  watcher = setInterval(() => {
    if (!listen) return;
    const now = performance.now();
    const silentFor = listen.lastVoice ? now - listen.lastVoice : 0;
    if ($('ai-handsfree').checked && listen.text && silentFor > 2200) finishListening();
    else if (now - t0 > 120000) finishListening();
  }, 200);
}

async function finishListening() {
  if (!listen) return;
  clearInterval(watcher);
  const s = listen; listen = null;
  $('ai-mic').textContent = '🎙 Nói';
  setStatus('Đang xử lý...');
  const r = await s.stop();
  $('ai-live').textContent = '';
  if (!r.text) { setStatus('Không nghe thấy. Bấm 🎙 để nói lại.'); return; }
  await sendUser(r.text, r);
}

async function sendUser(text, r) {
  if (!active || busy || !text.trim()) return;
  const meta = r ? [r.latency != null ? `bắt đầu sau ${r.latency.toFixed(1)}s` : '', r.wpm ? `${Math.round(r.wpm)} từ/phút` : '', r.pausesPerMin != null ? `${r.pausesPerMin.toFixed(1)} ngừng/phút` : '']
    .filter(Boolean).join(' · ') : 'gõ phím';
  addBubble('me', esc(text) + `<span class="meta">${esc(meta)}</span>`);
  log.push({ who: 'me', text });
  turns.push(r || null);
  history.push({ role: 'user', content: text });
  await claudeTurn();
}

$('ai-mic').onclick = () => listen ? finishListening() : startListening();
$('ai-send').onclick = () => { const t = $('ai-text').value; $('ai-text').value = ''; sendUser(t, null); };
$('ai-text').onkeydown = e => { if (e.key === 'Enter') $('ai-send').click(); };

// Gợi ý ý tưởng khi bí (không ghi vào lịch sử hội thoại)
$('ai-hint').onclick = async () => {
  const lastAi = [...log].reverse().find(x => x.who === 'ai');
  if (!lastAi) return;
  $('ai-hint').disabled = true;
  const b = addBubble('hint-b', '💭 Đang nghĩ gợi ý...');
  try {
    const msg = await streamClaude({
      system: 'You help an English learner who is stuck for words in a spoken conversation. Be brief.',
      messages: [{ role: 'user', content:
        `The other person just said: "${lastAi.text}"\n\nGive the learner 3 different short ideas they could say back, each a natural spoken English sentence starter of at most 10 words, one per line starting with "- ". Then one line starting with "Useful: " with a handy phrase for this moment. Nothing else.` }],
      effort: 'low',
    });
    b.innerHTML = '💭 ' + esc(textOf(msg));
  } catch (e) { b.remove(); toast(errorText(e)); }
  $('ai-hint').disabled = false;
};

/* ---------- Kết thúc & nhận xét ---------- */
function resetControls() {
  active = false;
  $('ai-begin').disabled = false; $('ai-end').disabled = true;
  $('ai-scenario').disabled = false; $('ai-correct').disabled = false;
  setInputs(false); setStatus('');
}
const avgOf = arr => { const v = arr.filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

$('ai-end').onclick = async () => {
  speechSynthesis.cancel();
  if (listen) { clearInterval(watcher); const s = listen; listen = null; await s.stop(); $('ai-mic').textContent = '🎙 Nói'; }
  resetControls();
  const myTurns = log.filter(x => x.who === 'me');
  if (!myTurns.length) return;

  const spoken = turns.filter(Boolean);
  const stats = {
    latency: avgOf(spoken.map(t => t.latency)),
    wpm: avgOf(spoken.map(t => t.wpm)),
    pauses: avgOf(spoken.map(t => t.pausesPerMin)),
    words: myTurns.reduce((a, t) => a + t.text.split(/\s+/).filter(Boolean).length, 0),
    mins: (Date.now() - startedAt) / 60000,
  };
  const label = SCENARIOS[$('ai-scenario').value].label;
  $('ai-feedback-card').hidden = false;
  $('ai-stats').innerHTML = statCards({ latency: stats.latency, wpm: stats.wpm, pausesPerMin: stats.pauses,
    pauses: spoken.reduce((a, t) => a + t.pauses, 0), words: stats.words, speakSec: spoken.reduce((a, t) => a + t.speakSec, 0) });

  // Lưu vào số liệu tiến độ
  S.reflex.push({ date: todayStr(), q: `💬 Hội thoại AI: ${label} (${myTurns.length} lượt)`, latency: stats.latency, wpm: stats.wpm, pauses: stats.pauses });
  today().minutes += stats.mins; save(); renderToday(); renderReflexHistory();

  const transcript = log.map(x => `${x.who === 'ai' ? 'Partner' : 'Learner'}: ${x.text}`).join('\n');
  const fb = $('ai-feedback'); fb.innerHTML = '<p class="hint">Đang viết nhận xét...</p>';
  let out = '';
  try {
    const msg = await streamClaude({
      system: 'You are a supportive English speaking coach for a Vietnamese learner (IELTS Speaking 6.5, aiming for 7.0-7.5) whose main goal is fluency and quick reactions in real conversation. Write your feedback in Vietnamese, quoting English examples in English.',
      messages: [{ role: 'user', content:
`Here is a spoken conversation (scenario: ${label}). The learner's lines come from speech recognition, so ignore punctuation, capitalisation and words that are obviously mis-recognised.

<transcript>
${transcript}
</transcript>

Measured fluency: average response start ${stats.latency?.toFixed(1) ?? 'n/a'} s (target ≤ 2 s), speaking rate ${stats.wpm ? Math.round(stats.wpm) : 'n/a'} words/min (target 120-130), pauses over 1 s: ${stats.pauses?.toFixed(1) ?? 'n/a'} per minute (target ≤ 3).

Write the feedback in Vietnamese with exactly these markdown sections:
### Điểm làm tốt
2-3 concrete points.
### Sửa lỗi quan trọng
Up to 5 of the learner's actual lines that most need fixing, each as: - "original" → "more natural version" (short reason). Prioritise errors that affect clarity or sound unnatural over minor slips.
### Cụm từ nên dùng
4-5 natural phrases that would have fit this conversation, each with a short Vietnamese gloss.
### Độ trôi chảy
2-3 sentences interpreting the numbers above and what to work on.
### Bài tập tiếp theo
One specific exercise for tomorrow (5-10 minutes).
Keep the whole thing under 350 words.` }],
      effort: 'medium',
      onText: d => { out += d; fb.innerHTML = renderMarkdown(out); },
    });
    fb.innerHTML = renderMarkdown(textOf(msg));
  } catch (e) { fb.innerHTML = `<p class="hint">${esc(errorText(e))}</p>`; }
  $('ai-feedback-card').scrollIntoView({ behavior: 'smooth' });
};

function renderMarkdown(md) {
  const lines = esc(md).split('\n');
  let html = '', inList = false;
  for (let line of lines) {
    line = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^\s*[-*] /.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${line.replace(/^\s*[-*] /, '')}</li>`; continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^#{1,4} /.test(line)) html += `<h3>${line.replace(/^#{1,4} /, '')}</h3>`;
    else if (line.trim()) html += `<p style="margin:4px 0">${line}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}
