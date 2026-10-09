// CAPTION - Camera Test Version

const localVideo = document.getElementById("localVideo");
const startAppBtn = document.getElementById("startAppBtn");
const splashScreen = document.getElementById("splash-screen");
const downloadAppBtn = document.getElementById("downloadAppBtn");
const openMenuButton = document.getElementById("openMenu");
const closeMenuButton = document.getElementById("closeMenu");
const sideMenu = document.getElementById("side-menu");
const menuOverlay = document.getElementById("menu-overlay");
const themeToggleButton = document.getElementById("themeToggle");
const viewHistoryButton = document.getElementById("viewHistoryMenu");
const showAboutButton = document.getElementById("showAbout");
const showHelpButton = document.getElementById("showHelp");
const contactSupportButton = document.getElementById("contactSupport");
const contactOverlay = document.getElementById("contactOverlay");
const closeContactButton = document.getElementById("closeContact");
const historyOverlay = document.getElementById("historyOverlay");
const historyContent = document.getElementById("historyContent");
const closeHistoryButton = document.getElementById("closeHistory");
const aboutOverlay = document.getElementById("aboutOverlay");
const closeAboutButton = document.getElementById("closeAbout");
const helpOverlay = document.getElementById("helpOverlay");
const closeHelpButton = document.getElementById("closeHelp");
const roomIdInput = document.getElementById("roomId");
const copyIdButton = document.getElementById("copyIdBtn");
const shareLinkButton = document.getElementById("shareLinkBtn");
const joinCallButton = document.getElementById("joinCall");
const endCallButton = document.getElementById("endCall");
const chatInput = document.getElementById("chatInput");
const sendChatButton = document.getElementById("sendChat");
const chatLog = document.getElementById("chatLog");
const remoteSignCaption = document.getElementById("remoteSignCaption");
const remoteSpeechCaption = document.getElementById("remoteSpeechCaption");
const remoteVideo = document.getElementById("remoteVideo");
const remoteLoading = document.getElementById("remoteLoading");
const handTrackingIndicator = document.getElementById("handTrackingIndicator");
const toggleVoiceButton = document.getElementById("toggleVoice");
const toggleSignButton = document.getElementById("toggleSign");
const toggleSignToSpeechButton = document.getElementById("toggleSignToSpeech");
const toggleCamButton = document.getElementById("toggleCam");
const toggleMicButton = document.getElementById("toggleMic");
const recordSessionButton = document.getElementById("recordSession");
const switchCamButton = document.getElementById("switchCam");
const toggleLandmarksButton = document.getElementById("toggleLandmarks");

let localStream = null;
let activeRoomId = null;
const chatClientId = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
let voiceRecognition = null;
let voiceEnabled = false;
let signTrackingEnabled = false;
let signToSpeechEnabled = false;
let cameraEnabled = false;
let microphoneMuted = false;
let mediaRecorder = null;
let recordingChunks = [];
let isCameraMirrored = true;
// Guides are off when CAPTION first opens; the user can reveal them with the
// overlay button after pressing Get Started.
let landmarksVisible = false;
let pendingSignWords = [];
let signPhraseTimer = null;
let liveKitRoom = null;
let liveKitSdk = null;
let deferredInstallPrompt = null;
let activeHistoryId = null;
let appStarted = false;

const LIVEKIT_TOKEN_ENDPOINT = window.CAPTION_CONFIG?.tokenEndpoint || "";
const SESSION_HISTORY_KEY = "caption-call-history-v1";

function pinMenuButtonToTopLeft() {
    if (!openMenuButton) return;
    // Use an inline important rule as a final guard against old stylesheet
    // rules or browser cache entries moving the hamburger over the logo.
    openMenuButton.style.setProperty("position", "fixed", "important");
    openMenuButton.style.setProperty("top", "28px", "important");
    openMenuButton.style.setProperty("left", "28px", "important");
    openMenuButton.style.setProperty("right", "auto", "important");
    openMenuButton.style.setProperty("bottom", "auto", "important");
    openMenuButton.style.setProperty("margin", "0", "important");
    openMenuButton.style.setProperty("z-index", "10002", "important");
}

