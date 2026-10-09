// Browser-side hand tracking and a small, static ASL-handshape baseline.
// This is deliberately not described as a full ASL translator: dynamic signs
// require a trained temporal model, which is not yet part of this project.

(() => {

const localVideo = document.getElementById("localVideo");
const overlayCanvas = document.getElementById("overlayCanvas");
const signCaption = document.getElementById("signCaption");
const status = document.getElementById("status");
const context = overlayCanvas.getContext("2d");
const signInstruction = "---";

const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
];

let hands;
let pose;
let isRunning = false;
let lastVideoTime = -1;
let isProcessingFrame = false;
let isProcessingPose = false;
let lastPoseTime = 0;
let bodyLandmarks = null;
let signToSpeechEnabled = false;
let lastSpokenSign = null;
let lastPublishedSign = null;
let hiMotion = [];
let lastHiDetectionAt = 0;
let helloMotion = [];
let helloSaluteHeldSince = 0;
let helpMotion = [];
let myHoldStartedAt = 0;
let nameHoldStartedAt = 0;
let lastDetectedSignAt = 0;
let handIsPresent = false;
let overlaysVisible = true;

function getBodyReference() {
    if (!bodyLandmarks?.length) return null;
    const nose = bodyLandmarks[0];
    const leftEar = bodyLandmarks[7];
    const rightEar = bodyLandmarks[8];
    const leftShoulder = bodyLandmarks[11];
    const rightShoulder = bodyLandmarks[12];
    if (!leftShoulder || !rightShoulder) return null;
    const shoulderWidth = distance(leftShoulder, rightShoulder);
    if (shoulderWidth < 0.04) return null;
    const headWidth = leftEar && rightEar && distance(leftEar, rightEar) > 0.02
        ? distance(leftEar, rightEar)
        : shoulderWidth * 0.42;
    return {
        nose,
        shoulderCenter: {
            x: (leftShoulder.x + rightShoulder.x) / 2,
            y: (leftShoulder.y + rightShoulder.y) / 2
        },
        shoulderWidth,
        headWidth,
        shoulderY: (leftShoulder.y + rightShoulder.y) / 2
    };
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function extendedFinger(landmarks, tipIndex, pipIndex) {
    // With the camera upright, an extended finger's tip is above its PIP joint.
    return landmarks[tipIndex].y < landmarks[pipIndex].y - 0.015;
}

function isOpenPalm(landmarks) {
    const wrist = landmarks[0];
    const fingerIsOut = (tip, pip) => (
        extendedFinger(landmarks, tip, pip) ||
        distance(landmarks[tip], wrist) > distance(landmarks[pip], wrist) * 1.12
    );

    // Use both vertical and radial checks so an open hand is still recognized
    // when it is tilted during a wave.
    return (
        fingerIsOut(8, 6) &&
        fingerIsOut(12, 10) &&
        fingerIsOut(16, 14) &&
        fingerIsOut(20, 18)
    );
}

function isHHand(landmarks) {
    const wrist = landmarks[0];
    const indexVector = {
        x: landmarks[8].x - landmarks[6].x,
        y: landmarks[8].y - landmarks[6].y
    };
    const middleVector = {
        x: landmarks[12].x - landmarks[10].x,
        y: landmarks[12].y - landmarks[10].y
    };
    // NAME uses a horizontal H: index and middle fingers extend sideways,
    // rather than pointing upward like a vertical peace sign.
    const index = distance(landmarks[8], wrist) > distance(landmarks[6], wrist) * 1.12 &&
        Math.abs(indexVector.x) > Math.abs(indexVector.y) * 0.70;
    const middle = distance(landmarks[12], wrist) > distance(landmarks[10], wrist) * 1.12 &&
        Math.abs(middleVector.x) > Math.abs(middleVector.y) * 0.70;
    const ringFolded = distance(landmarks[16], wrist) < distance(landmarks[14], wrist) * 1.08;
    const pinkyFolded = distance(landmarks[20], wrist) < distance(landmarks[18], wrist) * 1.08;
    return index && middle && ringFolded && pinkyFolded;
}

function isThumbUpFist(landmarks) {
    const wrist = landmarks[0];
    const thumbUp = landmarks[4].y < landmarks[3].y - 0.035;
    const fingersFolded = [
        [8, 6], [12, 10], [16, 14], [20, 18]
    ].every(([tip, pip]) => distance(landmarks[tip], wrist) < distance(landmarks[pip], wrist) * 1.15);
    return thumbUp && fingersFolded;
}

function palmLength(landmarks) {
    return Math.max(distance(landmarks[0], landmarks[9]), 0.001);
}

function isIsStartHandshape(landmarks) {
    // First picture only: a distinctly raised, upright index with the middle,
    // ring, and pinky all folded. This intentionally does not accept a loose
    // pointing shape or a partially open hand.
    const scale = palmLength(landmarks);
    const indexRise = (landmarks[6].y - landmarks[8].y) / scale;
    const wrist = landmarks[0];
    const indexExtended =
        indexRise > 0.58 &&
        distance(landmarks[8], wrist) > distance(landmarks[6], wrist) * 1.30;
    const otherFingersFolded = [[12, 10], [16, 14], [20, 18]].every(([tip, pip]) =>
        distance(landmarks[tip], wrist) <= distance(landmarks[pip], wrist) * 1.20
    );
    return indexExtended && otherFingersFolded;
}

function handCenter(landmarks) {
    return landmarks.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
}

function normalizedCenter(landmarks) {
    const total = handCenter(landmarks);
    return { x: total.x / landmarks.length, y: total.y / landmarks.length };
}

function isOutsideHeadTracker(landmarks) {
    const body = getBodyReference();
    if (!body?.nose) return false;
    const palm = normalizedCenter(landmarks);
    const headDistance = distance(palm, body.nose);
    // HI belongs outside the compact face/forehead ring used by HELLO, but
    // remains in the upper face area rather than becoming a distant wave.
    return headDistance >= body.headWidth * 1.35 &&
        headDistance <= body.headWidth * 3.2 &&
        palm.y <= body.shoulderY;
}

function isAtForehead(landmarks) {
    const body = getBodyReference();
    if (!body?.nose) return false;
    // A salute's wrist is naturally far from the face. Use the palm/finger
    // base, which is what actually sits at the forehead in the demonstration.
    const foreheadPoint = {
        x: (landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 4,
        y: (landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 4
    };
    return distance(foreheadPoint, body.nose) < body.headWidth * 1.35 &&
        foreheadPoint.y <= body.nose.y + body.headWidth * 0.55;
}

function isSaluteHand(landmarks) {
    if (!isOpenPalm(landmarks)) return false;
    const tips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
    const tipX = tips.map((point) => point.x);
    const tipY = tips.map((point) => point.y);
    const horizontalSpread = Math.max(...tipX) - Math.min(...tipX);
    const verticalSpread = Math.max(...tipY) - Math.min(...tipY);
    // A flat B-hand salute has the fingertips aligned across the forehead.
    return horizontalSpread > 0.09 && verticalSpread < 0.15;
}

function isHelloSaluteShape(landmarks) {
    // A HELLO salute can have slightly bent/angled fingers, so do not demand
    // a perfectly flat open palm. Require several fingers to reach outward
    // from the palm, which rejects a fist held beside the face.
    const wrist = landmarks[0];
    const extendedCount = [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([tip, pip]) =>
        distance(landmarks[tip], wrist) > distance(landmarks[pip], wrist) * 1.07
    ).length;
    return extendedCount >= 2;
}

function isUprightOpenPalm(landmarks) {
    if (!isOpenPalm(landmarks)) return false;
    const pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
    return pairs.filter(([tip, pip]) => landmarks[tip].y < landmarks[pip].y - 0.018).length >= 3;
}

function isPlausibleHand(landmarks, handedness) {
    // Reject weak, hand-like false positives. MediaPipe normally supplies a
    // handedness confidence; preserve compatibility if it is unavailable.
    const confidence = handedness?.score ?? handedness?.[0]?.score ?? 1;
    const palmWidth = distance(landmarks[5], landmarks[17]);
    const palmLength = distance(landmarks[0], landmarks[9]);
    const geometryIsHandLike = palmWidth > 0.025 && palmLength > 0.025 &&
        palmWidth / palmLength > 0.22 && palmWidth / palmLength < 3.2;
    const fingerChains = [
        [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]
    ];
    const coherentFingers = fingerChains.filter(([mcp, pip, dip, tip]) => {
        const first = distance(landmarks[mcp], landmarks[pip]);
        const second = distance(landmarks[pip], landmarks[dip]);
        const third = distance(landmarks[dip], landmarks[tip]);
        const tipRadius = distance(landmarks[tip], landmarks[0]);
        const mcpRadius = distance(landmarks[mcp], landmarks[0]);
        return first > 0.008 && second > 0.008 && third > 0.008 && tipRadius > mcpRadius * 0.72;
    }).length;
    // The raised-index IS starting pose is narrow and was being rejected
    // before landmarks reached the sign detector. Geometry/finger-chain
    // checks still protect against face-shaped false positives.
    return confidence >= 0.55 && geometryIsHandLike && coherentFingers >= 3;
}

function isIsStartCandidate(landmarks, handedness) {
    // A narrow fallback for the exact raised-index start of IS. Do not relax
    // the general three-finger-chain filter for other gestures or face-like
    // false positives.
    const confidence = handedness?.score ?? handedness?.[0]?.score ?? 0;
    const palmWidth = distance(landmarks[5], landmarks[17]);
    const handLength = distance(landmarks[0], landmarks[9]);
    const geometryIsHandLike = palmWidth > 0.025 && handLength > 0.025 &&
        palmWidth / handLength > 0.22 && palmWidth / handLength < 3.2;
    return confidence >= 0.42 && geometryIsHandLike && isIsStartHandshape(landmarks);
}

function detectHiMotion(landmarks, timestamp) {
    // HI is a short, casual side-to-side wave near the tracked head. It is
    // deliberately motion-only: an open hand held beside the face is not HI.
    const body = getBodyReference();
    if (!body || !isOpenPalm(landmarks) || !isOutsideHeadTracker(landmarks)) {
        hiMotion = [];
        return null;
    }

    const palm = normalizedCenter(landmarks);
    hiMotion.push({
        time: timestamp,
        x: palm.x,
        y: palm.y,
        headDistance: distance(palm, body.nose),
        shoulderWidth: body.shoulderWidth
    });
    hiMotion = hiMotion.filter((point) => timestamp - point.time <= 900);

    if (timestamp - lastHiDetectionAt < 1000 || hiMotion.length < 4) return null;

    const xValues = hiMotion.map((point) => point.x);
    const yValues = hiMotion.map((point) => point.y);
    const headDistances = hiMotion.map((point) => point.headDistance);
    const averageShoulderWidth = hiMotion.reduce((total, point) => total + point.shoulderWidth, 0) / hiMotion.length;
    const horizontalTravel = Math.max(...xValues) - Math.min(...xValues);
    const verticalTravel = Math.max(...yValues) - Math.min(...yValues);
    const headDistanceChange = Math.max(...headDistances) - Math.min(...headDistances);
    const movements = hiMotion.slice(1)
        .map((point, index) => point.x - hiMotion[index].x)
        .filter((change) => Math.abs(change) > 0.005);
    const hasDirectionChange = movements.some((change, index) => index > 0 && change * movements[index - 1] < 0);
    if (
        horizontalTravel >= averageShoulderWidth * 0.18 &&
        verticalTravel <= averageShoulderWidth * 0.70 &&
        headDistanceChange <= averageShoulderWidth * 0.52 &&
        hasDirectionChange
    ) {
        lastHiDetectionAt = timestamp;
        hiMotion = [];
        return "HI";
    }

    return null;
}

function detectHelloMotion(landmarks, timestamp) {
    const body = getBodyReference();
    if (!body || !isOpenPalm(landmarks)) {
        helloMotion = [];
        return null;
    }
    const palm = normalizedCenter(landmarks);
    helloMotion.push({
        time: timestamp,
        x: palm.x,
        y: palm.y,
        headDistance: distance(palm, body.nose),
        shoulderWidth: body.shoulderWidth,
        atForehead: isAtForehead(landmarks)
    });
    helloMotion = helloMotion.filter((point) => timestamp - point.time <= 900);
    if (helloMotion.length < 3) return null;

    // Find the actual forehead frame, not just the oldest frame in the
    // buffer; this keeps tracking reliable when the hand enters mid-motion.
    const first = helloMotion.find((point) => point.atForehead);
    if (!first) return null;
    const latest = helloMotion[helloMotion.length - 1];
    const elapsed = latest.time - first.time;
    const outwardDistance = latest.headDistance - first.headDistance;
    const palmTravel = Math.hypot(latest.x - first.x, latest.y - first.y);
    // HELLO starts at the forehead (salute) then moves outward, increasing
    // its distance from the head. A static salute does not produce text.
    if (
        elapsed >= 100 &&
        outwardDistance >= first.shoulderWidth * 0.24 &&
        palmTravel >= first.shoulderWidth * 0.20
    ) {
        helloMotion = [];
        hiMotion = [];
        return "HELLO";
    }
    return null;
}

function detectHello(landmarksByHand, timestamp) {
    // HELLO is strictly a one-hand sign. Two visible hands are reserved for
    // signs such as NAME and HELP, never a forehead salute.
    if (landmarksByHand.length !== 1) {
        helloMotion = [];
        helloSaluteHeldSince = 0;
        return null;
    }

    const landmarks = landmarksByHand[0];
    const atTrackedForehead = isAtForehead(landmarks);
    if (atTrackedForehead && isHelloSaluteShape(landmarks)) {
        if (!helloSaluteHeldSince) helloSaluteHeldSince = timestamp;
        // A brief hold filters one-frame false positives while allowing the
        // held salute shown in the supplied recording to say HELLO.
        if (timestamp - helloSaluteHeldSince >= 120) {
            helloMotion = [];
            return "HELLO";
        }
    } else {
        helloSaluteHeldSince = 0;
    }

    return detectHelloMotion(landmarks, timestamp);
}

function detectMy(landmarksByHand, timestamp) {
    // MY is a one-hand chest sign. Do not let a distant hand or a two-hand
    // configuration (such as NAME/HELP) fall through and become MY.
    if (landmarksByHand.length !== 1) {
        myHoldStartedAt = 0;
        return null;
    }

    const landmarks = landmarksByHand[0];
    const body = getBodyReference();
    if (!body) return null;
    const center = normalizedCenter(landmarks);
    // Camera-only landmarks cannot sense physical contact. Approximate MY by
    // a flat/open hand held still across the broad chest area.
    const horizontalPadding = body.shoulderWidth * 0.22;
    const palmWidth = distance(landmarks[5], landmarks[17]);
    const handIsCloseEnough = palmWidth >= body.shoulderWidth * 0.20;
    const inChestZone = handIsCloseEnough && isOpenPalm(landmarks) &&
        center.x >= Math.min(body.shoulderCenter.x - body.shoulderWidth / 2 - horizontalPadding, 0) &&
        center.x <= Math.max(body.shoulderCenter.x + body.shoulderWidth / 2 + horizontalPadding, 1) &&
        center.y >= body.shoulderY + body.shoulderWidth * 0.05 &&
        center.y <= body.shoulderY + body.shoulderWidth * 1.45;
    if (!inChestZone) {
        myHoldStartedAt = 0;
        return null;
    }
    if (!myHoldStartedAt) myHoldStartedAt = timestamp;
    return timestamp - myHoldStartedAt >= 300 ? "MY" : null;
}

function detectName(landmarksByHand) {
    if (landmarksByHand.length < 2 || !isHHand(landmarksByHand[0]) || !isHHand(landmarksByHand[1])) {
        nameHoldStartedAt = 0;
        return null;
    }
    const first = normalizedCenter(landmarksByHand[0]);
    const second = normalizedCenter(landmarksByHand[1]);
    // The two horizontal H-hands meet in neutral chest space for the tap.
    if (distance(first, second) >= 0.34 || Math.abs(first.y - second.y) >= 0.22) {
        nameHoldStartedAt = 0;
        return null;
    }
    if (!nameHoldStartedAt) nameHoldStartedAt = performance.now();
    return performance.now() - nameHoldStartedAt >= 220 ? "NAME" : null;
}

function detectHelp(landmarksByHand, timestamp) {
    if (landmarksByHand.length < 2) {
        helpMotion = [];
        return null;
    }
    const fist = landmarksByHand.find(isThumbUpFist);
    const palm = landmarksByHand.find(isOpenPalm);
    if (!fist || !palm) {
        helpMotion = [];
        return null;
    }
    const fistCenter = normalizedCenter(fist);
    const palmCenter = normalizedCenter(palm);
    // HELP has the thumb-up fist directly above an open supporting palm.
    if (distance(fistCenter, palmCenter) > 0.36 || fistCenter.y > palmCenter.y + 0.03) {
        helpMotion = [];
        return null;
    }

    // This is the landmark configuration from the user's HELP demonstration:
    // a thumb-up fist directly above an open supporting palm. Recognize it as
    // soon as the two real hands form the configuration; cooldown handles spam.
    return "HELP";
}

function detectIs(landmarksByHand) {
    // IS is the exact raised-index handshape in the supplied image. Text is
    // not sent immediately: script.js buffers every recognized sign for two
    // seconds, preventing repeat output while the hand remains in view.
    return landmarksByHand.length === 1 && isIsStartHandshape(landmarksByHand[0])
        ? "IS"
        : null;
}

function detectSign(landmarksByHand, timestamp) {
    if (!landmarksByHand.length || timestamp - lastDetectedSignAt < 1000) return null;
    const singleHand = landmarksByHand.length === 1;
    const sign = detectHelp(landmarksByHand, timestamp) ||
        detectName(landmarksByHand) ||
        detectIs(landmarksByHand, timestamp) ||
        detectHello(landmarksByHand, timestamp) ||
        (singleHand && detectHiMotion(landmarksByHand[0], timestamp)) ||
        detectMy(landmarksByHand, timestamp);
    if (sign) lastDetectedSignAt = timestamp;
    return sign;
}

function speakSign(sign) {
    if (!signToSpeechEnabled || sign === lastSpokenSign || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(sign));
    lastSpokenSign = sign;
}

function drawHands(landmarksByHand) {
    const width = localVideo.videoWidth;
    const height = localVideo.videoHeight;
    if (!width || !height) return;

    if (overlayCanvas.width !== width || overlayCanvas.height !== height) {
        overlayCanvas.width = width;
        overlayCanvas.height = height;
    }

    context.clearRect(0, 0, width, height);
    if (!overlaysVisible) return;
    context.lineWidth = Math.max(2, width / 320);
    context.strokeStyle = "#38bdf8";
    context.fillStyle = "#ffffff";

    const body = getBodyReference();
    if (body) {
        // Pose's nose landmark is the face/head reference used by the HI and
        // HELLO classifiers. Draw it so the user can verify it is tracked.
        context.save();
        context.fillStyle = "#d946ef";
        context.beginPath();
        context.arc(body.nose.x * width, body.nose.y * height, Math.max(4, width / 140), 0, Math.PI * 2);
        context.fill();
        // This compact ring shows the face-scale range used for HI/HELLO,
        // based on ear-to-ear distance rather than the much wider shoulders.
        context.strokeStyle = "rgba(217, 70, 239, 0.72)";
        context.lineWidth = Math.max(1.5, width / 520);
        context.setLineDash([5, 4]);
        context.beginPath();
        context.arc(body.nose.x * width, body.nose.y * height, body.headWidth * 1.35 * width, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
        context.font = `${Math.max(11, width / 52)}px sans-serif`;
        context.fillText("Head", body.nose.x * width + 8, body.nose.y * height - 8);
        context.restore();

        const left = Math.max(0, body.shoulderCenter.x - body.shoulderWidth * 0.72) * width;
        const right = Math.min(1, body.shoulderCenter.x + body.shoulderWidth * 0.72) * width;
        const top = Math.min(1, body.shoulderY + body.shoulderWidth * 0.05) * height;
        const bottom = Math.min(1, body.shoulderY + body.shoulderWidth * 1.45) * height;
        context.save();
        context.setLineDash([7, 6]);
        context.lineWidth = Math.max(2, width / 480);
        context.strokeStyle = "#f1c40f";
        context.strokeRect(left, top, right - left, bottom - top);
        context.fillStyle = "#f1c40f";
        context.font = `${Math.max(12, width / 42)}px sans-serif`;
        context.fillText("MY chest zone", left + 5, top + 18);
        context.restore();
        context.fillStyle = "#ffffff";
    }

    for (const landmarks of landmarksByHand) {
        for (const [from, to] of HAND_CONNECTIONS) {
            context.beginPath();
            context.moveTo(landmarks[from].x * width, landmarks[from].y * height);
            context.lineTo(landmarks[to].x * width, landmarks[to].y * height);
            context.stroke();
        }
        for (const point of landmarks) {
            context.beginPath();
            context.arc(point.x * width, point.y * height, Math.max(3, width / 180), 0, Math.PI * 2);
            context.fill();
        }
    }
}

function publishHandPresence(isPresent) {
    if (isPresent === handIsPresent) return;
    handIsPresent = isPresent;
    window.dispatchEvent(new CustomEvent("caption:hand-presence", {
        detail: { isPresent }
    }));
}

function handleHandResults(results) {
    const sourceLandmarks = results.multiHandLandmarks || [];
    const sourceHandedness = results.multiHandedness || [];
    const landmarksByHand = sourceLandmarks.filter((landmarks, index) =>
        isPlausibleHand(landmarks, sourceHandedness[index]) ||
        isIsStartCandidate(landmarks, sourceHandedness[index])
    );
    const timestamp = performance.now();
    publishHandPresence(landmarksByHand.length > 0);
    drawHands(landmarksByHand);

    const stable = detectSign(landmarksByHand, timestamp);

    if (stable) {
        signCaption.textContent = stable;
        if (stable !== lastPublishedSign) {
            lastPublishedSign = stable;
            window.dispatchEvent(new CustomEvent("caption:sign-detected", {
                detail: { sign: stable }
            }));
        }

    } else if (!landmarksByHand.length) {
        signCaption.textContent = signInstruction;
        lastSpokenSign = null;
        lastPublishedSign = null;
    } else {
        // Keep the panel quiet while recognition is in progress. It should
        // show either the instruction or the one sign actually detected.
        lastSpokenSign = null;
    }
}

function handlePoseResults(results) {
    bodyLandmarks = results.poseLandmarks || null;
}

function predictFrame() {
    if (!isRunning) return;

    if (
        !isProcessingFrame &&
        localVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        localVideo.currentTime !== lastVideoTime
    ) {
        lastVideoTime = localVideo.currentTime;
        isProcessingFrame = true;
        hands.send({ image: localVideo })
            .catch((error) => {
                console.error("MediaPipe Hands frame error:", error);
                window.dispatchEvent(new CustomEvent("caption:hand-error", {
                    detail: { message: error.message || "MediaPipe could not process the camera frame" }
                }));
            })
            .finally(() => { isProcessingFrame = false; });

        // Body pose is intentionally throttled so hand landmarks keep up with
        // fast signing while still giving MY/HI/HELLO reliable body context.
        if (!isProcessingPose && performance.now() - lastPoseTime > 120) {
            lastPoseTime = performance.now();
            isProcessingPose = true;
            pose.send({ image: localVideo })
                .catch((error) => console.warn("MediaPipe Pose frame error:", error))
                .finally(() => { isProcessingPose = false; });
        }
    }

    requestAnimationFrame(predictFrame);
}

async function startHandTracking() {
    if (isRunning) return;

    try {
        status.textContent = "Loading hand tracking...";
        if (!window.Hands) throw new Error("MediaPipe Hands library did not load");
        if (!window.Pose) throw new Error("MediaPipe Pose library did not load");
        if (!hands) {
            hands = new window.Hands({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
            });
            hands.setOptions({
                maxNumHands: 2,
                // Stronger model/confidence rejects face-shaped false
                // positives while remaining practical on a laptop webcam.
                modelComplexity: 1,
                minDetectionConfidence: 0.45,
                minTrackingConfidence: 0.45
            });
            hands.onResults(handleHandResults);
        }
        if (!pose) {
            pose = new window.Pose({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
            });
            pose.setOptions({
                modelComplexity: 0,
                smoothLandmarks: true,
                enableSegmentation: false,
                minDetectionConfidence: 0.45,
                minTrackingConfidence: 0.45
            });
            pose.onResults(handlePoseResults);
        }
        isRunning = true;
        lastVideoTime = -1;
        status.textContent = "Hand tracking ready";
        predictFrame();
    } catch (error) {
        console.error("Hand tracking failed to load:", error);
        status.textContent = "Hand tracking unavailable";
        signCaption.textContent = "Could not load hand tracking";
        window.dispatchEvent(new CustomEvent("caption:hand-error", {
            detail: { message: error.message || "MediaPipe model could not load" }
        }));
    }
}

function stopHandTracking() {
    isRunning = false;
    lastVideoTime = -1;
    publishHandPresence(false);
    context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    signCaption.textContent = signInstruction;
}

function setSignToSpeech(enabled) {
    signToSpeechEnabled = enabled;
    if (!enabled && window.speechSynthesis) window.speechSynthesis.cancel();
    if (enabled) startHandTracking();
}

function setOverlayVisible(visible) {
    overlaysVisible = visible;
    if (!visible) context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

window.CaptionSignDetection = {
    start: startHandTracking,
    stop: stopHandTracking,
    setSignToSpeech,
    setOverlayVisible
};
window.dispatchEvent(new CustomEvent("caption:sign-module-ready"));

})();
