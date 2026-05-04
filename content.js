// content.js — Injected into lecture pages
// Detects video players and provides helpers for LectureScribe

(function () {
  'use strict';

  // ─── Detect lecture platform ─────────────────────────────────
  const url = window.location.href;
  const isPanopto = url.includes('panopto.com') || url.includes('panopto.eu');
  const isCanvas  = url.includes('instructure.com') || url.includes('canvas.');

  let platform = 'generic';
  if (isPanopto) platform = 'panopto';
  else if (isCanvas) platform = 'canvas';

  // ─── Find video element ───────────────────────────────────────
  function findVideo() {
    // Try common selectors for Canvas/Panopto
    const selectors = [
      'video',
      '.panopto-video video',
      '#panopto-app video',
      'iframe[src*="panopto"]',
      '.media-embed video',
      '[data-media-type="video"] video'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ─── Inject floating indicator ────────────────────────────────
  function injectIndicator(state) {
    let badge = document.getElementById('ls-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'ls-badge';
      badge.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 99999;
        background: #0a0a0f;
        border: 1px solid #7c6dfa;
        border-radius: 8px;
        padding: 8px 14px;
        font-family: 'DM Mono', monospace, sans-serif;
        font-size: 12px;
        color: #e8e8f0;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 20px rgba(124,109,250,0.3);
        pointer-events: none;
        transition: opacity 0.3s;
      `;
      document.body.appendChild(badge);
    }

    const dot = state === 'recording'
      ? '<span style="width:8px;height:8px;border-radius:50%;background:#f87171;display:inline-block;animation:ls-pulse 1s infinite;"></span>'
      : '<span style="width:8px;height:8px;border-radius:50%;background:#7c6dfa;display:inline-block;"></span>';

    badge.innerHTML = dot + ' LectureScribe: ' + state;

    if (!document.getElementById('ls-style')) {
      const s = document.createElement('style');
      s.id = 'ls-style';
      s.textContent = '@keyframes ls-pulse { 0%,100%{opacity:1}50%{opacity:0.3} }';
      document.head.appendChild(s);
    }
  }

  function removeIndicator() {
    const badge = document.getElementById('ls-badge');
    if (badge) badge.remove();
  }

  // ─── Listen from extension ────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      const video = findVideo();
      sendResponse({
        platform,
        hasVideo: !!video,
        videoSrc: video?.src || video?.currentSrc || '',
        videoDuration: video?.duration || 0,
        videoCurrentTime: video?.currentTime || 0,
        paused: video?.paused ?? true,
        url: window.location.href,
        title: document.title
      });
    }

    if (msg.type === 'SHOW_INDICATOR') {
      injectIndicator(msg.state || 'active');
      sendResponse({ ok: true });
    }

    if (msg.type === 'HIDE_INDICATOR') {
      removeIndicator();
      sendResponse({ ok: true });
    }

    if (msg.type === 'PAUSE_VIDEO') {
      const video = findVideo();
      if (video && !video.paused) { video.pause(); sendResponse({ ok: true }); }
      else sendResponse({ ok: false });
    }

    if (msg.type === 'RESUME_VIDEO') {
      const video = findVideo();
      if (video && video.paused) { video.play(); sendResponse({ ok: true }); }
      else sendResponse({ ok: false });
    }
  });

  // ─── Auto-announce to extension ───────────────────────────────
  // Let the extension know a video page was loaded
  setTimeout(() => {
    const video = findVideo();
    if (video) {
      chrome.runtime.sendMessage({
        type: 'VIDEO_DETECTED',
        platform,
        title: document.title,
        url: window.location.href
      }).catch(() => {});
    }
  }, 2000);

})();
