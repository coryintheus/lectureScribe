// app.js — Web version of LectureScribe (adapted from Chrome extension)
// Replaces chrome.* APIs with localStorage and Web Audio API

// ─── State ────────────────────────────────────────────────────
let isRecording    = false;
let transcriptFull = '';
let uploadedBlob   = null;
let mediaRecorder  = null;
let audioChunks    = [];
let recordedStream = null;

// ─── DOM refs ─────────────────────────────────────────────────
let apiKeyInput, saveKeyBtn, keySaved, modelSelect, notesStyle, subjectInput;
let startBtn, stopBtn, transcribeBtn, notesBtn, uploadBtn, uploadInput;
let progressFill, progressLabel, progressPct, logBox, notesOutput;
let copyBtn, clearBtn, statusDot, statusText, modelTag, chunkTag;
let pqNumQuestions, pqQuestionType, pqDifficulty, pqShortAnswerType;
let pqEducationLevel, fileUploadArea, pqFileInput, generatePQBtn, clearPQBtn;
let questionsContainer, pqActions, submitPQBtn, regeneratePQBtn;
let savedQuestionsSection, savedQuestionsList;
let progressString, copyProgressBtn, refreshProgressBtn, restoreStringInput;
let restoreProgressBtn, clearProgressBtn;

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Get DOM references
  apiKeyInput   = document.getElementById('apiKeyInput');
  saveKeyBtn    = document.getElementById('saveKeyBtn');
  keySaved      = document.getElementById('keySaved');
  modelSelect   = document.getElementById('modelSelect');
  notesStyle    = document.getElementById('notesStyle');
  subjectInput  = document.getElementById('subjectInput');
  startBtn      = document.getElementById('startBtn');
  stopBtn       = document.getElementById('stopBtn');
  transcribeBtn = document.getElementById('transcribeBtn');
  notesBtn      = document.getElementById('notesBtn');
  uploadBtn     = document.getElementById('uploadBtn');
  uploadInput   = document.getElementById('uploadInput');
  progressFill  = document.getElementById('progressFill');
  progressLabel = document.getElementById('progressLabel');
  progressPct   = document.getElementById('progressPct');
  logBox        = document.getElementById('logBox');
  notesOutput   = document.getElementById('notesOutput');
  copyBtn       = document.getElementById('copyBtn');
  clearBtn      = document.getElementById('clearBtn');
  statusDot     = document.getElementById('statusDot');
  statusText    = document.getElementById('statusText');
  modelTag      = document.getElementById('modelTag');
  chunkTag      = document.getElementById('chunkTag');
  
  // Practice Questions DOM refs
  pqNumQuestions = document.getElementById('pqNumQuestions');
  pqQuestionType = document.getElementById('pqQuestionType');
  pqDifficulty = document.getElementById('pqDifficulty');
  pqShortAnswerType = document.getElementById('pqShortAnswerType');
  pqEducationLevel = document.getElementById('pqEducationLevel');
  fileUploadArea = document.getElementById('fileUploadArea');
  pqFileInput = document.getElementById('pqFileInput');
  generatePQBtn = document.getElementById('generatePQBtn');
  clearPQBtn = document.getElementById('clearPQBtn');
  questionsContainer = document.getElementById('questionsContainer');
  pqActions = document.getElementById('pqActions');
  submitPQBtn = document.getElementById('submitPQBtn');
  regeneratePQBtn = document.getElementById('regeneratePQBtn');
  savedQuestionsSection = document.getElementById('savedQuestionsSection');
  savedQuestionsList = document.getElementById('savedQuestionsList');
  
  // Progress tab DOM refs
  progressString = document.getElementById('progressString');
  copyProgressBtn = document.getElementById('copyProgressBtn');
  refreshProgressBtn = document.getElementById('refreshProgressBtn');
  restoreStringInput = document.getElementById('restoreStringInput');
  restoreProgressBtn = document.getElementById('restoreProgressBtn');
  clearProgressBtn = document.getElementById('clearProgressBtn');
  
  // Load settings from localStorage
  const local = JSON.parse(localStorage.getItem('lectureScribe') || '{}');
  
  if (local.groqApiKey)    { apiKeyInput.value = '•'.repeat(20); keySaved.classList.remove('hidden'); }
  if (local.model)          modelSelect.value = local.model;
  if (local.notesStylePref) notesStyle.value  = local.notesStylePref;
  if (local.subject)        subjectInput.value = local.subject;
  if (local.transcript)     { transcriptFull = local.transcript; transcribeBtn.disabled = false; notesBtn.disabled = false; }
  if (local.notes)          { renderNotes(local.notes); modelTag.textContent = local.model || 'whisper-large-v3'; }
  
  if (local.transcript) log('ok', 'Transcript loaded (' + wordCount(local.transcript) + ' words).');
  else log('info', 'LectureScribe ready. Save your Groq API key to begin.');

  // Initialize tabs
  initTabs();
  
  // Initialize practice questions state
  initPracticeQuestions();
});

// ─── Tab Management ────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      
      // Remove active class from all tabs and contents
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Add active class to selected tab
      btn.classList.add('active');
      document.getElementById('tab-' + tabId).classList.add('active');
    });
  });
}

// ─── Practice Questions State ──────────────────────────────────
let pqState = {
  questions: [],
  answers: {},
  saved: [],
  submitted: false,
  uploadedNotes: ''
};

function initPracticeQuestions() {
  // Load saved state from localStorage
  const saved = localStorage.getItem('pqState');
  if (saved) {
    try {
      pqState = JSON.parse(saved);
      if (pqState.questions.length > 0) {
        renderQuestions();
        pqActions.style.display = 'block';
        if (pqState.saved.length > 0) {
          savedQuestionsSection.style.display = 'block';
          renderSavedQuestions();
        }
      }
    } catch(e) { console.error('Failed to load PQ state:', e); }
  }
  updateProgressString();
}

function savePQState() {
  localStorage.setItem('pqState', JSON.stringify(pqState));
  updateProgressString();
}

function updateProgressString() {
  const str = btoa(JSON.stringify(pqState));
  progressString.textContent = str;
}

