/**
 * SaintSal™ Labs — Builder v2
 * 5-Agent AI App Builder Frontend
 * Vanilla JS · No frameworks · No imports
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const BUILDER_API_KEY = 'saintvision_gateway_2025';
const BUILDER_HEADERS  = { 'Content-Type': 'application/json', 'x-sal-key': BUILDER_API_KEY };

const AGENT_META = {
  grok:          { name: 'Grok 4.20',      role: 'Architect',   color: '#f59e0b' },
  stitch:        { name: 'Stitch',          role: 'Designer',    color: '#60a5fa' },
  'claude-sonnet': { name: 'Claude Sonnet', role: 'Engineer',    color: '#a78bfa' },
  'claude-opus': { name: 'Claude Opus',     role: 'Synthesizer', color: '#a78bfa' },
  gpt5:          { name: 'GPT-5 Core',      role: 'Validator',   color: '#00ff88' },
};

// ─── State ────────────────────────────────────────────────────────────────────

let builderState = {
  sessionId:   null,
  files:       [],           // [{ path, content, language }]
  activeFile:  null,
  timerStart:  null,
  timerHandle: null,
  building:    false,
  phase:       'idle',       // idle | building | awaiting_approval | complete
  mobileTab:   'chat',       // chat | files | preview
};

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Called by app.js navigate() when builder page is shown.
 * Also self-invoked on DOMContentLoaded as a fallback.
 */
function initBuilder() {
  fetchBuilderModels();
  builderInitMobileTabs();
  // Reset to clean state visually
  if (builderState.phase === 'idle') {
    resetAgentCards();
  }
}

// Kick off init once DOM is ready (handles direct load scenarios)
document.addEventListener('DOMContentLoaded', () => {
  // Only run if the builder elements exist
  if (document.getElementById('builder-input')) {
    initBuilder();
  }
});

// ─── Model Selector ───────────────────────────────────────────────────────────

async function fetchBuilderModels() {
  try {
    const res = await fetch('/api/builder/models', { headers: BUILDER_HEADERS });
    if (!res.ok) return; // Silently fail — keep static defaults
    const data = await res.json();
    const select = document.getElementById('builder-model');
    if (!select || !Array.isArray(data.models)) return;
    select.innerHTML = '';
    data.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value   = m.id || m.value || m;
      opt.textContent = m.label || m.name || m;
      select.appendChild(opt);
    });
  } catch (_) {
    // Network error — keep the static defaults already in the HTML
  }
}

// ─── Keyboard Handler ─────────────────────────────────────────────────────────

function builderKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    startBuild();
  }
}

// ─── New Build ────────────────────────────────────────────────────────────────

function newBuild() {
  stopTimer();
  builderState = {
    sessionId:   null,
    files:       [],
    activeFile:  null,
    timerStart:  null,
    timerHandle: null,
    building:    false,
    phase:       'idle',
    mobileTab:   builderState.mobileTab,
  };

  // Reset UI
  resetAgentCards();
  setStatus('Ready to build');
  document.getElementById('builder-chat-messages').innerHTML =
    '<p>Describe what you want to build. SAL\'s 5-agent pipeline will architect, design, build, and validate your app.</p>';
  document.getElementById('file-tree').innerHTML   =
    '<p style="font-size:12px;color:var(--t3);padding:8px">No files yet.</p>';
  document.getElementById('code-editor').textContent = '// Generated code appears here';
  document.getElementById('builder-timer').textContent = '⏱ 0:00';
  document.getElementById('builder-session-badge').textContent = 'New Build';
  document.getElementById('builder-deploy-btn').disabled = true;

  const placeholder = document.getElementById('preview-placeholder');
  const frame       = document.getElementById('preview-frame');
  if (placeholder) placeholder.style.display = '';
  if (frame)       { frame.style.display = 'none'; frame.srcdoc = ''; }

  document.getElementById('builder-input').value = '';
  document.getElementById('builder-input').focus();
}

// ─── Start Build ──────────────────────────────────────────────────────────────