function setMenuButtonVisible(visible) {
    if (!openMenuButton) return;
    openMenuButton.style.display = visible && appStarted ? "block" : "none";
}

function getSessionHistory() {
    try { return JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) || "[]"); }
    catch { return []; }
}

function saveSessionHistory(history) {
    localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
}

function startHistorySession(room) {
    activeHistoryId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const history = getSessionHistory();
    history.unshift({ id: activeHistoryId, room, joinedAt: new Date().toISOString(), leftAt: null, messageCount: 0 });
    saveSessionHistory(history);
}

function finishHistorySession() {
    if (!activeHistoryId) return;
    const history = getSessionHistory();
    const session = history.find((item) => item.id === activeHistoryId);
    if (session && !session.leftAt) session.leftAt = new Date().toISOString();
    saveSessionHistory(history);
    activeHistoryId = null;
}

function recordHistoryMessage() {
    if (!activeHistoryId) return;
    const history = getSessionHistory();
    const session = history.find((item) => item.id === activeHistoryId);
    if (session) session.messageCount = (session.messageCount || 0) + 1;
    saveSessionHistory(history);
}

function formatSessionTime(value) {
    return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function renderHistory() {
    const history = getSessionHistory();
    if (!history.length) {
        historyContent.innerHTML = "<p>No call history yet. Join a room to create a session record.</p>";
        return;
    }
    historyContent.replaceChildren(...history.map((session) => {
        const item = document.createElement("article");
        item.className = "history-item";
        const ended = session.leftAt ? formatSessionTime(session.leftAt) : "Still active";
        const title = document.createElement("strong");
        title.textContent = `Room ${session.room}`;
        const joined = document.createElement("span");
        joined.textContent = `Joined: ${formatSessionTime(session.joinedAt)}`;
        const endedAt = document.createElement("span");
        endedAt.textContent = `Ended: ${ended}`;
        const messages = document.createElement("span");
        messages.textContent = `Messages: ${session.messageCount || 0}`;
        item.append(title, joined, endedAt, messages);
        return item;
    }));
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("caption-theme", theme);
    document.getElementById("theme-meta")?.setAttribute("content", theme === "dark" ? "#0f172a" : "#1B4F97");
    if (themeToggleButton) themeToggleButton.textContent = theme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
}

function closeMenu() {
    sideMenu?.classList.remove("active");
    if (menuOverlay) menuOverlay.style.display = "none";
    setMenuButtonVisible(true);
}

function openOverlay(overlay) {
    closeMenu();
    if (overlay) overlay.style.display = "flex";
}

function isInstalledApp() {
    return window.matchMedia?.("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;
}

function showInstallButton() {
    if (!downloadAppBtn || isInstalledApp()) return;
    downloadAppBtn.style.display = "inline-flex";
}

window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showInstallButton();
});

window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (downloadAppBtn) downloadAppBtn.style.display = "none";
    updateStatus("CAPTION installed successfully");
});

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch((error) => {
            console.warn("Service worker registration failed:", error);
        });
    });
}

// ===============================
// STATUS
// ===============================
function updateStatus(message) {
    console.log("CAPTION:", message);

    const status = document.getElementById("status");
    if (status) {
        status.textContent = message;
    }
}

