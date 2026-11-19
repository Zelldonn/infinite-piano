/***********************************************************************
 * 6. INFINITE PLAYBACK LOOP, AUDIO SCHEDULER & MIDI WAIT ENGINE
 ***********************************************************************/

// Compute effective sounding duration including any tied continuation (intra-bar or across barline)
function getEffectiveTiedDurationBeats(events, evIdx, measure, isTreble) {
    const ev = events[evIdx];
    let totalBeats = ev.durationBeats;
    if (!ev.tieToNext) return totalBeats;

    const nextSameBar = events[evIdx + 1];
    if (nextSameBar && nextSameBar.isTiedFromPrev) {
        return totalBeats + nextSameBar.durationBeats;
    }
    const nextMeas = getMeasureByIndex(measure.index + 1);
    const nextList = nextMeas ? (isTreble ? nextMeas.rhEvents : nextMeas.lhEvents) : null;
    if (nextList && nextList.length > 0 && nextList[0].isTiedFromPrev) {
        return totalBeats + nextList[0].durationBeats;
    }
    return totalBeats;
}

// 8-bar period expressive dynamic contour (gentle opening -> bar 6 climax -> warm bar 8 cadence)
const PHRASE_DYNAMIC_CURVE = [0.88, 0.93, 0.97, 0.91, 1.00, 1.08, 0.96, 0.84];
const MACRO_SECTION_DYNAMIC_MULT = { 'A': 0.95, "A'": 1.01, 'B': 1.07, "A''": 0.92 };

// Compute LH & RH gain multipliers from AppState.handBalance (-1 = LH solo, 0 = balanced, +1 = RH solo)
function getHandBalanceGains() {
    const bal = Math.max(-1, Math.min(1, Number(AppState.handBalance) || 0));
    const lhScale = bal > 0 ? Math.max(0, 1 - bal) : 1;
    const rhScale = bal < 0 ? Math.max(0, 1 + bal) : 1;
    return { lhScale, rhScale };
}

// Compute gentle phrase-end cadence rubato (subtle ritardando on bar 4 half-cadence and bar 8 resolution)
function getEffectiveTempoForSubBeat(measure, subBeat) {
    const baseTempo = AppState.tempo;
    if (!measure || typeof measure.barInPeriod !== 'number') return baseTempo;
    const dna = getThemeDNA(measure.preset || AppState.activePreset);
    const strength = dna.rubatoStrength || 1.0;
    let factor = 1.0;
    if (measure.barInPeriod === 7) {
        const progress = Math.min(1, Math.max(0, subBeat / Math.max(1, measure.beatsPerMeasure)));
        factor = 1.0 - (0.06 + 0.08 * progress) * strength;
    } else if (measure.barInPeriod === 3 && subBeat >= measure.beatsPerMeasure - 1.5) {
        factor = 1.0 - 0.05 * strength;
    }
    return Math.max(36, baseTempo * factor);
}

// Compute expressive velocity for a given bar, 32-bar macro section, beat position, and hand
function computeExpressiveVelocity(baseVel, measure, subBeat, handScale) {
    const barIdx = typeof measure.barInPeriod === 'number' ? (measure.barInPeriod % 8) : 0;
    const phraseMult = PHRASE_DYNAMIC_CURVE[barIdx] || 1.0;
    const macroMult = (measure.macroSection && MACRO_SECTION_DYNAMIC_MULT[measure.macroSection]) || 1.0;
    const isDownbeat = Math.abs(subBeat) < 0.01;
    const isOffbeatEighth = Math.abs(subBeat - Math.round(subBeat)) > 0.1;
    const metricOffset = isDownbeat ? 0.04 : (isOffbeatEighth ? -0.04 : 0);
    const humanize = (Math.random() - 0.5) * 0.03;
    return Math.max(0.10, Math.min(1.0, (baseVel * phraseMult * macroMult + metricOffset + humanize) * handScale));
}

