// offscreen.js — holds audio blob in memory to avoid storage size limits

let mediaRecorder = null;
let audioChunks   = [];
let stream        = null;
let audioCtx      = null;
let sourceNode    = null;
let storedBlob    = null;   // kept in memory — never serialised to storage

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'OFFSCREEN_START') {
    startRecording(msg.streamId).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'OFFSCREEN_STOP') {
    stopRecording();
    sendResponse({ ok: true });
    return true;
  }
  // Popup asks for a specific chunk of the blob as a data URL
  if (msg.type === 'GET_BLOB_CHUNK') {
    if (!storedBlob) { sendResponse({ error: 'No blob in memory.' }); return true; }
    const { start, end } = msg;
    const chunk = storedBlob.slice(start, end, storedBlob.type);
    const reader = new FileReader();
    reader.onloadend = () => sendResponse({ dataUrl: reader.result, totalSize: storedBlob.size, mimeType: storedBlob.type });
    reader.onerror   = () => sendResponse({ error: 'FileReader chunk failed.' });
    reader.readAsDataURL(chunk);
    return true; // async
  }
  // Popup asks for blob metadata
  if (msg.type === 'GET_BLOB_INFO') {
    if (!storedBlob) { sendResponse({ exists: false }); return true; }
    sendResponse({ exists: true, size: storedBlob.size, mimeType: storedBlob.type });
    return true;
  }
  // Popup asks for the full blob as a data URL (only used for small blobs < 3MB)
  if (msg.type === 'GET_BLOB_DATAURL') {
    if (!storedBlob) { sendResponse({ error: 'No blob.' }); return true; }
    const reader = new FileReader();
    reader.onloadend = () => sendResponse({ dataUrl: reader.result });
    reader.onerror   = () => sendResponse({ error: 'FileReader failed.' });
    reader.readAsDataURL(storedBlob);
    return true;
  }
});

async function startRecording(streamId) {
  try {
    audioChunks = [];
    storedBlob  = null;

    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false
    });

    // Passthrough so the user can still hear the video
    audioCtx   = new AudioContext();
    sourceNode = audioCtx.createMediaStreamSource(stream);
    sourceNode.connect(audioCtx.destination);

    const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = (e) => { if (e.data?.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onerror = (e) => relay('OFFSCREEN_ERROR', { error: 'Recorder: ' + (e.error?.message || 'unknown') });
    mediaRecorder.start(5000);
    relay('LOG', { level: 'ok', text: 'Recording started (audio passthrough active).' });

  } catch (e) {
    relay('OFFSCREEN_ERROR', { error: 'getUserMedia failed: ' + e.message });
  }
}

function stopRecording() {
  if (!mediaRecorder) { relay('OFFSCREEN_ERROR', { error: 'Recorder not active.' }); return; }

  mediaRecorder.onstop = () => {
    try { sourceNode?.disconnect(); } catch(_) {}
    audioCtx?.close().catch(() => {});
    sourceNode = null; audioCtx = null;
    stream?.getTracks().forEach(t => t.stop());
    stream = null;

    if (!audioChunks.length) { relay('OFFSCREEN_ERROR', { error: 'No audio data captured.' }); return; }

    const mimeType = mediaRecorder?.mimeType || 'audio/webm';
    storedBlob  = new Blob(audioChunks, { type: mimeType });
    audioChunks = [];
    mediaRecorder = null;

    const sizeMB = (storedBlob.size / 1024 / 1024).toFixed(2);
    relay('LOG', { level: 'ok', text: 'Audio ready in memory: ' + sizeMB + ' MB. Click Transcribe.' });

    // Signal done — but do NOT serialize the blob. Popup will fetch chunks directly.
    relay('OFFSCREEN_DONE', { sizeBytes: storedBlob.size, mimeType: storedBlob.type });
  };

  try { mediaRecorder.stop(); }
  catch (e) { relay('OFFSCREEN_ERROR', { error: 'Stop failed: ' + e.message }); }
}

function relay(type, extra = {}) {
  chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});
}
