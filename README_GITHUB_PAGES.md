# LectureScribe — AI Notes Web App

A web-based version of the LectureScribe Chrome extension that transcribes video lectures and generates exam-ready notes using Groq AI.

## 🌐 Live Demo

Visit the GitHub Pages site to use the app directly in your browser.

## ✨ Features

- **System Audio Capture**: Record audio from any browser tab or application using `getDisplayMedia` API
- **Audio File Upload**: Upload existing audio/video files (MP3, MP4, WAV, M4A, OGG, WebM, AAC, FLAC)
- **AI Transcription**: Convert speech to text using Groq's Whisper models
- **Smart Notes Generation**: Generate study notes in multiple formats:
  - Exam-Ready Bullets
  - Cornell Notes
  - Detailed Outline
  - Flashcard Q&A
  - Concise Summary
  - Concept Map
  - Problem-Solving Focus
  - Compare & Contrast
  - Timeline/Sequence
- **Practice Questions**: Optional practice questions with answers
- **Transcript Correction**: AI-powered correction of transcription errors
- **Markdown Rendering**: Beautiful rendering of notes with tables, formulas (LaTeX), code blocks, and more
- **Local Storage**: All settings and data stored locally in your browser

## 🔧 Key Changes from Extension to Web App

| Chrome Extension | Web App |
|-----------------|---------|
| `chrome.storage.local` | `localStorage` |
| `chrome.runtime.sendMessage` | Direct function calls |
| `chrome.tabCapture` | `navigator.mediaDevices.getDisplayMedia` |
| Background service worker | Not needed (runs in-page) |
| Offscreen document | Not needed (in-memory recording) |
| Content scripts | Not needed (no page injection) |

## 🚀 Deploying to GitHub Pages

1. Push these files to a GitHub repository
2. Go to Settings → Pages
3. Select "Deploy from a branch"
4. Choose your branch (e.g., `main`) and `/ (root)` folder
5. Click Save
6. Your app will be live at `https://yourusername.github.io/repo-name/`

## 📁 Files

- `index.html` — Main HTML structure and CSS styles
- `app.js` — Application logic (adapted from `popup.js`, `background.js`, and `offscreen.js`)

## 🔑 Getting Started

1. Get a free Groq API key from [console.groq.com](https://console.groq.com)
2. Open the app in your browser
3. Enter and save your API key
4. Click "Start Capture" and select the tab/window with your lecture
5. Enable "Share system audio" when prompted
6. When done, click "Stop & Process"
7. Click "Transcribe" to convert audio to text
8. Click "Generate Notes" to create study materials

## 🎯 How Audio Capture Works

The web app uses the `getDisplayMedia` API which allows capturing system audio:

1. User clicks "Start Capture"
2. Browser shows a dialog to select a window/tab/screen
3. User must check "Share system audio" in the dialog
4. MediaRecorder captures the audio stream
5. Audio is stored in memory as a Blob
6. Blob is sent to Groq's Whisper API for transcription

**Note**: This works best in Chrome and Edge browsers. Firefox and Safari may have limited support for system audio capture.

## 🔒 Privacy & Security

- Your API key is stored locally in your browser (never sent to any server except Groq)
- Audio recordings are kept in memory only (not saved to disk)
- No data is collected or transmitted beyond what's needed for transcription
- All processing happens through Groq's API

## 🛠️ Development

### Running Locally

Simply open `index.html` in a modern browser. For best results, serve it via a local server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .

# Using PHP
php -S localhost:8000
```

Then visit `http://localhost:8000`

### Building from Extension

The web app was created by:
1. Extracting core functionality from `popup.js`, `background.js`, and `offscreen.js`
2. Replacing Chrome extension APIs with standard Web APIs
3. Adapting the UI from popup dimensions to full-page layout
4. Consolidating all logic into a single `app.js` file

## 📝 Notes Styles Explained

- **Exam-Ready Bullets**: Concise, high-yield points formatted for exam revision
- **Cornell Notes**: Traditional Cornell note-taking format with cue column
- **Detailed Outline**: Hierarchical structure with comprehensive coverage
- **Flashcard Q&A**: Question-answer pairs for active recall
- **Concise Summary**: Brief overview of key concepts
- **Concept Map**: Relationships between ideas
- **Problem-Solving Focus**: Step-by-step problem-solving frameworks
- **Compare & Contrast**: Side-by-side comparison of concepts
- **Timeline/Sequence**: Chronological or logical ordering of information

## ⚠️ Limitations

- Maximum audio file size depends on Groq API limits (typically ~25MB per chunk)
- System audio capture requires Chrome/Edge with "Share system audio" enabled
- Long recordings may be automatically compressed before note generation
- Rate limits apply based on your Groq API tier

## 🙏 Credits

Original Chrome extension concept adapted for web deployment. Powered by:
- [Groq](https://groq.com) — Fast inference for Whisper and Llama models
- [Whisper](https://openai.com/research/whisper) — Speech-to-text transcription
- [Llama 3](https://meta.ai) — Notes generation and correction

## 📄 License

MIT License