// Trigger all notes scheduled at a specific sub-beat (0.5 beat resolution) with exact AudioContext startTime & soft chord roll
function triggerMeasureBeatAudio(measure, subBeat, playSound = true, startTime = null) {
    const effTempo = getEffectiveTempoForSubBeat(measure, subBeat);
    const beatDurationSec = 60 / effTempo;
    const { lhScale, rhScale } = getHandBalanceGains();
    const dna = getThemeDNA(measure.preset || AppState.activePreset);
    const rollStepSec = dna.chordRollSec || 0.016;

    // Optional soft wooden metronome (compound duple 0 & 1.5 in 6/8; integer beats in 3/4, 4/4, 5/4)
    const isMetronomePulse = measure.timeSig === '6/8'
        ? (Math.abs(subBeat) < 0.01 || Math.abs(subBeat - 1.5) < 0.01)
        : (Math.abs(subBeat - Math.round(subBeat)) < 0.01);
    if (playSound && AppState.metronomeEnabled && isMetronomePulse) {
        audioEngine.playMetronomeClick(subBeat < 0.01, startTime);
    }

    // Resolve base AudioContext timestamp so multi-note chords can gently roll upward from bass to top
    if (playSound && !audioEngine.isInitialized) {
        audioEngine.init();
    }
    const baseTime = (startTime !== null && typeof startTime === 'number')
        ? startTime
        : (audioEngine.ctx ? audioEngine.ctx.currentTime : null);

    // Trigger Left Hand events starting at this subBeat (skipping tied continuations & muted hand)
    if (lhScale > 0.01) {
        for (let idx = 0; idx < measure.lhEvents.length; idx++) {
            const ev = measure.lhEvents[idx];
            if (!ev.isRest && !ev.isTiedFromPrev && Math.abs(ev.startBeat - subBeat) < 0.05) {
                const durSec = getEffectiveTiedDurationBeats(measure.lhEvents, idx, measure, false) * beatDurationSec;
                const lhVel = computeExpressiveVelocity(0.58, measure, subBeat, lhScale);
                const sorted = ev.notes.length > 1 ? [...ev.notes].sort((a, b) => a - b) : ev.notes;
                for (let nIdx = 0; nIdx < sorted.length; nIdx++) {
                    const noteWhen = (baseTime !== null && sorted.length > 1)
                        ? (baseTime + nIdx * rollStepSec)
                        : startTime;
                    if (playSound) audioEngine.playNote(sorted[nIdx], durSec, lhVel, noteWhen);
                }
            }
        }
    }

    // Trigger Right Hand events starting at this subBeat (skipping tied continuations, impro measures & muted hand)
    // In a Guided Improvisation measure, mute the procedural Right Hand so the user can improvise freely over the Left Hand!
    if (!measure.isImprovisation && rhScale > 0.01) {
        const rhBase = measure.isEarTraining ? 0.84 : 0.74; // Slightly emphasize melody in Ear Training measures
        for (let idx = 0; idx < measure.rhEvents.length; idx++) {
            const ev = measure.rhEvents[idx];
            if (!ev.isRest && !ev.isTiedFromPrev && Math.abs(ev.startBeat - subBeat) < 0.05) {
                const durSec = getEffectiveTiedDurationBeats(measure.rhEvents, idx, measure, true) * beatDurationSec;
                const rhVel = computeExpressiveVelocity(rhBase, measure, subBeat, rhScale);
                const sorted = ev.notes.length > 1 ? [...ev.notes].sort((a, b) => a - b) : ev.notes;
                for (let nIdx = 0; nIdx < sorted.length; nIdx++) {
                    const noteWhen = (baseTime !== null && sorted.length > 1)
                        ? (baseTime + nIdx * rollStepSec * 0.45)
                        : startTime;
                    if (playSound) audioEngine.playNote(sorted[nIdx], durSec, rhVel, noteWhen);
                }
            }
        }
    }
}

// =======================================================================
// Sample-Accurate Web Audio Lookahead Scheduler (Chris Wilson Pattern)
// Decouples audio scheduling from requestAnimationFrame jitter and locks
// visual playhead interpolation directly to AudioContext.currentTime.
// =======================================================================
const AudioLookaheadScheduler = {
    lookaheadSec: 0.12,
    intervalMs: 25,
    timerId: null,
    nextMeasureIndex: 0,
    nextSubBeat: 0,
    nextNoteTime: 0,
    anchors: [] // [{ measureIndex, subBeat, audioTime, beatsPerMeasure, tempo }]
};

