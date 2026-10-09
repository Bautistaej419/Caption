# CAPTION - project handoff

Last reviewed: 2026-10-06 (Asia/Manila)

## What this project is

CAPTION is an early browser-based accessibility/communication prototype intended to combine video calling, speech captions, sign-language recognition, text chat, and sign-to-speech. The repository is deliberately small and has no package manifest, build setup, test suite, or Git command available in the current shell.

## Current repository contents

- `index.html` - large single-page UI for CAPTION. It includes a splash screen, local/remote video panes, caption panels, chat, call/media/sign/recording controls, history/about/help overlays, and a side menu. It loads TensorFlow.js, MediaPipe Hands, the TensorFlow hand-pose detector, PeerJS, `style.css`, and `script.js` from CDNs/local files.
- `script.js` - currently a **camera test implementation**, not the full product. "Get Started" hides the splash screen and starts the front camera using `getUserMedia`. It updates the status text, attaches the stream to `#localVideo`, and stops tracks on page unload. No other displayed controls are wired up.
- `style.css` - responsive visual system with CSS variables for light/dark themes; video layout, overlays, caption cards, controls, menu, history panel, and mobile breakpoints.
- `HandTrackingModule.py` - separate OpenCV + MediaPipe Hands utility. It detects/draws up to two hands, returns landmark positions, and estimates raised fingers. Its `main()` opens camera index `1` and exits with Escape.
- `RealTimeSignLanguageDetection.ipynb` - appears to contain an LSTM/MediaPipe Holistic sign-language tutorial for landmark sequences and real-time predictions. Important: it is malformed as a usable notebook: its one top-level code cell contains a serialized notebook JSON string (a notebook nested inside another notebook). The embedded code references assets such as `model.h5`, `model_weights.h5`, and training data, but those assets are not present in the repository.

## Current functional state

Implemented and likely usable in a secure context (HTTPS or a local development server):

