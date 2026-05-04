# LectureScribe — AI Exam Notes Chrome Extension

Transcribe video lectures on Canvas, Panopto, and other platforms in real time using Groq Whisper, then summarize them into exam-ready notes with Groq LLaMA.

---

## Features

- **Live Tab Audio Capture** — records audio from any browser tab playing a video
- **Groq Whisper Transcription** — fast and accurate transcription (whisper-large-v3)
- **5 Notes Styles** — exam bullets, Cornell notes, detailed outline, Flashcard Q&A, or concise summary
- **Secure Local Storage** — your API key is stored locally, never sent anywhere except Groq
- **One-click Copy** — copy notes to clipboard instantly
- **Platform Aware** — special support for Canvas/Instructure and Panopto

---

## Setup (5 minutes)

### 1 — Get a Groq API Key
1. Go to [https://console.groq.com](https://console.groq.com)
2. Sign up for free account
3. Navigate to **API Keys** → **Create API Key**
4. Copy the key (starts with `gsk_`)

### 2 — Load the Extension in Chrome
1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer Mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `lecture-scribe-extension` folder
5. The LectureScribe icon will appear in your toolbar

### 3 — Configure
1. Click the LectureScribe icon
2. Paste your Groq API key and click **Save**
3. Choose your preferred Whisper model and notes style

---

## How to Use

1. **Navigate** to a Canvas course or Panopto lecture page
2. **Start the video** playing
3. **Click** the LectureScribe extension icon
4. Click **▶ Start Capture** — a recording badge appears on the page
5. Watch (or fast-forward through) your lecture
6. Click **⏹ Stop & Process** when done
7. Click **⚡ Transcribe** — Groq Whisper processes the audio
8. Click **✦ Generate Notes** — LLaMA turns the transcript into structured notes
9. Click **⎘ Copy Notes** — paste into Notion, Word, Anki, etc.

---

## Model Recommendations

| Model | Speed | Accuracy | Best For |
|-------|-------|----------|----------|
| whisper-large-v3 | Fast | Highest | All lectures (default) |
| whisper-large-v3-turbo | Fastest | High | Long lectures >1 hour |
| distil-whisper-large-v3-en | Very fast | Good | English-only lectures |

---

## Notes Styles

| Style | Output |
|-------|--------|
| **Exam-Ready Bullets** | Key concepts, facts, formulas, likely exam topics |
| **Cornell Notes** | Left cues + right notes + bottom summary |
| **Detailed Outline** | Hierarchical I/A/1 outline structure |
| **Flashcard Q&A** | 15-20 question-answer pairs for Anki/Quizlet |
| **Concise Summary** | Compact 5-point overview |

---

## Troubleshooting

**"Could not capture tab audio"**
- Make sure a video is actively playing in the tab
- Chrome requires user interaction before audio capture — click play on the video first
- Some sites (YouTube, Netflix) may block tab capture due to DRM

**"Groq API error 401"**
- Your API key is incorrect or expired — get a new one from console.groq.com

**"Audio too large"**
- Groq Whisper accepts up to 25MB. For lectures >~1 hour, use whisper-large-v3-turbo or record in segments.

**Extension not appearing**
- Make sure Developer Mode is ON in chrome://extensions
- Click the puzzle piece icon → pin LectureScribe

---

## Privacy

- Audio is only sent to `api.groq.com` for transcription
- No data is stored on any servers — everything is local
- Your API key is stored in Chrome's local storage (not synced)
- Clear all data anytime with the **✕ Clear** button

---

## File Structure

```
lecture-scribe-extension/
├── manifest.json       # Extension config
├── popup.html          # Main UI
├── popup.js            # UI logic + Groq API calls
├── background.js       # Tab audio capture service worker
├── content.js          # Page-level video detection
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```
