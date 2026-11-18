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

// Contemplative Style Presets configuration
const STYLE_PRESETS = {
    gymnopedie: {
        name: 'Gymnopédie',
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
        tempo: 72,
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
        tempo: 76,
        rootKey: 'F',
        mode: 'major',
        timeSig: '4/4',
        harmonicRichness: 'borrowed',
        leftHandPattern: 'ostinato_eighths',
        rightHandDensity: '3',
        intervalLeap: 'stepwise',
        reverb: 35
    }
};

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

    // Voice-leading & Musical Phrasing memory for smooth 8-bar composition
    lastMelodyMidi: 69,      // A4
    lastChordDegree: 0,      // 0-indexed scale degree
    lastVoicingMidis: [50, 57, 60, 64],
    generatedMeasureCounter: 0,
    phraseState: {
        periodIdx: -1,
        chordDegrees: [0, 3, 1, 4, 0, 3, 4, 0],
        motifEvents: [],     // Captured melodic-rhythmic motif [{ startBeat, durationBeats, isRest, relStep }]
        motifTimeSig: '3/4',
        motifAnchorMidi: 69
    },

    // Active notes for MIDI Wait mode
    activeMidiNotes: new Set(),
    satisfiedSubBeatNotes: new Set()
};
