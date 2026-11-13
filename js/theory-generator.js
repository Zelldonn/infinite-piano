/***********************************************************************
 * 4. PROCEDURAL MUSIC THEORY & VOICE-LEADING GENERATOR
 ***********************************************************************/

// Convert MIDI pitch to pitch class (0-11)
function midiToPc(midi) {
    return ((midi % 12) + 12) % 12;
}

// Format a pitch class into a readable note name based on modal key signature
function formatPitchClass(pc, useFlats = false, lang = 'en', flatsCount = 0) {
    const idx = ((pc % 12) + 12) % 12;
    if (flatsCount >= 6 && idx === 11) return lang === 'fr' ? 'Do♭' : 'Cb';
    if (flatsCount >= 7 && idx === 4)  return lang === 'fr' ? 'Fa♭' : 'Fb';
    if (lang === 'fr') {
        return useFlats ? NOTE_NAMES_FLAT_FR[idx] : NOTE_NAMES_SHARP_FR[idx];
    }
    return useFlats ? NOTE_NAMES_FLAT_EN[idx] : NOTE_NAMES_SHARP_EN[idx];
}

// Get scale pitch classes (7 notes) for a given rootKey and mode
function getScalePitchClasses(rootKey, mode) {
    const keyInfo = KEY_SIGNATURES[rootKey] || KEY_SIGNATURES['C'];
    const intervals = MODE_INTERVALS[mode] || MODE_INTERVALS.major;
    return intervals.map(semi => (keyInfo.rootPc + semi) % 12);
}

// 8-bar Period harmonic templates: 4-bar Antecedent ("question") + 4-bar Consequent ("answer" resolving to tonic)
const PHRASE_ARC_TEMPLATES = {
    gymnopedie: {
        antecedent: [
            [0, 3, 0, 3],
            [0, 3, 1, 4],
            [0, 5, 3, 4],
            [3, 0, 1, 4]
        ],
        consequent: [
            [0, 3, 1, 0],
            [3, 1, 4, 0],
            [0, 5, 4, 0],
            [3, 4, 0, 0]
        ]
    },
    minecraft: {
        antecedent: [
            [0, 1, 3, 4],
            [0, 3, 5, 4],
            [0, 1, 0, 3]
        ],
        consequent: [
            [3, 4, 5, 0],
            [0, 3, 1, 0],
            [5, 3, 4, 0]
        ]
    },
    skyrim: {
        antecedent: [
            [0, 6, 3, 4],
            [0, 5, 2, 6],
            [0, 3, 6, 4]
        ],
        consequent: [
            [0, 6, 3, 0],
            [5, 6, 3, 0],
            [0, 3, 4, 0]
        ]
    },
    default: {
        antecedent: [
            [0, 5, 1, 4],
            [0, 3, 1, 4],
            [5, 3, 0, 4],
            [0, 4, 5, 3]
        ],
        consequent: [
            [0, 5, 3, 0],
            [1, 4, 5, 0],
            [5, 1, 4, 0],
            [3, 1, 4, 0]
        ]
    }
};

// Ensure an 8-bar musical period plan exists for measureNumber
function ensurePeriodPlan(measureNumber, preset) {
    const periodIdx = Math.floor(measureNumber / 8);
    const ps = AppState.phraseState;
    if (ps.periodIdx === periodIdx && ps.chordDegrees.length === 8) {
        return ps;
    }
    const bank = PHRASE_ARC_TEMPLATES[preset] || PHRASE_ARC_TEMPLATES.default;
    const prevAntecedent = ps.chordDegrees.slice(0, 4).join(',');
    const antPool = bank.antecedent.filter(a => bank.antecedent.length === 1 || a.join(',') !== prevAntecedent);
    const ant = antPool[Math.floor(Math.random() * antPool.length)];
    const con = bank.consequent[Math.floor(Math.random() * bank.consequent.length)];

    ps.periodIdx = periodIdx;
    ps.chordDegrees = [...ant, ...con];
    ps.motifEvents = [];
    return ps;
}

// Phrase-structured harmonic selector: resolves each 8-bar period cleanly through antecedent & consequent arcs
function chooseNextChordDegree(prevDegree, preset, mode, measureNumber) {
    const ps = ensurePeriodPlan(measureNumber, preset);
    return ps.chordDegrees[measureNumber % 8];
}