// ─── Helpers ──────────────────────────────────────────────────
function log(type, msg) {
  const time = new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  line.innerHTML = '<span class="time">'+time+'</span><span class="msg">'+msg+'</span>';
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

function setStatus(type, text) {
  statusDot.className = 'dot '+(type==='recording'?'recording':type==='active'?'active':'');
  statusText.textContent = text;
}

function setProgress(pct, label) {
  progressFill.style.width = pct + '%';
  progressLabel.textContent = label;
  progressPct.textContent = pct > 0 ? pct + '%' : '—';
}

function wordCount(t) { return t.trim().split(/\s+/).filter(Boolean).length; }

function saveSettings() {
  const settings = {
    groqApiKey: localStorage.getItem('ls_groqApiKey'),
    model: modelSelect.value,
    notesStylePref: notesStyle.value,
    subject: subjectInput.value,
    transcript: transcriptFull,
    notes: notesOutput.classList.contains('rendered') ? notesOutput.innerText : null
  };
  localStorage.setItem('lectureScribe', JSON.stringify(settings));
}

// ─── Groq fetch with retry-on-429 ────────────────────────────
async function groqFetch(url, options, maxRetries = 5) {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, options);
    if (res.status === 429 && attempt < maxRetries) {
      let waitMs = Math.pow(2, attempt) * 8000;
      try {
        const body = await res.clone().json();
        const msg  = body?.error?.message || '';
        const match = msg.match(/try again in ([\d.]+)s/i);
        if (match) waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 2000;
      } catch(_) {}
      attempt++;
      log('warn', 'Rate limit hit. Waiting ' + Math.round(waitMs/1000) + 's before retry (' + attempt + '/' + maxRetries + ')…');
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    return res;
  }
}

// ─── Markdown → HTML renderer ────────────────────────────────
function renderNotes(md) {
  if (!md) return;
  let h = md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/((?:^|\n)\|.+\|[ \t]*(?:\n|$))+/g, tbl => {
      const rows = tbl.trim().split('\n').map(r=>r.trim());
      let out='<table>',isHead=true;
      for(const row of rows){
        if(/^\|[-:| ]+\|$/.test(row)){isHead=false;continue;}
        const cells=row.replace(/^\||\|$/g,'').split('|');
        const t=isHead?'th':'td';
        out+='<tr>'+cells.map(c=>'<'+t+'>'+c.trim()+'</'+t+'>').join('')+'</tr>';
        isHead=false;
      }
      return out+'</table>';
    })
    .replace(/```([\s\S]*?)```/g,'<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\$\$([\s\S]+?)\$\$/g,'<div class="math">$$$1$$</div>')
    .replace(/\$([^\$\n]+?)\$/g,'<span class="math-inline">$$$1$$</span>')
    .replace(/^#### (.+)$/gm,'<h4>$1</h4>').replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/~~(.+?)~~/g,'<del>$1</del>').replace(/^---+$/gm,'<hr>')
    .replace(/^&gt; (.+)$/gm,'<blockquote>$1</blockquote>')
    .replace(/^\d+\. (.+)$/gm,'<li class="ol">$1</li>')
    .replace(/^[-*] (.+)$/gm,'<li class="ul">$1</li>')
    .replace(/(<li class="ul">[\s\S]*?<\/li>)(\s*(?!<li))/g,m=>'<ul>'+m.replace(/ class="ul"/g,'')+'</ul>')
    .replace(/(<li class="ol">[\s\S]*?<\/li>)(\s*(?!<li))/g,m=>'<ol>'+m.replace(/ class="ol"/g,'')+'</ol>')
    .replace(/\n{2,}/g,'</p><p>').replace(/\n/g,'<br>');
  h='<p>'+h+'</p>';
  h=h.replace(/<p>(<(?:h[1-4]|ul|ol|table|pre|blockquote|hr)[^>]*>)/g,'$1')
     .replace(/(<\/(?:h[1-4]|ul|ol|table|pre|blockquote|hr)>)<\/p>/g,'$1');
  notesOutput.innerHTML = h;
  notesOutput.classList.add('rendered');
}

// ─── Save API Key ─────────────────────────────────────────────
saveKeyBtn.addEventListener('click', () => {
  const val = apiKeyInput.value.trim();
  if (!val || val.startsWith('•')) { log('warn','Enter a valid Groq API key (gsk_…)'); return; }
  localStorage.setItem('ls_groqApiKey', val);
  apiKeyInput.value = '•'.repeat(20);
  keySaved.classList.remove('hidden');
  setStatus('active','API Key Set');
  log('ok','API key saved.');
  saveSettings();
});

modelSelect.addEventListener('change', saveSettings);
notesStyle.addEventListener('change', saveSettings);
subjectInput.addEventListener('input', saveSettings);

// ─── Start Recording (Web Audio Capture) ──────────────────────
startBtn.addEventListener('click', async () => {
  const groqApiKey = localStorage.getItem('ls_groqApiKey');
  if (!groqApiKey) { log('err','Set your Groq API key first!'); return; }
  
  startBtn.disabled = true;
  log('info','Select the tab/window to capture audio from…');
  
  try {
    // Use getDisplayMedia for system audio capture
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    
    // Check if audio track exists
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      log('err','No audio track detected. Make sure to enable "Share system audio" in the browser prompt.');
      stream.getTracks().forEach(t => t.stop());
      startBtn.disabled = false;
      return;
    }
    
    recordedStream = stream;
    audioChunks = [];
    
    // Determine supported mime type
    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg'
    ].find(t => MediaRecorder.isTypeSupported(t)) || '';
    
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };
    
    mediaRecorder.onerror = (e) => {
      log('err','Recording error: ' + (e.error?.message || 'unknown'));
      stopRecording();
    };
    
    mediaRecorder.onstop = () => {
      // Stop all tracks
      stream.getTracks().forEach(t => t.stop());
      recordedStream = null;
      
      if (!audioChunks.length) {
        log('err','No audio data captured.');
        startBtn.disabled = false;
        stopBtn.disabled = true;
        stopBtn.classList.remove('active');
        return;
      }
      
      const finalMimeType = mediaRecorder.mimeType || 'audio/webm';
      uploadedBlob = new Blob(audioChunks, { type: finalMimeType });
      audioChunks = [];
      mediaRecorder = null;
      
      const sizeMB = (uploadedBlob.size / 1024 / 1024).toFixed(1);
      log('ok','Audio ready in memory: ' + sizeMB + ' MB. Click Transcribe.');
      
      isRecording = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      stopBtn.classList.remove('active');
      transcribeBtn.disabled = false;
      setStatus('active','Audio Ready');
      setProgress(100,'Audio ready in memory');
    };
    
    mediaRecorder.start(5000);
    
    isRecording = true;
    stopBtn.disabled = false;
    stopBtn.classList.add('active');
    setStatus('recording','Recording…');
    setProgress(0,'Recording audio…');
    log('ok','Capturing system audio…');
    
    // Monitor when user stops sharing via browser UI
    audioTrack.onended = () => {
      if (isRecording) {
        log('info','Screen sharing stopped by user.');
        stopRecording();
      }
    };
    
  } catch(e) {
    log('err','Capture failed: ' + e.message);
    startBtn.disabled = false;
    log('warn','Tip: Make sure you select a window/tab with audio and enable "Share system audio".');
  }
});

