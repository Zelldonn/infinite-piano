/***********************************************************************
 * 6. INFINITE PLAYBACK LOOP, AUDIO SCHEDULER & MIDI WAIT ENGINE
 ***********************************************************************/

// Trigger all notes scheduled at a specific sub-beat (0.5 beat resolution)
function triggerMeasureBeatAudio(measure, subBeat, playSound = true) {
    const beatDurationSec = 60 / AppState.tempo;

    // Optional soft wooden metronome on integer beats
    if (playSound && AppState.metronomeEnabled && Math.abs(subBeat - Math.round(subBeat)) < 0.01) {
        audioEngine.playMetronomeClick(subBeat === 0);
    }

    // Trigger Left Hand events starting at this subBeat
    for (const ev of measure.lhEvents) {
        if (!ev.isRest && Math.abs(ev.startBeat - subBeat) < 0.05) {
            const durSec = ev.durationBeats * beatDurationSec;
            for (const midi of ev.notes) {
                if (playSound) audioEngine.playNote(midi, durSec, 0.58);
            }
        }
    }

    // Trigger Right Hand events starting at this subBeat (skipping tied continuations & impro measures)
    // In a Guided Improvisation measure, mute the procedural Right Hand so the user can improvise freely over the Left Hand!
    if (!measure.isImprovisation) {
        const rhVel = measure.isEarTraining ? 0.84 : 0.74; // Slightly emphasize melody in Ear Training measures
        for (const ev of measure.rhEvents) {
            if (!ev.isRest && !ev.isTiedFromPrev && Math.abs(ev.startBeat - subBeat) < 0.05) {
                const durSec = ev.durationBeats * beatDurationSec;
                for (const midi of ev.notes) {
                    if (playSound) audioEngine.playNote(midi, durSec, rhVel);
                }
            }
        }
    }
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
    const measure = AppState.measures[AppState.currentMeasureIndex];
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
            const nextMeasure = AppState.measures[AppState.currentMeasureIndex];
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

    updateHudInfo();
    renderScore();
}

// Main animation loop for smooth scrolling, audio scheduling, and real-time Mic Pitch Detection
function animationLoop(timestamp) {
    if (!AppState.lastFrameTime) AppState.lastFrameTime = timestamp;
    const dtSec = Math.min(0.1, (timestamp - AppState.lastFrameTime) / 1000);
    AppState.lastFrameTime = timestamp;

    // Poll Microphone Pitch Detector when in 'mic_wait' mode
    if (AppState.scrollMode === 'mic_wait' && micPitchDetector.isListening) {
        micPitchDetector.processFrame(timestamp);
    }

    if (AppState.isPlaying && AppState.scrollMode !== 'midi_wait' && AppState.scrollMode !== 'mic_wait') {
        const measure = AppState.measures[AppState.currentMeasureIndex];
        if (measure) {
            const beatsPerSec = AppState.tempo / 60;
            AppState.currentBeatFloat += dtSec * beatsPerSec;

            // Check if we crossed a 0.5-beat boundary
            const currentSubIdx = Math.floor(AppState.currentBeatFloat * 2);
            const globalSubId = AppState.currentMeasureIndex * 16 + currentSubIdx;

            if (globalSubId !== AppState.lastTriggeredSubBeat) {
                AppState.lastTriggeredSubBeat = globalSubId;
                const subBeat = currentSubIdx * 0.5;
                if (subBeat < measure.beatsPerMeasure) {
                    triggerMeasureBeatAudio(measure, subBeat, true);
                }
            }

            // Advance to next measure when measure completes
            if (AppState.currentBeatFloat >= measure.beatsPerMeasure) {
                AppState.currentBeatFloat -= measure.beatsPerMeasure;
                AppState.currentMeasureIndex++;
                ensureInfiniteBuffer();
                updateHudInfo();
                autoScrollPageModeIfNeeded();

                // Trigger beat 0 of the newly entered measure immediately
                const newMeas = AppState.measures[AppState.currentMeasureIndex];
                const newGlobalSubId = AppState.currentMeasureIndex * 16;
                AppState.lastTriggeredSubBeat = newGlobalSubId;
                triggerMeasureBeatAudio(newMeas, 0, true);
            }

            renderScore();
        }
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
    const activeRow = Math.floor(AppState.currentMeasureIndex / measuresPerRow);
    const targetScrollTop = Math.max(0, activeRow * rowHeight - 20);
    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
}

/***********************************************************************
 * 7. WEB MIDI & MICROPHONE PITCH DETECTION ("ATTENTE NOTE MICRO / MIDI")
 ***********************************************************************/

// Evaluate a detected note (from either MIDI or Microphone) against the current sub-beat target
function checkWaitModeNoteMatch(midi) {
    if (AppState.scrollMode !== 'midi_wait' && AppState.scrollMode !== 'mic_wait') return false;
    const measure = AppState.measures[AppState.currentMeasureIndex];
    if (!measure) return false;

    const subBeat = Math.round(AppState.currentBeatFloat * 2) / 2;
    const expectedMidis = getExpectedSubBeatNotes(measure, subBeat);

    // Match either exact MIDI pitch or same pitch class (octave-tolerant for comfortable practice)
    for (const exp of expectedMidis) {
        if (exp === midi || midiToPc(exp) === midiToPc(midi)) {
            AppState.satisfiedSubBeatNotes.add(exp);
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
    // (or all RH notes in MIDI mode) advances smoothly.
    if (AppState.scrollMode === 'mic_wait') {
        const targetPool = rhExpected.length > 0 ? rhExpected : expectedMidis;
        const matched = targetPool.length > 0 && targetPool.some(m => AppState.satisfiedSubBeatNotes.has(m));
        if (matched) {
            advanceOneSubBeatStep(false);
            return true;
        }
    } else {
        const requiredTarget = rhExpected.length > 0 ? rhExpected : expectedMidis;
        const allSatisfied = requiredTarget.length > 0 && requiredTarget.every(m => AppState.satisfiedSubBeatNotes.has(m));
        if (allSatisfied) {
            advanceOneSubBeatStep(false);
            return true;
        }
    }
    return false;
}

function handleUserNoteOn(midi, velocity = 0.75) {
    AppState.activeMidiNotes.add(midi);
    audioEngine.playNote(midi, 1.4, velocity);
    checkWaitModeNoteMatch(midi);
}

function handleUserNoteOff(midi) {
    AppState.activeMidiNotes.delete(midi);
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

        this.analyser.getFloatTimeDomainData(this.timeBuf);
        const sampleRate = audioEngine.ctx.sampleRate;

        const measure = AppState.measures[AppState.currentMeasureIndex];
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