function startBuild() {
  const input  = document.getElementById('builder-input');
  const prompt = (input ? input.value : '').trim();
  if (!prompt) return;
  if (builderState.building) return;

  const modelOverride = (document.getElementById('builder-model') || {}).value || null;

  // Clear input
  if (input) input.value = '';

  // Show user message
  appendChatMessage('user', prompt);

  // Begin pipeline
  builderState.building = true;
  builderState.phase    = 'building';
  resetAgentCards('waiting');
  startTimer();
  setStatus('Initializing 5-agent pipeline…');

  const body = JSON.stringify({
    prompt,
    tier:           'pro',
    session_id:     builderState.sessionId,
    model_override: modelOverride,
  });

  streamSSE('/api/builder/agent/v2', body, handleBuilderEvent, () => {
    // onComplete callback — phase transitions happen via SSE events
    builderState.building = false;
  });
}

// ─── Design Approval ──────────────────────────────────────────────────────────

function approveDesign(approved, feedback) {
  if (!builderState.sessionId) return;

  // Remove the approval card from chat
  const approvalCard = document.getElementById('design-approval-card');
  if (approvalCard) approvalCard.remove();

  setStatus(approved ? 'Approved — generating code…' : 'Sending feedback…');
  builderState.building = true;
  builderState.phase    = 'building';

  const body = JSON.stringify({
    session_id: builderState.sessionId,
    approved,
    feedback: feedback || null,
  });

  streamSSE('/api/builder/agent/v2/approve', body, handleBuilderEvent, () => {
    builderState.building = false;
  });
}

// ─── Iteration ────────────────────────────────────────────────────────────────

function startIteration(changePrompt) {
  if (!changePrompt || !builderState.files.length) return;

  appendChatMessage('user', changePrompt);
  setStatus('Iterating…');
  builderState.building = true;
  startTimer();

  const body = JSON.stringify({
    change: changePrompt,
    files:  builderState.files,
  });

  streamSSE('/api/builder/iterate', body, handleBuilderEvent, () => {
    builderState.building = false;
  });
}

// ─── SSE Stream Helper ────────────────────────────────────────────────────────

/**
 * Open a server-sent event stream via fetch (POST).
 * Parses `event: name\ndata: json\n\n` format.
 */
