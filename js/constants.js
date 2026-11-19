/***********************************************************************
 * 1. MUSIC THEORY & CONTEMPLATIVE HARMONY CONSTANTS
 * All comments are written in English as required.
 ***********************************************************************/

// Chromatic pitch names in English and French Solfege
const NOTE_NAMES_SHARP_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT_EN  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE_NAMES_SHARP_FR = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const NOTE_NAMES_FLAT_FR  = ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

// Diatonic C major letter steps (0=C, 1=D, 2=E, 3=F, 4=G, 5=A, 6=B)
const DIATONIC_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

// Circle of Fifths definitions for keys and modal parent key signature resolution
const KEY_SIGNATURES = {
    'C':  { rootPc: 0,  fifths: 0,  sharps: 0, flats: 0, useFlats: false, labelFr: 'Do',  diatonicOffset: 0 },
    'G':  { rootPc: 7,  fifths: 1,  sharps: 1, flats: 0, useFlats: false, labelFr: 'Sol', diatonicOffset: 4 },
    'D':  { rootPc: 2,  fifths: 2,  sharps: 2, flats: 0, useFlats: false, labelFr: 'Ré',  diatonicOffset: 1 },
    'A':  { rootPc: 9,  fifths: 3,  sharps: 3, flats: 0, useFlats: false, labelFr: 'La',  diatonicOffset: 5 },
    'E':  { rootPc: 4,  fifths: 4,  sharps: 4, flats: 0, useFlats: false, labelFr: 'Mi',  diatonicOffset: 2 },
    'F':  { rootPc: 5,  fifths: -1, sharps: 0, flats: 1, useFlats: true,  labelFr: 'Fa',  diatonicOffset: 3 },
    'Bb': { rootPc: 10, fifths: -2, sharps: 0, flats: 2, useFlats: true,  labelFr: 'Si♭', diatonicOffset: 6 },
    'Eb': { rootPc: 3,  fifths: -3, sharps: 0, flats: 3, useFlats: true,  labelFr: 'Mi♭', diatonicOffset: 2 },
    'Ab': { rootPc: 8,  fifths: -4, sharps: 0, flats: 4, useFlats: true,  labelFr: 'La♭', diatonicOffset: 5 }
};

const CIRCLE_OF_FIFTHS_ORDER = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E'];

// Circle-of-fifths shift relative to the major mode for each mode's true key signature
const MODE_FIFTH_OFFSET = {
    lydian:     1,
    major:      0,
    mixolydian: -1,
    dorian:     -2,
    aeolian:    -3
};

// Resolve authentic key signature (sharps/flats/enharmonic bias) for any tonic + mode
function getModalSignatureInfo(rootKey, mode = 'major') {
    const base = KEY_SIGNATURES[rootKey] || KEY_SIGNATURES['C'];
    const fifths = base.fifths + (MODE_FIFTH_OFFSET[mode] || 0);
    const sharps = fifths > 0 ? Math.min(7, fifths) : 0;
    const flats = fifths < 0 ? Math.min(7, -fifths) : 0;
    const useFlats = flats > 0 || (fifths === 0 && (mode === 'dorian' || mode === 'aeolian' || mode === 'mixolydian'));
    return {
        rootPc: base.rootPc,
        fifths,
        sharps,
        flats,
        useFlats,
        labelFr: base.labelFr
    };
}

// Modal intervals in semitones from the modal tonic
const MODE_INTERVALS = {
    major:      [0, 2, 4, 5, 7, 9, 11], // Ionian
    dorian:     [0, 2, 3, 5, 7, 9, 10], // Dorian (natural 6, flat 7)
    aeolian:    [0, 2, 3, 5, 7, 8, 10], // Natural Minor
    lydian:     [0, 2, 4, 6, 7, 9, 11], // Lydian (#4)
    mixolydian: [0, 2, 4, 5, 7, 9, 10]  // Mixolydian (b7)
};

const MODE_LABELS_FR = {
    major: 'Majeur',
    dorian: 'Dorien',
    aeolian: 'Éolien',
    lydian: 'Lydien',
    mixolydian: 'Mixolydien'
};

// 32-bar macro-form labels: Section A -> A' (blossom) -> B (bridge contrast) -> A'' (warm return)
const MACRO_SECTION_LABELS = ['A', "A'", 'B', "A''"];

