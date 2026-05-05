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
const apiKeyInput   = document.getElementById('apiKeyInput');
const saveKeyBtn    = document.getElementById('saveKeyBtn');
const keySaved      = document.getElementById('keySaved');
const modelSelect   = document.getElementById('modelSelect');
const notesStyle    = document.getElementById('notesStyle');
const subjectInput  = document.getElementById('subjectInput');
const practiceCheck = document.getElementById('practiceQuestionsCheck');
const startBtn      = document.getElementById('startBtn');
const stopBtn       = document.getElementById('stopBtn');
const transcribeBtn = document.getElementById('transcribeBtn');
const notesBtn      = document.getElementById('notesBtn');
const uploadBtn     = document.getElementById('uploadBtn');
const uploadInput   = document.getElementById('uploadInput');
const progressFill  = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const progressPct   = document.getElementById('progressPct');
const logBox        = document.getElementById('logBox');
const notesOutput   = document.getElementById('notesOutput');
const copyBtn       = document.getElementById('copyBtn');
const clearBtn      = document.getElementById('clearBtn');
const statusDot     = document.getElementById('statusDot');
const statusText    = document.getElementById('statusText');
const modelTag      = document.getElementById('modelTag');
const chunkTag      = document.getElementById('chunkTag');

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Load settings from localStorage
  const local = JSON.parse(localStorage.getItem('lectureScribe') || '{}');
  
  if (local.groqApiKey)    { apiKeyInput.value = '•'.repeat(20); keySaved.classList.remove('hidden'); }
  if (local.model)          modelSelect.value = local.model;
  if (local.notesStylePref) notesStyle.value  = local.notesStylePref;
  if (local.subject)        subjectInput.value = local.subject;
  if (local.practiceQuestions) practiceCheck.checked = local.practiceQuestions;
  if (local.transcript)     { transcriptFull = local.transcript; transcribeBtn.disabled = false; notesBtn.disabled = false; }
  if (local.notes)          { renderNotes(local.notes); modelTag.textContent = local.model || 'whisper-large-v3'; }
  
  if (local.transcript) log('ok', 'Transcript loaded (' + wordCount(local.transcript) + ' words).');
  else log('info', 'LectureScribe ready. Save your Groq API key to begin.');
});

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
    practiceQuestions: practiceCheck.checked,
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
practiceCheck.addEventListener('change', saveSettings);

