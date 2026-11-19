const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
const swCode = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const manifestRaw = fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8');

// ---------------------------------------------------------------------------
// 0. Static PWA, HTML, Manifest, Service Worker, DOM IDs & CSS Coverage Checks
// ---------------------------------------------------------------------------
assert(!/cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(html),
    'index.html must not contain external CDN or Google Fonts links for offline PWA');

assert(/<link\s+rel="manifest"\s+href="\.\/manifest\.webmanifest"/i.test(html),
    'index.html must link ./manifest.webmanifest');
assert(/<link\s+rel="stylesheet"\s+href="\.\/css\/styles\.css"/i.test(html),
    'index.html must link ./css/styles.css');

const expectedScripts = [
    './js/constants.js',
    './js/audio.js',
    './js/theory-generator.js',
    './js/renderer.js',
    './js/playback-wait.js',
    './js/ui.js'
];
const deferScripts = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/gi)].map(m => m[1]);
assert.deepStrictEqual(deferScripts, expectedScripts,
    'index.html must load all 6 JS modules in exact defer order');

// Parse & verify sw.js + APP_SHELL asset existence
new vm.Script(swCode, { filename: 'sw.js' });
const appShellMatch = swCode.match(/const\s+APP_SHELL\s*=\s*(\[[\s\S]*?\]);/);
assert(appShellMatch, 'sw.js must define APP_SHELL array');
const appShellAssets = vm.runInNewContext(appShellMatch[1]);
assert(Array.isArray(appShellAssets) && appShellAssets.length >= 15, 'APP_SHELL should list all core offline assets');
for (const asset of appShellAssets) {
    if (asset === './') continue;
    const diskPath = path.join(ROOT, asset.replace(/^\.\//, ''));
    assert(fs.existsSync(diskPath), `APP_SHELL asset missing on disk: ${asset} (${diskPath})`);
}
console.log(`✓ sw.js syntax valid & all ${appShellAssets.length} APP_SHELL entries exist on disk`);

// Parse & verify manifest.webmanifest icons & required PWA fields
const manifest = JSON.parse(manifestRaw);
assert.strictEqual(manifest.display, 'standalone', 'PWA manifest display must be standalone');
assert(manifest.id && manifest.start_url && manifest.scope, 'PWA manifest must declare id, start_url, scope');
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'PWA manifest must list icons');
for (const ic of manifest.icons) {
    const iconDisk = path.join(ROOT, ic.src.replace(/^\.\//, ''));
    assert(fs.existsSync(iconDisk), `Manifest icon missing on disk: ${ic.src}`);
}
assert(fs.existsSync(path.join(ROOT, 'icons', 'apple-touch-icon.png')), 'apple-touch-icon.png missing');
assert(fs.existsSync(path.join(ROOT, 'Bravura.woff2')), 'Local Bravura.woff2 missing');
console.log('✓ manifest.webmanifest valid & all PWA icons + Bravura.woff2 present');

// Verify all getElementById(...) lookups in JS correspond to real HTML elements
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const jsSources = {};
let totalJsLines = 0;
for (const rel of expectedScripts) {
    const relFile = rel.replace(/^\.\//, '');
    const code = fs.readFileSync(path.join(ROOT, relFile), 'utf8');
    new vm.Script(code, { filename: relFile });
    jsSources[relFile] = code;
    totalJsLines += code.split('\n').length;

    for (const m of code.matchAll(/document\.getElementById\('([^']+)'\)/g)) {
        assert(htmlIds.has(m[1]), `Missing HTML element id="${m[1]}" referenced in ${relFile}`);
    }
}

// Extract every CSS class defined in css/styles.css
function unescapeCssIdent(sel) {
    return sel
        .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/\\(.)/g, '$1');
}
const definedClasses = new Set(['dark', 'preset-btn', 'group']);
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const selectorRegex = /(?:^|[\s,{}+>~(])\.((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w-])+)/g;
for (const m of cssNoComments.matchAll(selectorRegex)) {
    definedClasses.add(unescapeCssIdent(m[1]));
}

// Collect class tokens from index.html + js/*.js
const htmlClassTokens = new Set();
for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const tok of m[1].trim().split(/\s+/)) {
        if (tok) htmlClassTokens.add(tok);
    }
}

for (const code of Object.values(jsSources)) {
    for (const m of code.matchAll(/['"`]([^'"`\n]*(?:bg-|text-|border-|hover:|shadow|rounded|px-|py-|pt-|pb-|w-|h-|gap-|flex|items-|justify-|font-|tracking-|transition|hidden)[^'"`\n]*)['"`]/g)) {
        const str = m[1].replace(/\$\{[^}]+\}/g, ' ');
        for (const tok of str.split(/\s+/)) {
            if (tok && /^[a-z0-9-:#\[\]./]+$/i.test(tok) && !tok.includes('=') && !tok.includes(';') && (tok.includes('-') || tok.includes(':') || tok === 'hidden' || tok === 'flex')) {
                htmlClassTokens.add(tok);
            }
        }
    }
}

const missingClasses = [...htmlClassTokens].filter(c => !definedClasses.has(c));
assert.strictEqual(missingClasses.length, 0,
    `Missing CSS classes in css/styles.css: ${missingClasses.join(', ')}`);
console.log(`✓ JS syntax valid across 6 modules (${totalJsLines} lines), DOM IDs verified & ${htmlClassTokens.size} CSS classes 100% covered`);

// ---------------------------------------------------------------------------
// 1. Minimal DOM / Window Sandbox & Sequential Execution
// ---------------------------------------------------------------------------
const makeEl = (tag = 'div') => ({
    tagName: tag.toUpperCase(),
    value: '',
    checked: false,
    textContent: '',
    className: '',
    style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    appendChild(c) { this.children.push(c); },
    replaceChildren(...c) { this.children = [...c]; },
    setAttribute() {},
    getAttribute() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 400 }; },
    getContext() {
        return {
            setTransform() {}, save() {}, restore() {}, clearRect() {}, fillRect() {},
            beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {},
            arc() {}, ellipse() {}, bezierCurveTo() {}, quadraticCurveTo() {}, roundRect() {}, rect() {}, clip() {},
            fillText() {}, strokeText() {}, measureText(s) { return { width: String(s).length * 7 }; },
            setLineDash() {}
        };
    },
    scrollTo() {}
});

