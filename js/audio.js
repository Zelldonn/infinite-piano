/***********************************************************************
 * 3. WEB AUDIO API — MULTI-TIMBRE PIANO SYNTHESIZER (CLASSICAL GRAND DEFAULT)
 ***********************************************************************/
class PianoAudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.dryGain = null;
        this.wetGain = null;
        this.convolver = null;
        this.noiseBuffer = null;
        this.isInitialized = false;
    }

    // Initialize AudioContext on first user interaction
    init() {
        if (this.isInitialized) {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }
            return;
        }
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.88;

        // Stereo compressor to prevent clipping on rich chords while preserving dynamic range
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.setValueAtTime(-16, this.ctx.currentTime);
        this.compressor.knee.setValueAtTime(10, this.ctx.currentTime);
        this.compressor.ratio.setValueAtTime(3.5, this.ctx.currentTime);
        this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
        this.compressor.release.setValueAtTime(0.22, this.ctx.currentTime);

        this.dryGain = this.ctx.createGain();
        this.wetGain = this.ctx.createGain();

        // Build realistic concert hall impulse response
        this.convolver = this.ctx.createConvolver();
        this.convolver.buffer = this.createConcertHallImpulse(2.8, 2.6);

        // Short noise buffer for realistic piano hammer strike transients
        this.noiseBuffer = this.createHammerNoiseBuffer();

        this.masterGain.connect(this.dryGain);
        this.masterGain.connect(this.convolver);
        this.convolver.connect(this.wetGain);

        this.dryGain.connect(this.compressor);
        this.wetGain.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);

        this.updateReverbMix(AppState.reverbAmount);
        this.isInitialized = true;
    }

    createHammerNoiseBuffer() {
        const sr = this.ctx.sampleRate;
        const len = Math.floor(sr * 0.04);
        const buf = this.ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = Math.pow(1 - i / len, 2.2);
            data[i] = (Math.random() * 2 - 1) * env;
        }
        return buf;
    }

    // Generate stereo exponential decay impulse buffer for natural acoustic hall
    createConcertHallImpulse(durationSeconds, decayRate) {
        const sampleRate = this.ctx.sampleRate;
        const length = Math.floor(sampleRate * durationSeconds);
        const impulse = this.ctx.createBuffer(2, length, sampleRate);

        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            let lastSample = 0;
            for (let i = 0; i < length; i++) {
                const t = i / length;
                const env = Math.pow(1 - t, decayRate);
                const white = (Math.random() * 2 - 1);
                lastSample = lastSample * 0.72 + white * 0.28;
                data[i] = lastSample * env * 0.6;
            }
        }
        return impulse;
    }

    updateReverbMix(normValue) {
        AppState.reverbAmount = normValue;
        if (!this.isInitialized) return;
        const now = this.ctx.currentTime;
        this.dryGain.gain.setTargetAtTime(0.92 - normValue * 0.22, now, 0.05);
        this.wetGain.gain.setTargetAtTime(normValue * 0.85, now, 0.05);
    }

    // Dispatch note synthesis according to selected Sound Type
    playNote(midi, durationSec = 1.5, velocity = 0.68) {
        this.init();
        const type = AppState.soundType || 'classical';
        if (type === 'classical') {
            this.playClassicalGrandNote(midi, durationSec, velocity, false);
        } else if (type === 'bright') {
            this.playClassicalGrandNote(midi, durationSec, velocity, true);
        } else if (type === 'felt') {
            this.playFeltPianoNote(midi, durationSec, velocity);
        } else if (type === 'electric') {
            this.playElectricPianoNote(midi, durationSec, velocity);
        } else if (type === 'harpsichord') {
            this.playHarpsichordNote(midi, durationSec, velocity);
        }
    }

    // 1 & 2. Classical Concert Grand Piano & Bright Studio Grand synthesis
    playClassicalGrandNote(midi, durationSec, velocity, isBright = false) {
        const now = this.ctx.currentTime;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);

        // Register balance across 88 keys
        const registerScale = midi < 48 ? 0.9 : (midi > 76 ? 0.72 : 0.82);
        const amp = Math.min(1, Math.max(0.12, velocity)) * registerScale * 0.30;

        // Acoustic piano string inharmonicity coefficient B (higher in treble/bass extremes)
        const B = midi < 45 ? 0.00012 : (midi > 72 ? 0.00035 : 0.00018);
        const f2 = freq * 2 * Math.sqrt(1 + B * 4);
        const f3 = freq * 3 * Math.sqrt(1 + B * 9);

        // Two-stage acoustic grand piano envelope (crisp hammer strike -> singing soundboard sustain)
        const voiceGain = this.ctx.createGain();
        const attackTime = isBright ? 0.003 : 0.005;
        const releaseTime = Math.max(0.85, durationSec * 1.55);

        voiceGain.gain.setValueAtTime(0.0001, now);
        voiceGain.gain.linearRampToValueAtTime(amp, now + attackTime);
        voiceGain.gain.exponentialRampToValueAtTime(amp * 0.52, now + 0.22);
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime + 0.45);

        // Dynamic velocity-sensitive lowpass filter (opens on hammer impact, mellows on sustain)
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        const brightMult = isBright ? 1.45 : 1.0;
        const attackCutoff = Math.min(14000, freq * (8.5 + velocity * 6.5) * brightMult);
        const sustainCutoff = Math.min(6500, Math.max(380, freq * (3.6 + velocity * 1.8) * brightMult));
        const endCutoff = Math.max(260, freq * 1.6);

        filter.frequency.setValueAtTime(attackCutoff, now);
        filter.frequency.exponentialRampToValueAtTime(sustainCutoff, now + 0.16);
        filter.frequency.exponentialRampToValueAtTime(endCutoff, now + releaseTime);
        filter.Q.value = isBright ? 1.1 : 0.85;

        // Unison string 1: Warm Triangle core
        const osc1 = this.ctx.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(freq, now);

        // Unison string 2: Slightly detuned Sawtooth for rich acoustic piano even/odd harmonics
        const osc2 = this.ctx.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(freq, now);
        osc2.detune.setValueAtTime(1.8, now);
        const osc2Gain = this.ctx.createGain();
        osc2Gain.gain.setValueAtTime(isBright ? 0.34 : 0.24, now);
        osc2Gain.gain.exponentialRampToValueAtTime(0.06, now + releaseTime * 0.7);

        // Harmonic 2 (Octave partial with inharmonicity & slight flat detune)
        const osc3 = this.ctx.createOscillator();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(f2, now);
        osc3.detune.setValueAtTime(-1.5, now);
        const osc3Gain = this.ctx.createGain();
        osc3Gain.gain.setValueAtTime(0.24, now);
        osc3Gain.gain.exponentialRampToValueAtTime(0.002, now + releaseTime * 0.65);

        // Harmonic 3 (Twelfth partial for classical woody ring)
        const osc4 = this.ctx.createOscillator();
        osc4.type = 'sine';
        osc4.frequency.setValueAtTime(f3, now);
        const osc4Gain = this.ctx.createGain();
        osc4Gain.gain.setValueAtTime(isBright ? 0.14 : 0.09, now);
        osc4Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

        // Crisp acoustic hammer key-strike transient
        this.triggerClassicalHammerStrike(now, freq, amp * (isBright ? 0.38 : 0.26));

        osc1.connect(filter);
        osc2.connect(osc2Gain);
        osc2Gain.connect(filter);
        osc3.connect(osc3Gain);
        osc3Gain.connect(filter);
        osc4.connect(osc4Gain);
        osc4Gain.connect(filter);

        filter.connect(voiceGain);
        voiceGain.connect(this.masterGain);

        const stopAt = now + releaseTime + 0.5;
        osc1.start(now);
        osc2.start(now);
        osc3.start(now);
        osc4.start(now);
        osc1.stop(stopAt);
        osc2.stop(stopAt);
        osc3.stop(stopAt);
        osc4.stop(stopAt);
    }

    // Realistic acoustic hammer impact (filtered noise burst + soundboard woody ping)
    triggerClassicalHammerStrike(now, freq, level) {
        if (this.noiseBuffer) {
            const noise = this.ctx.createBufferSource();
            noise.buffer = this.noiseBuffer;
            const bp = this.ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(Math.min(4800, Math.max(600, freq * 2.8)), now);
            bp.Q.value = 1.8;
            const ng = this.ctx.createGain();
            ng.gain.setValueAtTime(level * 0.7, now);
            ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
            noise.connect(bp);
            bp.connect(ng);
            ng.connect(this.masterGain);
            noise.start(now);
        }

        // Soundboard bridge thump
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(155, now);
        osc.frequency.exponentialRampToValueAtTime(48, now + 0.028);
        g.gain.setValueAtTime(level * 0.55, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.036);
    }

    // 3. Intimate Felt Piano synthesis
    playFeltPianoNote(midi, durationSec, velocity) {
        const now = this.ctx.currentTime;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const registerScale = midi < 48 ? 0.85 : (midi > 76 ? 0.65 : 0.78);
        const amp = Math.min(1, Math.max(0.1, velocity)) * registerScale * 0.28;

        const voiceGain = this.ctx.createGain();
        voiceGain.gain.setValueAtTime(0.0001, now);
        voiceGain.gain.linearRampToValueAtTime(amp, now + 0.014);
        const releaseTime = Math.max(0.6, durationSec * 1.35);
        voiceGain.gain.exponentialRampToValueAtTime(amp * 0.32, now + 0.35);
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime + 0.4);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        const baseCutoff = Math.min(4200, freq * (2.6 + velocity * 2.5));
        filter.frequency.setValueAtTime(baseCutoff * 1.3, now);
        filter.frequency.exponentialRampToValueAtTime(Math.max(220, baseCutoff * 0.5), now + releaseTime * 0.8);
        filter.Q.value = 0.7;

        const osc1 = this.ctx.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(freq, now);

        const osc2 = this.ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq, now);
        osc2.detune.setValueAtTime(3.5, now);

        const osc3 = this.ctx.createOscillator();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(freq * 2, now);
        const osc3Gain = this.ctx.createGain();
        osc3Gain.gain.setValueAtTime(0.10, now);
        osc3Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        this.triggerClassicalHammerStrike(now, freq * 0.5, amp * 0.18);

        osc1.connect(filter);
        osc2.connect(filter);
        osc3.connect(osc3Gain);
        osc3Gain.connect(filter);
        filter.connect(voiceGain);
        voiceGain.connect(this.masterGain);

        const stopAt = now + releaseTime + 0.45;
        osc1.start(now);
        osc2.start(now);
        osc3.start(now);
        osc1.stop(stopAt);
        osc2.stop(stopAt);
        osc3.stop(stopAt);
    }

    // 4. Warm Electric Piano (Rhodes Tine & Tonebar style)
    playElectricPianoNote(midi, durationSec, velocity) {
        const now = this.ctx.currentTime;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const amp = Math.min(1, Math.max(0.1, velocity)) * 0.24;
        const releaseTime = Math.max(0.8, durationSec * 1.4);

        const voiceGain = this.ctx.createGain();
        voiceGain.gain.setValueAtTime(0.0001, now);
        voiceGain.gain.linearRampToValueAtTime(amp, now + 0.006);
        voiceGain.gain.exponentialRampToValueAtTime(amp * 0.45, now + 0.28);
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime + 0.3);

        const osc1 = this.ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(freq, now);

        const osc2 = this.ctx.createOscillator();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(freq, now);
        osc2.detune.setValueAtTime(2.5, now);
        const osc2Gain = this.ctx.createGain();
        osc2Gain.gain.setValueAtTime(0.35, now);

        // Rhodes metallic tine overtone chime on attack
        const tineOsc = this.ctx.createOscillator();
        tineOsc.type = 'sine';
        tineOsc.frequency.setValueAtTime(freq * 4, now);
        const tineGain = this.ctx.createGain();
        tineGain.gain.setValueAtTime(0.18 * velocity, now);
        tineGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.18);

        osc1.connect(voiceGain);
        osc2.connect(osc2Gain);
        osc2Gain.connect(voiceGain);
        tineOsc.connect(tineGain);
        tineGain.connect(voiceGain);
        voiceGain.connect(this.masterGain);

        const stopAt = now + releaseTime + 0.35;
        osc1.start(now);
        osc2.start(now);
        tineOsc.start(now);
        osc1.stop(stopAt);
        osc2.stop(stopAt);
        tineOsc.stop(stopAt);
    }

    // 5. Classical Pianoforte / Harpsichord Plucked Synthesis
    playHarpsichordNote(midi, durationSec, velocity) {
        const now = this.ctx.currentTime;
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const amp = Math.min(1, Math.max(0.12, velocity)) * 0.20;
        const releaseTime = Math.max(0.55, Math.min(1.6, durationSec * 1.1));

        const voiceGain = this.ctx.createGain();
        voiceGain.gain.setValueAtTime(0.0001, now);
        voiceGain.gain.linearRampToValueAtTime(amp, now + 0.0025);
        voiceGain.gain.exponentialRampToValueAtTime(amp * 0.28, now + 0.16);
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + releaseTime);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(Math.min(12000, freq * 12), now);
        filter.frequency.exponentialRampToValueAtTime(Math.max(800, freq * 3.5), now + releaseTime);
        filter.Q.value = 1.4;

        const osc1 = this.ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(freq, now);

        const osc2 = this.ctx.createOscillator();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(freq * 2, now);
        osc2.detune.setValueAtTime(1.5, now);
        const osc2Gain = this.ctx.createGain();
        osc2Gain.gain.setValueAtTime(0.28, now);
        osc2Gain.gain.exponentialRampToValueAtTime(0.01, now + releaseTime * 0.7);

        osc1.connect(filter);
        osc2.connect(osc2Gain);
        osc2Gain.connect(filter);
        filter.connect(voiceGain);
        voiceGain.connect(this.masterGain);

        const stopAt = now + releaseTime + 0.05;
        osc1.start(now);
        osc2.start(now);
        osc1.stop(stopAt);
        osc2.stop(stopAt);
    }

    // Wooden soft metronome click
    playMetronomeClick(isDownbeat = false) {
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(isDownbeat ? 760 : 500, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.03);

        g.gain.setValueAtTime(isDownbeat ? 0.15 : 0.09, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

        osc.connect(g);
        g.connect(this.dryGain);
        osc.start(now);
        osc.stop(now + 0.04);
    }
}

const audioEngine = new PianoAudioEngine();