// ─── Start Recording (Web Audio Capture) ──────────────────────
startBtn.addEventListener('click', async () => {
  const groqApiKey = localStorage.getItem('ls_groqApiKey');
  if (!groqApiKey) { log('err','Set your Groq API key first!'); return; }
  
  // Reset button state first
  startBtn.disabled = false;
  startBtn.classList.remove('active');
  stopBtn.disabled = true;
  stopBtn.classList.remove('active');
  
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
    
    log('info', 'Stream obtained. Video tracks: ' + stream.getVideoTracks().length + ', Audio tracks: ' + stream.getAudioTracks().length);
    
    // Check if audio track exists
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      log('err','No audio track detected. Make sure to enable "Share system audio" in the browser prompt.');
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    
    recordedStream = stream;
    audioChunks = [];
    
    // Wait for track to be ready (macOS fix)
    log('info', 'Waiting for audio track to initialize...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Re-check track state after waiting
    log('info', 'Audio track state: ' + audioTrack.readyState);
    log('info', 'Audio track enabled: ' + audioTrack.enabled);
    log('info', 'Audio track muted: ' + audioTrack.muted);
    
    if (audioTrack.readyState !== 'live') {
      log('err', 'Audio track is not live (state: ' + audioTrack.readyState + '). Try selecting the tab again and ensure audio is playing.');
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    
    if (!audioTrack.enabled || audioTrack.muted) {
      log('err', 'Audio track is disabled or muted. Make sure the tab has audio playing and you enabled "Share system audio".');
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    
    // Get only audio tracks for MediaRecorder
    const audioOnlyStream = new MediaStream(stream.getAudioTracks());
    
    log('info', 'Created audio-only stream with ' + audioOnlyStream.getAudioTracks().length + ' track(s)');
    if (!audioOnlyStream.getAudioTracks().length) {
      log('err','No audio track in stream. Make sure to enable "Share system audio" in the browser prompt.');
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    
    // Determine supported mime type
    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg'
    ].find(t => MediaRecorder.isTypeSupported(t)) || '';
    
    try {
      mediaRecorder = new MediaRecorder(audioOnlyStream, mimeType ? { mimeType } : {});
      
      // Add debug logging for MediaRecorder state
      log('info', 'MediaRecorder created. State: ' + mediaRecorder.state);
      log('info', 'MediaRecorder mimeType: ' + (mediaRecorder.mimeType || 'default'));
      log('info', 'Audio track settings: sampleRate=' + audioTrack.getSettings().sampleRate + ', channelCount=' + audioTrack.getSettings().channelCount);
      
      // CRITICAL FIX: Set up event handlers BEFORE calling start()
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunks.push(e.data);
          log('info', 'Data received: ' + e.data.size + ' bytes (total chunks: ' + audioChunks.length + ')');
        } else if (e.data) {
          log('warn', 'Empty data chunk received');
        }
      };
      
      mediaRecorder.onerror = (e) => {
        log('err','Recording error: ' + (e.error?.message || 'unknown'));
        console.error('MediaRecorder error:', e);
        stopRecording();
      };
      
      mediaRecorder.onwarning = (e) => {
        log('warn','MediaRecorder warning: ' + (e.message || 'unknown'));
        console.warn('MediaRecorder warning:', e);
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
      
      // Start recording with smaller timeslice for more frequent chunks
      mediaRecorder.start(500);
      log('ok', 'MediaRecorder started with mimeType: ' + (mediaRecorder.mimeType || 'default'));
      log('info', 'MediaRecorder state after start: ' + mediaRecorder.state);
      
    } catch (e) {
      log('err','Failed to create/start MediaRecorder: ' + e.message);
      stream.getTracks().forEach(t => t.stop());
      startBtn.disabled = false;
      return;
    }
    
    isRecording = true;
    startBtn.disabled = false;
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
    
    // Log initial state
    log('info', 'Audio track settings: enabled=' + audioTrack.enabled + ', muted=' + audioTrack.muted);
    log('info', 'Audio track state: ' + audioTrack.readyState);
    log('info', 'MediaRecorder is recording: ' + (mediaRecorder && mediaRecorder.state === 'recording'));

  } catch(e) {
    log('err','Capture failed: ' + e.message);
    startBtn.disabled = false;
    log('warn','Tip: On macOS, make sure to: 1) Select the tab with audio playing, 2) Check "Also share tab audio" in the prompt, 3) Ensure audio is actually playing in that tab.');
    console.error('Capture error:', e);
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
  const includePractice = practiceCheck.checked;

  notesBtn.disabled = true;
  setStatus('active','Generating notes…');
  setProgress(10,'Preparing…');
  log('info','Generating ' + style + ' notes' + (includePractice ? ' with practice questions' : '') + '…');

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
${includePractice ? `\n### 📝 Practice Questions (10-15 questions)
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
${includePractice ? `\n### 📝 Practice Questions (15-20 questions)
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
${includePractice ? `\n### 📝 Practice Questions (10-15 questions)
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
${includePractice ? `\n### 📝 Additional Practice Questions
After the flashcards, add:
- 5-7 comprehension check questions (quick recall)
- 5-8 exam-style problems with detailed solutions` : ''}

Include: definition cards, mechanism cards, comparison cards ("difference between X and Y"), application cards ("in what scenario would you…"), and mistake cards ("what is wrong with this reasoning…").

| # | Question | Answer |
|---|----------|--------|`,

      summary: `You are an expert tutor. Create a DEEP STUDY SUMMARY that goes beyond the lecture.
${subjectCtx}
${FORMATTING}
${includePractice ? `\n### 📝 Practice Questions (10-12 questions)
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
${includePractice ? `\n### 📝 Practice Questions
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
${includePractice ? `\n### 📝 Practice Problems (12-15 problems)
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
${includePractice ? `\n### 📝 Practice Questions
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
${includePractice ? `\n### 📝 Practice Questions
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

// ════════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ════════════════════════════════════════════════════════════════
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    
    // Remove active from all tabs
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    // Add active to selected tab
    btn.classList.add('active');
    document.getElementById(tabId).classList.add('active');
    
    // Refresh export data if switching to save tab
    if (tabId === 'save-tab') {
      refreshExportData();
    }
  });
});

// ════════════════════════════════════════════════════════════════
// PRACTICE QUIZ FUNCTIONALITY
// ════════════════════════════════════════════════════════════════

let currentQuiz = {
  questions: [],
  userAnswers: {},
  submitted: false
};

let savedQuestions = JSON.parse(localStorage.getItem('ls_savedQuestions') || '[]');

// DOM refs for quiz
const quizFileInput = document.getElementById('quizFileInput');
const loadFileBtn = document.getElementById('loadFileBtn');
const quizNotesInput = document.getElementById('quizNotesInput');
const generateQuizBtn = document.getElementById('generateQuizBtn');
const quizNumQuestions = document.getElementById('quizNumQuestions');
const quizQuestionType = document.getElementById('quizQuestionType');
const quizDifficulty = document.getElementById('quizDifficulty');
const quizInputType = document.getElementById('quizInputType');
const quizEduLevel = document.getElementById('quizEduLevel');
const quizProgressSection = document.getElementById('quizProgressSection');
const questionsSection = document.getElementById('questionsSection');
const resultsSection = document.getElementById('resultsSection');
const savedQuestionsSection = document.getElementById('savedQuestionsSection');
const quizContainer = document.getElementById('quizContainer');
const quizProgressCheckpoints = document.getElementById('quizProgressCheckpoints');
const quizProgressLabel = document.getElementById('quizProgressLabel');
const quizProgressPct = document.getElementById('quizProgressPct');
const quizProgressFill = document.getElementById('quizProgressFill');
const submitQuizBtn = document.getElementById('submitQuizBtn');
const retryQuizBtn = document.getElementById('retryQuizBtn');
const newQuizBtn = document.getElementById('newQuizBtn');
const scoreDisplay = document.getElementById('scoreDisplay');
const scorePercent = document.getElementById('scorePercent');
const resultsDetails = document.getElementById('resultsDetails');
const savedQuestionsList = document.getElementById('savedQuestionsList');
const exportString = document.getElementById('exportString');
const importString = document.getElementById('importString');
const copyExportBtn = document.getElementById('copyExportBtn');
const refreshExportBtn = document.getElementById('refreshExportBtn');
const importDataBtn = document.getElementById('importDataBtn');
const clearAllDataBtn = document.getElementById('clearAllDataBtn');
const dataSummary = document.getElementById('dataSummary');

// Load file content
loadFileBtn.addEventListener('click', async () => {
  const file = quizFileInput.files[0];
  if (!file) {
    log('warn', 'Please select a file first.');
    return;
  }
  
  try {
    const text = await file.text();
    quizNotesInput.value = text;
    log('ok', `Loaded ${file.name} (${text.length} characters)`);
  } catch (e) {
    log('err', 'Failed to read file: ' + e.message);
  }
});

// Generate Quiz
generateQuizBtn.addEventListener('click', async () => {
  const groqApiKey = localStorage.getItem('ls_groqApiKey');
  if (!groqApiKey) {
    log('err', 'Please set your Groq API key first.');
    alert('Please save your Groq API key in the Notes & Recording tab first.');
    return;
  }
  
  const notesContent = quizNotesInput.value.trim();
  if (!notesContent) {
    log('warn', 'Please provide study material content.');
    alert('Please upload a file or paste your notes before generating questions.');
    return;
  }
  
  const numQuestions = parseInt(quizNumQuestions.value) || 10;
  const questionType = quizQuestionType.value;
  const difficulty = quizDifficulty.value;
  const inputType = quizInputType.value;
  const eduLevel = quizEduLevel.value || 'Undergraduate';
  
  generateQuizBtn.disabled = true;
  generateQuizBtn.textContent = '⏳ Generating...';
  
  try {
    const prompt = `You are an expert educational content creator. Generate ${numQuestions} practice questions based on the following study material.

EDUCATION LEVEL: ${eduLevel}
DIFFICULTY: ${difficulty === '1' ? 'Level 1 - Basic recall and understanding' : difficulty === '2' ? 'Level 2 - Application of concepts' : difficulty === '3' ? 'Level 3 - Analysis, synthesis, and evaluation' : 'Mixed difficulty levels'}
QUESTION TYPE: ${questionType === 'mcq' ? 'Multiple Choice Questions only' : questionType === 'shortanswer' ? 'Short Answer questions only' : questionType === 'calculation' ? 'Calculation/Problem-solving questions only' : 'Mix of different question types'}
INPUT METHOD FOR SHORT ANSWER: ${inputType === 'handwritten' ? 'Students will draw/write by hand on canvas' : 'Students will type text answers'}

For each question, provide:
- A unique ID (q1, q2, etc.)
- Question type: "mcq", "shortanswer", or "calculation"
- Difficulty level: 1, 2, or 3
- The question text
- For MCQ: 4 options (A, B, C, D) with the correct answer letter
- For shortanswer/calculation: the expected correct answer
- A brief explanation of why the answer is correct

Return ONLY valid JSON in this exact format:
{
  "questions": [
    {
      "id": "q1",
      "type": "mcq",
      "difficulty": 2,
      "question": "What is...",
      "options": {"A": "...", "B": "...", "C": "...", "D": "..."},
      "correctAnswer": "B",
      "explanation": "..."
    },
    {
      "id": "q2",
      "type": "shortanswer",
      "difficulty": 1,
      "question": "Define...",
      "correctAnswer": "...",
      "explanation": "..."
    }
  ]
}

STUDY MATERIAL:
${notesContent.slice(0, 15000)}`;

    const response = await groqFetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqApiKey },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are an expert at creating educational assessments. Return ONLY valid JSON, no markdown formatting.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 4000,
        temperature: 0.7
      })
    });
    
    if (!response.ok) {
      throw new Error('Failed to generate questions: ' + response.status);
    }
    
    const result = await response.json();
    let content = result.choices?.[0]?.message?.content || '';
    
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      content = jsonMatch[0];
    }
    
    const quizData = JSON.parse(content);
    
    if (!quizData.questions || !Array.isArray(quizData.questions)) {
      throw new Error('Invalid response format from AI');
    }
    
    currentQuiz = {
      questions: quizData.questions,
      userAnswers: {},
      submitted: false
    };
    
    // Save to localStorage
    localStorage.setItem('ls_currentQuiz', JSON.stringify(currentQuiz));
    
    // Show quiz UI
    renderQuiz();
    
    log('ok', `Generated ${currentQuiz.questions.length} practice questions.`);
    
  } catch (e) {
    log('err', 'Quiz generation failed: ' + e.message);
    alert('Failed to generate questions: ' + e.message);
  } finally {
    generateQuizBtn.disabled = false;
    generateQuizBtn.textContent = '🚀 Generate Practice Questions';
  }
});

