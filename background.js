// background.js — MV3 Service Worker

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE')    { handleStart(sendResponse);        return true; }
  if (msg.type === 'STOP_CAPTURE')     { handleStop(sendResponse);         return true; }
  if (msg.type === 'GET_BLOB_CHUNK')   { forwardToOffscreen(msg, sendResponse); return true; }
  if (msg.type === 'GET_BLOB_INFO')    { forwardToOffscreen(msg, sendResponse); return true; }
  if (msg.type === 'GET_BLOB_DATAURL') { forwardToOffscreen(msg, sendResponse); return true; }

  if (msg.type === 'OFFSCREEN_DONE') {
    // Blob stays in offscreen memory. Just update state flags.
    chrome.storage.session.set({ isRecording: false, startTime: null, blobReady: true, blobSize: msg.sizeBytes });
    chrome.storage.local.set({ recordingState: 'done', capturedAudio: null }); // null = in offscreen memory
    return;
  }
  if (msg.type === 'OFFSCREEN_ERROR') {
    chrome.storage.session.set({ isRecording: false, startTime: null, blobReady: false });
    chrome.storage.local.set({ recordingState: 'error', recordingError: msg.error });
    return;
  }
  if (msg.type === 'LOG') {
    chrome.storage.session.get({ logLines: [] }, ({ logLines }) => {
      logLines.push({ level: msg.level, text: msg.text, ts: Date.now() });
      if (logLines.length > 30) logLines = logLines.slice(-30);
      chrome.storage.session.set({ logLines });
    });
  }
});

// Forward blob fetch requests from popup → offscreen
async function forwardToOffscreen(msg, sendResponse) {
  await ensureOffscreen();
  chrome.runtime.sendMessage(msg, (resp) => {
    if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
    else sendResponse(resp);
  });
}

async function handleStart(sendResponse) {
  try {
    const { isRecording } = await chrome.storage.session.get({ isRecording: false });
    if (isRecording) { sendResponse({ success: false, error: 'Already recording.' }); return; }

    // Get the currently active tab to capture audio from it
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) {
      sendResponse({ success: false, error: 'No active tab found. Please make sure the lecture tab is open and active.' });
      return;
    }

    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: activeTab.id }, (id) => {
        if (chrome.runtime.lastError || !id)
          reject(new Error(chrome.runtime.lastError?.message || 'tabCapture failed'));
        else resolve(id);
      });
    });

    await ensureOffscreen();
    await chrome.storage.session.set({ isRecording: true, startTime: Date.now(), blobReady: false });
    await chrome.storage.local.set({ recordingState: 'recording', capturedAudio: null });
    await chrome.runtime.sendMessage({ type: 'OFFSCREEN_START', streamId });
    sendResponse({ success: true });

  } catch (e) {
    await chrome.storage.session.set({ isRecording: false });
    sendResponse({ success: false, error: e.message });
  }
}

async function handleStop(sendResponse) {
  const { isRecording, startTime } = await chrome.storage.session.get({ isRecording: false, startTime: null });

  if (!isRecording) {
    const { blobReady } = await chrome.storage.session.get({ blobReady: false });
    sendResponse({ success: true, pending: !blobReady, blobReady });
    return;
  }

  const durationSec = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;
  await chrome.storage.session.set({ isRecording: false, startTime: null, pendingDuration: durationSec });
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' }).catch(() => {});
  // Respond immediately — popup polls session.blobReady
  sendResponse({ success: true, pending: true, durationSec });
}

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument().catch(() => false);
  if (!has) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Record and hold tab audio in memory for transcription'
    });
  }
}