// Contemplative Style Presets configuration (6 signature piano worlds)
const STYLE_PRESETS = {
    gymnopedie: {
        name: 'Gymnopédie',
        soundType: 'classical',
        tempo: 66,
        rootKey: 'D',
        mode: 'dorian',
        timeSig: '3/4',
        harmonicRichness: 'extensions',
        leftHandPattern: 'satie',
        rightHandDensity: '2',
        intervalLeap: 'moderate',
        reverb: 38
    },
    minecraft: {
        name: 'Voxel Ambient',
        soundType: 'felt',
        tempo: 68,
        rootKey: 'G',
        mode: 'lydian',
        timeSig: '4/4',
        harmonicRichness: 'extensions',
        leftHandPattern: 'arpeggio_slow',
        rightHandDensity: '2',
        intervalLeap: 'moderate',
        reverb: 48
    },
    skyrim: {
        name: 'Nordique & Brume',
        soundType: 'classical',
        tempo: 60,
        rootKey: 'D',
        mode: 'aeolian',
        timeSig: '4/4',
        harmonicRichness: 'sevenths',
        leftHandPattern: 'nordic_fifths',
        rightHandDensity: '4',
        intervalLeap: 'moderate',
        reverb: 52
    },
    licorice: {
        name: 'Licorice Néo',
        soundType: 'classical',
        tempo: 76,
        rootKey: 'F',
        mode: 'major',
        timeSig: '4/4',
        harmonicRichness: 'borrowed',
        leftHandPattern: 'ostinato_eighths',
        rightHandDensity: '3',
        intervalLeap: 'stepwise',
        reverb: 35
    },
    zelda: {
        name: 'Hyrule & Fées',
        soundType: 'classical',
        tempo: 74,
        rootKey: 'G',
        mode: 'major',
        timeSig: '4/4',
        harmonicRichness: 'borrowed',
        leftHandPattern: 'ostinato_eighths',
        rightHandDensity: '2',
        intervalLeap: 'moderate',
        reverb: 44
    },
    gonzales: {
        name: 'Solo Piano',
        soundType: 'felt',
        tempo: 80,
        rootKey: 'C',
        mode: 'aeolian',
        timeSig: '4/4',
        harmonicRichness: 'borrowed',
        leftHandPattern: 'ostinato_eighths',
        rightHandDensity: '3',
        intervalLeap: 'stepwise',
        reverb: 22
    }
};

// Per-theme compositional DNA: governs signature rhythms, voicings, suspensions, echoes, chord roll & rubato
const THEME_DNA = {
    gymnopedie: {
        beatOnePickupChance: 0.56,   // Satie trademark: LH strikes beat 1 alone, RH floats in on beat 2
        restChance: 0.14,
        suspensionChance: 0.34,      // Floating 9th/4th color landings resolving softly
        highEchoChance: 0.0,
        heroicLeapChance: 0.08,
        openTenthLh: false,
        fairyWaveLh: false,
        baroqueBassLh: false,
        bridgeLhPattern: 'arpeggio_slow',
        chordRollSec: 0.024,         // Lush warm LH chord roll
        rubatoStrength: 1.15
    },
    minecraft: {
        beatOnePickupChance: 0.16,
        restChance: 0.30,            // Generous ambient silence & ringing air
        suspensionChance: 0.36,      // Lydian #4->5 and add9 shimmer
        highEchoChance: 0.28,        // Crystalline octave-up echo on phrase answers
        heroicLeapChance: 0.10,
        openTenthLh: true,           // Wide open Root - 5th - 10th spreads
        fairyWaveLh: false,
        baroqueBassLh: false,
        bridgeLhPattern: 'sustained_voicing',
        chordRollSec: 0.020,
        rubatoStrength: 1.05
    },
    skyrim: {
        beatOnePickupChance: 0.08,
        restChance: 0.16,
        suspensionChance: 0.24,
        highEchoChance: 0.10,
        heroicLeapChance: 0.42,      // Sweeping upward 5th/octave folk-heroic arch followed by stepwise fall
        openTenthLh: false,
        fairyWaveLh: false,
        baroqueBassLh: false,
        bridgeLhPattern: 'arpeggio_slow',
        chordRollSec: 0.018,
        rubatoStrength: 1.10
    },
    licorice: {
        beatOnePickupChance: 0.06,
        restChance: 0.10,
        suspensionChance: 0.42,      // Cinematic yearning 4->3 & 9->8 appoggiaturas
        highEchoChance: 0.12,
        heroicLeapChance: 0.12,
        openTenthLh: false,
        fairyWaveLh: false,
        baroqueBassLh: false,
        bridgeLhPattern: 'arpeggio_slow',
        chordRollSec: 0.015,
        rubatoStrength: 0.95
    },
    zelda: {
        beatOnePickupChance: 0.14,
        restChance: 0.16,
        suspensionChance: 0.46,      // Bittersweet Kondo suspensions (sus4->3, add9->1)
        highEchoChance: 0.34,        // Shimmering Fairy Fountain high-register bell echo
        heroicLeapChance: 0.26,      // Nostalgic Hyrule melody leaps
        openTenthLh: false,
        fairyWaveLh: true,           // Shimmering flowing 1-5-9-10-9-5 wave in LH
        baroqueBassLh: false,
        bridgeLhPattern: 'arpeggio_slow',
        chordRollSec: 0.022,
        rubatoStrength: 1.10
    },
    gonzales: {
        beatOnePickupChance: 0.08,
        restChance: 0.12,
        suspensionChance: 0.52,      // Crisp Chilly Gonzales classical appoggiaturas & Baroque ornaments
        highEchoChance: 0.08,
        heroicLeapChance: 0.14,
        openTenthLh: false,
        fairyWaveLh: false,
        baroqueBassLh: true,         // Tight Alberti / Solo Piano baroque walking-bass figure
        bridgeLhPattern: 'satie',    // Intimate chordal pause in Bridge before returning to ostinato
        chordRollSec: 0.009,         // Crisp intimate felt articulation
        rubatoStrength: 0.85
    }
};