function stopRecording() {
  if (!mediaRecorder) return;
  
  stopBtn.disabled = true;
  stopBtn.classList.remove('active');
  setStatus('active','Processing…');
  setProgress(30,'Stopping capture…');
  log('info','Stopping recording…');
  
  try {
    mediaRecorder.stop();
  } catch(e) {
    log('err','Stop failed: ' + e.message);
  }
}

// ─── Stop Recording ───────────────────────────────────────────
stopBtn.addEventListener('click', stopRecording);

// ─── Upload Audio File ────────────────────────────────────────
uploadBtn.addEventListener('click', () => uploadInput.click());
uploadInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const ok = /\.(mp3|mp4|wav|m4a|ogg|webm|aac|flac)$/i.test(file.name)
             || file.type.startsWith('audio/') || file.type.startsWith('video/');
  if (!ok) { log('err','Unsupported file type: ' + file.type); return; }

  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  log('info','File loaded: ' + file.name + ' (' + sizeMB + ' MB)');
  setProgress(100,'File ready');
  setStatus('active','File Loaded');
  uploadedBlob = file;
  transcribeBtn.disabled = false;
  log('ok','File ready. Click Transcribe.');
  uploadInput.value = '';
});

// ─── Split blob into chunks ───────────────────────────────────
function splitBlob(blob, maxBytes = 25 * 1024 * 1024) {
  if (blob.size <= maxBytes) return [blob];
  log('warn', 'Large file (' + (blob.size/1024/1024).toFixed(1) + ' MB). Attempting single-chunk upload first...');
  return [blob];
}

// ─── Transcribe one chunk with retry ─────────────────────────
async function transcribeChunk(blob, apiKey, model, idx, total) {
  const fd = new FormData();
  const ext = blob.type.includes('webm') ? '.webm' : 
              blob.type.includes('ogg') ? '.ogg' : 
              blob.type.includes('mp3') ? '.mp3' : 
              blob.type.includes('mp4') ? '.mp4' : 
              blob.type.includes('wav') ? '.wav' : 
              blob.type.includes('m4a') ? '.m4a' : '.webm';
  fd.append('file', blob, 'audio_' + idx + ext);
  fd.append('model', model);
  fd.append('response_format', 'json');
  fd.append('language', 'en');
  
  const res = await groqFetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey }, body: fd
  });
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Whisper chunk ' + idx + '/' + total + ' — ' + res.status + ': ' + errText);
  }
  return (await res.json()).text || '';
}

// ─── Transcribe ───────────────────────────────────────────────
transcribeBtn.addEventListener('click', async () => {
  const groqApiKey = localStorage.getItem('ls_groqApiKey');
  if (!groqApiKey) { log('err','No API key set.'); return; }

  transcribeBtn.disabled = true;
  notesBtn.disabled = true;
  setStatus('active','Transcribing…');
  setProgress(5,'Loading audio…');
  log('info','Starting transcription…');

  try {
    const model = modelSelect.value || 'whisper-large-v3';

    if (!uploadedBlob) {
      log('err','No audio available. Record or upload audio first.');
      transcribeBtn.disabled = false;
      notesBtn.disabled = false;
      return;
    }

    const blob = uploadedBlob;
    const totalMB = (blob.size / 1024 / 1024).toFixed(1);
    const chunks  = splitBlob(blob, 8 * 1024 * 1024);
    chunkTag.textContent = chunks.length > 1 ? chunks.length + ' chunks' : '';
    log('info', totalMB + ' MB → ' + chunks.length + ' audio chunk(s).');

    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      setProgress(Math.round(15 + (i / chunks.length) * 75),
        chunks.length > 1 ? 'Whisper chunk ' + (i+1) + '/' + chunks.length + '…' : 'Transcribing…');
      parts.push(await transcribeChunk(chunks[i], groqApiKey, model, i+1, chunks.length));
      log('ok','Chunk ' + (i+1) + '/' + chunks.length + ' transcribed.');
    }

    transcriptFull = parts.join(' ').trim();
    localStorage.setItem('ls_transcript', transcriptFull);
    localStorage.setItem('ls_model', model);
    modelTag.textContent = model;
    setProgress(100,'Transcription complete!');
    log('ok','Done: ' + wordCount(transcriptFull) + ' words.');

    notesOutput.innerHTML = '';
    notesOutput.classList.remove('rendered');
    notesOutput.textContent = '📝 TRANSCRIPT PREVIEW:\n\n'
      + transcriptFull.slice(0, 600) + (transcriptFull.length > 600 ? '…' : '');

    transcribeBtn.disabled = false;
    notesBtn.disabled = false;
    setStatus('active','Transcribed');
    saveSettings();

  } catch(e) {
    log('err','Transcription failed: ' + e.message);
    setStatus('active','Error');
    setProgress(0,'Failed');
    transcribeBtn.disabled = false;
    notesBtn.disabled = !transcriptFull;
  }
});