function appendChatMessage(sender, message, isLocal = false) {
    const entry = document.createElement("p");
    entry.style.margin = "4px 0";

    const name = document.createElement("strong");
    name.textContent = `${sender}: `;
    entry.append(name, document.createTextNode(message));

    if (isLocal) entry.style.color = "var(--brand-blue)";
    chatLog.append(entry);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function speakText(text) {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function sendRoomMessage(data) {
    if (!liveKitRoom || !activeRoomId) return;
    const payload = new TextEncoder().encode(JSON.stringify({ ...data, senderId: chatClientId }));
    liveKitRoom.localParticipant.publishData(payload, { reliable: true }).catch((error) => {
        console.error("LiveKit data error:", error);
    });
}

function normalizeRoomId(value) {
    return value.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
}

function invitationUrl(room) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", room);
    return url.toString();
}

function setRoomInvitationControls(room = "") {
    const visible = Boolean(room);
    if (copyIdButton) copyIdButton.style.display = visible ? "inline-block" : "none";
    if (shareLinkButton) shareLinkButton.style.display = visible ? "inline-block" : "none";
    if (copyIdButton && visible) copyIdButton.textContent = "Copy room link";
}

function handleRoomMessage(data) {
    if (!data || data.senderId === chatClientId) return;
    if (data.type === "chat") {
        appendChatMessage("Guest", data.message);
        recordHistoryMessage();
    }
    if (data.type === "speech") {
        remoteSpeechCaption.textContent = data.message;
        appendChatMessage("Guest (speech)", data.message);
        recordHistoryMessage();
    }
    if (data.type === "sign") {
        remoteSignCaption.textContent = data.sign;
        recordHistoryMessage();
    }
}

function queueSignWord(sign) {
    pendingSignWords.push(sign);
    clearTimeout(signPhraseTimer);
    signPhraseTimer = setTimeout(commitSignPhrase, 2000);
}

function commitSignPhrase() {
    const phrase = pendingSignWords.join(" ");
    pendingSignWords = [];
    if (!phrase) return;

    signCaption.textContent = phrase;
    appendChatMessage("You (sign)", phrase, true);
    recordHistoryMessage();
    sendRoomMessage({ type: "sign", sign: phrase });
    sendRoomMessage({ type: "chat", message: phrase });
    if (signToSpeechEnabled) speakText(phrase);
}

function setChatAvailability(isAvailable) {
    chatInput.disabled = !isAvailable;
    sendChatButton.disabled = !isAvailable;
    chatInput.placeholder = isAvailable
        ? "Type a message..."
        : "Join a room before chatting";
}

function setRemoteStream(stream) {
    remoteVideo.srcObject = stream;
    remoteVideo.play().catch(() => {});
    remoteLoading.style.display = "none";
}

async function loadLiveKit() {
    if (!liveKitSdk) {
        liveKitSdk = await import("https://cdn.jsdelivr.net/npm/livekit-client@2.15.0/+esm");
    }
    return liveKitSdk;
}

function clearRemoteVideo() {
    remoteVideo.srcObject = null;
}

async function requestLiveKitToken(room) {
    if (!LIVEKIT_TOKEN_ENDPOINT || LIVEKIT_TOKEN_ENDPOINT.includes("YOUR-WORKER")) {
        throw new Error("Video calls are not configured yet. Add your deployed Worker /token URL to livekit-config.js.");
    }
    const response = await fetch(LIVEKIT_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, identity: `caption-${chatClientId}` })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.token || !body.url) {
        throw new Error(body.error || "Could not join the video room");
    }
    return body;
}

async function connectLiveKit(roomId) {
    const { Room, RoomEvent, Track } = await loadLiveKit();
    const credentials = await requestLiveKitToken(roomId);
    const room = new Room({ adaptiveStream: true, dynacast: true });

    room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Video) {
            const stream = new MediaStream([track.mediaStreamTrack]);
            setRemoteStream(stream);
        } else if (track.kind === Track.Kind.Audio) {
            const audio = track.attach();
            audio.autoplay = true;
            audio.dataset.captionRemoteAudio = "true";
            document.body.append(audio);
        }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((element) => element.remove());
        if (track.kind === Track.Kind.Video) clearRemoteVideo();
    });
    room.on(RoomEvent.DataReceived, (payload) => {
        try { handleRoomMessage(JSON.parse(new TextDecoder().decode(payload))); }
        catch (error) { console.warn("Ignored invalid room message", error); }
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
        clearRemoteVideo();
        remoteLoading.style.display = "block";
    });
    room.on(RoomEvent.Disconnected, () => updateStatus("Disconnected from video room"));

    await room.connect(credentials.url, credentials.token);
    const videoTrack = localStream?.getVideoTracks()[0];
    const audioTrack = localStream?.getAudioTracks()[0];
    if (videoTrack) await room.localParticipant.publishTrack(videoTrack, { source: Track.Source.Camera });
    if (audioTrack) await room.localParticipant.publishTrack(audioTrack, { source: Track.Source.Microphone });
    liveKitRoom = room;
    remoteLoading.style.display = "block";
    startHistorySession(roomId);
    updateStatus(`Joined room ${roomId} - waiting for another participant`);
}