async function streamSSE(path, body, onEvent, onComplete) {
  try {
    const res = await fetch(path, {
      method:  'POST',
      headers: BUILDER_HEADERS,
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      handleBuilderEvent('error', { agent: 'gateway', message: `HTTP ${res.status}: ${text}`, recoverable: true });
      onComplete && onComplete();
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop(); // keep incomplete block

      for (const block of blocks) {
        if (!block.trim()) continue;
        const eventName = (block.match(/^event:\s*(.+)$/m) || [])[1] || 'message';
        const dataLine  = (block.match(/^data:\s*(.+)$/m)  || [])[1] || '';
        let data = {};
        try { data = JSON.parse(dataLine); } catch (_) { data = { raw: dataLine }; }
        onEvent(eventName, data);
      }
    }
  } catch (err) {
    handleBuilderEvent('error', { agent: 'network', message: err.message || String(err), recoverable: true });
  }
  onComplete && onComplete();
}

// ─── SSE Event Handler ────────────────────────────────────────────────────────

function handleBuilderEvent(eventName, data) {
  switch (eventName) {
    case 'agent_status':     onAgentStatus(data);     break;
    case 'plan_ready':       onPlanReady(data);        break;
    case 'design_ready':     onDesignReady(data);      break;
    case 'awaiting_approval':onAwaitingApproval(data); break;
    case 'scaffold_ready':   onScaffoldReady(data);    break;
    case 'files_ready':      onFilesReady(data);       break;
    case 'validation_ready': onValidationReady(data);  break;
    case 'complete':         onBuildComplete(data);    break;
    case 'error':            onBuildError(data);       break;
    default: break; // Ignore unknown events
  }
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

function onAgentStatus({ agent, status, message }) {
  updateAgentCard(agent, status, message);
  if (message) setStatus(message);
}

function onPlanReady({ plan, components, tech_stack }) {
  const stackItems = tech_stack
    ? Object.entries(tech_stack).map(([k, v]) => `<span style="color:var(--gold)">${k}:</span> ${v}`).join(' · ')
    : '';

  const compList = Array.isArray(components) && components.length
    ? `<ul style="margin:8px 0 0;padding-left:16px;color:var(--t2)">
        ${components.map(c => `<li>${escHtml(c)}</li>`).join('')}
       </ul>`
    : '';

  appendChatMessage('agent', `
    <div class="builder-event-card">
      <div class="builder-event-label">📐 Architecture Plan</div>
      <p style="margin:6px 0;white-space:pre-wrap">${escHtml(plan || '')}</p>
      ${stackItems ? `<p style="font-size:11px;color:var(--t3);margin:6px 0">${stackItems}</p>` : ''}
      ${compList}
    </div>
  `);
  setStatus('Plan ready — designing screens…');
}

function onDesignReady({ screens, session_id }) {
  if (session_id) {
    builderState.sessionId = session_id;
    document.getElementById('builder-session-badge').textContent = `Session: ${session_id.slice(-6)}`;
  }

  const thumbs = Array.isArray(screens) && screens.length
    ? screens.map(s => `
        <div style="margin-bottom:8px">
          <div style="font-size:11px;color:var(--t3);margin-bottom:4px">${escHtml(s.name || 'Screen')}</div>
          ${s.thumbnail
            ? `<img src="${escHtml(s.thumbnail)}" style="width:100%;border-radius:4px;border:1px solid var(--brd)" alt="${escHtml(s.name)}">`
            : `<div style="background:#111114;border:1px solid var(--brd);border-radius:4px;padding:24px;text-align:center;color:var(--t3);font-size:12px">Preview unavailable</div>`
          }
        </div>
      `).join('')
    : '<p style="color:var(--t3);font-size:12px">Design screens generated.</p>';

  appendChatMessage('agent', `
    <div class="builder-event-card">
      <div class="builder-event-label">🎨 Design Ready</div>
      ${thumbs}
    </div>
  `);
  setStatus('Design ready — awaiting your approval');
}

function onAwaitingApproval({ session_id, message }) {
  if (session_id) builderState.sessionId = session_id;
  builderState.phase = 'awaiting_approval';

  appendChatMessage('agent', `
    <div class="builder-event-card" id="design-approval-card">
      <div class="builder-event-label">⏳ Approval Required</div>
      <p style="margin:6px 0;color:var(--t2)">${escHtml(message || 'Review the design and approve to generate code.')}</p>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" onclick="approveDesign(true, null)">✓ Approve &amp; Build</button>
        <button class="btn btn-ghost btn-sm" onclick="requestChanges()">✎ Request Changes</button>
      </div>
      <div id="change-request-area" style="display:none;margin-top:10px">
        <textarea
          id="change-request-input"
          class="chat-input"
          rows="2"
          placeholder="Describe what you'd like changed…"
          style="font-size:12px"
        ></textarea>
        <button class="btn btn-gold btn-sm" style="margin-top:6px" onclick="submitChangeFeedback()">Send Feedback</button>
      </div>
    </div>
  `);
  builderState.building = false; // Pause
}

function requestChanges() {
  const area = document.getElementById('change-request-area');
  if (area) { area.style.display = ''; document.getElementById('change-request-input').focus(); }
}

function submitChangeFeedback() {
  const input    = document.getElementById('change-request-input');
  const feedback = input ? input.value.trim() : '';
  approveDesign(false, feedback || null);
}

function onScaffoldReady({ files }) {
  if (!Array.isArray(files)) return;
  setStatus(`Scaffolding ${files.length} files…`);
  // Show file paths as skeleton in the file tree
  renderFileTree(files.map(f => ({ path: f.path, description: f.description, content: '' })));
}

function onFilesReady({ files }) {
  if (!Array.isArray(files)) return;
  builderState.files = files;

  renderFileTree(files);

  // Auto-select first HTML or index file for preview
  const htmlFile = files.find(f => f.path.endsWith('.html'))
    || files.find(f => f.path.includes('index'))
    || files[0];

  if (htmlFile) {
    selectFile(htmlFile.path);
  }

  // Render preview with first HTML file
  const previewFile = files.find(f => f.path.endsWith('.html'));
  if (previewFile) renderPreview(previewFile.content || '');

  setStatus(`${files.length} files generated — ready`);
}

function onValidationReady({ lint_results, suggestions }) {
  const items = Array.isArray(suggestions) && suggestions.length
    ? suggestions.map(s => `<li style="color:var(--t2)">${escHtml(s)}</li>`).join('')
    : '';

  const lintStatus = lint_results && lint_results.errors === 0
    ? '<span style="color:var(--green)">✓ No errors</span>'
    : `<span style="color:var(--coral)">⚠ ${(lint_results && lint_results.errors) || 0} error(s)</span>`;

  appendChatMessage('agent', `
    <div class="builder-event-card">
      <div class="builder-event-label">🛡 Validation ${lintStatus}</div>
      ${items ? `<ul style="margin:8px 0 0;padding-left:16px;font-size:12px">${items}</ul>` : ''}
    </div>
  `);
}

function onBuildComplete({ session_id, total_files }) {
  if (session_id) builderState.sessionId = session_id;
  builderState.phase    = 'complete';
  builderState.building = false;

  stopTimer();

  const elapsed = formatElapsed(builderState.timerStart);
  appendChatMessage('agent', `
    <div class="builder-event-card" style="border-color:var(--green)">
      <div class="builder-event-label" style="color:var(--green)">✓ Build Complete</div>
      <p style="color:var(--t2);margin:6px 0">
        ${total_files || builderState.files.length} files generated in ${elapsed}.
        Click any file to view code, or use the preview pane.
      </p>
      <p style="font-size:12px;color:var(--t3);margin:4px 0">
        Type a follow-up message to iterate (e.g. "make the header dark blue")
      </p>
    </div>
  `);

  setStatus(`Build complete · ${total_files || builderState.files.length} files`);
  document.getElementById('builder-deploy-btn').disabled = false;
}

function onBuildError({ agent, message, recoverable }) {
  builderState.building = false;
  builderState.phase    = builderState.phase === 'idle' ? 'idle' : 'complete';
  stopTimer();

  appendChatMessage('agent', `
    <div class="builder-event-card" style="border-color:var(--coral)">
      <div class="builder-event-label" style="color:var(--coral)">✗ Error — ${escHtml(agent || 'Unknown agent')}</div>
      <p style="color:var(--t2);margin:6px 0">${escHtml(message || 'An unexpected error occurred.')}</p>
      ${recoverable ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="retryBuild()">↺ Retry</button>` : ''}
    </div>
  `);

  setStatus(`Error: ${message || 'Build failed'}`);
}

// ─── Retry ────────────────────────────────────────────────────────────────────

function retryBuild() {
  // Re-read last user message and retry
  const msgs  = document.querySelectorAll('#builder-chat-messages .chat-msg-user');
  const last  = msgs.length ? msgs[msgs.length - 1] : null;
  const text  = last ? last.textContent.trim() : '';
  if (!text) { newBuild(); return; }

  builderState.building = false;
  const input = document.getElementById('builder-input');
  if (input) input.value = text;
  startBuild();
}

// ─── File Tree ────────────────────────────────────────────────────────────────

function renderFileTree(files) {
  const tree = document.getElementById('file-tree');
  if (!tree) return;

  // Build folder structure
  const groups = {};
  files.forEach(f => {
    const parts  = f.path.replace(/^\//, '').split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!groups[folder]) groups[folder] = [];
    groups[folder].push(f);
  });

  let html = '';
  Object.keys(groups).sort().forEach(folder => {
    if (folder) {
      html += `<div class="code-file-folder">📁 ${escHtml(folder)}</div>`;
    }
    groups[folder].forEach(f => {
      const icon = fileIcon(f.path);
      const name = f.path.split('/').pop();
      html += `<div class="code-file" data-path="${escHtml(f.path)}" onclick="selectFile('${escAttr(f.path)}')" title="${escHtml(f.path)}">
        ${icon} ${escHtml(name)}
        ${f.description ? `<span style="font-size:10px;color:var(--t3);display:block;margin-left:16px">${escHtml(f.description)}</span>` : ''}
      </div>`;
    });
  });

  tree.innerHTML = html || '<p style="font-size:12px;color:var(--t3);padding:8px">No files yet.</p>';
}

function selectFile(path) {
  // Mark active in tree
  document.querySelectorAll('#file-tree .code-file').forEach(el => {
    el.classList.toggle('active', el.dataset.path === path);
  });

  const file = builderState.files.find(f => f.path === path);
  if (!file) return;

  builderState.activeFile = path;

  // Render in code editor
  const editor = document.getElementById('code-editor');
  if (editor) {
    editor.innerHTML = syntaxHighlight(file.content || '', file.language || inferLanguage(path));
  }

  // Auto-preview HTML files
  if (path.endsWith('.html') && file.content) {
    renderPreview(file.content);
  }
}

function fileIcon(path) {
  if (path.endsWith('.html'))                return '🌐';
  if (path.endsWith('.css'))                 return '🎨';
  if (path.endsWith('.js'))                  return '⚡';
  if (path.endsWith('.ts'))                  return '🔷';
  if (path.endsWith('.json'))                return '📋';
  if (path.endsWith('.md'))                  return '📝';
  if (path.endsWith('.py'))                  return '🐍';
  if (path.match(/\.(png|jpg|jpeg|svg|gif)/)) return '🖼';
  return '📄';
}

function inferLanguage(path) {
  if (path.endsWith('.html'))  return 'html';
  if (path.endsWith('.css'))   return 'css';
  if (path.endsWith('.js'))    return 'javascript';
  if (path.endsWith('.ts'))    return 'typescript';
  if (path.endsWith('.json'))  return 'json';
  if (path.endsWith('.py'))    return 'python';
  if (path.endsWith('.sh'))    return 'bash';
  return 'text';
}

// ─── Syntax Highlighting (CSS-based, no libs) ─────────────────────────────────

function syntaxHighlight(code, lang) {
  let escaped = escHtml(code);

  if (lang === 'html') {
    escaped = escaped
      .replace(/(&lt;\/?[\w-]+)((?:\s[^&]*?)?)(\/&gt;|&gt;)/g, '<span style="color:#60a5fa">$1</span>$2<span style="color:#60a5fa">$3</span>')
      .replace(/(\s)([\w-]+=)(&quot;[^&]*?&quot;)/g, '$1<span style="color:#f59e0b">$2</span><span style="color:#a78bfa">$3</span>');
  } else if (lang === 'css') {
    escaped = escaped
      .replace(/([.#]?[\w-]+)\s*\{/g, '<span style="color:#60a5fa">$1</span> {')
      .replace(/([\w-]+)\s*:/g, '<span style="color:#f59e0b">$1</span>:')
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#666">$1</span>');
  } else if (lang === 'javascript' || lang === 'typescript') {
    const keywords = /\b(const|let|var|function|async|await|return|if|else|for|while|class|import|export|default|new|this|true|false|null|undefined|typeof|instanceof|try|catch|throw|=>)\b/g;
    escaped = escaped
      .replace(keywords,        '<span style="color:#a78bfa">$1</span>')
      .replace(/(\/\/[^\n]*)/g, '<span style="color:#666">$1</span>')
      .replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;|`[^`]*?`)/g, '<span style="color:#00ff88">$1</span>')
      .replace(/\b(\d+)\b/g,   '<span style="color:#f59e0b">$1</span>');
  } else if (lang === 'json') {
    escaped = escaped
      .replace(/(&quot;[\w-]+&quot;)\s*:/g,   '<span style="color:#60a5fa">$1</span>:')
      .replace(/:\s*(&quot;[^&]*?&quot;)/g,   ': <span style="color:#00ff88">$1</span>')
      .replace(/\b(true|false|null)\b/g,       '<span style="color:#a78bfa">$1</span>')
      .replace(/\b(\d+\.?\d*)\b/g,            '<span style="color:#f59e0b">$1</span>');
  } else if (lang === 'python') {
    const pyKeywords = /\b(def|class|import|from|return|if|elif|else|for|while|try|except|with|as|in|not|and|or|True|False|None|lambda|yield|pass|break|continue)\b/g;
    escaped = escaped
      .replace(pyKeywords,      '<span style="color:#a78bfa">$1</span>')
      .replace(/(#[^\n]*)/g,    '<span style="color:#666">$1</span>')
      .replace(/(&quot;[^&]*?&quot;)/g, '<span style="color:#00ff88">$1</span>')
      .replace(/\b(\d+)\b/g,   '<span style="color:#f59e0b">$1</span>');
  }

  return `<pre style="margin:0;white-space:pre-wrap;word-break:break-word">${escaped}</pre>`;
}

// ─── Preview ──────────────────────────────────────────────────────────────────

function renderPreview(html) {
  const frame       = document.getElementById('preview-frame');
  const placeholder = document.getElementById('preview-placeholder');

  if (!frame) return;

  if (placeholder) placeholder.style.display = 'none';
  frame.style.display = 'block';
  frame.srcdoc = html;
}

// ─── Agent Cards ──────────────────────────────────────────────────────────────

function resetAgentCards(status) {
  const s = status || 'idle';
  document.querySelectorAll('#agent-cards .agent-card').forEach(card => {
    card.dataset.status = s;
    const txt = card.querySelector('.agent-status-text');
    if (txt) txt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
  });
}

function updateAgentCard(agentId, status, message) {
  const card = document.querySelector(`#agent-cards .agent-card[data-agent="${agentId}"]`);
  if (!card) return;

  card.dataset.status = status; // CSS handles border/dot color

  const label = { waiting: 'Waiting', active: 'Active…', complete: 'Done', error: 'Error' }[status] || status;
  const txt   = card.querySelector('.agent-status-text');
  if (txt) txt.textContent = message && message.length < 30 ? message : label;
}

// ─── Chat Messages ────────────────────────────────────────────────────────────

function appendChatMessage(role, htmlContent) {
  const container = document.getElementById('builder-chat-messages');
  if (!container) return;

  const div = document.createElement('div');
  div.className = role === 'user' ? 'chat-msg-user' : 'chat-msg-agent';
  div.style.cssText = role === 'user'
    ? 'background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:10px 14px;margin:8px 0;color:var(--t1);font-size:13px'
    : 'margin:8px 0;font-size:13px;color:var(--t2)';

  if (role === 'user') {
    div.textContent = htmlContent; // Safe — user text is plain
  } else {
    div.innerHTML = htmlContent;   // Agent HTML — already escaped in callers
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

function setStatus(text) {
  const el = document.getElementById('builder-status-text');
  if (el) el.textContent = text;
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer() {
  stopTimer();
  builderState.timerStart  = Date.now();
  builderState.timerHandle = setInterval(tickTimer, 1000);
  tickTimer();
}

function stopTimer() {
  if (builderState.timerHandle) {
    clearInterval(builderState.timerHandle);
    builderState.timerHandle = null;
  }
}

function tickTimer() {
  const el = document.getElementById('builder-timer');
  if (!el) return;
  el.textContent = '⏱ ' + formatElapsed(builderState.timerStart);
}

function formatElapsed(startMs) {
  if (!startMs) return '0:00';
  const secs  = Math.floor((Date.now() - startMs) / 1000);
  const m     = Math.floor(secs / 60);
  const s     = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Deploy Menu ──────────────────────────────────────────────────────────────

function showDeployMenu() {
  // Remove any existing menu
  const existing = document.getElementById('deploy-dropdown');
  if (existing) { existing.remove(); return; }

  const btn  = document.getElementById('builder-deploy-btn');
  if (!btn) return;

  const menu = document.createElement('div');
  menu.id    = 'deploy-dropdown';
  menu.style.cssText = `
    position:absolute;right:0;top:calc(100% + 4px);min-width:160px;
    background:#111114;border:1px solid var(--brd);border-radius:8px;
    box-shadow:0 8px 24px rgba(0,0,0,0.6);z-index:1000;overflow:hidden;
  `;
  menu.innerHTML = `
    <div class="deploy-menu-item" onclick="deployTo('vercel')">▲ Deploy to Vercel</div>
    <div class="deploy-menu-item" onclick="deployTo('render')">☁ Deploy to Render</div>
    <div class="deploy-menu-item" onclick="downloadZip()">⬇ Download ZIP</div>
  `;
  // Inject item styles
  menu.querySelectorAll('.deploy-menu-item').forEach(el => {
    el.style.cssText = 'padding:10px 16px;font-size:13px;color:var(--t2);cursor:pointer;transition:background 0.15s';
    el.addEventListener('mouseenter', () => el.style.background = 'rgba(245,158,11,0.08)');
    el.addEventListener('mouseleave', () => el.style.background = '');
  });

  // Position relative to button
  btn.style.position = 'relative';
  btn.appendChild(menu);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closer(e) {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.remove();
        document.removeEventListener('click', closer);
      }
    });
  }, 10);
}

async function deployTo(platform) {
  const menu = document.getElementById('deploy-dropdown');
  if (menu) menu.remove();

  if (!builderState.files.length) {
    showBuilderToast('No files to deploy.', 'error');
    return;
  }

  setStatus(`Deploying to ${platform}…`);
  showBuilderToast(`Initiating ${platform} deployment…`, 'info');

  try {
    const res  = await fetch('/api/builder/deploy', {
      method:  'POST',
      headers: BUILDER_HEADERS,
      body:    JSON.stringify({
        platform,
        files:      builderState.files,
        session_id: builderState.sessionId,
      }),
    });
    const data = await res.json();

    if (data.url) {
      showBuilderToast(`Deployed! <a href="${escHtml(data.url)}" target="_blank" style="color:var(--gold)">${escHtml(data.url)}</a>`, 'success');
      setStatus(`Deployed to ${platform}: ${data.url}`);
    } else {
      showBuilderToast(data.message || `Deployment to ${platform} initiated.`, 'success');
      setStatus(`Deployment to ${platform} complete`);
    }
  } catch (err) {
    showBuilderToast(`Deploy failed: ${err.message}`, 'error');
    setStatus('Deployment failed');
  }
}

async function downloadZip() {
  const menu = document.getElementById('deploy-dropdown');
  if (menu) menu.remove();

  if (!builderState.files.length) {
    showBuilderToast('No files to download.', 'error');
    return;
  }

  setStatus('Preparing ZIP…');

  try {
    // Build a simple zip-like archive using data URLs (no external libs)
    // We fall back to a combined HTML file if JSZip is unavailable
    if (typeof JSZip !== 'undefined') {
      const zip = new JSZip();
      builderState.files.forEach(f => zip.file(f.path.replace(/^\//, ''), f.content || ''));
      const blob = await zip.generateAsync({ type: 'blob' });
      triggerDownload(blob, `saintsallabs-build-${Date.now()}.zip`, 'application/zip');
    } else {
      // Fallback: create a self-contained combined HTML
      downloadFilesAsHtml();
    }
    setStatus('Download ready');
  } catch (err) {
    showBuilderToast(`Download error: ${err.message}`, 'error');
    setStatus('Download failed');
  }
}

function downloadFilesAsHtml() {
  // Embed all files in a single HTML with <script> and <style> tags
  let combinedHtml = '<!DOCTYPE html>\n<html>\n<!-- SaintSal™ Labs Build Export -->\n';

  builderState.files.forEach(f => {
    combinedHtml += `<!-- FILE: ${f.path} -->\n`;
    if (f.path.endsWith('.css')) {
      combinedHtml += `<style>\n${f.content || ''}\n</style>\n`;
    } else if (f.path.endsWith('.js')) {
      combinedHtml += `<script>\n${f.content || ''}\n<\/script>\n`;
    }
  });

  const htmlFile = builderState.files.find(f => f.path.endsWith('.html'));
  if (htmlFile) combinedHtml = htmlFile.content || combinedHtml;

  const blob = new Blob([combinedHtml], { type: 'text/html' });
  triggerDownload(blob, `saintsallabs-build-${Date.now()}.html`, 'text/html');
}

function triggerDownload(blob, filename, type) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

// ─── Mobile Tabs ──────────────────────────────────────────────────────────────

function builderInitMobileTabs() {
  // Only inject tab bar if not already present
  if (document.getElementById('builder-mobile-tabs')) return;

  const main = document.querySelector('.builder-main');
  if (!main) return;

  const tabs = document.createElement('div');
  tabs.id = 'builder-mobile-tabs';
  tabs.style.cssText = 'display:none;border-bottom:1px solid var(--brd);flex-shrink:0';
  tabs.innerHTML = `
    <div style="display:flex">
      <button class="builder-mob-tab active" data-tab="chat"    onclick="builderSwitchTab('chat')">💬 Chat</button>
      <button class="builder-mob-tab"        data-tab="files"   onclick="builderSwitchTab('files')">📁 Files</button>
      <button class="builder-mob-tab"        data-tab="preview" onclick="builderSwitchTab('preview')">👁 Preview</button>
    </div>
  `;

  // Style the tab buttons
  tabs.querySelectorAll('.builder-mob-tab').forEach(b => {
    b.style.cssText = 'flex:1;padding:8px;font-size:12px;background:none;border:none;color:var(--t3);cursor:pointer;border-bottom:2px solid transparent';
    b.addEventListener('mouseenter', () => { if (!b.classList.contains('active')) b.style.color = 'var(--t2)'; });
    b.addEventListener('mouseleave', () => { if (!b.classList.contains('active')) b.style.color = 'var(--t3)'; });
  });

  const builderPage = document.getElementById('builder-page');
  if (builderPage) builderPage.insertBefore(tabs, main);

  // Show/hide via media query
  const mq = window.matchMedia('(max-width: 768px)');
  function handleMQ(e) { tabs.style.display = e.matches ? '' : 'none'; applyMobilePanes(e.matches); }
  mq.addEventListener('change', handleMQ);
  handleMQ(mq);
}

function builderSwitchTab(tab) {
  builderState.mobileTab = tab;

  // Update active button
  document.querySelectorAll('.builder-mob-tab').forEach(b => {
    const isActive = b.dataset.tab === tab;
    b.classList.toggle('active', isActive);
    b.style.color        = isActive ? 'var(--gold)' : 'var(--t3)';
    b.style.borderBottomColor = isActive ? 'var(--gold)' : 'transparent';
  });

  // Show/hide panes
  applyMobilePanes(true, tab);
}

function applyMobilePanes(isMobile, activeTab) {
  const panes = document.querySelectorAll('.builder-pane');
  if (!panes.length) return;

  const tab = activeTab || builderState.mobileTab || 'chat';

  if (!isMobile) {
    panes.forEach(p => p.style.display = '');
    return;
  }

  const tabIndex = { chat: 0, files: 1, preview: 2 };
  panes.forEach((p, i) => {
    p.style.display = (i === (tabIndex[tab] ?? 0)) ? 'flex' : 'none';
  });
}

// ─── Toast Notifications ──────────────────────────────────────────────────────

function showBuilderToast(htmlMsg, type) {
  // Reuse global showToast if available
  if (typeof showToast === 'function') {
    showToast(htmlMsg.replace(/<[^>]+>/g, ''), type);
    return;
  }

  const colors = { success: 'var(--green)', error: 'var(--coral)', info: 'var(--gold)' };
  const toast  = document.createElement('div');
  toast.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:#111114;border:1px solid ${colors[type] || 'var(--brd)'};
    border-radius:8px;padding:10px 20px;font-size:13px;color:var(--t1);
    z-index:9999;max-width:360px;text-align:center;
    box-shadow:0 4px 16px rgba(0,0,0,0.5);
  `;
  toast.innerHTML = htmlMsg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.5s'; }, 2500);
  setTimeout(() => toast.remove(), 3000);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function escAttr(str) {
  // For use inside onclick="..." — escape single quotes
  return String(str || '').replace(/'/g, "\\'");
}

// ─── Style Injection ──────────────────────────────────────────────────────────
// Inject styles for elements created dynamically by builder.js

(function injectBuilderStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Builder event cards */
    .builder-event-card {
      background: #111114;
      border: 1px solid var(--brd);
      border-radius: 8px;
      padding: 12px 14px;
      margin: 4px 0;
    }
    .builder-event-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--t3);
      margin-bottom: 4px;
    }

    /* Agent card pulse animation */
    .agent-card[data-status="active"] {
      animation: agentPulse 1.8s ease-in-out infinite;
    }
    @keyframes agentPulse {
      0%, 100% { box-shadow: 0 0 0 rgba(245,158,11,0); }
      50%       { box-shadow: 0 0 12px rgba(245,158,11,0.35); }
    }

    /* File tree folder label */
    .code-file-folder {
      font-size: 11px;
      color: var(--t3);
      padding: 4px 8px 2px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    /* Builder mobile tab active state */
    .builder-mob-tab.active {
      color: var(--gold) !important;
      border-bottom: 2px solid var(--gold) !important;
    }

    /* Code editor content */
    #code-editor pre {
      padding: 0;
      margin: 0;
    }
  `;
  document.head.appendChild(style);
})();

// ─── Expose globals required by HTML inline handlers ─────────────────────────

// These are referenced in index.html as onclick/onkeydown attributes
window.builderKeydown    = builderKeydown;
window.startBuild        = startBuild;
window.showDeployMenu    = showDeployMenu;
window.newBuild          = newBuild;
window.approveDesign     = approveDesign;
window.requestChanges    = requestChanges;
window.submitChangeFeedback = submitChangeFeedback;
window.selectFile        = selectFile;
window.deployTo          = deployTo;
window.downloadZip       = downloadZip;
window.retryBuild        = retryBuild;
window.builderSwitchTab  = builderSwitchTab;
window.initBuilder       = initBuilder;