function stopAudioScheduler() {
    if (AudioLookaheadScheduler.timerId !== null) {
        if (typeof clearInterval === 'function') {
            clearInterval(AudioLookaheadScheduler.timerId);
        }
        AudioLookaheadScheduler.timerId = null;
    }
    AudioLookaheadScheduler.anchors = [];
}

function startAudioScheduler() {
    audioEngine.init();
    stopAudioScheduler();
    if (!audioEngine.ctx) return;

    const meas = getMeasureByIndex(AppState.currentMeasureIndex);
    if (!meas) return;

    const now = audioEngine.ctx.currentTime;
    const floorSub = Math.floor(AppState.currentBeatFloat * 2) / 2;
    const fracIntoSub = AppState.currentBeatFloat - floorSub;

    if (fracIntoSub > 0.02) {
        // Resuming mid-sub-beat: anchor current visual position at `now` and schedule next 0.5-beat boundary cleanly
        let nextSub = floorSub + 0.5;
        let nextM = AppState.currentMeasureIndex;
        const waitBeats = nextSub - AppState.currentBeatFloat;
        if (nextSub >= meas.beatsPerMeasure - 0.01) {
            nextSub = 0;
            nextM++;
        }
        AudioLookaheadScheduler.anchors.push({
            measureIndex: AppState.currentMeasureIndex,
            subBeat: AppState.currentBeatFloat,
            audioTime: now,
            beatsPerMeasure: meas.beatsPerMeasure,
            tempo: AppState.tempo
        });
        AudioLookaheadScheduler.nextMeasureIndex = nextM;
        AudioLookaheadScheduler.nextSubBeat = nextSub;
        AudioLookaheadScheduler.nextNoteTime = now + waitBeats * (60 / AppState.tempo);
    } else {
        // Starting cleanly on a sub-beat boundary (with 25ms micro-lead for glitch-free first chord attack)
        const startSub = Math.round(AppState.currentBeatFloat * 2) / 2;
        const firstTime = now + 0.025;
        AudioLookaheadScheduler.nextMeasureIndex = AppState.currentMeasureIndex;
        AudioLookaheadScheduler.nextSubBeat = startSub >= meas.beatsPerMeasure - 0.01 ? 0 : startSub;
        AudioLookaheadScheduler.nextNoteTime = firstTime;
    }

    pumpAudioScheduler();
    if (typeof setInterval === 'function') {
        AudioLookaheadScheduler.timerId = setInterval(pumpAudioScheduler, AudioLookaheadScheduler.intervalMs);
    }
}

function resyncAudioScheduler() {
    if (AppState.isPlaying && AppState.scrollMode !== 'midi_wait' && AppState.scrollMode !== 'mic_wait') {
        startAudioScheduler();
    } else {
        stopAudioScheduler();
    }
}

function pumpAudioScheduler() {
    if (!AppState.isPlaying || AppState.scrollMode === 'midi_wait' || AppState.scrollMode === 'mic_wait') return;
    if (!audioEngine.ctx) return;

    const now = audioEngine.ctx.currentTime;
    // Recover gracefully if browser tab was backgrounded (never blast catch-up bursts)
    if (now - AudioLookaheadScheduler.nextNoteTime > 0.5) {
        AudioLookaheadScheduler.nextNoteTime = now + 0.025;
    }

    while (AudioLookaheadScheduler.nextNoteTime < now + AudioLookaheadScheduler.lookaheadSec) {
        // Keep lookahead buffer populated ahead of audio scheduling cursor
        while (AppState.measureWindowOffset + AppState.measures.length <= AudioLookaheadScheduler.nextMeasureIndex + 6) {
            AppState.measures.push(generateNextMeasure());
        }

        const meas = getMeasureByIndex(AudioLookaheadScheduler.nextMeasureIndex);
        if (!meas) break;

        const subBeat = AudioLookaheadScheduler.nextSubBeat;
        const noteTime = AudioLookaheadScheduler.nextNoteTime;
        const effTempo = getEffectiveTempoForSubBeat(meas, subBeat);

        AudioLookaheadScheduler.anchors.push({
            measureIndex: meas.index,
            subBeat,
            audioTime: noteTime,
            beatsPerMeasure: meas.beatsPerMeasure,
            tempo: effTempo
        });

        triggerMeasureBeatAudio(meas, subBeat, true, noteTime);

        const halfBeatSec = 0.5 * (60 / effTempo);
        AudioLookaheadScheduler.nextNoteTime += halfBeatSec;
        AudioLookaheadScheduler.nextSubBeat += 0.5;
        if (AudioLookaheadScheduler.nextSubBeat >= meas.beatsPerMeasure - 0.01) {
            AudioLookaheadScheduler.nextSubBeat = 0;
            AudioLookaheadScheduler.nextMeasureIndex++;
        }
    }

    // Trim stale past anchors while keeping recent history for smooth visual sync
    const anchors = AudioLookaheadScheduler.anchors;
    while (anchors.length > 32 && anchors[1].audioTime < now - 0.5) {
        anchors.shift();
    }
}