// Build chord structure (root, 3rd, 5th, 7th, 9th, chord symbol, Roman numeral, guide tones)
function buildContemplativeChord(rootKey, mode, degree, richness, preset) {
    const sigInfo = getModalSignatureInfo(rootKey, mode);
    const scalePcs = getScalePitchClasses(rootKey, mode);

    const rootPc = scalePcs[degree % 7];
    let thirdPc = scalePcs[(degree + 2) % 7];
    const fifthPc = scalePcs[(degree + 4) % 7];
    let seventhPc = scalePcs[(degree + 6) % 7];
    const ninthPc = scalePcs[(degree + 1) % 7];

    // Handle modal borrowed chord (e.g. minor iv in Major or V7 in minor) when richness === 'borrowed'
    let isBorrowedMinorIv = false;
    let isSecondaryDom = false;
    if (richness === 'borrowed') {
        if (mode === 'major' && degree === 3 && Math.random() < 0.45) {
            // Borrow minor iv (flatten the 3rd of IV)
            thirdPc = (rootPc + 3) % 12;
            seventhPc = (rootPc + 10) % 12;
            isBorrowedMinorIv = true;
        } else if (degree === 1 && Math.random() < 0.3) {
            // Secondary dominant V7/V (II7)
            thirdPc = (rootPc + 4) % 12;
            seventhPc = (rootPc + 10) % 12;
            isSecondaryDom = true;
        }
    }

    // Compute intervals relative to chord root
    const thirdInterval = (thirdPc - rootPc + 12) % 12; // 3 = minor, 4 = major
    const fifthInterval = (fifthPc - rootPc + 12) % 12; // 7 = perfect, 6 = dim
    const seventhInterval = (seventhPc - rootPc + 12) % 12; // 10 = m7, 11 = Maj7

    const isMinor = thirdInterval === 3;
    const isDim = fifthInterval === 6;
    const isMaj7 = seventhInterval === 11;

    // Construct Roman numeral base
    const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
    let romanBase = romanNumerals[degree % 7];
    if (isMinor || isDim) romanBase = romanBase.toLowerCase();
    if (isDim) romanBase += '°';

    const rootName = formatPitchClass(rootPc, sigInfo.useFlats, 'en', sigInfo.flats);
    let suffix = isMinor ? 'm' : (isDim ? 'dim' : '');
    let romanSuffix = '';

    // Determine active chord tones and extensions based on richness
    const chordPcs = [rootPc, thirdPc, fifthPc];
    const guideTonePcs = new Set([thirdPc]);

    if (richness === 'sevenths' || richness === 'extensions' || richness === 'borrowed') {
        chordPcs.push(seventhPc);
        guideTonePcs.add(seventhPc);

        if (!isDim) {
            if (isMaj7 && !isMinor) {
                suffix = 'maj7';
                romanSuffix = 'Δ7';
            } else if (!isMaj7 && !isMinor) {
                suffix = '7';
                romanSuffix = '7';
            } else if (isMinor && !isMaj7) {
                suffix = 'm7';
                romanSuffix = '7';
            }
        }
    }

    if (richness === 'extensions' || (richness === 'borrowed' && !isDim)) {
        // Add lush 9ths, add9, or sus2 for Minecraft / Gymnopédie / Licorice
        const ninthInterval = (ninthPc - rootPc + 12) % 12;
        if (ninthInterval === 2) {
            if (preset === 'minecraft' && Math.random() < 0.45 && !isMinor) {
                // Replace or augment with add9 / sus2
                chordPcs.push(ninthPc);
                suffix = isMaj7 ? 'maj9' : 'add9';
                romanSuffix = isMaj7 ? 'Δ9' : 'add9';
            } else if (Math.random() < 0.65) {
                chordPcs.push(ninthPc);
                if (isMaj7 && !isMinor) {
                    suffix = 'maj9';
                    romanSuffix = 'Δ9';
                } else if (isMinor) {
                    suffix = 'm9';
                    romanSuffix = '9';
                } else {
                    suffix = '9';
                    romanSuffix = '9';
                }
            }
        }
    }

    if (isBorrowedMinorIv) {
        suffix = 'm6';
        romanSuffix = '6 (emp.)';
    } else if (isSecondaryDom) {
        suffix = '7';
        romanBase = 'V/V';
        romanSuffix = '';
    }

    return {
        degree,
        rootPc,
        thirdPc,
        fifthPc,
        seventhPc,
        ninthPc,
        chordPcs,
        guideTonePcs,
        preferFlats: isBorrowedMinorIv,
        preferSharps: isSecondaryDom && sigInfo.flats === 0,
        symbol: `${rootName}${suffix}`,
        roman: `${romanBase}${romanSuffix}`
    };
}

