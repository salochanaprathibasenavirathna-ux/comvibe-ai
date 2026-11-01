# Comvibe AI Desktop

## Download and install on Windows

Run the `A-L Mastermind AI-Setup-<version>.exe` installer, then launch **Comvibe AI** from the Start menu. On first launch, select **API key සකසන්න** in the app and enter your own Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). The key is encrypted for your Windows user account and is not included in the installer or shared with other users. Gemini usage is billed against the Google account that owns that key.

## Run from source on Windows

1. Install Node.js 20 or newer from [nodejs.org](https://nodejs.org/).
2. Double-click `start.bat`. It installs the Electron app dependencies the first time and opens the app in its own desktop window (not a browser tab).
3. For source/developer use, the first launch creates `.env` from `.env.example` and opens Notepad. Add your own key, save, and run `start.bat` again. The desktop app also supports storing a personal key in its API key settings.
4. Alternatively, run `npm install` once and then `npm start` in a terminal. Use `npm run web` only if you specifically want browser mode. `npm run check` verifies the backend and Electron entry-point files. `npm run dist:win` builds the Windows installer into `dist`.

Keep `.env` private and never share it. The installer explicitly excludes `.env` files; every person must configure their own key in the app. The key is submitted from the entry field to Electron's local main process, encrypted using Windows secure storage, never written into application files, and never returned to the renderer. Developer `.env` values continue to configure source runs. The app retries temporary model outages once with `GEMINI_FALLBACK_MODEL` (default: `gemini-3.5-flash`); HTTP 429 quota errors are not retried. Gemini usage may incur charges and is subject to Google's account, region, and rate limits. Creating another key in the same Google Cloud project does not reset that project's quota; check [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) if the app reports HTTP 429.

Gemini API endpoint URLs are centralized in `api-config.js`; change them there when switching to another compatible endpoint. Keep API keys in `.env` rather than adding them to the app's frontend. The local API accepts only same-origin JSON POST requests from `127.0.0.1` or `localhost`; third-party websites cannot use the local service to submit Gemini requests.

## Features and data

- Gemini tutor with Sinhala explanations and image questions.
- Essay review with an attached handwritten answer image. Marks are AI estimates, not official examiner marks; upload the official marking scheme too when available.
- Timed practice accepts a past-paper PDF up to 100 MB and an optional answer-sheet PDF up to 100 MB. PDFs are split by page as needed to fit Gemini's per-file limit and uploaded as temporary Gemini Files API references; temporary uploads are deleted after processing. Processing still depends on available memory, network capacity, and Gemini's service limits. Use public, authorized source material; AI extraction and answer keys must be checked against the original paper and official marking scheme.
- Optional essay marking-scheme PDFs are also limited to 100 MB and split into Gemini-compatible page ranges for verification. Image uploads keep their separate smaller limits.
- Uploaded-paper quiz questions show the matching original PDF page alongside the extracted question, preserving its printed layout and wording for comparison.
- Grounded web search for official source links and exam resources.
- Three original subject revision guides can be downloaded as self-contained Sinhala HTML e-books for offline reading. Official past papers and commercial publications are not bundled.
- Mind Boost active-recall activities and personal progress/history.
- Desktop accounts, PIN verifiers, study data, and the active sign-in session are encrypted with Windows secure storage. PIN verification and per-account data access are handled by the Electron main process; existing browser accounts are migrated on first desktop launch. Browser mode keeps the sign-in session in browser storage. Sign-in remains active across restarts until the user signs out.
- On the first app visit, students choose their name, three subjects, A/L exam year, and target score together. These settings can be edited later from the profile button in the top bar or the dashboard target section, and are saved separately for each account. Changing the year or target clears the old AI study plan so it can be regenerated for the new goal.
- MCQ and essay marks show A/B/C/S/W grade colors directly on the mark box: A 75–100 (bright green), B 65–74 (green), C 55–64 (yellow), S 35–54 (red), and W below 35 (red).
- The supplied `app-logo.png` appears on startup, in the app sidebar, and as the browser tab icon; the startup screen transitions to the dashboard automatically.
- Five Mind Boost modes: AI-personalized activity recommendations, timed five-question Quick Fire MCQ, logic puzzles, Feynman explanation feedback, speed flashcards, and AI-generated mind maps. Existing saved flashcards are used for speed review when available.
- An A/L year selector and editable exam date, live days/hours/minutes/seconds countdown, 0–100 starting-level and target sliders, available study hours, and a Gemini-generated study plan.
- Past-paper history, countdown settings, study targets, AI plan, and notes are saved in the desktop app's encrypted Windows-user data folder. Each Windows user has a separate encrypted store; people sharing one Windows login also share that OS-level security boundary.

Official starting points:

- [Sri Lanka Department of Examinations](https://www.doenets.lk/)
- [e-Thaksalawa, Ministry of Education](https://e-thaksalawa.moe.gov.lk/lcms/)

This application does not bundle or redistribute copyrighted past papers. Availability and permissions are determined by the respective source.

The initial countdown date is **1 August of the selected year as an estimate**, not an official examination date. Change it to the official date once announced. AI study plans are guidance only and cannot guarantee examination marks.