async function publishNewCameraTracks() {
    if (!liveKitRoom) return;
    const { Track } = await loadLiveKit();
    const videoTrack = localStream?.getVideoTracks()[0];
    const audioTrack = localStream?.getAudioTracks()[0];
    if (videoTrack) await liveKitRoom.localParticipant.publishTrack(videoTrack, { source: Track.Source.Camera });
    if (audioTrack) await liveKitRoom.localParticipant.publishTrack(audioTrack, { source: Track.Source.Microphone });
}

async function joinRoom() {
    const roomId = normalizeRoomId(roomIdInput.value);
    if (!roomId) {
        updateStatus("Enter a room name first (for example: caption-123)");
        roomIdInput.focus();
        return;
    }
    roomIdInput.value = roomId;

    if (!localStream) await startLocalVideo();
    if (!localStream) return;

    activeRoomId = roomId;

    joinCallButton.disabled = true;
    roomIdInput.disabled = true;
    endCallButton.disabled = false;
    setChatAvailability(true);
    appendChatMessage("System", `Joining room ${roomId}...`);
    try {
        await connectLiveKit(roomId);
        setRoomInvitationControls(roomId);
    } catch (error) {
        console.error("LiveKit connection error:", error);
        appendChatMessage("System", error.message);
        leaveRoom();
        updateStatus("Could not join video room");
    }
}

function leaveRoom() {
    clearTimeout(signPhraseTimer);
    pendingSignWords = [];
    liveKitRoom?.disconnect();
    liveKitRoom = null;
    finishHistorySession();
    clearRemoteVideo();
    remoteLoading.style.display = "none";
    activeRoomId = null;
    setRoomInvitationControls();
    joinCallButton.disabled = false;
    roomIdInput.disabled = false;
    endCallButton.disabled = true;
    setChatAvailability(false);
    appendChatMessage("System", "Left the room.");
    updateStatus("System Ready");
}

function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message || !activeRoomId) return;

    appendChatMessage("You", message, true);
    recordHistoryMessage();
    sendRoomMessage({ type: "chat", message });
    chatInput.value = "";
    chatInput.focus();
}

function postSpeechToChat(transcript) {
    if (!activeRoomId) {
        appendChatMessage("System", "Join a room before sending speech to live chat.");
        return;
    }

    appendChatMessage("You (speech)", transcript, true);
    recordHistoryMessage();
    sendRoomMessage({ type: "speech", message: transcript });
}

function setVoiceButtonState(enabled) {
    toggleVoiceButton.textContent = enabled ? "Voice: ON" : "Voice: OFF";
    toggleVoiceButton.classList.toggle("active", enabled);
}

function createVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        updateStatus("Voice-to-text is not supported by this browser");
        return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.addEventListener("result", (event) => {
        let interim = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const transcript = event.results[index][0].transcript.trim();
            if (event.results[index].isFinal) {
                document.getElementById("speechCaption").textContent = transcript;
                postSpeechToChat(transcript);
            } else {
                interim += transcript;
            }
        }
        if (interim) document.getElementById("speechCaption").textContent = interim;
    });

    recognition.addEventListener("error", (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            voiceEnabled = false;
            setVoiceButtonState(false);
            updateStatus("Microphone permission is required for voice-to-text");
        }
    });

    recognition.addEventListener("end", () => {
        if (voiceEnabled) recognition.start();
    });
    return recognition;
}

function toggleVoiceToText() {
    if (voiceEnabled) {
        voiceEnabled = false;
        if (voiceRecognition) voiceRecognition.stop();
        setVoiceButtonState(false);
        updateStatus("Voice-to-text off");
        return;
    }

    voiceRecognition = voiceRecognition || createVoiceRecognition();
    if (!voiceRecognition) return;
    voiceEnabled = true;
    setVoiceButtonState(true);
    updateStatus("Listening for speech...");
    voiceRecognition.start();
}