// Synchronize visual playhead smoothly with the AudioContext clock
function syncVisualPlayheadFromAudioClock() {
    if (!audioEngine.ctx) return;
    pumpAudioScheduler();

    const anchors = AudioLookaheadScheduler.anchors;
    if (anchors.length === 0) return;

    const now = audioEngine.ctx.currentTime;
    let activeAnchor = anchors[0];
    for (let i = anchors.length - 1; i >= 0; i--) {
        if (anchors[i].audioTime <= now) {
            activeAnchor = anchors[i];
            break;
        }
    }

    const elapsedSec = Math.max(0, now - activeAnchor.audioTime);
    const rawBeat = activeAnchor.subBeat + elapsedSec * (activeAnchor.tempo / 60);
    const clampedBeat = Math.max(0, Math.min(activeAnchor.beatsPerMeasure - 0.0001, rawBeat));

    const prevMeasureIdx = AppState.currentMeasureIndex;
    AppState.currentMeasureIndex = activeAnchor.measureIndex;
    AppState.currentBeatFloat = clampedBeat;

    if (AppState.currentMeasureIndex !== prevMeasureIdx) {
        ensureInfiniteBuffer();
        updateHudInfo();
        autoScrollPageModeIfNeeded();
    }

    renderScore();
}

// Gather expected pitch classes at current sub-beat for "Attente MIDI/Micro" mode
function getExpectedSubBeatNotes(measure, subBeat) {
    const expectedMidis = [];
    if (!measure.isImprovisation) {
        for (const ev of measure.rhEvents) {
            if (!ev.isRest && !ev.isTiedFromPrev && Math.abs(ev.startBeat - subBeat) < 0.05) {
                expectedMidis.push(...ev.notes);
            }
        }
    }
    for (const ev of measure.lhEvents) {
        if (!ev.isRest && !ev.isTiedFromPrev && Math.abs(ev.startBeat - subBeat) < 0.05) {
            expectedMidis.push(...ev.notes);
        }
    }
    return expectedMidis;
}

// Advance to the next rhythmic event in "Attente MIDI" mode or manual step button
function advanceOneSubBeatStep(playAudio = true) {
    const measure = getMeasureByIndex(AppState.currentMeasureIndex);
    if (!measure) return;

    const currentSub = Math.round(AppState.currentBeatFloat * 2) / 2;
    if (playAudio) {
        triggerMeasureBeatAudio(measure, currentSub, true);
    }

    let nextSub = currentSub + 0.5;
    if (nextSub >= measure.beatsPerMeasure - 0.01) {
        AppState.currentMeasureIndex++;
        AppState.currentBeatFloat = 0;
        ensureInfiniteBuffer();
        autoScrollPageModeIfNeeded();
    } else {
        AppState.currentBeatFloat = nextSub;
    }

    AppState.satisfiedSubBeatNotes.clear();

    // Skip empty eighth subdivisions where neither hand has a new note onset (prevents stalls during holds/rests)
    if (AppState.scrollMode === 'midi_wait' || AppState.scrollMode === 'mic_wait') {
        let guard = 0;
        while (guard < 16) {
            const nextMeasure = getMeasureByIndex(AppState.currentMeasureIndex);
            if (!nextMeasure) break;
            const expected = getExpectedSubBeatNotes(nextMeasure, AppState.currentBeatFloat);
            if (expected.length > 0) break;
            const nextNext = AppState.currentBeatFloat + 0.5;
            if (nextNext >= nextMeasure.beatsPerMeasure - 0.01) {
                AppState.currentMeasureIndex++;
                AppState.currentBeatFloat = 0;
                ensureInfiniteBuffer();
                autoScrollPageModeIfNeeded();
            } else {
                AppState.currentBeatFloat = nextNext;
            }
            guard++;
        }
    }

    if (AppState.isPlaying) {
        resyncAudioScheduler();
    }
    updateHudInfo();
    renderScore();
}