// ─── Compress transcript if too long ──────────────────────────
async function compressTranscript(transcript, apiKey, subjectCtx) {
  const TARGET_TOKENS = 6000;
  const approxTokens  = Math.round(wordCount(transcript) * 1.35);
  if (approxTokens <= TARGET_TOKENS) return { text: transcript, compressed: false };

  log('warn', 'Transcript is long (' + wordCount(transcript) + ' words). Compressing to key points first…');

  const words    = transcript.split(/\s+/);
  const SEC_SIZE = 1500;
  const sections = [];
  for (let i = 0; i < words.length; i += SEC_SIZE)
    sections.push(words.slice(i, i + SEC_SIZE).join(' '));

  log('info', 'Compressing ' + sections.length + ' transcript section(s)…');

  const summaries = [];
  for (let i = 0; i < sections.length; i++) {
    setProgress(Math.round(20 + (i / sections.length) * 20),
      'Compressing section ' + (i+1) + '/' + sections.length + '…');

    const res = await groqFetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Extract ALL key concepts, facts, definitions, formulas, and important statements from this transcript section into a dense bullet-point list. ' + subjectCtx + ' Preserve all technical terms exactly. Extract ONLY what is in the transcript — do not add external information. No prose, no padding — only information-dense bullets.' },
          { role: 'user',   content: 'SECTION ' + (i+1) + '/' + sections.length + ':\n\n' + sections[i] }
        ],
        max_tokens: 1200,
        temperature: 0.1
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error('Compression section ' + (i+1) + ' failed: ' + res.status + ' ' + err);
    }
    const r = await res.json();
    summaries.push(r.choices?.[0]?.message?.content || '');
    if (i < sections.length - 1) await new Promise(r => setTimeout(r, 3000));
  }

  return { text: summaries.join('\n\n'), compressed: true };
}

// ─── Generate Notes ───────────────────────────────────────────
notesBtn.addEventListener('click', async () => {
  const groqApiKey = localStorage.getItem('ls_groqApiKey');
  if (!groqApiKey) { log('err','No API key set.'); return; }

  const transcript = transcriptFull;
  if (!transcript)  { log('err','No transcript. Transcribe first.'); return; }

  const style   = notesStyle.value || 'exam';
  const subject = subjectInput.value?.trim() || '';

  notesBtn.disabled = true;
  setStatus('active','Generating notes…');
  setProgress(10,'Preparing…');
  log('info','Generating ' + style + ' notes…');

  const subjectCtx = subject
    ? 'The subject/course is: "' + subject + '". Use this context ONLY to correctly interpret technical terms and fix transcription errors. Do NOT add external knowledge beyond what the lecture covers.'
    : 'Infer the academic subject from context. Use this ONLY to correctly interpret technical terms and fix transcription errors. Do NOT add external knowledge beyond what the lecture covers.';

  try {
    // Step 1: Compress if transcript is too long
    const { text: workingText, compressed } = await compressTranscript(transcript, groqApiKey, subjectCtx);
    if (compressed) log('ok', 'Transcript compressed to ~' + wordCount(workingText) + ' words.');

    // Step 2: Correction pass
    setProgress(42,'Correcting transcript errors…');
    log('info','Pass 1: Checking transcript against knowledge base…');

    const corrRes = await groqFetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqApiKey },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: `You are a knowledgeable academic assistant correcting a speech-to-text transcript.
${subjectCtx}
Fix mishearing errors (e.g. "N-replication problem" → "end-replication problem"), garbled technical terms, and phonetic approximations. Do NOT add new information — only fix misheard words.
Return the corrected text followed by "## Corrections Made" listing each fix as [Original] → [Corrected] with a brief reason.` },
          { role: 'user', content: 'TRANSCRIPT:\n\n' + workingText.slice(0, 12000) }
        ],
        max_tokens: 3000,
        temperature: 0.1
      })
    });
    if (!corrRes.ok) throw new Error('Correction pass: ' + corrRes.status + ' ' + await corrRes.text());
    const corrResult    = await corrRes.json();
    const correctedText = corrResult.choices?.[0]?.message?.content || workingText;

    const corrMatch = correctedText.match(/## Corrections Made([\s\S]+)$/);
    if (corrMatch) {
      const fixes = corrMatch[1].trim().split('\n').filter(l => l.includes('→'));
      if (fixes.length) log('warn', fixes.length + ' correction(s): ' + fixes.slice(0,3).map(f=>f.trim()).join('; '));
      else log('ok','No transcript errors detected.');
    }

    await new Promise(r => setTimeout(r, 4000));

    // Step 3: Notes generation pass
    setProgress(65,'Generating tutor notes…');
    log('info','Pass 2: Generating study notes…');

    const FORMATTING = `
FORMATTING (mandatory):
- **Bold** key terms on first use
- Markdown tables for comparisons, structured lists, glossaries
- LaTeX ($formula$) for ALL equations and formulas
- \`code\` for code, syntax, or precise notation
- > blockquote for formal definitions
- ### headings for major sections
- Numbered lists for processes; bullet lists for properties

CONTENT RULES:
- Notes must be STRICTLY based on the lecture content provided
- Do NOT add external knowledge, analogies, or supplementary information unless explicitly correcting a clear transcription error
- If the lecture doesn't cover something, don't invent it — stay faithful to what was actually said
- Concise, revision-friendly bullets over verbose prose`;

    const notePrompts = {
      exam: `You are an expert tutor generating EXAM-READY STUDY NOTES. NOT a transcriber, NOT a summariser.

RULES:
- Teach the material as a tutor would — explain WHY, not just WHAT.
- Be concise and revision-friendly: cut fluff, keep only high-yield points.
- Think like an examiner: what would be tested and how?
- Flag common misconceptions.
${subjectCtx}
${FORMATTING}
Generate TWO types of questions:
**A. Comprehension Check (5-7 questions)**
- Short, direct questions testing basic understanding
- Quick self-check format with brief answers

**B. Exam-Style Questions (5-8 questions)**
- Multiple choice with 4 options (mark correct answer + explain why others are wrong)
- Short answer requiring application of concepts
- Scenario-based problems testing deeper understanding
Provide full answers/explanations after each question.` : ''}

### 🧠 Core Concepts Explained
Per concept: clear explanation with intuition, analogy if helpful, why it matters. Use tables to compare items.

### 📐 Formulas, Equations & Notation
Every formula in LaTeX. Each variable defined. Common application mistakes.

### ⚠️ Common Misconceptions & Exam Traps
What students get wrong. What trick questions look like for this topic.

### 🔗 How It All Connects
Table or prose linking the key concepts. Bigger picture context.

### 📋 High-Yield Exam Points
10–15 precise, testable facts/relationships. Exact terminology matters.

### 💡 Tutor Tips
Mnemonics, memory hooks, intuitive shortcuts for the hardest ideas.`,

      cornell: `You are an expert tutor generating CORNELL NOTES. Not a summary — pedagogical notes for retention.
${subjectCtx}
${FORMATTING}
**A. Quick Recall (8-10 questions)** - Direct fact/concept checks
**B. Application Problems (7-10 questions)** - Scenario-based, multi-step reasoning
Include varied question types with full answers.` : ''}

### Notes
Concise, exam-focused concept breakdowns. No verbose explanations — bullet points with key facts, formulas, relationships.

### Cue Column
| Question / Cue | Key Answer Points |
|----------------|------------------|
15–20 self-test questions from foundational to advanced. Focus on what's testable.

### 📐 Formulas & Equations
All formulas in LaTeX with variable definitions. When to use each.

### Summary
4–6 sentence synthesis of the absolute essentials — what MUST be memorised vs understood.`,

      outline: `You are an expert tutor. Create a COMPREHENSIVE STUDY OUTLINE enriched with your expertise.
${subjectCtx}
${FORMATTING}
**Comprehension:** 5-7 direct questions checking understanding
**Exam-Style:** 5-8 application/problems with full solutions` : ''}