function getThemeDNA(presetKey) {
    return THEME_DNA[presetKey] || THEME_DNA.licorice;
}

/***********************************************************************
 * 2. APPLICATION STATE
 ***********************************************************************/
const AppState = {
    // Playback & Sound state
    isPlaying: false,
    tempo: 66,
    soundType: 'classical',   // 'classical' | 'bright' | 'felt' | 'electric' | 'harpsichord'
    scrollMode: 'continuous', // 'continuous' | 'measure' | 'midi_wait'
    viewLayout: 'ribbon',     // 'ribbon' | 'page'
    sheetTheme: 'parchment',  // 'parchment' | 'dark'
    metronomeEnabled: false,
    reverbAmount: 0.35,
    masterVolume: 0.88,       // 0.0 .. 1.0 master output level
    handBalance: 0,           // -1.0 (LH solo) .. 0 (balanced) .. +1.0 (RH solo)

    // Musical parameters
    activePreset: 'gymnopedie',
    rootKey: 'D',
    generationRootKey: 'D',  // Tracks lookahead buffer modulation independently of playhead UI key
    mode: 'dorian',
    progressiveModulation: false,
    harmonicRichness: 'extensions',
    leftHandPattern: 'satie',
    rightHandDensity: 2,
    timeSig: '3/4',
    intervalLeap: 'moderate',
    allowLedgerLines: true,

    // Visual Aids & Cognitive Pedagogy (Look-Ahead, Ear Training, Improvisation)
    showChords: true,
    showRoman: true,
    highlightGuideTones: true,
    noteNameMode: 'fr', // 'none' | 'fr' | 'en'
    lookAheadMode: 'off', // 'off' | 'beat' | 'measure'
    earTrainingEnabled: false,
    improMeasureEnabled: false,

    // Infinite Score Buffer & Playhead
    measures: [],
    measureWindowOffset: 0,  // Global measure index of measures[0] for rolling window pruning
    currentMeasureIndex: 0,
    currentBeatFloat: 0,     // Floating beat position within currentMeasureIndex
    lastFrameTime: 0,
    lastTriggeredSubBeat: -1,

    // Voice-leading & Musical Phrasing memory for 32-bar (A - A' - B - A'') composition
    lastMelodyMidi: 69,      // A4
    lastChordDegree: 0,      // 0-indexed scale degree
    lastVoicingMidis: [50, 57, 60, 64],
    generatedMeasureCounter: 0,
    phraseState: {
        periodIdx: -1,
        macroChapterIdx: -1,
        macroSection: 'A',   // 'A' | "A'" | 'B' | "A''"
        chordPlan: [],       // 8 entries: { deg, inv, borrowed }
        chordDegrees: [0, 3, 1, 4, 0, 3, 4, 0],
        motifEvents: [],     // Current 8-bar period motif [{ startBeat, durationBeats, isRest, relStep, wasChordal }]
        motifTimeSig: '3/4',
        motifAnchorMidi: 69,
        sectionAMotif: [],   // Saved Section A primary theme recalled tenderly in A' and A''
        sectionAMotifTimeSig: '3/4',
        sectionAAnchorMidi: 69,
        pendingResolutionMidi: null // Active appoggiatura/suspension resolution target
    },

    // Active notes for MIDI Wait mode
    activeMidiNotes: new Set(),
    satisfiedSubBeatNotes: new Set()
};