// Main animation loop for AudioContext-synced visual scrolling and real-time Mic Pitch Detection
function animationLoop(timestamp) {
    AppState.lastFrameTime = timestamp;

    // Poll Microphone Pitch Detector when in 'mic_wait' mode
    if (AppState.scrollMode === 'mic_wait' && micPitchDetector.isListening) {
        micPitchDetector.processFrame(timestamp);
    }

    if (AppState.isPlaying && AppState.scrollMode !== 'midi_wait' && AppState.scrollMode !== 'mic_wait') {
        if (AudioLookaheadScheduler.anchors.length === 0) {
            startAudioScheduler();
        }
        syncVisualPlayheadFromAudioClock();
    }

    requestAnimationFrame(animationLoop);
}

// Keep active row visible in Multi-System Page mode
function autoScrollPageModeIfNeeded() {
    if (AppState.viewLayout !== 'page') return;
    const container = document.getElementById('scoreViewportContainer');
    const width = container.clientWidth;
    const isCompact = container.clientHeight < 420 || width < 760;
    const measuresPerRow = width < 680 ? 2 : (width < 1100 ? 3 : 4);
    const rowHeight = isCompact ? 225 : 285;
    const localIdx = Math.max(0, AppState.currentMeasureIndex - AppState.measureWindowOffset);
    const activeRow = Math.floor(localIdx / measuresPerRow);
    const targetScrollTop = Math.max(0, activeRow * rowHeight - 20);
    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
}

/***********************************************************************
 * 7. WEB MIDI & MICROPHONE PITCH DETECTION ("ATTENTE NOTE MICRO / MIDI")
 ***********************************************************************/

// Evaluate a detected note (from either MIDI or Microphone) against the current sub-beat target
function checkWaitModeNoteMatch(midi) {
    if (AppState.scrollMode !== 'midi_wait' && AppState.scrollMode !== 'mic_wait') return false;
    const measure = getMeasureByIndex(AppState.currentMeasureIndex);
    if (!measure) return false;

    const subBeat = Math.round(AppState.currentBeatFloat * 2) / 2;
    const expectedMidis = getExpectedSubBeatNotes(measure, subBeat);

    let addedAny = false;
    // Match either exact MIDI pitch or same pitch class (octave-tolerant for comfortable practice)
    for (const exp of expectedMidis) {
        if (exp === midi || midiToPc(exp) === midiToPc(midi)) {
            if (!AppState.satisfiedSubBeatNotes.has(exp)) {
                AppState.satisfiedSubBeatNotes.add(exp);
                addedAny = true;
            }
        }
    }

    const rhExpected = [];
    if (!measure.isImprovisation) {
        for (const ev of measure.rhEvents) {
            if (!ev.isRest && !ev.isTiedFromPrev && Math.abs(ev.startBeat - subBeat) < 0.05) {
                rhExpected.push(...ev.notes);
            }
        }
    }

    // In Mic mode, acoustic polyphony can mask inner accompaniment notes, so matching ANY expected RH note
    // (or LH when RH is silent/impro) advances smoothly. In MIDI Wait mode, enforce ALL expected notes (both hands!).
    if (AppState.scrollMode === 'mic_wait') {
        const targetPool = rhExpected.length > 0 ? rhExpected : expectedMidis;
        const matched = targetPool.length > 0 && targetPool.some(m => AppState.satisfiedSubBeatNotes.has(m));
        if (matched) {
            advanceOneSubBeatStep(false);
            return true;
        }
    } else {
        const allSatisfied = expectedMidis.length > 0 && expectedMidis.every(m => AppState.satisfiedSubBeatNotes.has(m));
        if (allSatisfied) {
            advanceOneSubBeatStep(false);
            return true;
        }
    }
    if (addedAny) {
        renderScore();
    }
    return false;
}

function handleUserNoteOn(midi, velocity = 0.75) {
    AppState.activeMidiNotes.add(midi);
    audioEngine.noteOn(midi, velocity);
    checkWaitModeNoteMatch(midi);
}