# [Lecture Title]
## I. [Topic]
### A. Concept
- **Definition**: (use > for formal)
- **Key Points**: bullet list of essentials only
- **Formula**: $formula$ with variable meanings
- **Example**: one concrete example
- **Common mistake**: what students get wrong
Be concise — revision notes, not prose.`,

      flashcards: `You are an expert tutor. Generate 25–35 EXAM-QUALITY flashcards testing deep understanding.
${subjectCtx}
${FORMATTING}
After the flashcards, add:
- 5-7 comprehension check questions (quick recall)
- 5-8 exam-style problems with detailed solutions` : ''}

Include: definition cards, mechanism cards, comparison cards ("difference between X and Y"), application cards ("in what scenario would you…"), and mistake cards ("what is wrong with this reasoning…").

| # | Question | Answer |
|---|----------|--------|`,

      summary: `You are an expert tutor. Create a DEEP STUDY SUMMARY that goes beyond the lecture.
${subjectCtx}
${FORMATTING}
**Comprehension:** 5-6 quick-check questions
**Application:** 5-6 exam-style problems with answers` : ''}

### 🎯 What This Topic Is Really About
2–3 sentences explaining the conceptual essence — as a tutor to a confused student.

### 🔑 Key Ideas (with depth)
Each idea: what it is, why it exists, what it connects to. Bullet format.

### 📐 Formulas & Equations
| Formula (LaTeX) | Name | What It Describes | When to Use |

### 📖 Glossary
| Term | Precise Definition | Memory Hook |

### ⚠️ Watch Out For
Misconceptions, exam traps, edge cases.`,

      concept: `You are an expert tutor creating a CONCEPT MAP for revision.
${subjectCtx}
${FORMATTING}
**Check Understanding:** 5-7 questions verifying concept relationships
**Apply Knowledge:** 5-7 scenario problems testing connections between concepts` : ''}

### Central Concept
One-sentence essence of the topic.

### Key Concepts & Relationships
| Concept | Definition | Connects To | Why It Matters |
Map how ideas link together.

### Visual Structure
Use indentation/arrows to show hierarchy: Main Idea → Sub-concept → Detail

### Common Confusions
Where students mix up related concepts. Clarify distinctions.`,

      problem: `You are an expert tutor focusing on PROBLEM-SOLVING SKILLS.
${subjectCtx}
${FORMATTING}
**Guided Practice (5-7):** Step-by-step worked examples
**Independent (7-8):** Full problems with answers only — test yourself` : ''}

### Problem Types Covered
List each type of problem this lecture addresses.

### Solution Framework
For each problem type:
1. **Identify**: What type is this? What clues to look for?
2. **Approach**: Step-by-step method
3. **Formula/Tools**: What equations/concepts apply
4. **Worked Example**: One complete example
5. **Common Errors**: What goes wrong

### Quick Reference
Condensed table of problem types → approaches → key formulas.`,

      compare: `You are an expert tutor creating COMPARE & CONTRAST notes.
${subjectCtx}
${FORMATTING}
**Distinguish:** 5-7 "What's the difference between X and Y?" questions
**Apply:** 5-7 scenarios requiring choice between similar concepts/methods` : ''}

### Comparison Tables
| Feature | Concept A | Concept B | Concept C |
Compare all major concepts side-by-side.

### When to Use Each
Decision tree or bullets: "If you see X, use Y because..."

### Similarities That Confuse
What makes these concepts easy to mix up. How to tell them apart.

### Key Distinctions
The 3-5 critical differences that matter for exams.`,

      timeline: `You are an expert tutor creating a TIMELINE/SEQUENCE overview.
${subjectCtx}
${FORMATTING}
**Sequence Check:** 5-7 "What comes next?" or ordering questions
**Causal Links:** 5-7 questions about why each step leads to the next` : ''}

### Chronological/Logical Sequence
| Step/Stage | What Happens | Why It Matters | Key Terms |
Order events, processes, or procedures.

### Dependencies
What must happen before X? What does X enable?

### Memory Aids
Mnemonics or patterns to remember the sequence.