function renderQuiz() {
  quizProgressSection.classList.remove('hidden');
  questionsSection.classList.remove('hidden');
  resultsSection.classList.add('hidden');
  
  quizContainer.innerHTML = '';
  quizProgressCheckpoints.innerHTML = '';
  
  // Create progress checkpoints
  currentQuiz.questions.forEach((q, idx) => {
    const checkpoint = document.createElement('div');
    checkpoint.className = 'progress-checkpoint';
    checkpoint.id = `checkpoint-${idx}`;
    checkpoint.innerHTML = `
      <span class="check">○</span>
      <span>Question ${idx + 1}</span>
      <span class="question-type" style="margin-left:auto;">${q.type.toUpperCase()}</span>
    `;
    quizProgressCheckpoints.appendChild(checkpoint);
  });
  
  // Render each question
  currentQuiz.questions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'question-card';
    card.id = `question-${idx}`;
    
    let inputHtml = '';
    
    if (q.type === 'mcq') {
      inputHtml = `<div class="mcq-options">`;
      ['A', 'B', 'C', 'D'].forEach(opt => {
        inputHtml += `
          <label class="mcq-option" data-question="${idx}" data-option="${opt}">
            <input type="radio" name="q${idx}" value="${opt}"/>
            <strong>${opt}.</strong> ${q.options[opt]}
          </label>
        `;
      });
      inputHtml += `</div>`;
    } else if (q.type === 'shortanswer') {
      if (quizInputType.value === 'handwritten') {
        inputHtml = `
          <canvas class="handwritten-canvas" id="canvas-${idx}"></canvas>
          <div class="question-actions">
            <button class="btn secondary save-btn" onclick="clearCanvas(${idx})">Clear Canvas</button>
          </div>
        `;
        setTimeout(() => initCanvas(idx), 100);
      } else {
        inputHtml = `
          <textarea class="short-answer-input" id="answer-${idx}" placeholder="Type your answer here..."></textarea>
        `;
      }
    } else if (q.type === 'calculation') {
      inputHtml = `
        <textarea class="calculation-work" id="work-${idx}" placeholder="Show your working here..."></textarea>
        <input type="text" class="input-field" id="answer-${idx}" placeholder="Final answer..." style="width:100%;"/>
      `;
    }
    
    card.innerHTML = `
      <div class="question-header">
        <span class="question-type">${q.type}</span>
        <span class="question-difficulty">Difficulty: ${q.difficulty}</span>
      </div>
      <div class="question-text"><strong>Q${idx + 1}:</strong> ${q.question}</div>
      ${inputHtml}
      <div class="question-actions">
        <button class="btn secondary save-btn" onclick="toggleSaveQuestion(${idx})">⭐ Save Question</button>
        <button class="btn secondary save-btn" onclick="toggleRevealAnswer(${idx})">👁 Reveal Answer</button>
      </div>
      <div class="reveal-answer" id="reveal-${idx}">
        <strong>Correct Answer:</strong> ${formatAnswer(q)}<br/>
        <strong>Explanation:</strong> ${q.explanation}
      </div>
    `;
    
    quizContainer.appendChild(card);
  });
  
  // Add event listeners for MCQ options
  document.querySelectorAll('.mcq-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        const input = opt.querySelector('input');
        input.checked = true;
      }
      const questionIdx = parseInt(opt.dataset.question);
      const option = opt.dataset.option;
      currentQuiz.userAnswers[questionIdx] = option;
      updateProgress();
    });
  });
  
  // Add event listeners for text inputs
  document.querySelectorAll('.short-answer-input, .calculation-work, #answer-').forEach(input => {
    input.addEventListener('input', (e) => {
      const match = e.target.id.match(/answer-(\d+)/);
      if (match) {
        const questionIdx = parseInt(match[1]);
        currentQuiz.userAnswers[questionIdx] = e.target.value;
        updateProgress();
      }
    });
  });
  
  document.getElementById('questionsCount').textContent = `${currentQuiz.questions.length} questions`;
  updateProgress();
  
  // Initialize canvases
  currentQuiz.questions.forEach((q, idx) => {
    if (q.type === 'shortanswer' && quizInputType.value === 'handwritten') {
      initCanvas(idx);
    }
  });
}