// Parsimonious voice-leading helper: minimizes semitone movement from prevVoicingMidis across C3–F4
function buildSmoothLeftHandVoicing(chord, prevVoicingMidis) {
    // Pick warm bass root in [36..50] closest to previous bass note (default around D2..C3)
    const prevBass = (prevVoicingMidis && prevVoicingMidis.length > 0) ? prevVoicingMidis[0] : 43;
    const bassCandidates = [];
    for (const octBase of [36, 48]) {
        const m = octBase + chord.rootPc;
        if (m >= 36 && m <= 50) bassCandidates.push(m);
    }
    if (bassCandidates.length === 0) bassCandidates.push(36 + chord.rootPc);
    bassCandidates.sort((a, b) => Math.abs(a - prevBass) - Math.abs(b - prevBass));
    const bassMidi = bassCandidates[0];

    // Select 3 upper chord-tone pitch classes (3rd, 7th/5th, 9th/5th)
    const targetPcs = [
        chord.thirdPc,
        chord.seventhPc !== undefined ? chord.seventhPc : chord.fifthPc,
        chord.ninthPc !== undefined && AppState.harmonicRichness === 'extensions' ? chord.ninthPc : chord.fifthPc
    ];
    const uniquePcs = [...new Set(targetPcs)];
    while (uniquePcs.length < 3) {
        uniquePcs.push(chord.rootPc);
    }
    const pcs3 = uniquePcs.slice(0, 3);

    const minUpper = Math.max(48, bassMidi + 5); // Stay clear of low muddy intervals above bass
    const maxUpper = 67; // G4 (allows smooth upper 9th extensions without ceiling jump)
    const prevUpper = (prevVoicingMidis && prevVoicingMidis.length >= 4)
        ? prevVoicingMidis.slice(1, 4)
        : [55, 59, 62];

    // For each pitch class, enumerate valid pitches in [minUpper..maxUpper]
    const candidatesPerPc = pcs3.map((pc) => {
        const list = [];
        for (let oct = 3; oct <= 5; oct++) {
            const m = (oct + 1) * 12 + pc;
            if (m >= minUpper && m <= maxUpper) list.push(m);
        }
        if (list.length === 0) list.push(55 + pc);
        return list;
    });

    // Exhaustively score permutations to minimize total semitone movement while keeping voices uncluttered
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    let bestUpper = null;
    let bestCost = Infinity;

    for (const p of perms) {
        const chosen = [0, 1, 2].map((slotIdx) => {
            const pcOpts = candidatesPerPc[p[slotIdx]];
            let bestM = pcOpts[0];
            let bestD = Infinity;
            for (const m of pcOpts) {
                const d = Math.abs(m - prevUpper[slotIdx]);
                if (d < bestD) { bestD = d; bestM = m; }
            }
            return bestM;
        }).sort((a, b) => a - b);

        // Penalize unison overlaps or overly wide 1-hand spans (>14 semis)
        if (chosen[0] === chosen[1] || chosen[1] === chosen[2]) continue;
        const span = chosen[2] - chosen[0];
        if (span > 14) continue;

        const motionCost = Math.abs(chosen[0] - prevUpper[0])
            + Math.abs(chosen[1] - prevUpper[1])
            + Math.abs(chosen[2] - prevUpper[2]);
        const centerPenalty = Math.abs(((chosen[0] + chosen[2]) / 2) - 58) * 0.25;
        const totalCost = motionCost + centerPenalty;
        if (totalCost < bestCost) {
            bestCost = totalCost;
            bestUpper = chosen;
        }
    }

    if (!bestUpper) {
        bestUpper = pcs3.map((pc) => {
            let c = 48 + pc;
            while (c < minUpper) c += 12;
            while (c > maxUpper) c -= 12;
            return c;
        }).sort((a, b) => a - b);
    }

    return {
        bassMidi,
        upperMidis: bestUpper
    };
}

// Parse time signature into beats per measure
function getBeatsPerMeasure(timeSig) {
    switch (timeSig) {
        case '3/4': return 3;
        case '4/4': return 4;
        case '6/8': return 3; // Represented as 3 dotted-quarter beats (6 eighth subdivisions)
        case '5/4': return 5;
        default: return 4;
    }
}