function handleUserNoteOff(midi) {
    AppState.activeMidiNotes.delete(midi);
    audioEngine.noteOff(midi);
}

// Real-Time Microphone Pitch & Spectral Chroma Detector for Acoustic/Digital Pianos
class MicPitchDetector {
    constructor() {
        this.stream = null;
        this.source = null;
        this.analyser = null;
        this.timeBuf = null;
        this.freqBuf = null;
        this.isListening = false;
        this.lastDetectedMidi = null;
        this.stableCandidateMidi = null;
        this.stableFrames = 0;
        this.lastAdvanceTimestamp = 0;
        this.lastAdvancedMidi = null;
    }

    async start() {
        if (this.isListening) return true;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert("Votre navigateur ne supporte pas l'accès au microphone (vérifiez que vous êtes bien en HTTPS ou localhost).");
            return false;
        }
        try {
            audioEngine.init();
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        autoGainControl: false,
                        noiseSuppression: false
                    }
                });
            } catch (_) {
                this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            this.source = audioEngine.ctx.createMediaStreamSource(this.stream);
            this.analyser = audioEngine.ctx.createAnalyser();
            this.analyser.fftSize = 8192;
            this.analyser.smoothingTimeConstant = 0.25;
            this.source.connect(this.analyser);

            this.timeBuf = new Float32Array(this.analyser.fftSize);
            this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);
            this.isListening = true;
            this.updateMicBadge('🎙️ Écoute...');
            return true;
        } catch (err) {
            console.warn('Microphone access denied or failed:', err);
            this.updateMicBadge('🎙️ Micro refusé');
            return false;
        }
    }

    stop() {
        if (this.source) {
            try { this.source.disconnect(); } catch (_) {}
            this.source = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        this.isListening = false;
        this.lastDetectedMidi = null;
    }

    updateMicBadge(label) {
        const badge = document.getElementById('micDetectedNoteBadge');
        if (badge) {
            badge.textContent = label;
        }
    }

    // Normalized Autocorrelation (NSDF) pitch estimation from time-domain buffer
    detectMonophonicPitch(sampleRate) {
        const buf = this.timeBuf;
        const n = buf.length;

        // 1. Compute RMS energy to ignore silence / background hum
        let rms = 0;
        for (let i = 0; i < n; i++) {
            rms += buf[i] * buf[i];
        }
        rms = Math.sqrt(rms / n);
        if (rms < 0.012) return null; // Too quiet

        // Search lag range corresponding to 60 Hz (B1) .. 1100 Hz (C#6)
        const minLag = Math.floor(sampleRate / 1100);
        const maxLag = Math.min(Math.floor(sampleRate / 60), Math.floor(n / 2));
        const windowLen = Math.min(1024, n - maxLag);

        let bestLag = -1;
        let bestCorr = 0;

        // Find first strong normalized autocorrelation peak after zero-crossing
        let inPositiveRegion = false;
        let passedFirstZeroCross = false;

        for (let lag = minLag; lag <= maxLag; lag++) {
            let sumProd = 0;
            let sumSq1 = 0;
            let sumSq2 = 0;
            for (let i = 0; i < windowLen; i += 2) { // Stride 2 for fast mobile CPU performance
                const a = buf[i];
                const b = buf[i + lag];
                sumProd += a * b;
                sumSq1 += a * a;
                sumSq2 += b * b;
            }
            const denom = Math.sqrt(sumSq1 * sumSq2);
            const corr = denom > 1e-8 ? (sumProd / denom) : 0;

            if (!passedFirstZeroCross) {
                if (corr < 0) passedFirstZeroCross = true;
                continue;
            }

            if (corr > 0.62 && corr > bestCorr) {
                bestCorr = corr;
                bestLag = lag;
                inPositiveRegion = true;
            } else if (inPositiveRegion && corr < bestCorr - 0.12) {
                // Stop at the first dominant fundamental peak to avoid octave-down subharmonics
                break;
            }
        }

        if (bestLag <= 0 || bestCorr < 0.62) return null;

        // Parabolic interpolation around bestLag for sub-sample frequency precision (critical above C5)
        const corrAtLag = (lagVal) => {
            if (lagVal < minLag || lagVal > maxLag) return bestCorr - 0.1;
            let sP = 0, s1 = 0, s2 = 0;
            for (let i = 0; i < windowLen; i += 2) {
                const a = buf[i];
                const b = buf[i + lagVal];
                sP += a * b;
                s1 += a * a;
                s2 += b * b;
            }
            const d = Math.sqrt(s1 * s2);
            return d > 1e-8 ? (sP / d) : 0;
        };
        const cPrev = corrAtLag(bestLag - 1);
        const cNext = corrAtLag(bestLag + 1);
        const denom = cPrev - 2 * bestCorr + cNext;
        const lagShift = Math.abs(denom) > 1e-6 ? Math.max(-0.5, Math.min(0.5, 0.5 * (cPrev - cNext) / denom)) : 0;

        const freq = sampleRate / (bestLag + lagShift);
        const midi = Math.round(69 + 12 * Math.log2(freq / 440));
        if (midi < 33 || midi > 96) return null;
        return midi;
    }

    // Check if any expected target MIDI pitch has a prominent fundamental + 2nd harmonic peak in FFT
    // (Helps when playing two-handed chords where monophonic autocorrelation might lock onto the bass)
    detectExpectedNoteInSpectrum(sampleRate, expectedMidis) {
        if (!expectedMidis || expectedMidis.length === 0) return null;
        this.analyser.getFloatFrequencyData(this.freqBuf);
        const binHz = sampleRate / this.analyser.fftSize;

        // Compute average noise floor in piano mid-range (100Hz - 1000Hz)
        let sumDb = 0;
        let countBins = 0;
        const startBin = Math.max(2, Math.floor(100 / binHz));
        const endBin = Math.min(this.freqBuf.length - 1, Math.ceil(1000 / binHz));
        for (let b = startBin; b <= endBin; b++) {
            sumDb += this.freqBuf[b];
            countBins++;
        }
        const avgDb = countBins > 0 ? (sumDb / countBins) : -90;
        if (avgDb < -78) return null;

        let bestMidi = null;
        let bestScore = -999;

        for (const midi of expectedMidis) {
            const f0 = 440 * Math.pow(2, (midi - 69) / 12);
            const bin1 = Math.round(f0 / binHz);
            const bin2 = Math.round((f0 * 2) / binHz);
            if (bin1 <= 2 || bin2 >= this.freqBuf.length - 2) continue;

            // Locate local peak bin around fundamental and refine with parabolic interpolation
            let pBin = bin1;
            if (this.freqBuf[bin1 - 1] > this.freqBuf[pBin]) pBin = bin1 - 1;
            if (this.freqBuf[bin1 + 1] > this.freqBuf[pBin]) pBin = bin1 + 1;
            const yL = this.freqBuf[pBin - 1];
            const yC = this.freqBuf[pBin];
            const yR = this.freqBuf[pBin + 1];
            const pDenom = yL - 2 * yC + yR;
            const binShift = Math.abs(pDenom) > 1e-6 ? Math.max(-0.5, Math.min(0.5, 0.5 * (yL - yR) / pDenom)) : 0;
            const estFreq = (pBin + binShift) * binHz;

            // Reject adjacent semitone peaks outside ±0.6 semitones
            const semitoneErr = Math.abs(12 * Math.log2(estFreq / f0));
            if (semitoneErr > 0.60) continue;

            const peak1 = yC;
            const peak2 = Math.max(this.freqBuf[bin2 - 1], this.freqBuf[bin2], this.freqBuf[bin2 + 1]);
            const score = peak1 * 0.7 + peak2 * 0.3 - semitoneErr * 4;

            // Require the harmonic peak to stand well above the ambient noise floor
            if (peak1 > -54 && (peak1 - avgDb) > 15 && score > bestScore) {
                bestScore = score;
                bestMidi = midi;
            }
        }
        return bestMidi;
    }

    processFrame(timestamp) {
        if (!this.isListening || !this.analyser || !audioEngine.ctx) return;

        // Mute mic triggering briefly after the app's own speaker synth plays (prevents audition self-triggering)
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : timestamp;
        if (audioEngine.lastSynthPlayTimestamp > 0 && (nowMs - audioEngine.lastSynthPlayTimestamp) < 420) {
            this.stableFrames = 0;
            this.stableCandidateMidi = null;
            return;
        }

        this.analyser.getFloatTimeDomainData(this.timeBuf);
        const sampleRate = audioEngine.ctx.sampleRate;

        const measure = getMeasureByIndex(AppState.currentMeasureIndex);
        const subBeat = Math.round(AppState.currentBeatFloat * 2) / 2;
        const expectedMidis = measure ? getExpectedSubBeatNotes(measure, subBeat) : [];

        // 1. Primary monophonic autocorrelation detection
        let detectedMidi = this.detectMonophonicPitch(sampleRate);

        // 2. If playing a chord and monophonic pitch didn't match, check spectral peaks for expected notes
        if (detectedMidi === null || !expectedMidis.some(m => midiToPc(m) === midiToPc(detectedMidi))) {
            const specMidi = this.detectExpectedNoteInSpectrum(sampleRate, expectedMidis);
            if (specMidi !== null) {
                detectedMidi = specMidi;
            }
        }

        if (detectedMidi === null) {
            this.stableFrames = 0;
            this.stableCandidateMidi = null;
            return;
        }

        // Require 2 consecutive consistent frames (~32ms) to reject transient clicks
        if (this.stableCandidateMidi !== null && midiToPc(detectedMidi) === midiToPc(this.stableCandidateMidi)) {
            this.stableFrames++;
        } else {
            this.stableCandidateMidi = detectedMidi;
            this.stableFrames = 1;
        }

        if (this.stableFrames >= 2) {
            const sigInfo = getModalSignatureInfo(AppState.rootKey, AppState.mode);
            const noteName = formatPitchClass(midiToPc(detectedMidi), sigInfo.useFlats, 'fr', sigInfo.flats);
            const octave = Math.floor(detectedMidi / 12) - 1;
            this.updateMicBadge(`🎙️ ${noteName}${octave}`);

            // Cooldown check: if the newly entered sub-beat expects the exact same note as the previous beat,
            // wait 240ms so a single sustained piano string doesn't skip two identical notes in a row
            const elapsedSinceAdvance = timestamp - this.lastAdvanceTimestamp;
            const isSameNoteAsJustAdvanced = (
                this.lastAdvancedMidi !== null &&
                midiToPc(detectedMidi) === midiToPc(this.lastAdvancedMidi)
            );
            if (elapsedSinceAdvance < 140 || (isSameNoteAsJustAdvanced && elapsedSinceAdvance < 280)) {
                return;
            }

            const didAdvance = checkWaitModeNoteMatch(detectedMidi);
            if (didAdvance) {
                this.lastAdvanceTimestamp = timestamp;
                this.lastAdvancedMidi = detectedMidi;
                this.stableFrames = 0;
            }
        }
    }
}