function initCanvas(idx) {
  const canvas = document.getElementById(`canvas-${idx}`);
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  
  // Set canvas size
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  ctx.strokeStyle = '#e8e8f0';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  function startDrawing(e) {
    isDrawing = true;
    [lastX, lastY] = getCoords(e);
  }
  
  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    
    const [x, y] = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    [lastX, lastY] = [x, y];
  }
  
  function stopDrawing() {
    isDrawing = false;
  }
  
  function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches) {
      return [
        e.touches[0].clientX - rect.left,
        e.touches[0].clientY - rect.top
      ];
    }
    return [e.offsetX, e.offsetY];
  }
  
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', stopDrawing);
  canvas.addEventListener('touchstart', startDrawing);
  canvas.addEventListener('touchmove', draw);
  canvas.addEventListener('touchend', stopDrawing);
}

window.clearCanvas = function(idx) {
  const canvas = document.getElementById(`canvas-${idx}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
};

window.toggleSaveQuestion = function(idx) {
  const question = currentQuiz.questions[idx];
  const existingIdx = savedQuestions.findIndex(q => q.id === question.id);
  
  if (existingIdx >= 0) {
    savedQuestions.splice(existingIdx, 1);
    log('info', 'Question removed from saved.');
  } else {
    savedQuestions.push({ ...question, savedAt: Date.now() });
    log('ok', 'Question saved!');
  }
  
  localStorage.setItem('ls_savedQuestions', JSON.stringify(savedQuestions));
  renderSavedQuestions();
  
  const card = document.getElementById(`question-${idx}`);
  if (existingIdx >= 0) {
    card.classList.remove('saved');
  } else {
    card.classList.add('saved');
  }
};

window.toggleRevealAnswer = function(idx) {
  const reveal = document.getElementById(`reveal-${idx}`);
  reveal.classList.toggle('visible');
};

function formatAnswer(q) {
  if (q.type === 'mcq') {
    return `${q.correctAnswer}. ${q.options[q.correctAnswer]}`;
  }
  return q.correctAnswer;
}

function updateProgress() {
  const answered = Object.keys(currentQuiz.userAnswers).length;
  const total = currentQuiz.questions.length;
  const pct = Math.round((answered / total) * 100);
  
  quizProgressLabel.textContent = `Question ${answered} of ${total}`;
  quizProgressPct.textContent = pct + '%';
  quizProgressFill.style.width = pct + '%';
  
  // Update checkpoints
  currentQuiz.questions.forEach((_, idx) => {
    const checkpoint = document.getElementById(`checkpoint-${idx}`);
    if (currentQuiz.userAnswers[idx] !== undefined) {
      checkpoint.classList.add('completed');
      checkpoint.querySelector('.check').textContent = '✓';
    } else {
      checkpoint.classList.remove('completed');
      checkpoint.querySelector('.check').textContent = '○';
    }
  });
}

submitQuizBtn.addEventListener('click', () => {
  const answered = Object.keys(currentQuiz.userAnswers).length;
  const total = currentQuiz.questions.length;
  
  if (answered < total) {
    if (!confirm(`You've answered ${answered} of ${total} questions. Submit anyway?`)) {
      return;
    }
  }
  
  gradeQuiz();
});