// Generate a single measure of both Left Hand (Bass Clef) and Right Hand (Treble Clef) events
function generateNextMeasure() {
    const measureIndex = AppState.generatedMeasureCounter++;

    // Handle optional Progressive Modulation along the Circle of Fifths every 8 measures
    // Uses generationRootKey so lookahead buffering never overwrites the playhead's UI key prematurely
    const willModulateNow = (AppState.progressiveModulation && measureIndex > 0 && measureIndex % 8 === 0);
    if (willModulateNow) {
        const idx = CIRCLE_OF_FIFTHS_ORDER.indexOf(AppState.generationRootKey);
        const dir = Math.random() < 0.65 ? 1 : -1;
        const nextIdx = (idx + dir + CIRCLE_OF_FIFTHS_ORDER.length) % CIRCLE_OF_FIFTHS_ORDER.length;
        AppState.generationRootKey = CIRCLE_OF_FIFTHS_ORDER[nextIdx];
    }

    const rootKey = AppState.generationRootKey;
    const mode = AppState.mode;
    const timeSig = AppState.timeSig;
    const isSixEight = (timeSig === '6/8');
    const beatsPerMeasure = getBeatsPerMeasure(timeSig);
    const richness = AppState.harmonicRichness;
    const lhPattern = AppState.leftHandPattern;
    const rhDensity = Number(AppState.rightHandDensity);

    const periodIndex = Math.floor(measureIndex / 8);
    const barInPeriod = measureIndex % 8;
    const isHalfCadenceBar = (barInPeriod === 3);
    const isFullCadenceBar = (barInPeriod === 7);
    const isCadenceBar = isHalfCadenceBar || isFullCadenceBar;

    const pedFlags = computePedagogyFlagsForMeasureIndex(measureIndex);
    const nextPedFlags = computePedagogyFlagsForMeasureIndex(measureIndex + 1);
    const nextWillModulate = (AppState.progressiveModulation && ((measureIndex + 1) % 8 === 0));
    const prevMeas = measureIndex > 0 ? AppState.measures[measureIndex - 1] : null;
    const prevLastRh = (prevMeas && prevMeas.rhEvents && prevMeas.rhEvents.length > 0)
        ? prevMeas.rhEvents[prevMeas.rhEvents.length - 1]
        : null;
    const incomingTieNotes = (
        prevLastRh && prevLastRh.tieToNext && !prevLastRh.isRest && prevLastRh.notes.length > 0 &&
        !pedFlags.isEarTraining && !pedFlags.isImprovisation &&
        !prevMeas.isEarTraining && !prevMeas.isImprovisation && !willModulateNow
    ) ? [...prevLastRh.notes] : null;

    // Prevent ties from blurring major/sub-phrase openings (bars 0, 2, 4 in period)
    const isSubPhraseBoundary = (barInPeriod === 1 || barInPeriod === 3 || barInPeriod === 7);

    const allowOutgoingTie = (
        !isSubPhraseBoundary &&
        !pedFlags.isEarTraining && !pedFlags.isImprovisation &&
        !nextPedFlags.isEarTraining && !nextPedFlags.isImprovisation &&
        !nextWillModulate
    );

    // Select next chord degree from the active 8-bar period arc (call on measure 0 too so periodIdx initializes cleanly)
    const periodDegree = chooseNextChordDegree(AppState.lastChordDegree, AppState.activePreset, mode, measureIndex);
    const nextDegree = measureIndex === 0 ? 0 : periodDegree;
    AppState.lastChordDegree = nextDegree;

    const chord = buildContemplativeChord(rootKey, mode, nextDegree, richness, AppState.activePreset);
    const voicing = buildSmoothLeftHandVoicing(chord, AppState.lastVoicingMidis);
    AppState.lastVoicingMidis = [voicing.bassMidi, ...voicing.upperMidis];

    const lhEvents = [];
    const rhEvents = [];

    // ==================== 1. LEFT HAND (BASS CLEF) GENERATION ====================
    if (isSixEight) {
        // Authentic Compound Duple (6/8 = 2 dotted-quarter beats of 1.5 quarter-beats each)
        const fifthMidi = voicing.bassMidi + 7;
        const octaveMidi = voicing.bassMidi + 12;
        if (lhPattern === 'satie') {
            lhEvents.push({ startBeat: 0, durationBeats: 1.5, notes: [voicing.bassMidi], isRest: false });
            lhEvents.push({ startBeat: 1.5, durationBeats: 1.5, notes: voicing.upperMidis, isRest: false });
        } else if (lhPattern === 'arpeggio_slow') {
            // Flowing Barcarolle compound lilt: quarter + eighth | quarter + eighth
            lhEvents.push({ startBeat: 0, durationBeats: 1, notes: [voicing.bassMidi], isRest: false });
            lhEvents.push({ startBeat: 1, durationBeats: 0.5, notes: [fifthMidi], isRest: false });
            lhEvents.push({ startBeat: 1.5, durationBeats: 1, notes: [octaveMidi], isRest: false });
            lhEvents.push({ startBeat: 2.5, durationBeats: 0.5, notes: [voicing.upperMidis[0]], isRest: false });
        } else if (lhPattern === 'nordic_fifths') {
            lhEvents.push({ startBeat: 0, durationBeats: 1.5, notes: [voicing.bassMidi, fifthMidi], isRest: false });
            lhEvents.push({ startBeat: 1.5, durationBeats: 1.5, notes: [fifthMidi, octaveMidi], isRest: false });
        } else if (lhPattern === 'sustained_voicing') {
            lhEvents.push({ startBeat: 0, durationBeats: 3, notes: [voicing.bassMidi, voicing.upperMidis[0], voicing.upperMidis[1]], isRest: false });
        } else if (lhPattern === 'ostinato_eighths') {
            const top1 = voicing.upperMidis[0];
            const top2 = voicing.upperMidis[1];
            const pattern6 = [voicing.bassMidi, fifthMidi, top1, top2, fifthMidi, top1];
            for (let e = 0; e < 6; e++) {
                lhEvents.push({ startBeat: e * 0.5, durationBeats: 0.5, notes: [pattern6[e]], isRest: false });
            }
        }
    } else if (lhPattern === 'satie') {
        // Beat 0: Low Bass Root, Beat 1 (& 2): Warm middle-register chord voicing
        lhEvents.push({
            startBeat: 0,
            durationBeats: 1,
            notes: [voicing.bassMidi],
            isRest: false
        });
        if (beatsPerMeasure === 3) {
            lhEvents.push({
                startBeat: 1,
                durationBeats: 2,
                notes: voicing.upperMidis,
                isRest: false
            });
        } else {
            lhEvents.push({
                startBeat: 1,
                durationBeats: 2,
                notes: voicing.upperMidis,
                isRest: false
            });
            lhEvents.push({
                startBeat: 3,
                durationBeats: beatsPerMeasure - 3,
                notes: [voicing.upperMidis[0], voicing.upperMidis[2]],
                isRest: false
            });
        }
    } else if (lhPattern === 'arpeggio_slow') {
        // Gentle quarter-note broken arpeggio (1 - 5 - 8 - 10)
        const fifthMidi = voicing.bassMidi + 7;
        const octaveMidi = voicing.bassMidi + 12;
        const tenthMidi = voicing.upperMidis[0] > octaveMidi ? voicing.upperMidis[0] : voicing.upperMidis[0] + 12;
        const arpPool = [voicing.bassMidi, fifthMidi, octaveMidi, tenthMidi, fifthMidi];
        for (let b = 0; b < beatsPerMeasure; b++) {
            lhEvents.push({
                startBeat: b,
                durationBeats: 1,
                notes: [arpPool[b % arpPool.length]],
                isRest: false
            });
        }
    } else if (lhPattern === 'nordic_fifths') {
        // Resonant open fifths and octaves (Skyrim style)
        const fifthMidi = voicing.bassMidi + 7;
        const octaveMidi = voicing.bassMidi + 12;
        if (beatsPerMeasure >= 4) {
            lhEvents.push({
                startBeat: 0,
                durationBeats: 2,
                notes: [voicing.bassMidi, fifthMidi],
                isRest: false
            });
            lhEvents.push({
                startBeat: 2,
                durationBeats: beatsPerMeasure - 2,
                notes: [fifthMidi, octaveMidi],
                isRest: false
            });
        } else {
            lhEvents.push({
                startBeat: 0,
                durationBeats: 2,
                notes: [voicing.bassMidi, fifthMidi, octaveMidi],
                isRest: false
            });
            lhEvents.push({
                startBeat: 2,
                durationBeats: 1,
                notes: [fifthMidi],
                isRest: false
            });
        }
    } else if (lhPattern === 'sustained_voicing') {
        // Sustained close-voiced guide-tone chords
        lhEvents.push({
            startBeat: 0,
            durationBeats: beatsPerMeasure,
            notes: [voicing.bassMidi, voicing.upperMidis[0], voicing.upperMidis[1]],
            isRest: false
        });
    } else if (lhPattern === 'ostinato_eighths') {
        // Continuous eighth-note broken chords (Licorice / Neo-classical style)
        const fifthMidi = voicing.bassMidi + 7;
        const top1 = voicing.upperMidis[0];
        const top2 = voicing.upperMidis[1];
        const pattern = [voicing.bassMidi, fifthMidi, top1, fifthMidi, top2, fifthMidi, top1, fifthMidi];
        const totalEighths = beatsPerMeasure * 2;
        for (let e = 0; e < totalEighths; e++) {
            lhEvents.push({
                startBeat: e * 0.5,
                durationBeats: 0.5,
                notes: [pattern[e % pattern.length]],
                isRest: false
            });
        }
    }

    // ==================== 2. RIGHT HAND (TREBLE CLEF) GENERATION ====================
    const scalePcs = getScalePitchClasses(rootKey, mode);
    const minMidi = AppState.allowLedgerLines ? 60 : 64; // C4 or E4
    const maxMidi = AppState.allowLedgerLines ? 84 : 77; // C6 or F5

    // Build pool of candidate scale MIDI notes in Treble Clef
    const scaleMidis = [];
    for (let m = minMidi; m <= maxMidi; m++) {
        if (scalePcs.includes(midiToPc(m))) {
            scaleMidis.push(m);
        }
    }

    // 8-bar period melodic arch: gently opens -> rises in bar 2 -> relaxes at half-cadence bar 3 -> peaks in bar 5 -> resolves home in bar 7
    const PHRASE_CONTOUR_RATIO = [0.42, 0.50, 0.58, 0.48, 0.62, 0.78, 0.64, 0.36];
    const phraseTargetMidi = scaleMidis[Math.min(scaleMidis.length - 1, Math.max(0, Math.round((scaleMidis.length - 1) * PHRASE_CONTOUR_RATIO[barInPeriod])))];

    const findClosestScaleIdx = (midi) => {
        let bestIdx = 0;
        let bestDiff = Infinity;
        for (let k = 0; k < scaleMidis.length; k++) {
            const d = Math.abs(scaleMidis[k] - midi);
            if (d < bestDiff) { bestDiff = d; bestIdx = k; }
        }
        return bestIdx;
    };

    // Helper to pick next lyrical melody note guided by phrase contour & conjunct motion
    const pickNextMelodyNote = (preferChordTone = false, preferTonicResolution = false) => {
        let maxSemis = 5;
        if (AppState.intervalLeap === 'stepwise') maxSemis = 4;
        if (AppState.intervalLeap === 'moderate') maxSemis = 7;
        if (AppState.intervalLeap === 'wide') maxSemis = 12;

        let candidates = scaleMidis.filter(m => Math.abs(m - AppState.lastMelodyMidi) <= maxSemis);
        if (candidates.length === 0) candidates = scaleMidis;

        if (preferTonicResolution) {
            const tonicPool = candidates.filter(m => midiToPc(m) === chord.rootPc);
            const thirdPool = candidates.filter(m => midiToPc(m) === chord.thirdPc);
            if (tonicPool.length > 0) candidates = tonicPool;
            else if (thirdPool.length > 0) candidates = thirdPool;
        } else if (preferChordTone) {
            const chordCandidates = candidates.filter(m => chord.chordPcs.includes(midiToPc(m)));
            if (chordCandidates.length > 0) candidates = chordCandidates;
        }

        let bestNote = candidates[0];
        let bestScore = -Infinity;
        for (const m of candidates) {
            const stepDist = Math.abs(m - AppState.lastMelodyMidi);
            const contourPull = -Math.abs(m - phraseTargetMidi) * 0.45;
            const conjunctBonus = (stepDist >= 1 && stepDist <= 4) ? 3.2 : 0;
            const repeatPenalty = (m === AppState.lastMelodyMidi) ? -2.6 : 0;
            const score = contourPull + conjunctBonus + repeatPenalty + Math.random() * 2.2;
            if (score > bestScore) {
                bestScore = score;
                bestNote = m;
            }
        }

        AppState.lastMelodyMidi = bestNote;
        return bestNote;
    };

    const buildRhNoteArray = (mainNote) => {
        const notes = [mainNote];
        if (rhDensity === 4 && Math.random() < 0.72) {
            const idxInScale = scaleMidis.indexOf(mainNote);
            const harmonyOffset = Math.random() < 0.7 ? 2 : 5;
            if (idxInScale - harmonyOffset >= 0) {
                notes.unshift(scaleMidis[idxInScale - harmonyOffset]);
            }
        }
        return notes;
    };

    // Attempt transposed call-and-response / sequence replay of Bar 0 motif on Bar 2 and Bar 4
    const ps = AppState.phraseState;
    let usedMotifRecall = false;
    if (
        (barInPeriod === 2 || barInPeriod === 4) &&
        !incomingTieNotes &&
        ps.motifEvents.length > 0 &&
        ps.motifTimeSig === timeSig
    ) {
        const approxAnchorTarget = barInPeriod === 2
            ? (ps.motifAnchorMidi + (Math.random() < 0.75 ? 3 : -2))
            : phraseTargetMidi;
        const chordToneMidis = scaleMidis.filter(m => chord.chordPcs.includes(midiToPc(m)));
        let startNote = scaleMidis[findClosestScaleIdx(approxAnchorTarget)];
        if (chordToneMidis.length > 0) {
            let bestD = Infinity;
            for (const m of chordToneMidis) {
                const d = Math.abs(m - approxAnchorTarget);
                if (d < bestD) { bestD = d; startNote = m; }
            }
        }
        const anchorIdx = findClosestScaleIdx(startNote);
        const lastNoteSlotIdx = ps.motifEvents.reduce((acc, ev, idx) => (ev.isRest ? acc : idx), -1);

        for (let idx = 0; idx < ps.motifEvents.length; idx++) {
            const mEv = ps.motifEvents[idx];
            if (mEv.isRest) {
                rhEvents.push({
                    startBeat: mEv.startBeat,
                    durationBeats: mEv.durationBeats,
                    notes: [],
                    isRest: true
                });
                continue;
            }
            let noteIdx = Math.max(0, Math.min(scaleMidis.length - 1, anchorIdx + mEv.relStep));
            if (idx === lastNoteSlotIdx) {
                // Gently resolve the motif tail onto a tone of the current bar's chord
                const neighborIdxs = [noteIdx, Math.max(0, noteIdx - 1), Math.min(scaleMidis.length - 1, noteIdx + 1)];
                const chordMatch = neighborIdxs.find(k => chord.chordPcs.includes(midiToPc(scaleMidis[k])));
                if (chordMatch !== undefined) noteIdx = chordMatch;
            }
            const noteMidi = scaleMidis[noteIdx];
            AppState.lastMelodyMidi = noteMidi;
            rhEvents.push({
                startBeat: mEv.startBeat,
                durationBeats: mEv.durationBeats,
                notes: mEv.wasChordal ? buildRhNoteArray(noteMidi) : [noteMidi],
                isRest: false
            });
        }
        usedMotifRecall = true;
    }

    if (usedMotifRecall) {
        // Motif sequence cleanly populated rhEvents
    } else if (isSixEight) {
        // Compound 6/8 melody shaped in two 1.5-beat compound pulses
        if ((rhDensity === 1 || isFullCadenceBar) && !incomingTieNotes && Math.random() < (isFullCadenceBar ? 0.65 : 0.45)) {
            const mainNote = pickNextMelodyNote(true, isFullCadenceBar);
            rhEvents.push({
                startBeat: 0,
                durationBeats: 3,
                notes: [mainNote],
                isRest: false,
                tieToNext: allowOutgoingTie && Math.random() < 0.22
            });
        } else {
            for (const cStart of [0, 1.5]) {
                if (cStart === 0 && incomingTieNotes) {
                    rhEvents.push({
                        startBeat: 0,
                        durationBeats: 1.5,
                        notes: incomingTieNotes,
                        isRest: false,
                        isTiedFromPrev: true
                    });
                    AppState.lastMelodyMidi = incomingTieNotes[incomingTieNotes.length - 1];
                    continue;
                }

                // Breathing rest on final pulse of cadence bars or quiet Minecraft measures
                if (cStart === 1.5 && ((isCadenceBar && Math.random() < 0.30) || (!isCadenceBar && Math.random() < (AppState.activePreset === 'minecraft' ? 0.22 : 0.10)))) {
                    rhEvents.push({ startBeat: 1.5, durationBeats: 1.5, notes: [], isRest: true });
                    continue;
                }

                if (!isCadenceBar && rhDensity === 3 && Math.random() < 0.52) {
                    // True 3-eighth compound group
                    for (let k = 0; k < 3; k++) {
                        const n = pickNextMelodyNote(cStart === 0 && k === 0, false);
                        rhEvents.push({
                            startBeat: cStart + k * 0.5,
                            durationBeats: 0.5,
                            notes: [n],
                            isRest: false
                        });
                    }
                } else if (!(isCadenceBar && cStart === 1.5) && rhDensity >= 2 && Math.random() < (rhDensity === 2 ? 0.45 : 0.35)) {
                    // Classic 6/8 quarter + eighth lilt (1.0 + 0.5)
                    const n1 = pickNextMelodyNote(cStart === 0, false);
                    rhEvents.push({
                        startBeat: cStart,
                        durationBeats: 1,
                        notes: buildRhNoteArray(n1),
                        isRest: false
                    });
                    const n2 = pickNextMelodyNote(false, false);
                    rhEvents.push({
                        startBeat: cStart + 1,
                        durationBeats: 0.5,
                        notes: [n2],
                        isRest: false
                    });
                } else {
                    // Dotted quarter resolution (preferred on cadence endings)
                    const mainNote = pickNextMelodyNote(cStart === 0 || isCadenceBar, isFullCadenceBar && cStart === 1.5);
                    rhEvents.push({
                        startBeat: cStart,
                        durationBeats: 1.5,
                        notes: buildRhNoteArray(mainNote),
                        isRest: false,
                        tieToNext: (cStart === 1.5 && allowOutgoingTie && Math.random() < 0.22)
                    });
                }
            }
        }
    } else {
        // Simple / Asymmetric meters (3/4, 4/4, 5/4)
        let beatCursor = 0;
        while (beatCursor < beatsPerMeasure - 0.001) {
            const remaining = beatsPerMeasure - beatCursor;

            // If previous bar tied over the barline into beat 0, preserve exact tied pitch without re-attack
            if (beatCursor === 0 && incomingTieNotes) {
                const tieDur = (rhDensity === 1 && remaining >= 2) ? 2 : 1;
                rhEvents.push({
                    startBeat: 0,
                    durationBeats: tieDur,
                    notes: incomingTieNotes,
                    isRest: false,
                    isTiedFromPrev: true
                });
                AppState.lastMelodyMidi = incomingTieNotes[incomingTieNotes.length - 1];
                beatCursor += tieDur;
                continue;
            }

            // Cadence closing behavior on bar 4 / bar 8: sustain final chord/tonic tone or breathe with a rest
            if (isCadenceBar && remaining <= 2 && beatCursor > 0) {
                if (isFullCadenceBar && remaining === 1 && Math.random() < 0.42) {
                    rhEvents.push({ startBeat: beatCursor, durationBeats: 1, notes: [], isRest: true });
                    beatCursor += 1;
                    continue;
                }
                const cadNote = pickNextMelodyNote(true, isFullCadenceBar);
                rhEvents.push({
                    startBeat: beatCursor,
                    durationBeats: remaining,
                    notes: buildRhNoteArray(cadNote),
                    isRest: false,
                    tieToNext: false
                });
                beatCursor += remaining;
                continue;
            }

            // Intentional breathing rest (more likely at phrase breath or in Minecraft mode)
            if (beatCursor > 0 && remaining >= 1 && Math.random() < (AppState.activePreset === 'minecraft' ? 0.24 : 0.12)) {
                rhEvents.push({
                    startBeat: beatCursor,
                    durationBeats: 1,
                    notes: [],
                    isRest: true
                });
                beatCursor += 1;
                continue;
            }

            let dur = 1;
            if (rhDensity === 1) {
                if (remaining >= 3 && beatsPerMeasure === 3) dur = 3;
                else if (remaining >= 2) dur = 2;
                else dur = 1;
            } else if (rhDensity === 2) {
                if (remaining >= 2 && Math.random() < 0.42) dur = 2;
                else dur = 1;
            } else if (rhDensity === 3) {
                if (remaining >= 1 && Math.random() < 0.48) {
                    const n1 = pickNextMelodyNote(beatCursor === 0, false);
                    rhEvents.push({
                        startBeat: beatCursor,
                        durationBeats: 0.5,
                        notes: [n1],
                        isRest: false
                    });
                    const n2 = pickNextMelodyNote(false, false);
                    rhEvents.push({
                        startBeat: beatCursor + 0.5,
                        durationBeats: 0.5,
                        notes: [n2],
                        isRest: false
                    });
                    beatCursor += 1;
                    continue;
                } else {
                    dur = (remaining >= 2 && Math.random() < 0.25) ? 2 : 1;
                }
            } else if (rhDensity === 4) {
                dur = (remaining >= 2 && Math.random() < 0.45) ? 2 : 1;
            }

            const mainNote = pickNextMelodyNote(beatCursor === 0, isFullCadenceBar && beatCursor + dur >= beatsPerMeasure);
            const notes = buildRhNoteArray(mainNote);

            rhEvents.push({
                startBeat: beatCursor,
                durationBeats: dur,
                notes,
                isRest: false,
                tieToNext: (allowOutgoingTie && dur >= 2 && beatCursor + dur >= beatsPerMeasure && Math.random() < 0.22)
            });

            beatCursor += dur;
        }
    }

    // Capture Bar 0 motif shape (relative diatonic intervals + rhythm) for Bars 2 & 4 call-and-response
    if (barInPeriod === 0 && !incomingTieNotes) {
        const firstPitched = rhEvents.find(e => !e.isRest && e.notes.length > 0);
        if (firstPitched) {
            const firstNoteMidi = firstPitched.notes[firstPitched.notes.length - 1];
            const anchorIdx = findClosestScaleIdx(firstNoteMidi);
            ps.motifAnchorMidi = firstNoteMidi;
            ps.motifTimeSig = timeSig;
            ps.motifEvents = rhEvents.map(ev => {
                if (ev.isRest || ev.notes.length === 0) {
                    return { startBeat: ev.startBeat, durationBeats: ev.durationBeats, isRest: true, relStep: 0, wasChordal: false };
                }
                const leadMidi = ev.notes[ev.notes.length - 1];
                return {
                    startBeat: ev.startBeat,
                    durationBeats: ev.durationBeats,
                    isRest: false,
                    relStep: findClosestScaleIdx(leadMidi) - anchorIdx,
                    wasChordal: ev.notes.length > 1
                };
            });
        }
    }

    // Compute comfortable Treble register guide/chord tones (C4=60 to G5=79) for Guided Improvisation
    const improGuideMidis = [];
    const targetPcs = [chord.rootPc, chord.thirdPc, chord.fifthPc, chord.seventhPc];
    let cursorMidi = 60 + chord.rootPc;
    if (cursorMidi < 62) cursorMidi += 12; // Keep nicely centered on the Treble staff
    for (const pc of targetPcs) {
        let candidate = 60 + pc;
        while (candidate < cursorMidi - 2) candidate += 12;
        while (candidate > 79) candidate -= 12;
        if (!improGuideMidis.includes(candidate)) {
            improGuideMidis.push(candidate);
        }
        cursorMidi = candidate;
    }
    improGuideMidis.sort((a, b) => a - b);

    return {
        index: measureIndex,
        periodIndex,
        barInPeriod,
        rootKey,
        mode,
        timeSig,
        beatsPerMeasure,
        chord,
        lhEvents,
        rhEvents,
        improGuideMidis,
        isEarTraining: pedFlags.isEarTraining,
        earRevealed: false,
        isImprovisation: pedFlags.isImprovisation
    };
}