### Critical Transitions
Where things commonly go wrong or get confusing.`
    };

    const notesRes = await groqFetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqApiKey },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: notePrompts[style] || notePrompts.exam },
          { role: 'user',   content: 'CORRECTED TRANSCRIPT:\n\n' + correctedText.slice(0, 12000) }
        ],
        max_tokens: 5000,
        temperature: 0.35
      })
    });
    if (!notesRes.ok) throw new Error('Notes pass failed: ' + notesRes.status + ' ' + await notesRes.text());

    const notesResult = await notesRes.json();
    const notes       = notesResult.choices?.[0]?.message?.content || 'No notes returned.';

    localStorage.setItem('ls_notes', notes);
    renderNotes(notes);
    setProgress(100,'Notes ready!');
    log('ok', style + ' notes done (' + wordCount(notes) + ' words).');
    setStatus('active','Notes Ready');
    notesBtn.disabled = false;
    saveSettings();

  } catch(e) {
    log('err','Notes failed: ' + e.message);
    setStatus('active','Error');
    setProgress(0,'Failed');
    notesBtn.disabled = false;
  }
});

// ─── Copy Notes ───────────────────────────────────────────────
copyBtn.addEventListener('click', () => {
  const notes = localStorage.getItem('ls_notes') || notesOutput.innerText;
  if (!notes || notes.includes('Notes will appear')) { log('warn','No notes to copy.'); return; }
  navigator.clipboard.writeText(notes).then(() => {
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => { copyBtn.textContent = '⎘ Copy Notes'; }, 2000);
    log('ok','Notes copied (markdown).');
  }).catch(err => {
    log('err','Copy failed: ' + err);
  });
});

// ─── Clear ────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  notesOutput.innerHTML = '<span class="notes-empty">Notes will appear here after processing…</span>';
  notesOutput.classList.remove('rendered');
  transcriptFull = '';
  uploadedBlob = null;
  localStorage.removeItem('ls_transcript');
  localStorage.removeItem('ls_notes');
  localStorage.removeItem('ls_model');
  transcribeBtn.disabled = true;
  notesBtn.disabled = true;
  setProgress(0,'Ready');
  setStatus('','Idle');
  modelTag.textContent = '';
  chunkTag.textContent = '';
  log('info','Cleared.');
  saveSettings();
});

// ─── Practice Questions: File Upload ───────────────────────────
fileUploadArea.addEventListener('click', () => pqFileInput.click());

fileUploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  fileUploadArea.classList.add('dragover');
});

fileUploadArea.addEventListener('dragleave', () => {
  fileUploadArea.classList.remove('dragover');
});

fileUploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  fileUploadArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handlePQFile(file);
});

pqFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handlePQFile(file);
  pqFileInput.value = '';
});

async function handlePQFile(file) {
  const validTypes = ['.txt', '.pdf', '.docx', '.md', '.html', '.htm'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  
  if (!validTypes.includes(ext)) {
    log('err', 'Unsupported file type: ' + ext);
    return;
  }
  
  try {
    let text = '';
    
    if (ext === '.txt' || ext === '.md' || ext === '.html' || ext === '.htm') {
      text = await file.text();
    } else if (ext === '.pdf') {
      // Simple PDF text extraction (basic)
      text = await extractTextFromPDF(file);
    } else if (ext === '.docx') {
      text = await extractTextFromDOCX(file);
    }
    
    pqState.uploadedNotes = text;
    generatePQBtn.disabled = false;
    fileUploadArea.querySelector('.file-upload-text').textContent = '✓ ' + file.name;
    log('ok', 'Notes file loaded: ' + file.name + ' (' + text.length + ' chars)');
  } catch(e) {
    log('err', 'Failed to read file: ' + e.message);
  }
}

async function extractTextFromPDF(file) {
  // Basic PDF text extraction - in production use pdf.js
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      // Simple fallback - just return binary as string for now
      // In production, integrate pdf.js library
      resolve('PDF content loaded. For best results, convert PDF to text first.');
    };
    reader.readAsArrayBuffer(file);
  });
}

async function extractTextFromDOCX(file) {
  // Basic DOCX text extraction
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const zip = new JSZip();
        const docx = await zip.loadAsync(e.target.result);
        const content = await docx.file('word/document.xml').async('text');
        // Strip XML tags
        const text = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        resolve(text);
      } catch(err) {
        resolve('DOCX content loaded. For best results, convert to plain text first.');
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─── Practice Questions: Generate ──────────────────────────────
generatePQBtn.addEventListener('click', async () => {
  const groqApiKey = localStorage.getItem('ls_groqApiKey');
  if (!groqApiKey) { 
    log('err', 'Set your Groq API key first!'); 
    alert('Please save your Groq API key in the AI Notes tab first.');
    return; 
  }
  
  if (!pqState.uploadedNotes) {
    log('err', 'No notes uploaded.');
    return;
  }
  
  generatePQBtn.disabled = true;
  generatePQBtn.textContent = '⏳ Generating...';
  
  const numQuestions = parseInt(pqNumQuestions.value) || 10;
  const questionType = pqQuestionType.value;
  const difficulty = pqDifficulty.value;
  const shortAnswerType = pqShortAnswerType.value;
  const educationLevel = pqEducationLevel.value.trim() || 'University';
  
  try {
    const prompt = buildGeneratePrompt(numQuestions, questionType, difficulty, shortAnswerType, educationLevel);
    
    const res = await groqFetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqApiKey },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are an expert educator generating practice questions from study notes.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 6000,
        temperature: 0.5
      })
    });
    
    if (!res.ok) throw new Error('Generation failed: ' + res.status);
    
    const result = await res.json();
    const generatedContent = result.choices?.[0]?.message?.content || '';
    
    // Parse the generated questions
    pqState.questions = parseGeneratedQuestions(generatedContent, shortAnswerType);
    pqState.answers = {};
    pqState.submitted = false;
    
    renderQuestions();
    pqActions.style.display = 'block';
    savePQState();
    
    generatePQBtn.textContent = '❓ Generate Questions';
    generatePQBtn.disabled = false;
    log('ok', 'Generated ' + pqState.questions.length + ' practice questions.');
    
  } catch(e) {
    log('err', 'Failed to generate questions: ' + e.message);
    generatePQBtn.textContent = '❓ Generate Questions';
    generatePQBtn.disabled = false;
  }
});

function buildGeneratePrompt(numQuestions, questionType, difficulty, shortAnswerType, educationLevel) {
  let typeDesc = '';
  if (questionType === 'mixed') {
    typeDesc = 'Generate a mix of multiple choice, short answer, and calculation questions.';
  } else if (questionType === 'mcq') {
    typeDesc = 'Generate ONLY multiple choice questions with 4 options each.';
  } else if (questionType === 'shortanswer') {
    typeDesc = 'Generate ONLY short answer questions.';
  } else if (questionType === 'calculation') {
    typeDesc = 'Generate ONLY calculation-based problems with numerical answers.';
  }
  
  let diffDesc = '';
  if (difficulty === '1') diffDesc = 'Level 1: Basic recall and understanding questions.';
  else if (difficulty === '2') diffDesc = 'Level 2: Application and analysis questions.';
  else if (difficulty === '3') diffDesc = 'Level 3: Challenging synthesis and evaluation questions.';
  else diffDesc = 'Mix of all difficulty levels.';
  
  return `Generate ${numQuestions} practice questions based on these study notes.