function gradeQuiz() {
  let correct = 0;
  const results = [];
  
  currentQuiz.questions.forEach((q, idx) => {
    const userAnswer = currentQuiz.userAnswers[idx];
    let isCorrect = false;
    
    if (q.type === 'mcq') {
      isCorrect = userAnswer === q.correctAnswer;
    } else {
      // For text answers, do simple string comparison (case-insensitive)
      isCorrect = userAnswer?.toLowerCase().trim().includes(q.correctAnswer.toLowerCase().trim().slice(0, 20));
    }
    
    if (isCorrect) correct++;
    
    results.push({
      question: q,
      userAnswer: userAnswer || '(no answer)',
      isCorrect
    });
  });
  
  currentQuiz.submitted = true;
  
  // Show results
  questionsSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  
  scoreDisplay.textContent = `${correct}/${total}`;
  scorePercent.textContent = `${Math.round((correct / total) * 100)}% correct`;
  
  // Show detailed results
  resultsDetails.innerHTML = '';
  results.forEach((r, idx) => {
    const div = document.createElement('div');
    div.className = 'question-card';
    div.style.borderColor = r.isCorrect ? 'var(--green)' : 'var(--red)';
    div.innerHTML = `
      <div class="question-header">
        <span class="question-type">${r.question.type}</span>
        <span style="color:${r.isCorrect ? 'var(--green)' : 'var(--red)'};">
          ${r.isCorrect ? '✓ Correct' : '✗ Incorrect'}
        </span>
      </div>
      <div class="question-text"><strong>Q${idx + 1}:</strong> ${r.question.question}</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
        <strong>Your answer:</strong> ${r.userAnswer}
      </div>
      <div style="font-size:11px;color:var(--green);">
        <strong>Correct answer:</strong> ${formatAnswer(r.question)}
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:6px;">
        <em>${r.question.explanation}</em>
      </div>
    `;
    resultsDetails.appendChild(div);
  });
  
  // Save results
  localStorage.setItem('ls_quizResults', JSON.stringify({
    date: Date.now(),
    score: correct,
    total: total,
    results
  }));
  
  log('ok', `Quiz submitted! Score: ${correct}/${total}`);
}