function setSignTracking(enabled) {
    signTrackingEnabled = enabled;
    toggleSignButton.textContent = enabled ? "Sign: ON" : "Sign: OFF";
    toggleSignButton.classList.toggle("active", enabled);

    if (enabled) {
        handTrackingIndicator.classList.remove("detected");
        handTrackingIndicator.lastElementChild.textContent = "Searching for hand";
        window.CaptionSignDetection?.start();
        updateStatus("Hand tracking on");
    } else if (!signToSpeechEnabled) {
        window.CaptionSignDetection?.stop();
        handTrackingIndicator.classList.remove("detected");
        handTrackingIndicator.lastElementChild.textContent = "Hand tracking off";
        updateStatus("Hand tracking off");
    }
}

function toggleSignToSpeech() {
    signToSpeechEnabled = !signToSpeechEnabled;
    toggleSignToSpeechButton.textContent = signToSpeechEnabled
        ? "Sign-to-Text & Speech: ON"
        : "Sign-to-Text & Speech: OFF";
    toggleSignToSpeechButton.classList.toggle("active", signToSpeechEnabled);
    window.CaptionSignDetection?.setSignToSpeech(signToSpeechEnabled);

    if (signToSpeechEnabled) {
        setSignTracking(true);
        updateStatus("Sign-to-speech on");
    } else {
        updateStatus("Sign-to-speech off");
    }
}

function updateCameraButton(enabled) {
    cameraEnabled = enabled;
    toggleCamButton.classList.toggle("off", !enabled);
    toggleCamButton.textContent = enabled ? "📷" : "🚫";
    toggleCamButton.title = enabled ? "Turn camera off" : "Turn camera on";
    toggleCamButton.setAttribute("aria-label", toggleCamButton.title);
}

function toggleMicrophone() {
    const audioTracks = localStream?.getAudioTracks() || [];
    if (!audioTracks.length) {
        updateStatus("No microphone is available");
        return;
    }

    microphoneMuted = !microphoneMuted;
    audioTracks.forEach((track) => { track.enabled = !microphoneMuted; });
    toggleMicButton.classList.toggle("off", microphoneMuted);
    toggleMicButton.textContent = microphoneMuted ? "🔇" : "🎙️";
    toggleMicButton.title = microphoneMuted ? "Unmute microphone" : "Mute microphone";
    updateStatus(microphoneMuted ? "Microphone muted" : "Microphone on");
}

function toggleCameraMirror() {
    isCameraMirrored = !isCameraMirrored;
    localVideo.classList.toggle("no-mirror", !isCameraMirrored);
    document.getElementById("overlayCanvas").classList.toggle("no-mirror", !isCameraMirrored);
    switchCamButton.classList.toggle("active", isCameraMirrored);
    switchCamButton.title = isCameraMirrored ? "Turn camera mirror off" : "Turn camera mirror on";
    updateStatus(isCameraMirrored ? "Camera mirror on" : "Camera mirror off");
}

function toggleLandmarks() {
    landmarksVisible = !landmarksVisible;
    window.CaptionSignDetection?.setOverlayVisible(landmarksVisible);
    toggleLandmarksButton.classList.toggle("off", !landmarksVisible);
    toggleLandmarksButton.textContent = landmarksVisible ? "✦" : "◌";
    toggleLandmarksButton.title = landmarksVisible
        ? "Hide hand and head guides"
        : "Show hand and head guides";
}