const micPitchDetector = new MicPitchDetector();

// Initialize Web MIDI API if supported by browser
function initWebMIDI() {
    const dot = document.getElementById('midiStatusDot');
    const text = document.getElementById('midiStatusText');
    if (!dot || !text) return;

    if (!navigator.requestMIDIAccess) {
        dot.className = 'w-2 h-2 rounded-full bg-studio-600';
        text.textContent = 'MIDI: Off';
        return;
    }

    navigator.requestMIDIAccess().then(midiAccess => {
        const bindInputs = () => {
            const inputs = Array.from(midiAccess.inputs.values());
            if (inputs.length > 0) {
                dot.className = 'w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]';
                text.textContent = `MIDI: ${inputs[0].name.slice(0, 10)}`;
            } else {
                dot.className = 'w-2 h-2 rounded-full bg-amber-400';
                text.textContent = 'MIDI: Prêt';
            }

            for (const input of inputs) {
                input.onmidimessage = (msg) => {
                    const [status, data1, data2] = msg.data;
                    const cmd = status & 0xf0;
                    if (cmd === 0x90 && data2 > 0) {
                        handleUserNoteOn(data1, data2 / 127);
                    } else if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) {
                        handleUserNoteOff(data1);
                    } else if (cmd === 0xB0 && data1 === 64) {
                        // MIDI CC 64: Sustain / Damper Pedal (>= 64 pressed, < 64 released)
                        audioEngine.setSustainPedal(data2 >= 64);
                    }
                };
            }
        };

        bindInputs();
        midiAccess.onstatechange = bindInputs;
    }).catch(() => {
        dot.className = 'w-2 h-2 rounded-full bg-studio-600';
        text.textContent = 'MIDI';
    });
}