retryQuizBtn.addEventListener('click', () => {
  currentQuiz.userAnswers = {};
  currentQuiz.submitted = false;
  
  // Clear all inputs
  document.querySelectorAll('input[type="radio"]').forEach(i => i.checked = false);
  document.querySelectorAll('.short-answer-input, .calculation-work').forEach(i => i.value = '');
  document.querySelectorAll('.reveal-answer').forEach(r => r.classList.remove('visible'));
  
  resultsSection.classList.add('hidden');
  questionsSection.classList.remove('hidden');
  updateProgress();
});

newQuizBtn.addEventListener('click', () => {
  quizProgressSection.classList.add('hidden');
  questionsSection.classList.add('hidden');
  resultsSection.classList.add('hidden');
  savedQuestionsSection.classList.add('hidden');
  quizNotesInput.value = '';
  currentQuiz = { questions: [], userAnswers: {}, submitted: false };
});

function renderSavedQuestions() {
  if (savedQuestions.length === 0) {
    savedQuestionsList.innerHTML = '<div style="color:var(--text-faint);font-style:italic;">No saved questions yet. Click ⭐ on any question to save it.</div>';
    return;
  }
  
  savedQuestionsList.innerHTML = '';
  savedQuestions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'question-card saved';
    card.innerHTML = `
      <div class="question-header">
        <span class="question-type">${q.type}</span>
        <span class="question-difficulty">Difficulty: ${q.difficulty}</span>
        <button class="btn danger save-btn" onclick="removeSavedQuestion(${idx})">Remove</button>
      </div>
      <div class="question-text"><strong>Q:</strong> ${q.question}</div>
      <div style="font-size:11px;color:var(--green);margin:8px 0;">
        <strong>A:</strong> ${formatAnswer(q)}
      </div>
      <div style="font-size:11px;color:var(--text-dim);">
        <em>${q.explanation}</em>
      </div>
    `;
    savedQuestionsList.appendChild(card);
  });
  
  savedQuestionsSection.classList.remove('hidden');
}