- Start screen dismissal.
- Front-camera permission/request, local video preview, and basic status/error messages.
- Camera cleanup when the page unloads.
- Browser-side MediaPipe Hand Landmarker integration (`sign-detection.js`), including a live landmark overlay and a HI-wave-only prototype. It no longer classifies static handshapes. This is not full ASL translation.
- Room-based test chat: entering a room ID such as `123` and selecting Join Call unlocks a `BroadcastChannel` live chat. It works across tabs/windows on the same browser origin; it is not yet networked messaging or a video call.
- `Voice: ON` uses the browser Web Speech API (where supported) and sends final transcripts to the joined room's live chat. `Sign-to-Text & Speech: ON` starts hand tracking, speaks stable results, and posts them to chat.
- `Sign: ON` now shares stable, supported sign labels with the second tab/window in the same room, displays them under Remote Signs, and posts them to the joined room's live chat. `Sign-to-Text & Speech` additionally speaks detected labels. This is currently limited to the static baseline labels, not word-level ASL.
- Reviewed `C:\Users\Ej Bautista\Downloads\Video Project.mp4`: a 2.67-second ASL HI clip showing an open palm near the head with a short horizontal wave. Added a landmark-motion HI prototype to `sign-detection.js`; it is not a trained model and will need real camera testing/tuning plus more labeled clips for reliable recognition.
- The local camera pane now has a hand-tracking indicator: red while searching/off and green when MediaPipe finds a hand. The canvas also draws the 21-point landmark skeleton.
- The initial Tasks-API hand tracker continuously searched without detecting a hand on the user's Live Server test. Switched `sign-detection.js` to the classic MediaPipe Hands CDN API (`Hands`, `hands.send({ image: localVideo })`, and `onResults`) supplied by the user; it retains the custom landmark overlay, detection indicator, sign rules, and room sharing. The camera control now stops and restarts actual media tracks.
- Live Server console screenshot on 2026-10-06 identified the actual tracker blocker: `Uncaught SyntaxError: Identifier 'localVideo' has already been declared` in `sign-detection.js`, caused by loading two classic scripts that each declared top-level `const localVideo`. Wrapped `sign-detection.js` in an IIFE so its variables are private while `window.CaptionSignDetection` remains available to `script.js`.
- Removed the no-longer-applicable A calibration control and unused voice-picker UI. Enabled microphone mute/unmute in the camera overlay and local MediaRecorder capture/download through the Record button. Camera setup now requests audio as well as video.
- Reviewed the supplied lesson/test clips for HELLO, MY, NAME, and HELP. Added rule-based prototypes alongside HI: HELLO is an upper-face open-palm movement down/out; MY is a held open palm in the central lower/chest zone; NAME is two nearby H-handshapes; HELP is a thumb-up fist lifted from a nearby open palm. MediaPipe uses the lite `modelComplexity: 0` setting and lower confidence thresholds to better keep up with fast motion. The local camera is mirrored by default; the `↔️` overlay control toggles that mirror for both video and landmark canvas.
- Revised gesture heuristics after user clarification: HELLO begins in a salute/forehead position; MY accepts a flat hand held anywhere across the broad chest zone; NAME requires two sideways/horizontal H-hands; HELP has lower movement/detection requirements plus a held-pose fallback. `Your Signs` now only reports a recognized label or a neutral reading status, not a list of possible signs.
- Reviewed 2026-10-07 user demonstrations: HELP (thumb-up fist on open palm, rising), NAME (two horizontal H-hands/tap), and MY (flat open hand on chest). Filter MediaPipe results using handedness confidence and basic palm geometry before drawing/recognizing, to prevent weak false positives. MY chest zone is raised to match the user's recording; NAME needs a short valid two-H hold; HELP requires the correct upper-fist/lower-palm configuration and a real upward motion (no loose held-pose fallback).
- Added classic MediaPipe Pose alongside Hands. The tracker now uses nose/shoulder landmarks to require a real body context: MY must be inside a computed chest zone, HI must be near the head and reverse direction, and HELLO must start near the forehead before moving outward. Pose is throttled to roughly 11 fps while lightweight Hands still runs per available video frame. A recognized sign is not reposted while held; it can publish again after hand release or a different sign.
- UI/performance refinement: `Your Signs` now shows only the initial instruction or one recognized sign, never a changing list/"Reading" message. HI detection is restricted to a quick open-palm horizontal wave with a direction reversal; HELLO is a salute/forehead start followed by an outward movement. Pose body context is now sampled about every 180ms (instead of about 90ms) to preserve more laptop CPU for per-frame hand tracking.
- Per user request, switched HELP to immediate demonstrated-landmark recognition with a 1-second cooldown: a thumb-up fist above a supporting open palm produces HELP. MY uses the pose-derived chest zone. A dashed yellow `MY chest zone` overlay is drawn from shoulder landmarks. HI remains a horizontal open-palm wave (not a static palm), because HELLO starts with the same palm near the face; this preserves the ability to distinguish HI from HELLO. Initial `Your Signs` display is simply `---`.
- User's HELLO screenshot showed a valid flat salute at the forehead but the wrist was away from the face. Updated HELLO to evaluate the palm/finger-base position, plus a flat aligned-fingertip B-handshape, and classify it immediately. Pose sampling increased from every 180ms to every 120ms for faster face/chest context while hands continue per frame.
- User screenshot showed a true false-positive face landmark. Hardened `isPlausibleHand()` with correctly read handedness confidence, basic palm geometry, and at least three coherent finger chains. MediaPipe Hands now uses `modelComplexity: 1`, `minDetectionConfidence: 0.65`, and `minTrackingConfidence: 0.55`. HI is an upright open palm beside the head; HELLO is evaluated first as a flat salute at the forehead.
- MY reliability refinement: it is now eligible only with exactly one detected hand, inside the pose-derived chest zone, and with a palm at least 20% of the visible shoulder width. This rejects far-away hands and prevents two-hand NAME/HELP configurations from falling through to MY.
- The camera overlay toggle was added but initially had no click handler. It now calls `CaptionSignDetection.setOverlayVisible()`, clears/shows both hand skeleton and chest guide, and updates its icon/title.
- Reworked sign output into phrases: each recognized sign goes into a buffer; after two seconds with no further sign, the phrase is placed in chat, shared as Remote Sign, and spoken when Sign-to-Text & Speech is enabled. Began PeerJS room integration for cross-device data/video using `caption-room-<room-code>` as the owner peer ID; the room owner hosts, later joiners connect/call it. Both devices must load the page over HTTPS or a LAN-reachable HTTP URL, not `127.0.0.1`.
- Added `.vscode/settings.json` to make VS Code Live Server bind to `0.0.0.0` and prefer the LAN IP, allowing another device on the same Wi-Fi to open the page. Phone camera/microphone usage still generally requires an HTTPS URL; use an HTTPS tunnel or deploy it for full mobile calling.