TARGET AUDIENCE: ${educationLevel} level students
DIFFICULTY: ${diffDesc}
QUESTION TYPES: ${typeDesc}

IMPORTANT FORMAT REQUIREMENTS:
Return the questions in this EXACT JSON format (no markdown, no extra text):
{
  "questions": [
    {
      "id": 1,
      "type": "mcq" | "shortanswer" | "calculation",
      "difficulty": 1 | 2 | 3,
      "question": "The question text here",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],  // only for mcq
      "correctAnswer": "B" | "exact answer text" | "numerical value",
      "explanation": "Why this is the correct answer"
    }
  ]
}

STUDY NOTES:
${pqState.uploadedNotes.slice(0, 15000)}`;
}

function parseGeneratedQuestions(content, shortAnswerType) {
  try {
    // Try to find JSON in the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.questions && Array.isArray(parsed.questions)) {
        return parsed.questions.map(q => ({
          ...q,
          userAnswer: null,
          handwrittenData: null,
          inputType: q.type === 'shortanswer' ? shortAnswerType : 'text'
        }));
      }
    }
  } catch(e) { console.error('Parse error:', e); }
  
  // Fallback: create a single question from the content
  return [{
    id: 1,
    type: 'shortanswer',
    difficulty: 2,
    question: 'Based on the notes: ' + content.slice(0, 500),
    correctAnswer: 'See generated content',
    explanation: 'Review the generated content above.',
    userAnswer: null,
    handwrittenData: null,
    inputType: shortAnswerType
  }];
}

function renderQuestions() {
  if (!pqState.questions.length) {
    questionsContainer.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:40px;">No questions generated yet. Upload notes and click Generate.</p>';
    return;
  }
  
  let html = '';
  pqState.questions.forEach((q, idx) => {
    html += `
      <div class="question-item" data-qid="${q.id}">
        <div class="question-header">
          <span class="question-type">${q.type.toUpperCase()} • Difficulty ${q.difficulty}</span>
          <button class="btn secondary" onclick="saveQuestion(${q.id})" style="padding:4px 8px;font-size:9px;">⭐ Save</button>
        </div>
        <div class="question-text"><strong>Q${idx+1}:</strong> ${q.question}</div>
        ${renderQuestionInput(q, idx)}
        <div class="question-actions">
          ${q.explanation ? `<button class="btn secondary" onclick="toggleExplanation(${q.id})" style="padding:4px 8px;font-size:9px;">👁 Show Answer</button>` : ''}
        </div>
        <div class="explanation" id="expl-${q.id}" style="display:none;margin-top:10px;padding:10px;background:rgba(52,211,153,0.1);border:1px solid var(--green);border-radius:6px;">
          <strong style="color:var(--green);">✓ Correct Answer:</strong> ${q.correctAnswer}<br><br>
          <em>${q.explanation || ''}</em>
        </div>
      </div>
    `;
  });
  
  questionsContainer.innerHTML = html;
  
  // Initialize canvases for handwritten questions
  if (pqState.questions.some(q => q.inputType === 'handwritten')) {
    initHandwrittenCanvases();
  }
}

function renderQuestionInput(q, idx) {
  if (q.type === 'mcq') {
    let optionsHtml = '<div class="mcq-options">';
    const labels = ['A', 'B', 'C', 'D'];
    (q.options || []).forEach((opt, i) => {
      optionsHtml += `
        <label class="mcq-option" data-opt="${labels[i]}">
          <input type="radio" name="q_${q.id}" value="${labels[i]}" onchange="recordAnswer(${q.id}, '${labels[i]}')">
          ${opt}
        </label>
      `;
    });
    optionsHtml += '</div>';
    return optionsHtml;
  } else if (q.type === 'shortanswer' || q.type === 'calculation') {
    if (q.inputType === 'text') {
      return `<textarea class="short-answer-input" placeholder="Type your answer here..." oninput="recordAnswer(${q.id}, this.value)"></textarea>`;
    } else {
      return `
        <div class="canvas-tools">
          <button class="canvas-tool" onclick="setCanvasColor(${q.id}, '#ffffff')">⬜ White</button>
          <button class="canvas-tool" onclick="setCanvasColor(${q.id}, '#1a1a26')">⬛ Dark</button>
          <button class="canvas-tool" onclick="clearCanvas(${q.id})">✕ Clear</button>
        </div>
        <canvas class="handwritten-canvas" id="canvas-${q.id}"></canvas>
      `;
    }
  }
  return '';
}

function initHandwrittenCanvases() {
  pqState.questions.forEach(q => {
    if (q.inputType === 'handwritten') {
      const canvas = document.getElementById('canvas-' + q.id);
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      ctx.strokeStyle = '#e8e8f0';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      
      let drawing = false;
      let lastX = 0, lastY = 0;
      
      canvas.addEventListener('mousedown', (e) => {
        drawing = true;
        const rect = canvas.getBoundingClientRect();
        lastX = e.clientX - rect.left;
        lastY = e.clientY - rect.top;
      });
      
      canvas.addEventListener('mousemove', (e) => {
        if (!drawing) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        
        lastX = x;
        lastY = y;
        
        // Save canvas data
        pqState.answers[q.id] = canvas.toDataURL();
      });
      
      canvas.addEventListener('mouseup', () => drawing = false);
      canvas.addEventListener('mouseout', () => drawing = false);
    }
  });
}

function recordAnswer(qid, answer) {
  pqState.answers[qid] = answer;
  savePQState();
}

function setCanvasColor(qid, color) {
  const canvas = document.getElementById('canvas-' + qid);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = color === '#ffffff' ? '#1a1a26' : '#e8e8f0';
}

function clearCanvas(qid) {
  const canvas = document.getElementById('canvas-' + qid);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1a26';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  pqState.answers[qid] = null;
  savePQState();
}

function toggleExplanation(qid) {
  const el = document.getElementById('expl-' + qid);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function saveQuestion(qid) {
  const q = pqState.questions.find(q => q.id === qid);
  if (!q) return;
  
  if (!pqState.saved.find(s => s.id === qid)) {
    pqState.saved.push({ ...q, savedAt: Date.now() });
    savedQuestionsSection.style.display = 'block';
    renderSavedQuestions();
    savePQState();
    log('ok', 'Question saved.');
  } else {
    log('warn', 'Question already saved.');
  }
}

function renderSavedQuestions() {
  if (!pqState.saved.length) {
    savedQuestionsList.innerHTML = '<p style="color:var(--text-dim);font-size:11px;">No saved questions yet.</p>';
    return;
  }
  
  let html = '';
  pqState.saved.forEach((q, idx) => {
    html += `
      <div class="saved-question-item">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="color:var(--accent);font-size:9px;text-transform:uppercase;">${q.type} • D${q.difficulty}</span>
          <button class="btn danger" onclick="removeSavedQuestion(${q.id})" style="padding:2px 6px;font-size:8px;">✕</button>
        </div>
        <div style="color:var(--text);font-size:11px;line-height:1.5;">${q.question}</div>
      </div>
    `;
  });
  savedQuestionsList.innerHTML = html;
}

function removeSavedQuestion(qid) {
  pqState.saved = pqState.saved.filter(s => s.id !== qid);
  if (!pqState.saved.length) savedQuestionsSection.style.display = 'none';
  renderSavedQuestions();
  savePQState();
}

// ─── Submit Answers ────────────────────────────────────────────
submitPQBtn.addEventListener('click', () => {
  let score = 0;
  let total = 0;
  
  pqState.questions.forEach(q => {
    if (q.type === 'mcq') {
      total++;
      const userAnswer = pqState.answers[q.id];
      const optionEl = document.querySelector(`input[name="q_${q.id}"][value="${userAnswer}"]`);
      const parentLabel = optionEl?.closest('.mcq-option');
      
      if (userAnswer === q.correctAnswer) {
        score++;
        if (parentLabel) {
          parentLabel.classList.add('correct');
          parentLabel.classList.remove('incorrect');
        }
      } else {
        if (parentLabel) {
          parentLabel.classList.add('incorrect');
          parentLabel.classList.remove('correct');
        }
        // Highlight correct answer
        const correctEl = document.querySelector(`input[name="q_${q.id}"][value="${q.correctAnswer}"]`);
        correctEl?.closest('.mcq-option')?.classList.add('correct');
      }
    } else {
      // For short answer/calculation, just show the explanation
      total++;
    }
  });
  
  pqState.submitted = true;
  savePQState();
  
  // Show all explanations
  pqState.questions.forEach(q => {
    const expl = document.getElementById('expl-' + q.id);
    if (expl) expl.style.display = 'block';
  });
  
  alert(`Score: ${score}/${total} (${Math.round(score/total*100)}%)\n\nCheck individual questions for correct answers and explanations.`);
});

regeneratePQBtn.addEventListener('click', () => {
  if (confirm('Regenerate questions? This will clear current progress.')) {
    pqState.questions = [];
    pqState.answers = {};
    pqState.submitted = false;
    questionsContainer.innerHTML = '';
    pqActions.style.display = 'none';
    generatePQBtn.disabled = false;
    savePQState();
  }
});

clearPQBtn.addEventListener('click', () => {
  if (confirm('Clear all practice questions and saved items?')) {
    pqState = { questions: [], answers: {}, saved: [], submitted: false, uploadedNotes: '' };
    questionsContainer.innerHTML = '';
    pqActions.style.display = 'none';
    savedQuestionsSection.style.display = 'none';
    fileUploadArea.querySelector('.file-upload-text').textContent = 'Click or drag notes file here';
    generatePQBtn.disabled = true;
    savePQState();
  }
});

// ─── Progress Tab Functions ────────────────────────────────────
copyProgressBtn.addEventListener('click', () => {
  const str = progressString.textContent;
  navigator.clipboard.writeText(str).then(() => {
    copyProgressBtn.textContent = '✓ Copied!';
    setTimeout(() => copyProgressBtn.textContent = '⎘ Copy String', 2000);
  });
});

refreshProgressBtn.addEventListener('click', updateProgressString);

restoreProgressBtn.addEventListener('click', () => {
  const str = restoreStringInput.value.trim();
  if (!str) { alert('Paste a progress string first.'); return; }
  
  try {
    const restored = JSON.parse(atob(str));
    if (restored.questions) {
      pqState = restored;
      savePQState();
      
      if (pqState.questions.length > 0) {
        renderQuestions();
        pqActions.style.display = 'block';
      }
      if (pqState.saved.length > 0) {
        savedQuestionsSection.style.display = 'block';
        renderSavedQuestions();
      }
      
      alert('Progress restored successfully!');
    } else {
      alert('Invalid progress string format.');
    }
  } catch(e) {
    alert('Failed to restore: Invalid progress string.');
  }
});

clearProgressBtn.addEventListener('click', () => {
  if (confirm('Clear all progress? This cannot be undone.')) {
    pqState = { questions: [], answers: {}, saved: [], submitted: false, uploadedNotes: '' };
    localStorage.removeItem('pqState');
    questionsContainer.innerHTML = '';
    pqActions.style.display = 'none';
    savedQuestionsSection.style.display = 'none';
    updateProgressString();
    alert('Progress cleared.');
  }
});