window.removeSavedQuestion = function(idx) {
  savedQuestions.splice(idx, 1);
  localStorage.setItem('ls_savedQuestions', JSON.stringify(savedQuestions));
  renderSavedQuestions();
};

// ════════════════════════════════════════════════════════════════
// SAVE/LOAD PROGRESS (EXPORT/IMPORT STRING)
// ════════════════════════════════════════════════════════════════

function refreshExportData() {
  const exportData = {
    version: 1,
    exportedAt: Date.now(),
    apiKeySet: !!localStorage.getItem('ls_groqApiKey'),
    settings: {
      model: localStorage.getItem('ls_model'),
      notesStyle: localStorage.getItem('ls_notesStylePref'),
      subject: localStorage.getItem('ls_subject'),
      practiceQuestions: localStorage.getItem('ls_practiceQuestions')
    },
    transcript: localStorage.getItem('ls_transcript'),
    notes: localStorage.getItem('ls_notes'),
    savedQuestions: savedQuestions,
    quizResults: JSON.parse(localStorage.getItem('ls_quizResults') || 'null')
  };
  
  const jsonString = JSON.stringify(exportData);
  const encoded = btoa(unescape(encodeURIComponent(jsonString)));
  exportString.value = encoded;
  
  // Update summary
  updateDataSummary(exportData);
}