Present in the UI but not implemented in `script.js`:

- PeerJS connection, room joining, remote video, and ending a call.
- Speech recognition/captioning and remote captions.
- Sign recognition, remote sign sharing, calibration, or sign-to-speech.
- Chat, recording, history, PWA install/download flow, theme toggle, menu/overlays, camera switching, flash/mic/camera buttons, ID copy/share, and voice picker.

## Integration gaps / cautions

- `sign-detection.js` downloads the MediaPipe task and its model from CDNs at runtime; hand tracking needs an internet connection on first use unless those assets are later self-hosted.
- Several referenced PWA/image assets (`manifest.json`, `icon-192.png`, `icon-512.png`) do not exist in the reviewed file list, so the manifest and logos will currently fail to load.
- Text intended as emoji displays as mojibake in the source/output; save HTML/JS/CSS as UTF-8 and correct affected characters if polishing the UI.
- The product language says ASL, but neither the browser code nor the checked-in model assets implement production ASL recognition. Avoid claiming that it does until an actual model pipeline is integrated and tested.
- Camera access requires HTTPS or localhost. Test with two devices/browsers before treating video calling as complete.

## Recommended next work

1. Decide whether the browser app is the primary direction. If yes, make `script.js` the source of truth and implement features incrementally rather than relying on the unrelated Python notebook.
2. Wire basic UX first: menu/overlays, theme persistence, camera/mic toggles, camera switching, and graceful unavailable-device states.
3. Add PeerJS call lifecycle and a tested signaling/room-ID flow; then implement chat through a data connection.
4. Add speech recognition with clear browser support/fallback behavior.
5. Choose or train an appropriate, licensed sign-recognition model and export/deploy it for the browser. Keep inference, temporal smoothing, confidence thresholds, and accessibility disclosure explicit.
6. Either repair/flatten the notebook into a valid `.ipynb` and commit its required models/data documentation, or archive/remove it from the active browser-app path.
7. Add missing static/PWA assets, a minimal README with launch instructions, and a lightweight test/lint setup.

## Notes for the next session

- Start by asking which roadmap item the user wants; no feature implementation was performed during the 2026-10-06 review.
- `memory.md` was empty before this handoff was written.
- The shell reported that `git` is not installed/available, so repository history and worktree status were not inspected.

## Deployment update (2026-10-09)