// Determine if a measure index is an Ear Training or Guided Improvisation measure
function computePedagogyFlagsForMeasureIndex(measureIndex) {
    let isEarTraining = false;
    let isImprovisation = false;
    if (AppState.earTrainingEnabled && AppState.improMeasureEnabled) {
        isEarTraining = (measureIndex % 4 === 1);
        isImprovisation = (measureIndex % 4 === 3);
    } else if (AppState.earTrainingEnabled) {
        isEarTraining = (measureIndex > 0 && measureIndex % 2 === 1);
    } else if (AppState.improMeasureEnabled) {
        isImprovisation = (measureIndex > 0 && measureIndex % 2 === 1);
    }
    return { isEarTraining, isImprovisation };
}

// Update existing buffered measures immediately when user toggles Ear Training or Improvisation
function syncPedagogyFlagsOnMeasures() {
    for (let i = 0; i < AppState.measures.length; i++) {
        const m = AppState.measures[i];
        const flags = computePedagogyFlagsForMeasureIndex(m.index);
        m.isEarTraining = flags.isEarTraining;
        m.isImprovisation = flags.isImprovisation;
        if (!m.isEarTraining) m.earRevealed = false;

        // Ensure ties never cross into/out of mystery or improvisation measures
        if (m.isEarTraining || m.isImprovisation) {
            if (m.rhEvents.length > 0) {
                m.rhEvents[0].isTiedFromPrev = false;
                m.rhEvents[m.rhEvents.length - 1].tieToNext = false;
            }
            if (i > 0 && AppState.measures[i - 1].rhEvents.length > 0) {
                const prevRh = AppState.measures[i - 1].rhEvents;
                prevRh[prevRh.length - 1].tieToNext = false;
            }
        }
    }
    updateHudInfo();
    renderScore();
}