const elements = new Map();
const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeEl('div'));
    return elements.get(id);
};

getEl('sliderReverb').value = '35';
getEl('scoreViewportContainer').clientWidth = 960;
getEl('scoreViewportContainer').clientHeight = 420;

let swRegistrations = [];
let mockNowMs = 1000;
const context = {
    console,
    Math, Number, String, Boolean, Array, Object, Map, Set, JSON, Float32Array, Uint8Array,
    performance: { now: () => mockNowMs },
    requestAnimationFrame: () => 0,
    localStorage: { getItem: () => null, setItem() {} },
    navigator: {
        serviceWorker: {
            register: (swPath) => {
                swRegistrations.push(swPath);
                return Promise.resolve({});
            }
        }
    },
    alert() {},
    setTimeout() {},
    setInterval: () => 42,
    clearInterval() {},
    window: {
        devicePixelRatio: 2,
        isSecureContext: true,
        location: { protocol: 'https:' },
        matchMedia: () => ({ matches: false }),
        addEventListener() {},
        AudioContext: function MockAudioContext() {
            const noopParam = {
                value: 0.5,
                setValueAtTime() {},
                linearRampToValueAtTime() {},
                exponentialRampToValueAtTime() {},
                setTargetAtTime() {},
                cancelScheduledValues() {}
            };
            const node = () => ({
                connect() { return this; },
                gain: noopParam,
                pan: noopParam,
                frequency: noopParam,
                detune: noopParam,
                Q: noopParam,
                threshold: noopParam,
                knee: noopParam,
                ratio: noopParam,
                attack: noopParam,
                release: noopParam,
                playbackRate: noopParam,
                type: '',
                buffer: null,
                start() {},
                stop() {}
            });
            return {
                currentTime: 0,
                sampleRate: 44100,
                state: 'running',
                destination: {},
                pannerCount: 0,
                resume() { return Promise.resolve(); },
                createGain: node,
                createOscillator: node,
                createBiquadFilter: node,
                createDynamicsCompressor: node,
                createConvolver: node,
                createWaveShaper: node,
                createBufferSource: node,
                createStereoPanner() { this.pannerCount++; return node(); },
                createBuffer: (ch = 1, len = 128) => ({ getChannelData: () => new Float32Array(len) })
            };
        }
    },
    document: {
        fonts: { check: () => true, load: () => Promise.resolve() },
        getElementById: getEl,
        createElement: makeEl,
        querySelectorAll: () => [],
        fullscreenElement: null,
        documentElement: {}
    }
};
context.window.document = context.document;
context.window.navigator = context.navigator;
vm.createContext(context);

