// ==UserScript==
// @name         עוזר AI לכל דף
// @namespace    ai-page-assistant
// @version      1.3
// @description  כפתור AI בכל דף: מעתיק את כל הטקסט שבמסך ועונה לפי מה שאתה שואל
// @match        *://*/*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_MODEL = 'gemini-flash-lite-latest';
  const KEY_URL = 'https://aistudio.google.com/apikey';
  const MAX_CHARS = 150000;

  const getKey = () => GM_getValue('api_key', '');
  const getModel = () => GM_getValue('model', DEFAULT_MODEL);

  function askKey(force) {
    let key = getKey();
    if (!key || force) {
      if (!key) { try { GM_openInTab(KEY_URL, { active: false }); } catch (e) {} }
      const input = prompt('הכנס מפתח API של Gemini (נשמר רק בדפדפן שלך).\nלהשגת מפתח חינם: ' + KEY_URL, key || '');
      if (input === null) return key;
      key = input.trim();
      GM_setValue('api_key', key);
    }
    return key;
  }

  function getPageText() {
    let text = (document.body && document.body.innerText) || '';
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n...[נחתך]';
    return text;
  }

  // ---------- UI ----------
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }

      /* ----- כפתור צף ----- */
      #fab { position: fixed; bottom: 20px; left: 20px; width: 56px; height: 56px; border-radius: 50%;
        border: none; color: #fff; font-size: 17px; font-weight: 800; letter-spacing: .5px; cursor: pointer;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        box-shadow: 0 8px 24px rgba(99,102,241,.55);
        animation: pop .6s cubic-bezier(.34,1.56,.64,1) both;
        transition: transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s; }
      #fab:hover { transform: scale(1.12) rotate(-6deg); box-shadow: 0 10px 30px rgba(139,92,246,.7); }
      #fab:active { transform: scale(.92); }
      #fab::after { content: ''; position: absolute; inset: 0; border-radius: 50%;
        border: 2px solid rgba(139,92,246,.8); animation: ring 2.4s ease-out infinite; pointer-events: none; }
      #fab.on { background: linear-gradient(135deg, #334155, #1e293b); box-shadow: 0 6px 18px rgba(0,0,0,.5); }
      #fab.on::after { display: none; }
      @keyframes pop { from { transform: scale(0) rotate(-120deg); opacity: 0; } to { transform: none; opacity: 1; } }
      @keyframes ring { 0% { transform: scale(1); opacity: .9; } 100% { transform: scale(1.8); opacity: 0; } }

      /* ----- חלון ----- */
      #panel { position: fixed; bottom: 90px; left: 20px; width: 410px; max-width: calc(100vw - 32px);
        height: 580px; max-height: calc(100vh - 112px); background: #0f172a; color: #e2e8f0;
        border: 1px solid #334155; border-radius: 22px; box-shadow: 0 24px 70px rgba(0,0,0,.6);
        display: flex; flex-direction: column; direction: rtl; overflow: hidden;
        opacity: 0; visibility: hidden; pointer-events: none;
        transform: translateY(26px) scale(.94); transform-origin: bottom left;
        transition: opacity .25s ease, transform .35s cubic-bezier(.2,.9,.3,1.15), visibility 0s .35s; }
      #panel.open { opacity: 1; visibility: visible; pointer-events: auto; transform: none;
        transition: opacity .25s ease, transform .35s cubic-bezier(.2,.9,.3,1.15), visibility 0s; }

      #head { background: linear-gradient(90deg, #6366f1, #8b5cf6); padding: 14px 16px; display: flex;
        align-items: center; gap: 8px; color: #fff; }
      #titles { flex: 1; line-height: 1.25; }
      #titles b { display: block; font-size: 17px; }
      #titles small { font-size: 11px; opacity: .8; }
      .hb { background: rgba(255,255,255,.2); color: #fff; border: none; border-radius: 14px; padding: 6px 12px;
        font-size: 12px; cursor: pointer; transition: background .2s, transform .15s; }
      .hb:hover { background: rgba(255,255,255,.35); }
      .hb:active { transform: scale(.92); }
      #close { font-size: 16px; padding: 4px 11px; }

      #info { margin: 10px 12px 0; padding: 6px 12px; font-size: 12px; color: #94a3b8;
        background: #1e293b; border-radius: 12px; }

      #chat { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
      #empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        text-align: center; color: #64748b; font-size: 15px; line-height: 1.6; padding: 20px;
        transition: opacity .3s; pointer-events: none; }
      #empty.hide { opacity: 0; }
      #msgs { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
        scrollbar-width: thin; scrollbar-color: #334155 transparent; }
      #msgs::-webkit-scrollbar { width: 6px; }
      #msgs::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }

      .m { position: relative; padding: 10px 14px; border-radius: 18px; font-size: 14.5px; line-height: 1.6;
        white-space: pre-wrap; word-wrap: break-word; max-width: 88%; animation: rise .32s cubic-bezier(.2,.9,.3,1.2) both; }
      @keyframes rise { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
      .u { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; align-self: flex-start;
        border-top-right-radius: 6px; }
      .a { background: #1e293b; color: #e2e8f0; align-self: flex-end; border-top-left-radius: 6px; }
      .e { background: #3f1d2b; color: #fca5a5; align-self: flex-end; }
      .a .cp { position: absolute; bottom: -9px; left: 10px; font-size: 11px; background: #334155; color: #cbd5e1;
        border: none; border-radius: 10px; padding: 2px 9px; cursor: pointer; opacity: 0;
        transform: translateY(4px); transition: opacity .2s, transform .2s; }
      .a:hover .cp { opacity: 1; transform: none; }
      .a { margin-bottom: 6px; }

      .dots { display: flex; gap: 6px; padding: 14px 16px; }
      .dots i { width: 8px; height: 8px; border-radius: 50%; background: #94a3b8; animation: blink 1.2s infinite ease-in-out; }
      .dots i:nth-child(2) { animation-delay: .18s; }
      .dots i:nth-child(3) { animation-delay: .36s; }
      @keyframes blink { 0%, 80%, 100% { opacity: .25; transform: scale(.8); } 40% { opacity: 1; transform: scale(1.15); } }

      #chips { display: flex; gap: 8px; padding: 6px 12px 2px; overflow-x: auto; scrollbar-width: none; }
      #chips::-webkit-scrollbar { display: none; }
      .chip { flex: none; background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 16px;
        padding: 6px 14px; font-size: 13px; cursor: pointer; transition: background .2s, transform .15s, border-color .2s; }
      .chip:hover { background: #334155; border-color: #8b5cf6; }
      .chip:active { transform: scale(.93); }

      #row { display: flex; align-items: center; gap: 6px; margin: 8px 12px 12px; 
        padding: 4px 14px 4px 4px; background: #1e293b; border-radius: 28px; border: 1px solid transparent;
        transition: border-color .2s, box-shadow .2s; }
      #row:focus-within { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,.2); }
      #q { flex: 1; background: transparent; border: none; outline: none; color: #e2e8f0; font-size: 14.5px;
        direction: rtl; resize: none; height: 24px; line-height: 24px; padding: 8px 0 8px 8px; }
      #q::placeholder { color: #64748b; }
      #send { flex: none; width: 40px; height: 40px; border-radius: 50%; border: none; color: #fff; font-size: 20px;
        font-weight: 700; cursor: pointer; background: linear-gradient(135deg, #6366f1, #8b5cf6);
        transition: transform .2s cubic-bezier(.34,1.56,.64,1), opacity .2s; }
      #send:hover { transform: scale(1.1); }
      #send:active { transform: scale(.88); }
      #send:disabled { opacity: .4; transform: none; cursor: default; }
    </style>

    <button id="fab" title="עוזר AI">AI</button>
    <div id="panel">
      <div id="head">
        <div id="titles"><b>עוזר AI</b><small>עונה לפי הדף שאתה צופה בו</small></div>
        <button class="hb" id="refresh" title="קרא מחדש את הטקסט שבדף">רענן</button>
        <button class="hb" id="clear">נקה</button>
        <button class="hb" id="settings">מפתח</button>
        <button class="hb" id="close">×</button>
      </div>
      <div id="info"></div>
      <div id="chat">
        <div id="empty">לחץ על אחד הכפתורים למטה<br>או שאל שאלה על הדף</div>
        <div id="msgs"></div>
      </div>
      <div id="chips">
        <button class="chip" data-p="סכם לי את הדף בקצרה, בנקודות.">סכם</button>
        <button class="chip" data-p="מה הדבר הכי חשוב בדף הזה? תשובה של 2-3 משפטים.">מה העיקר?</button>
        <button class="chip" data-p="תרגם לעברית את עיקרי הדף.">תרגם לעברית</button>
        <button class="chip" data-p="הסבר לי את תוכן הדף בצורה פשוטה.">הסבר בפשטות</button>
      </div>
      <div id="row">
        <textarea id="q" placeholder="שאל על הדף..." rows="1"></textarea>
        <button id="send" title="שלח">↑</button>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (id) => root.getElementById(id);
  const panel = $('panel'), msgs = $('msgs'), q = $('q'), send = $('send'), info = $('info'),
        fab = $('fab'), empty = $('empty');

  let pageText = '';
  let history = [];
  let gen = 0;

  function loadPage() {
    pageText = getPageText();
    info.textContent = 'הועתקו ' + pageText.length.toLocaleString() + ' תווים מהדף';
  }

  function scrollDown() { msgs.scrollTop = msgs.scrollHeight; }

  function addMsg(text, cls) {
    empty.classList.add('hide');
    const d = document.createElement('div');
    d.className = 'm ' + cls;
    d.textContent = text;
    msgs.appendChild(d);
    scrollDown();
    return d;
  }

  function addTyping() {
    empty.classList.add('hide');
    const d = document.createElement('div');
    d.className = 'm a dots';
    d.innerHTML = '<i></i><i></i><i></i>';
    msgs.appendChild(d);
    scrollDown();
    return d;
  }

  function reveal(el, text) {
    const n = text.length;
    const dur = Math.min(1500, Math.max(250, n * 7));
    const t0 = performance.now();
    (function step(now) {
      const k = Math.min(n, Math.floor(((now - t0) / dur) * n));
      el.firstChild.textContent = text.slice(0, k);
      scrollDown();
      if (k < n) requestAnimationFrame(step); else el.firstChild.textContent = text;
    })(t0);
  }

  function copyText(t, btn) {
    const done = () => { btn.textContent = 'הועתק ✓'; setTimeout(() => (btn.textContent = 'העתק'), 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => {});
    else {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} ta.remove();
    }
  }

  function showAnswer(slot, text) {
    slot.className = 'm a';
    slot.innerHTML = '<span></span><button class="cp">העתק</button>';
    slot.lastChild.onclick = () => copyText(text, slot.lastChild);
    reveal(slot, text);
  }

  function openPanel() {
    if (!askKey(false)) return;
    loadPage();
    panel.classList.add('open');
    fab.classList.add('on');
    setTimeout(() => q.focus(), 300);
  }

  function closePanel() {
    panel.classList.remove('open');
    fab.classList.remove('on');
  }

  function toggle() { panel.classList.contains('open') ? closePanel() : openPanel(); }

  function clearChat() {
    gen++;
    history = [];
    msgs.innerHTML = '';
    empty.classList.remove('hide');
    send.disabled = false;
  }

  fab.onclick = toggle;
  $('close').onclick = closePanel;
  $('refresh').onclick = () => { loadPage(); addMsg('הטקסט של הדף נקרא מחדש.', 'a'); };
  $('clear').onclick = clearChat;
  $('settings').onclick = () => askKey(true);
  root.querySelectorAll('.chip').forEach((c) => (c.onclick = () => submit(c.dataset.p)));
  GM_registerMenuCommand('פתח/סגור עוזר AI', toggle);
  GM_registerMenuCommand('שנה מפתח API', () => askKey(true));
  GM_registerMenuCommand('שנה מודל', () => {
    const m = prompt('שם מודל Gemini:', getModel());
    if (m) GM_setValue('model', m.trim());
  });

  // ---------- AI ----------
  function callGemini(userText) {
    return new Promise((resolve, reject) => {
      const key = getKey();
      if (!key) return reject(new Error('אין מפתח API'));
      history.push({ role: 'user', parts: [{ text: userText }] });
      const body = {
        systemInstruction: {
          parts: [{
            text:
              'אתה עוזר שעונה למשתמש על סמך תוכן הדף שהוא צופה בו. ענה בשפה שבה המשתמש כותב (ברירת מחדל: עברית), בקצרה וישירות.\n' +
              'כתובת הדף: ' + location.href + '\nכותרת: ' + document.title +
              '\n\n===== תוכן הדף =====\n' + pageText
          }]
        },
        contents: history
      };
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(getModel()) + ':generateContent',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        data: JSON.stringify(body),
        timeout: 120000,
        onload: (r) => {
          try {
            const j = JSON.parse(r.responseText);
            if (r.status >= 300) throw new Error((j.error && j.error.message) || ('שגיאה ' + r.status));
            const t = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
            if (!t) throw new Error('תשובה ריקה');
            history.push({ role: 'model', parts: [{ text: t }] });
            resolve(t);
          } catch (e) { history.pop(); reject(e); }
        },
        onerror: () => { history.pop(); reject(new Error('שגיאת רשת')); },
        ontimeout: () => { history.pop(); reject(new Error('הבקשה נתקעה')); }
      });
    });
  }

  async function submit(textArg) {
    const text = (typeof textArg === 'string' ? textArg : q.value).trim();
    if (!text || send.disabled) return;
    if (typeof textArg !== 'string') q.value = '';
    addMsg(text, 'u');
    const wait = addTyping();
    const g = gen;
    send.disabled = true;
    try {
      const ans = await callGemini(text);
      if (g !== gen) return;
      showAnswer(wait, ans);
    } catch (e) {
      if (g !== gen) return;
      wait.className = 'm e';
      wait.textContent = 'שגיאה: ' + e.message;
    }
    send.disabled = false;
    scrollDown();
    q.focus();
  }

  send.onclick = () => submit();
  q.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') closePanel();
  });
  q.addEventListener('keyup', (e) => e.stopPropagation());
  q.addEventListener('keypress', (e) => e.stopPropagation());
})();