// Populate initial sliding window of measures
function rebuildScoreStream() {
    AppState.measures = [];
    AppState.generatedMeasureCounter = 0;
    AppState.currentMeasureIndex = 0;
    AppState.currentBeatFloat = 0;
    AppState.lastTriggeredSubBeat = -1;
    AppState.lastChordDegree = 0;
    AppState.lastMelodyMidi = 69;
    AppState.lastVoicingMidis = [50, 57, 60, 64];
    AppState.generationRootKey = AppState.rootKey;
    AppState.phraseState.periodIdx = -1;
    AppState.phraseState.motifEvents = [];

    for (let i = 0; i < 16; i++) {
        AppState.measures.push(generateNextMeasure());
    }
    updateHeaderSummary();
    updateHudInfo();
    renderScore();
}

// Ensure infinite lookahead buffer always has at least 10 measures ahead of playhead
function ensureInfiniteBuffer() {
    while (AppState.measures.length < AppState.currentMeasureIndex + 12) {
        AppState.measures.push(generateNextMeasure());
    }
}

// Regenerate upcoming measures seamlessly when a user tweaks any parameter live
function refreshUpcomingMeasuresLive(applyCurrentIfPausedAtStart = true) {
    const canReplaceCurrent = applyCurrentIfPausedAtStart && !AppState.isPlaying && AppState.currentBeatFloat < 0.05;
    const keepUntil = canReplaceCurrent ? AppState.currentMeasureIndex : (AppState.currentMeasureIndex + 1);
    AppState.measures = AppState.measures.slice(0, keepUntil);
    AppState.generatedMeasureCounter = keepUntil;
    AppState.generationRootKey = AppState.rootKey;
    AppState.phraseState.periodIdx = -1;
    AppState.phraseState.motifEvents = [];
    ensureInfiniteBuffer();
    updateHeaderSummary();
    updateHudInfo();
    renderScore();
}