for (const rel of expectedScripts) {
    const relFile = rel.replace(/^\.\//, '');
    vm.runInContext(jsSources[relFile], context, { filename: relFile });
}

// Verify Service Worker & PWA context status handling
context.window.location.protocol = 'file:';
context.registerServiceWorker();
assert.strictEqual(swRegistrations.length, 0, 'Must NOT register Service Worker on file:// protocol');
assert.strictEqual(getEl('pwaStatusBadge').textContent, 'file://');

context.window.location.protocol = 'http:';
context.window.isSecureContext = false;
context.registerServiceWorker();
assert.strictEqual(swRegistrations.length, 0, 'Must NOT register Service Worker on insecure HTTP LAN context');
assert.strictEqual(getEl('pwaStatusBadge').textContent, 'HTTP LAN bloqué');

context.window.location.protocol = 'https:';
context.window.isSecureContext = true;
context.registerServiceWorker();
assert.deepStrictEqual(swRegistrations, ['./sw.js'], 'Must register ./sw.js on secure context');

// ---------------------------------------------------------------------------
// 2. Unit & Integration Checks (Tests A - G)
// ---------------------------------------------------------------------------
const dorianD = context.getModalSignatureInfo('D', 'dorian');
assert.strictEqual(dorianD.sharps, 0);
assert.strictEqual(dorianD.flats, 0);

const aeolianD = context.getModalSignatureInfo('D', 'aeolian');
assert.strictEqual(aeolianD.sharps, 0);
assert.strictEqual(aeolianD.flats, 1);
assert.strictEqual(aeolianD.useFlats, true);

const lydianF = context.getModalSignatureInfo('F', 'lydian');
assert.strictEqual(lydianF.flats, 0);
assert.strictEqual(lydianF.sharps, 0);

const minorAb = context.getModalSignatureInfo('Ab', 'aeolian');
assert.strictEqual(minorAb.flats, 7);

const bbInDaeolian = context.midiToStaffStepAndAccidental(70, 'D', 'aeolian');
assert.strictEqual(bbInDaeolian.accidental, '');
assert.strictEqual(bbInDaeolian.step, 6);

const bNatInDaeolian = context.midiToStaffStepAndAccidental(71, 'D', 'aeolian');
assert.strictEqual(bNatInDaeolian.accidental, '♮');
assert.strictEqual(bNatInDaeolian.step, 6);

const abBorrowed = context.midiToStaffStepAndAccidental(68, 'C', 'major', null, { preferFlats: true });
assert.strictEqual(abBorrowed.step, 5);
assert.strictEqual(abBorrowed.accidental, '♭');

assert.strictEqual(context.formatPitchClass(11, true, 'en', 7), 'Cb');
assert.strictEqual(context.formatPitchClass(11, true, 'fr', 7), 'Do♭');
assert.strictEqual(context.formatPitchClass(4, true, 'fr', 7), 'Fa♭');

const accMap = new Map();
assert.strictEqual(context.midiToStaffStepAndAccidental(66, 'C', 'major', accMap).accidental, '♯');
assert.strictEqual(context.midiToStaffStepAndAccidental(66, 'C', 'major', accMap).accidental, '');
assert.strictEqual(context.midiToStaffStepAndAccidental(65, 'C', 'major', accMap).accidental, '♮');

let widthSets = 0;
let backingW = 0;
Object.defineProperty(getEl('scoreCanvas'), 'width', {
    get() { return backingW; },
    set(v) { widthSets++; backingW = v; }
});
context.syncCanvasBackingSize(800, 400, 2);
context.syncCanvasBackingSize(800, 400, 2);
assert.strictEqual(widthSets, 1);
assert.strictEqual(backingW, 1600);
context.syncCanvasBackingSize(900, 400, 2);
assert.strictEqual(widthSets, 2);
assert.strictEqual(backingW, 1800);

const runInVm = (code) => vm.runInContext(code, context);
const appState = runInVm('AppState');

appState.timeSig = '6/8';
appState.rootKey = 'D';
appState.generationRootKey = 'D';
appState.mode = 'dorian';
appState.leftHandPattern = 'ostinato_eighths';
appState.rightHandDensity = 3;
context.rebuildScoreStream();

const meas68 = appState.measures;
assert(meas68.length >= 10);
assert.strictEqual(meas68[0].beatsPerMeasure, 3);
assert.deepStrictEqual([...meas68[0].lhEvents.map(e => e.startBeat)], [0, 0.5, 1, 1.5, 2, 2.5]);

for (let m = 0; m < meas68.length - 1; m++) {
    const curr = meas68[m];
    const next = meas68[m + 1];
    const lastRh = curr.rhEvents[curr.rhEvents.length - 1];
    const firstNextRh = next.rhEvents[0];
    if (lastRh && lastRh.tieToNext) {
        assert(firstNextRh && firstNextRh.isTiedFromPrev);
        assert.deepStrictEqual([...firstNextRh.notes], [...lastRh.notes]);
    }
}

appState.progressiveModulation = true;
appState.rootKey = 'C';
appState.generationRootKey = 'C';
context.rebuildScoreStream();
assert.strictEqual(appState.rootKey, 'C');
assert.notStrictEqual(appState.generationRootKey, 'C');

appState.measures[0].isImprovisation = true;
const expImpro = [...context.getExpectedSubBeatNotes(appState.measures[0], 0)];
const lhBeat0Notes = [...appState.measures[0].lhEvents.filter(e => !e.isRest && e.startBeat === 0).flatMap(e => e.notes)];
assert.deepStrictEqual(expImpro, lhBeat0Notes);

appState.scrollMode = 'mic_wait';
appState.isPlaying = false;
context.togglePlayPause();
assert.strictEqual(appState.isPlaying, false);
assert.strictEqual(getEl('labelPlayPause').textContent, 'Lecture');

appState.rootKey = 'Ab';
appState.generationRootKey = 'Ab';
appState.mode = 'aeolian';
appState.improMeasureEnabled = true;
context.rebuildScoreStream();
appState.viewLayout = 'ribbon';
context.renderScore();
appState.viewLayout = 'page';
context.renderScore();

const detector = runInVm('micPitchDetector');
const sr = 44100;
detector.analyser = {
    fftSize: 8192,
    getFloatFrequencyData: (buf) => {
        buf.fill(-70);
        const binHz = sr / 8192;
        const b1 = Math.round(440 / binHz);
        const b2 = Math.round(880 / binHz);
        buf[b1 - 1] = -36; buf[b1] = -25; buf[b1 + 1] = -34;
        buf[b2 - 1] = -42; buf[b2] = -32; buf[b2 + 1] = -40;
    }
};
detector.timeBuf = new Float32Array(8192);
detector.freqBuf = new Float32Array(4096);
for (let i = 0; i < 8192; i++) {
    detector.timeBuf[i] = 0.25 * Math.sin(2 * Math.PI * 523.25 * i / sr);
}
assert.strictEqual(detector.detectMonophonicPitch(sr), 72);
assert.strictEqual(detector.detectExpectedNoteInSpectrum(sr, [60, 69]), 69);
assert.strictEqual(detector.detectExpectedNoteInSpectrum(sr, [68, 70]), null);

appState.progressiveModulation = false;
appState.earTrainingEnabled = false;
appState.improMeasureEnabled = false;
for (const presetName of ['gymnopedie', 'minecraft', 'skyrim', 'licorice']) {
    appState.activePreset = presetName;
    appState.timeSig = presetName === 'gymnopedie' ? '3/4' : (presetName === 'skyrim' ? '6/8' : '4/4');
    appState.rootKey = 'C';
    appState.generationRootKey = 'C';
    appState.mode = presetName === 'skyrim' ? 'aeolian' : 'major';
    appState.rightHandDensity = 2;
    context.rebuildScoreStream();

    assert(appState.measures.length >= 16);
    for (const pEndIdx of [7, 15]) {
        const endMeas = appState.measures[pEndIdx];
        assert.strictEqual(endMeas.barInPeriod, 7);
        assert.strictEqual(endMeas.chord.degree, 0);
        const lastRh = endMeas.rhEvents[endMeas.rhEvents.length - 1];
        assert.strictEqual(Boolean(lastRh && lastRh.tieToNext), false);
    }

    for (let i = 0; i < 16; i++) {
        const m = appState.measures[i];
        const rhTotal = m.rhEvents.reduce((s, ev) => s + ev.durationBeats, 0);
        assert(Math.abs(rhTotal - m.beatsPerMeasure) < 1e-6);
    }

    const r0 = appState.measures[0].rhEvents.map(e => e.durationBeats);
    const r2 = appState.measures[2].rhEvents.map(e => e.durationBeats);
    const r4 = appState.measures[4].rhEvents.map(e => e.durationBeats);
    assert.deepStrictEqual([...r2], [...r0]);
    assert.deepStrictEqual([...r4], [...r0]);
}

appState.harmonicRichness = 'sevenths';
const cMaj = context.buildContemplativeChord('C', 'major', 0, 'sevenths', 'licorice');
const fMaj = context.buildContemplativeChord('C', 'major', 3, 'sevenths', 'licorice');
const v1 = context.buildSmoothLeftHandVoicing(cMaj, [48, 55, 59, 64]);
const v2 = context.buildSmoothLeftHandVoicing(fMaj, [v1.bassMidi, ...v1.upperMidis]);
const upperDiffSum = Math.abs(v2.upperMidis[0] - v1.upperMidis[0])
    + Math.abs(v2.upperMidis[1] - v1.upperMidis[1])
    + Math.abs(v2.upperMidis[2] - v1.upperMidis[2]);
assert(upperDiffSum <= 4);

appState.harmonicRichness = 'extensions';
const cMaj9 = context.buildContemplativeChord('C', 'major', 0, 'extensions', 'licorice');
const fMaj9 = context.buildContemplativeChord('C', 'major', 3, 'extensions', 'licorice');
const v1e = context.buildSmoothLeftHandVoicing(cMaj9, [48, 59, 62, 64]);
const v2e = context.buildSmoothLeftHandVoicing(fMaj9, [v1e.bassMidi, ...v1e.upperMidis]);
const upperDiffExt = Math.abs(v2e.upperMidis[0] - v1e.upperMidis[0])
    + Math.abs(v2e.upperMidis[1] - v1e.upperMidis[1])
    + Math.abs(v2e.upperMidis[2] - v1e.upperMidis[2]);
assert(upperDiffExt <= 7);

context.initPWAInstallPrompt();
context.bindEventListeners();

// Test H: Regression tests for all major bug fixes
// H1. Triads mode strictly excludes 7ths in LH voicing and Improvisation guide tones
appState.harmonicRichness = 'triads';
const cTriad = context.buildContemplativeChord('C', 'major', 0, 'triads', 'gymnopedie');
assert.strictEqual(cTriad.hasSeventh, false);
assert.strictEqual(cTriad.seventhPc, null);
const cTriadVoicing = context.buildSmoothLeftHandVoicing(cTriad, [48, 55, 59, 64]);
for (const m of [cTriadVoicing.bassMidi, ...cTriadVoicing.upperMidis]) {
    assert([0, 4, 7].includes(context.midiToPc(m)), `Triad voicing must only use C/E/G, got midi ${m}`);
}
assert(cTriadVoicing.upperMidis[2] - cTriadVoicing.upperMidis[0] <= 12, 'LH block chord span must be <= 12 semis');
appState.rootKey = 'C';
appState.generationRootKey = 'C';
appState.mode = 'major';
appState.improMeasureEnabled = true;
context.rebuildScoreStream();
for (const m of appState.measures[0].improGuideMidis) {
    assert(appState.measures[0].chord.chordPcs.includes(context.midiToPc(m)), 'Triad improGuideMidis must only contain triad tones');
}
appState.improMeasureEnabled = false;

// H2. Borrowed minor iv6 in Major actually uses major 6th (+9) matching Fm6 label, never minor 7th (+10)
let foundBorrowedIv6 = false;
for (let attempt = 0; attempt < 80; attempt++) {
    const ch = context.buildContemplativeChord('C', 'major', 3, 'borrowed', 'licorice');
    if (ch.symbol === 'Fm6') {
        assert(ch.chordPcs.includes(2), 'Fm6 must contain D (pc 2, major 6th)');
        assert(!ch.chordPcs.includes(3), 'Fm6 must not contain Eb (pc 3, minor 7th)');
        foundBorrowedIv6 = true;
        break;
    }
}
assert(foundBorrowedIv6, 'Expected to sample borrowed Fm6 chord in C major');

// H3. Diminished chord uses true diatonic fifth (+6) instead of hardcoded perfect fifth (+7)
appState.rootKey = 'D';
appState.generationRootKey = 'D';
appState.mode = 'aeolian';
appState.harmonicRichness = 'triads';
appState.leftHandPattern = 'nordic_fifths';
appState.timeSig = '4/4';
appState.phraseState.periodIdx = 0;
appState.phraseState.chordDegrees = [1, 1, 1, 1, 1, 1, 1, 1]; // ii° = E dim in D Aeolian (E, G, Bb)
const dAeolianScale = context.getScalePitchClasses('D', 'aeolian');
appState.measures = [];
appState.measureWindowOffset = 0;
appState.generatedMeasureCounter = 1; // measureIndex = 1 uses degree 1 (Edim)
const dimMeas = context.generateNextMeasure();
assert.strictEqual(dimMeas.chord.degree, 1);
for (const ev of dimMeas.lhEvents) {
    for (const m of ev.notes) {
        assert(dAeolianScale.includes(context.midiToPc(m)), `Diminished chord LH note midi ${m} must remain diatonic in D Aeolian`);
    }
}

// H4. Ergonomic LH block span <= 12 semitones across all richness & presets
for (const rich of ['triads', 'sevenths', 'extensions', 'borrowed']) {
    appState.harmonicRichness = rich;
    let prev = [48, 55, 59, 64];
    for (let deg = 0; deg < 7; deg++) {
        const ch = context.buildContemplativeChord('D', 'dorian', deg, rich, 'gymnopedie');
        const v = context.buildSmoothLeftHandVoicing(ch, prev);
        assert(v.upperMidis[2] - v.upperMidis[0] <= 12, `Span > 12 for richness=${rich} deg=${deg}`);
        prev = [v.bassMidi, ...v.upperMidis];
    }
}

// H5. 5/4 sustained_voicing splits cleanly into tied 3 + 2 and skips audio re-attack at beat 3
appState.timeSig = '5/4';
appState.leftHandPattern = 'sustained_voicing';
appState.rootKey = 'C';
appState.generationRootKey = 'C';
appState.mode = 'major';
context.rebuildScoreStream();
const meas54 = appState.measures[0];
assert.strictEqual(meas54.lhEvents.length, 2, '5/4 sustained_voicing must split into 2 tied events');
assert.strictEqual(meas54.lhEvents[0].durationBeats, 3);
assert.strictEqual(meas54.lhEvents[0].tieToNext, true);
assert.strictEqual(meas54.lhEvents[1].startBeat, 3);
assert.strictEqual(meas54.lhEvents[1].durationBeats, 2);
assert.strictEqual(meas54.lhEvents[1].isTiedFromPrev, true);

// H6. 6/8 metronome clicks ONLY on compound duple pulses (0 and 1.5), not on 1.0 or 2.0
appState.timeSig = '6/8';
appState.metronomeEnabled = true;
context.rebuildScoreStream();
const engine = runInVm('audioEngine');
const origClick = engine.playMetronomeClick.bind(engine);
const metroCalls = [];
engine.playMetronomeClick = (isDownbeat) => { metroCalls.push(isDownbeat); origClick(isDownbeat); };
const m68 = appState.measures[0];
for (const sb of [0, 0.5, 1.0, 1.5, 2.0, 2.5]) {
    context.triggerMeasureBeatAudio(m68, sb, true);
}
engine.playMetronomeClick = origClick;
appState.metronomeEnabled = false;
assert.deepStrictEqual(metroCalls, [true, false], '6/8 metronome must click strictly on beats 0 (strong) and 1.5 (weak)');

// H7. midi_wait enforces BOTH hands on simultaneous beats (pressing only RH does not advance)
appState.timeSig = '4/4';
appState.leftHandPattern = 'satie';
appState.scrollMode = 'midi_wait';
context.rebuildScoreStream();
const mWait = appState.measures[0];
// Ensure distinct RH and LH pitches on beat 0
mWait.lhEvents = [{ startBeat: 0, durationBeats: 4, notes: [48], isRest: false }]; // C3
mWait.rhEvents = [{ startBeat: 0, durationBeats: 4, notes: [64], isRest: false }]; // E4
appState.currentMeasureIndex = 0;
appState.currentBeatFloat = 0;
appState.satisfiedSubBeatNotes.clear();
assert.strictEqual(context.checkWaitModeNoteMatch(64), false, 'midi_wait must wait for LH C3 even after RH E4 is pressed');
assert.strictEqual(appState.currentMeasureIndex, 0);
assert.strictEqual(context.checkWaitModeNoteMatch(48), true, 'midi_wait must advance once both RH and LH notes are satisfied');
assert.strictEqual(appState.currentMeasureIndex, 1);

// H8. Mic self-triggering guard ignores audio immediately after synth playback
appState.scrollMode = 'mic_wait';
appState.currentMeasureIndex = 0;
appState.currentBeatFloat = 0;
appState.satisfiedSubBeatNotes.clear();
detector.isListening = true;
detector.analyser.getFloatTimeDomainData = (buf) => { buf.set(detector.timeBuf); };
mockNowMs = 5000;
engine.playNote(60, 0.5, 0.5); // sets lastSynthPlayTimestamp = 5000
mockNowMs = 5100; // within 420ms cooldown
detector.stableFrames = 1;
detector.stableCandidateMidi = 72;
detector.processFrame(5100);
assert.strictEqual(detector.stableFrames, 0, 'MicPitchDetector must ignore audio during synth-playback cooldown');
detector.isListening = false;

// H9. Rolling window pruning caps memory & preserves measure lookups + live voice-leading continuity
appState.scrollMode = 'continuous';
appState.timeSig = '4/4';
appState.leftHandPattern = 'satie';
context.rebuildScoreStream();
for (let m = 0; m <= 60; m++) {
    appState.currentMeasureIndex = m;
    context.ensureInfiniteBuffer();
}
assert.strictEqual(appState.measureWindowOffset, 24, 'Expected rolling window to prune 24 old measures after reaching measure 60');
assert(appState.measures.length < 55, `Expected bounded rolling measure buffer, got ${appState.measures.length}`);
assert.strictEqual(context.getMeasureByIndex(60).index, 60);
const keptBeforeRefresh = context.getMeasureByIndex(59);
appState.currentBeatFloat = 0;
appState.isPlaying = false;
context.refreshUpcomingMeasuresLive(true);
assert.deepStrictEqual([...appState.lastVoicingMidis.slice(0, 1)].length, 1);
assert(keptBeforeRefresh && context.getMeasureByIndex(59).index === 59);

// H10. Smoke-test Page-View viewport culling, multi-voice ties, fallback 8th rest moveTo, and preset highlight clearing
getEl('scoreViewportContainer').scrollTop = 480;
appState.rightHandDensity = 4;
appState.viewLayout = 'page';
context.renderScore();
context.document.fonts.check = () => false; // Exercise vector fallback paths (including 8th rest)
const restOps = [];
const spyCtx = {
    save() {}, restore() {}, fillRect() {}, fill() {}, stroke() {}, arc() {},
    beginPath() { restOps.push('beginPath'); },
    moveTo() { restOps.push('moveTo'); },
    lineTo() { restOps.push('lineTo'); },
    quadraticCurveTo() { restOps.push('quadraticCurveTo'); }
};
context.drawRestGlyph(spyCtx, 100, 50, 10, 0.5, { ink: '#000' });
const qIdx = restOps.indexOf('quadraticCurveTo');
assert(qIdx > 0 && restOps[qIdx - 1] === 'moveTo', 'Fallback 8th rest must call moveTo immediately before quadraticCurveTo');
appState.viewLayout = 'ribbon';
context.renderScore();
context.document.fonts.check = () => true;
context.updatePresetCardHighlights(null);

// Test I: Core Technical & UX Improvements (Lookahead Scheduler, Stereo Panning, MIDI NoteOff/CC64, Dynamics, Volume/Balance)
// I1. Stereo Keyboard Panning (bass left -> middle center -> treble right)
engine.init();
const pannersBefore = engine.ctx.pannerCount;
assert(engine.getPanForMidi(36) < -0.2, 'Bass C2 should pan left');
assert.strictEqual(engine.getPanForMidi(60), 0, 'Middle C4 should pan center');
assert(engine.getPanForMidi(84) > 0.2, 'Treble C6 should pan right');
engine.playNote(60, 0.8, 0.7);
assert(engine.ctx.pannerCount > pannersBefore, 'playNote must route voices through StereoPannerNode');

// I2. Real Web MIDI Note-On / Note-Off & Sustain Pedal (CC 64)
engine.setSustainPedal(false);
context.handleUserNoteOn(60, 0.8);
assert.strictEqual(engine.liveVoices.has(60), true, 'noteOn must track active voice');
context.handleUserNoteOff(60);
assert.strictEqual(engine.liveVoices.has(60), false, 'noteOff without pedal must damp voice immediately');

context.handleUserNoteOn(64, 0.8);
engine.setSustainPedal(true);
context.handleUserNoteOff(64);
assert.strictEqual(engine.liveVoices.has(64), true, 'Sustain pedal CC64 must hold released note');
assert.strictEqual(engine.sustainedReleasedNotes.has(64), true);
engine.setSustainPedal(false);
assert.strictEqual(engine.liveVoices.has(64), false, 'Lifting sustain pedal must release all held notes');
assert.strictEqual(engine.sustainedReleasedNotes.size, 0);

// I3. Master Volume & LH/RH Balance controls
context.setMasterVolume(50);
assert.strictEqual(appState.masterVolume, 0.5);
assert.strictEqual(getEl('valMasterVolume').textContent, '50%');
context.setHandBalance(-100);
assert.deepStrictEqual({ ...context.getHandBalanceGains() }, { lhScale: 1, rhScale: 0 });
assert.strictEqual(getEl('valHandBalance').textContent, 'MG');
context.setHandBalance(100);
assert.deepStrictEqual({ ...context.getHandBalanceGains() }, { lhScale: 0, rhScale: 1 });
assert.strictEqual(getEl('valHandBalance').textContent, 'MD');
context.setHandBalance(0);
assert.deepStrictEqual({ ...context.getHandBalanceGains() }, { lhScale: 1, rhScale: 1 });
assert.strictEqual(getEl('valHandBalance').textContent, 'Équil.');

// I4. 8-bar Phrase-Arch Expressive Dynamics (bar 6 climax louder than bar 8 cadence)
const velClimax = context.computeExpressiveVelocity(0.74, { barInPeriod: 5 }, 0, 1);
const velCadence = context.computeExpressiveVelocity(0.74, { barInPeriod: 7 }, 0, 1);
assert(velClimax > velCadence + 0.10, `Bar 6 climax (${velClimax.toFixed(3)}) must be stronger than bar 8 cadence (${velCadence.toFixed(3)})`);

// I5. Sample-Accurate Web Audio Lookahead Scheduler & AudioContext-locked visual playhead
const scheduler = runInVm('AudioLookaheadScheduler');
appState.scrollMode = 'continuous';
appState.timeSig = '4/4';
appState.tempo = 120; // 0.5s per beat, 0.25s per sub-beat
context.rebuildScoreStream();
appState.isPlaying = true;
appState.currentMeasureIndex = 0;
appState.currentBeatFloat = 0;
engine.ctx.currentTime = 1.0;
context.startAudioScheduler();
assert(scheduler.anchors.length >= 1, 'Lookahead scheduler must seed initial anchor');
assert(Math.abs(scheduler.anchors[0].audioTime - 1.025) < 1e-6);

// Advance AudioContext clock in 100ms steps across 1 full 4/4 measure (2.0s = 4 beats at 120 BPM)
for (let t = 1.125; t <= 3.03; t += 0.1) {
    engine.ctx.currentTime = t;
    context.syncVisualPlayheadFromAudioClock();
}
assert.strictEqual(appState.currentMeasureIndex, 1, 'Playhead must cross cleanly into measure 1 at exact AudioContext barline');
assert(appState.currentBeatFloat < 0.1, `Expected beat near 0 on measure entry, got ${appState.currentBeatFloat}`);

// Background-tab sleep guard (+10s jump must NOT blast catch-up bursts)
const anchorsBeforeJump = scheduler.anchors.length;
engine.ctx.currentTime += 10.0;
context.pumpAudioScheduler();
assert(scheduler.anchors.length <= anchorsBeforeJump + 2, 'Background tab wake-up must recover without scheduling catch-up bursts');
context.stopAudioScheduler();
appState.isPlaying = false;
assert.strictEqual(scheduler.timerId, null);
assert.strictEqual(scheduler.anchors.length, 0);

// Test J: 6 Themes (incl. Zelda & Chilly Gonzales), 32-bar Macro-Form (A -> A' -> B -> A''), Inversions, Suspensions, Roll & Rubato
const allSixPresets = ['gymnopedie', 'minecraft', 'skyrim', 'licorice', 'zelda', 'gonzales'];
for (const pKey of allSixPresets) {
    context.applyStylePreset(pKey);
    // Generate full 32-bar chapter
    while (appState.measures.length < 32) {
        appState.measures.push(context.generateNextMeasure());
    }
    assert.strictEqual(appState.measures[0].macroSection, 'A', `${pKey}: bar 0 must be section A`);
    assert.strictEqual(appState.measures[8].macroSection, "A'", `${pKey}: bar 8 must be section A'`);
    assert.strictEqual(appState.measures[16].macroSection, 'B', `${pKey}: bar 16 must be section B`);
    assert.strictEqual(appState.measures[24].macroSection, "A''", `${pKey}: bar 24 must be section A''`);

    // Every bar across all 32 measures must have exact RH duration sum and clean cadence on bar 7/15/23/31
    for (let i = 0; i < 32; i++) {
        const m = appState.measures[i];
        const rhSum = m.rhEvents.reduce((s, e) => s + e.durationBeats, 0);
        assert(Math.abs(rhSum - m.beatsPerMeasure) < 1e-6, `${pKey} bar ${i}: RH sum ${rhSum} != ${m.beatsPerMeasure}`);
        if (m.barInPeriod === 7) {
            assert.strictEqual(m.chord.degree, 0, `${pKey} bar ${i}: period end must resolve to tonic`);
        }
    }

    // Section A' (bar 8) and A'' (bar 24) recall Section A's primary rhythmic motif
    const rA = appState.measures[0].rhEvents.map(e => e.durationBeats);
    const rAp = appState.measures[8].rhEvents.map(e => e.durationBeats);
    const rApp = appState.measures[24].rhEvents.map(e => e.durationBeats);
    assert.deepStrictEqual([...rAp], [...rA], `${pKey}: Section A' must recall Section A motif rhythm`);
    assert.deepStrictEqual([...rApp], [...rA], `${pKey}: Section A'' must recall Section A motif rhythm`);
}

// J2. Zelda ("Hyrule & Fées"): Iconic bVI -> bVII -> I bridge cadence & Fairy Wave LH
context.applyStylePreset('zelda');
while (appState.measures.length < 24) appState.measures.push(context.generateNextMeasure());
const zeldaBridge = appState.measures.slice(16, 24);
assert(zeldaBridge.some(m => m.chord.roman.startsWith('♭VI')), 'Zelda Section B must include heroic ♭VI chord');
assert(zeldaBridge.some(m => m.chord.roman.startsWith('♭VII')), 'Zelda Section B must include heroic ♭VII chord');
assert.strictEqual(zeldaBridge[7].chord.degree, 0, 'Zelda Section B must resolve home to I');

// J3. Chilly Gonzales ("Solo Piano"): Felt timbre, dry reverb, 1st-inversion slash bass & harmonic-minor V7 (raised B♮ in C minor)
context.applyStylePreset('gonzales');
assert.strictEqual(appState.soundType, 'felt', 'Chilly Gonzales preset must default to felt piano');
assert.strictEqual(appState.rootKey, 'C');
assert.strictEqual(appState.mode, 'aeolian');
while (appState.measures.length < 24) appState.measures.push(context.generateNextMeasure());
const hasV7WithLeadingTone = appState.measures.some(m => m.chord.roman.startsWith('V7') && m.chord.chordPcs.includes(11));
assert(hasV7WithLeadingTone, 'Chilly Gonzales in C minor must feature harmonic-minor V7 (G7 with B♮)');
const firstInvMeas = appState.measures.find(m => m.chord.inversion === 'first');
assert(firstInvMeas, 'Chilly Gonzales must include 1st-inversion walking slash chords');
assert.strictEqual(context.midiToPc(firstInvMeas.voicingMidis[0]), firstInvMeas.chord.thirdPc, '1st inversion must put chord 3rd in bass');

// J4. Nordic ("Nordique & Brume") tonic pedal drone puts modal tonic in bass
const pedalChord = context.buildContemplativeChord('D', 'aeolian', 6, 'sevenths', 'skyrim', { deg: 6, inv: 'pedal', borrowed: null });
assert.strictEqual(pedalChord.inversion, 'pedal');
assert.strictEqual(pedalChord.bassPc, 2, 'D Aeolian pedal chord must keep D (pc 2) in bass');
const pedalVoicing = context.buildSmoothLeftHandVoicing(pedalChord, [38, 53, 57, 60]);
assert.strictEqual(context.midiToPc(pedalVoicing.bassMidi), 2);

// J5. Humanization: Soft Rolled Chords stagger timestamps upward & Cadence Rubato breathes on Bar 7
context.applyStylePreset('gymnopedie');
const origPlayNote = engine.playNote.bind(engine);
const playedTimes = [];
engine.playNote = (midi, dur, vel, when) => { playedTimes.push({ midi, when }); return origPlayNote(midi, dur, vel, when); };
const satieMeas = appState.measures[0];
// Beat 1 of Gymnopédie Satie LH has a 3-note block chord
context.triggerMeasureBeatAudio(satieMeas, 1, true, 5.0);
engine.playNote = origPlayNote;
const lhRollTimes = playedTimes.filter(x => x.midi < 68).map(x => x.when);
assert(lhRollTimes.length >= 2 && lhRollTimes[1] > lhRollTimes[0], 'Multi-note LH chord must softly roll bottom-to-top');

appState.tempo = 72;
const tempoBar0 = context.getEffectiveTempoForSubBeat({ barInPeriod: 0, beatsPerMeasure: 4, preset: 'zelda' }, 0);
const tempoBar7End = context.getEffectiveTempoForSubBeat({ barInPeriod: 7, beatsPerMeasure: 4, preset: 'zelda' }, 3);
assert.strictEqual(tempoBar0, 72);
assert(tempoBar7End < 68, `Bar 7 cadence rubato (${tempoBar7End.toFixed(1)}) must slow gently below 72 BPM`);

// Smoke-render rehearsal marks (A, A', B, A'') across Ribbon & Page views
appState.currentMeasureIndex = 16;
appState.viewLayout = 'ribbon';
context.renderScore();
appState.viewLayout = 'page';
context.renderScore();

console.log('✓ All PWA, CSS, DOM, scheduler, audio, MIDI, 6-theme composer, 32-bar form & integration checks passed!');