- Restored normal VS Code Live Server behavior by removing `.vscode/settings.json`, which had forced the insecure LAN IP address. Camera access should again work through `localhost`.
- Added a transparent version of the supplied circular CAPTION logo at `assets/caption-logo-transparent.png`, plus `icon-192.png`, `icon-512.png`, and `manifest.json`; this removes the prior PWA/icon 404s.
- Replaced the browser PeerJS integration with LiveKit client logic. The app now requires a deployed token endpoint before remote calls/chat can connect. The endpoint implementation is in `worker/`, while GitHub Pages deployment is in `.github/workflows/deploy-pages.yml`.
- `livekit-config.js` deliberately contains a placeholder Worker URL. Follow `DEPLOYMENT.md` to create LiveKit Cloud and Cloudflare Worker credentials, deploy the Worker, set the exact GitHub Pages allowed origin, and replace that placeholder. No LiveKit secret belongs in the GitHub repository.
- Added an `IS` rule to `sign-detection.js`: with exactly one plausible hand, the first reference shape (raised index, other fingers folded) starts a five-second sequence. The second reference shape (curled/compact index handshape) must appear inside that window to publish `IS`; the first handshape alone never publishes text.
- Stabilized `IS` recognition: the first reference shape arms the five-second sequence immediately on one valid detection and remains armed even if the hand leaves the camera. The finish cannot register until 180 ms after arming and must remain visible for about 180 ms, which prevents landmark flicker from completing the sign incorrectly.
- Reviewed `Screen Recording 2026-10-09 111021.mp4`: the overlay did not detect the raised-index start pose but did detect the later fist, so `IS` could never arm. Lowered the MediaPipe hand detection/tracking thresholds moderately and relaxed the start-shape rule to accept a clear raised index plus any two folded fingers; the geometry/finger-chain checks remain to reduce face false positives.
- Added installable PWA behavior for GitHub Pages: the splash screen now has an `INSTALL APP` button, `script.js` handles the Chrome/Edge install prompt (and Safari Add-to-Home-Screen guidance), and `sw.js` caches core local app assets. The button hides once CAPTION is already installed.
- Implemented the upper-right menu: it opens from the right and provides persistent light/dark theme switching, locally stored call history, About CAPTION, Help & How-to, and Contact Support. A history record starts only after a room successfully joins, records join/end time and message count, and is stored only in that browser via `localStorage`.
- Revised HI/HELLO recognition to rely on tracked motion rather than static poses: HI now needs a reversing horizontal open-palm wave that remains near the pose-tracked head, while HELLO must begin at the forehead and increase hand-to-head distance as it moves outward. The prior immediate static HI/HELLO checks were removed to prevent duplicate or mistaken text output.
- `IS` is now a single, exact raised-index handshape (long upright index, with middle/ring/pinky folded). It does not use a second fist gesture. Recognition enters the existing two-second phrase buffer before it appears in live chat or speech, preventing repeat output while the sign is held.
- Reviewed `Screen Recording 2026-10-09 181003.mp4` and added a dedicated one-hand HELLO salute rule: the pose-tracked forehead must be near the hand, at least two fingers must extend from the palm (to reject a fist), and the pose is held briefly. Two hands always reject HELLO. The overlay now draws a `Head` marker at the pose nose landmark used for HI/HELLO distance checks.
- Landmark/head/chest guides now start hidden when CAPTION opens and appear only after the overlay button is pressed. HI/HELLO head proximity now uses pose ear-to-ear face width (with a shoulder-based fallback) rather than the broad shoulder width; the optional overlay shows the compact head range as a dashed purple ring.
- Greeting zones are now explicitly separated: HELLO is restricted to one hand inside the small forehead/head range, while HI is restricted to one open hand making a reversing wave outside that head ring but still alongside the upper face. Two hands cannot produce HI.
- LiveKit deployment hardening (2026-10-09): the Cloudflare token Worker now exposes `POST /token` and `GET /health`, strictly checks comma-separated `ALLOWED_ORIGINS`, creates short-lived (15-minute) publish/subscribe/data tokens, and keeps all three LiveKit values in Worker secrets. Added root `.env.example`, `worker/.dev.vars.example`, stronger `.gitignore`, a GitHub Pages workflow that reads the public `CAPTION_TOKEN_ENDPOINT` repository variable into the deploy artifact, and room invitation copy/share links. `livekit-config.js` intentionally remains blank until the Worker URL is configured. GitHub/Cloudflare/LiveKit accounts are not connected in this session; deployment and end-to-end call verification are pending user authorization/credentials.