function stopRecording() {
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

function toggleRecording() {
    if (mediaRecorder?.state === "recording") {
        stopRecording();
        return;
    }
    if (!localStream || !window.MediaRecorder) {
        updateStatus("Turn the camera on before recording");
        return;
    }

    recordingChunks = [];
    try {
        mediaRecorder = new MediaRecorder(localStream);
        mediaRecorder.addEventListener("dataavailable", (event) => {
            if (event.data.size) recordingChunks.push(event.data);
        });
        mediaRecorder.addEventListener("stop", () => {
            const recording = new Blob(recordingChunks, { type: mediaRecorder.mimeType || "video/webm" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(recording);
            link.download = `caption-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            recordSessionButton.classList.remove("recording");
            recordSessionButton.textContent = "🔴 Record";
            updateStatus("Recording saved");
        });
        mediaRecorder.start();
        recordSessionButton.classList.add("recording");
        recordSessionButton.textContent = "⏹ Stop Recording";
        updateStatus("Recording camera and microphone...");
    } catch (error) {
        console.error("Recording error:", error);
        updateStatus("Could not start recording");
    }
}

async function toggleCamera() {
    if (!cameraEnabled || !localStream) {
        await startLocalVideo();
        return;
    }

    stopCamera();
    window.CaptionSignDetection?.stop();
    handTrackingIndicator.classList.remove("detected");
    handTrackingIndicator.lastElementChild.textContent = "Camera off";
}

window.addEventListener("caption:sign-detected", (event) => {
    const sign = event.detail.sign;
    if (!signTrackingEnabled) return;
    queueSignWord(sign);
});

// If Sign was clicked while the ES-module was still downloading, start it as
// soon as MediaPipe has finished loading.
window.addEventListener("caption:sign-module-ready", () => {
    window.CaptionSignDetection.setOverlayVisible(landmarksVisible);
    if (signTrackingEnabled || signToSpeechEnabled) {
        window.CaptionSignDetection.start();
    }
});

window.addEventListener("caption:hand-presence", (event) => {
    const isPresent = event.detail.isPresent;
    handTrackingIndicator.classList.toggle("detected", isPresent);
    handTrackingIndicator.lastElementChild.textContent = isPresent
        ? "Hand detected"
        : "Searching for hand";
});

window.addEventListener("caption:hand-error", (event) => {
    handTrackingIndicator.classList.remove("detected");
    handTrackingIndicator.lastElementChild.textContent = "Hand tracker failed to load";
    console.error("MediaPipe hand tracker:", event.detail.message);
});

joinCallButton.addEventListener("click", joinRoom);
endCallButton.addEventListener("click", leaveRoom);
sendChatButton.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendChatMessage();
});
toggleVoiceButton.addEventListener("click", toggleVoiceToText);
toggleSignButton.addEventListener("click", () => setSignTracking(!signTrackingEnabled));
toggleSignToSpeechButton.addEventListener("click", toggleSignToSpeech);
toggleCamButton.addEventListener("click", toggleCamera);
toggleMicButton.addEventListener("click", toggleMicrophone);
recordSessionButton.addEventListener("click", toggleRecording);
switchCamButton.addEventListener("click", toggleCameraMirror);
toggleLandmarksButton.addEventListener("click", toggleLandmarks);
setChatAvailability(false);
pinMenuButtonToTopLeft();
setMenuButtonVisible(false);
toggleLandmarksButton.classList.add("off");
toggleLandmarksButton.textContent = "◌";
toggleLandmarksButton.title = "Show hand and head guides";

applyTheme(localStorage.getItem("caption-theme") || "light");
const invitedRoom = normalizeRoomId(new URLSearchParams(window.location.search).get("room") || "");
if (invitedRoom) {
    roomIdInput.value = invitedRoom;
    updateStatus(`Invitation ready for room ${invitedRoom}`);
}

openMenuButton?.addEventListener("click", () => {
    sideMenu?.classList.add("active");
    if (menuOverlay) menuOverlay.style.display = "block";
    setMenuButtonVisible(false);
});
closeMenuButton?.addEventListener("click", closeMenu);
menuOverlay?.addEventListener("click", closeMenu);
themeToggleButton?.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
});
viewHistoryButton?.addEventListener("click", () => {
    renderHistory();
    openOverlay(historyOverlay);
});
showAboutButton?.addEventListener("click", () => openOverlay(aboutOverlay));
showHelpButton?.addEventListener("click", () => openOverlay(helpOverlay));
closeHistoryButton?.addEventListener("click", () => { historyOverlay.style.display = "none"; });
closeAboutButton?.addEventListener("click", () => { aboutOverlay.style.display = "none"; });
closeHelpButton?.addEventListener("click", () => { helpOverlay.style.display = "none"; });
contactSupportButton?.addEventListener("click", () => openOverlay(contactOverlay));
closeContactButton?.addEventListener("click", () => { contactOverlay.style.display = "none"; });
copyIdButton?.addEventListener("click", async () => {
    if (!activeRoomId) return;
    try {
        await navigator.clipboard.writeText(invitationUrl(activeRoomId));
        updateStatus("Room invitation link copied");
    } catch {
        updateStatus("Could not copy the invitation link");
    }
});
shareLinkButton?.addEventListener("click", async () => {
    if (!activeRoomId) return;
    const url = invitationUrl(activeRoomId);
    if (navigator.share) {
        try {
            await navigator.share({ title: "Join my CAPTION call", text: `Join my CAPTION room: ${activeRoomId}`, url });
            return;
        } catch (error) {
            if (error.name === "AbortError") return;
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        updateStatus("Room invitation link copied");
    } catch {
        updateStatus("Could not share the invitation link");
    }
});

if (downloadAppBtn) {
    if (!isInstalledApp()) showInstallButton();
    downloadAppBtn.addEventListener("click", async () => {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const choice = await deferredInstallPrompt.userChoice;
            if (choice.outcome === "accepted") downloadAppBtn.style.display = "none";
            deferredInstallPrompt = null;
            return;
        }

        // iPhone/iPad Safari does not expose beforeinstallprompt. It still
        // supports installation from the Share menu on the HTTPS GitHub page.
        const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
        alert(isAppleMobile
            ? "To install CAPTION, tap Share, then choose Add to Home Screen."
            : "Install is not available yet. Open the GitHub Pages HTTPS link in Chrome or Edge, then use the browser menu's Install app option.");
    });
}

// ===============================
// START BUTTON
// ===============================
if (startAppBtn) {
    startAppBtn.addEventListener("click", async () => {

        // Hide splash screen
        if (splashScreen) {
            splashScreen.classList.add("fade-out");
        }

        appStarted = true;
        setMenuButtonVisible(true);

        // Start camera
        await startLocalVideo();
    });
}

// ===============================
// CAMERA
// ===============================
async function startLocalVideo() {
    try {

        // Check browser support
        if (
            !navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia
        ) {
            throw new Error(
                "Camera access is not available. Make sure you are using Live Server or HTTPS."
            );
        }

        updateStatus("Opening Camera...");

        // CAMERA ONLY FOR TESTING
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user"
            },
            audio: true
        });

        console.log("Camera stream:", localStream);
        updateCameraButton(true);
        microphoneMuted = false;
        toggleMicButton.classList.remove("off");
        toggleMicButton.textContent = "🎙️";
        toggleMicButton.title = "Mute microphone";

        // Put camera stream into video
        if (localVideo) {
            localVideo.srcObject = localStream;

            localVideo.onloadedmetadata = async () => {
                try {
                    await localVideo.play();

                    updateStatus("Camera On");
                    window.dispatchEvent(new CustomEvent("caption:camera-ready"));
                    publishNewCameraTracks().catch((publishError) => {
                        console.error("Could not publish restarted camera tracks:", publishError);
                    });
                    if (signTrackingEnabled || signToSpeechEnabled) {
                        window.CaptionSignDetection?.start();
                    }
                    console.log("Camera started successfully.");

                } catch (error) {
                    console.error("Video playback error:", error);
                    updateStatus("Video Playback Error");
                }
            };
        }

    } catch (error) {

        console.error("CAMERA ERROR:", error);

        updateStatus("Camera Error");

        alert(
            "CAMERA ERROR\n\n" +
            "Name: " + error.name + "\n\n" +
            "Message: " + error.message
        );
    }
}

// ===============================
// STOP CAMERA
// ===============================
function stopCamera() {
    if (localStream) {

        stopRecording();

        localStream.getTracks().forEach(track => {
            track.stop();
        });

        localStream = null;

        if (localVideo) {
            localVideo.srcObject = null;
        }

        updateCameraButton(false);
        updateStatus("Camera Off");
    }
}

// ===============================
// PAGE CLOSE
// ===============================
window.addEventListener("beforeunload", () => {
    stopCamera();
});
