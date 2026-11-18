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
            arc() {}, bezierCurveTo() {}, quadraticCurveTo() {}, roundRect() {}, rect() {}, clip() {},
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
const context = {
    console,
    Math, Number, String, Boolean, Array, Object, Map, Set, JSON, Float32Array, Uint8Array,
    performance: { now: () => 0 },
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
    window: {
        devicePixelRatio: 2,
        isSecureContext: true,
        location: { protocol: 'https:' },
        matchMedia: () => ({ matches: false }),
        addEventListener() {},
        AudioContext: function MockAudioContext() {
            const noopParam = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} };
            const node = () => ({
                connect() { return this; },
                gain: noopParam,
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
                resume() { return Promise.resolve(); },
                createGain: node,
                createOscillator: node,
                createBiquadFilter: node,
                createDynamicsCompressor: node,
                createConvolver: node,
                createWaveShaper: node,
                createBufferSource: node,
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

appState.currentMeasureIndex = 6;
appState.viewLayout = 'ribbon';
context.renderScore();
appState.viewLayout = 'page';
context.renderScore();

console.log('✓ All PWA, CSS, DOM, module separation, unit & integration checks passed!');