function updateDataSummary(data) {
  const lines = [
    `<strong>API Key:</strong> ${data.apiKeySet ? '✓ Saved' : 'Not set'}`,
    `<strong>Model:</strong> ${data.settings.model || 'Default'}`,
    `<strong>Notes Style:</strong> ${data.settings.notesStyle || 'Not set'}`,
    `<strong>Subject:</strong> ${data.settings.subject || 'Not set'}`,
    `<strong>Transcript:</strong> ${data.transcript ? wordCount(data.transcript) + ' words' : 'None'}`,
    `<strong>Notes:</strong> ${data.notes ? wordCount(data.notes) + ' words' : 'None'}`,
    `<strong>Saved Questions:</strong> ${data.savedQuestions.length}`,
    `<strong>Last Quiz:</strong> ${data.quizResults ? `${data.quizResults.score}/${data.quizResults.total} (${Math.round(data.quizResults.score/data.quizResults.total*100)}%)` : 'No results'}`
  ];
  
  dataSummary.innerHTML = lines.join('<br/>');
}

refreshExportBtn.addEventListener('click', refreshExportData);

copyExportBtn.addEventListener('click', () => {
  if (!exportString.value) {
    alert('No data to copy. Click "Refresh Data" first.');
    return;
  }
  exportString.select();
  document.execCommand('copy');
  log('ok', 'Export string copied to clipboard!');
  copyExportBtn.textContent = '✓ Copied!';
  setTimeout(() => { copyExportBtn.textContent = '📋 Copy String'; }, 2000);
});

importDataBtn.addEventListener('click', () => {
  const encoded = importString.value.trim();
  if (!encoded) {
    alert('Please paste an export string first.');
    return;
  }
  
  try {
    const decoded = decodeURIComponent(escape(atob(encoded)));
    const data = JSON.parse(decoded);
    
    if (!data.version) {
      throw new Error('Invalid export format');
    }
    
    // Import data
    if (data.settings.model) localStorage.setItem('ls_model', data.settings.model);
    if (data.settings.notesStyle) localStorage.setItem('ls_notesStylePref', data.settings.notesStyle);
    if (data.settings.subject) localStorage.setItem('ls_subject', data.settings.subject);
    if (data.settings.practiceQuestions) localStorage.setItem('ls_practiceQuestions', data.settings.practiceQuestions);
    if (data.transcript) localStorage.setItem('ls_transcript', data.transcript);
    if (data.notes) localStorage.setItem('ls_notes', data.notes);
    if (data.savedQuestions) {
      savedQuestions = data.savedQuestions;
      localStorage.setItem('ls_savedQuestions', JSON.stringify(savedQuestions));
    }
    if (data.quizResults) localStorage.setItem('ls_quizResults', JSON.stringify(data.quizResults));
    
    log('ok', 'Data imported successfully!');
    alert('Data imported successfully! Refresh the page to see changes.');
    refreshExportData();
    
  } catch (e) {
    log('err', 'Import failed: ' + e.message);
    alert('Failed to import data. Please check that the string is valid.');
  }
});

clearAllDataBtn.addEventListener('click', () => {
  if (!confirm('Are you sure you want to delete ALL data? This cannot be undone.')) {
    return;
  }
  
  localStorage.removeItem('ls_groqApiKey');
  localStorage.removeItem('ls_model');
  localStorage.removeItem('ls_notesStylePref');
  localStorage.removeItem('ls_subject');
  localStorage.removeItem('ls_practiceQuestions');
  localStorage.removeItem('ls_transcript');
  localStorage.removeItem('ls_notes');
  localStorage.removeItem('ls_savedQuestions');
  localStorage.removeItem('ls_quizResults');
  localStorage.removeItem('ls_currentQuiz');
  
  savedQuestions = [];
  
  log('warn', 'All data cleared.');
  alert('All data has been cleared. Refresh the page.');
  refreshExportData();
});

// Initial load of saved questions
renderSavedQuestions();
