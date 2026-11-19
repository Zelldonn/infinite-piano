/***********************************************************************
 * 4. PROCEDURAL MUSIC THEORY, 32-BAR FORM & THEME-DNA COMPOSER
 * Supports 6 idiomatic piano worlds (Gymnopédie, Voxel Ambient,
 * Nordique & Brume, Licorice Néo, Hyrule & Fées, Solo Piano),
 * 32-bar A -> A' -> B -> A'' macro-form, slash-chord inversions,
 * borrowed harmonic colors, and melodic suspensions/appoggiaturas.
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

// Normalize a harmonic arc item (number or { deg, inv, borrowed }) into a structured chord spec
function normalizeChordSpec(entry) {
    if (typeof entry === 'number') {
        return { deg: entry, inv: 'root', borrowed: null };
    }
    return {
        deg: entry.deg ?? 0,
        inv: entry.inv || 'root',
        borrowed: entry.borrowed || null
    };
}

// 8-bar Period harmonic templates per theme:
// - antecedent + consequent for Sections A, A', A''
// - bridgeAntecedent + bridgeConsequent for Section B (contrast & lift in 32-bar macro-form)
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
        ],
        bridgeAntecedent: [
            [5, 3, 1, 4],
            [3, 2, 1, 4]
        ],
        bridgeConsequent: [
            [3, { deg: 0, inv: 'first' }, 1, 0],
            [5, 3, 4, 0]
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
        ],
        bridgeAntecedent: [
            [3, 4, 5, 2],
            [5, 3, 1, 4]
        ],
        bridgeConsequent: [
            [3, 1, 4, 0],
            [5, 3, 1, 0]
        ]
    },
    skyrim: {
        antecedent: [
            [0, { deg: 6, inv: 'pedal' }, { deg: 5, inv: 'pedal' }, 4],
            [0, { deg: 3, inv: 'pedal' }, 6, 4],
            [0, 6, 3, 4]
        ],
        consequent: [
            [0, { deg: 6, inv: 'pedal' }, 3, 0],
            [5, 6, 3, 0],
            [0, 3, 4, 0]
        ],
        bridgeAntecedent: [
            [5, 6, 2, 3],
            [2, 6, 5, 4]
        ],
        bridgeConsequent: [
            [5, 6, 4, 0],
            [3, 6, 5, 0]
        ]
    },
    licorice: {
        antecedent: [
            [0, { deg: 4, inv: 'first' }, 5, 3],
            [0, { deg: 4, inv: 'first' }, 5, { deg: 2, inv: 'first' }],
            [5, 3, 0, 4]
        ],
        consequent: [
            [3, { deg: 0, inv: 'first' }, 1, 0],
            [3, { deg: 3, borrowed: 'iv6' }, 4, 0],
            [5, 1, 4, 0]
        ],
        bridgeAntecedent: [
            [5, { deg: 2, inv: 'first' }, 3, { deg: 0, inv: 'first' }],
            [3, 4, 2, 5]
        ],
        bridgeConsequent: [
            [1, { deg: 3, borrowed: 'iv6' }, 4, 0],
            [3, { deg: 0, inv: 'first' }, 4, 0]
        ]
    },
    zelda: {
        antecedent: [
            [0, { deg: 4, inv: 'first' }, 5, 3],
            [3, { deg: 4, inv: 'pedal' }, 2, 5],
            [0, 5, 3, 4]
        ],
        consequent: [
            [3, { deg: 3, borrowed: 'iv6' }, 4, 0],
            [5, 3, { deg: 3, borrowed: 'iv6' }, 0],
            [1, 4, { deg: 3, borrowed: 'iv6' }, 0]
        ],
        bridgeAntecedent: [
            [5, 2, 3, 4],
            [3, 2, 5, 1]
        ],
        bridgeConsequent: [
            [3, { deg: 5, borrowed: 'bVI' }, { deg: 6, borrowed: 'bVII' }, 0],
            [1, { deg: 5, borrowed: 'bVI' }, { deg: 6, borrowed: 'bVII' }, 0]
        ]
    },
    gonzales: {
        antecedent: [
            [0, { deg: 4, inv: 'first', borrowed: 'V7' }, 5, { deg: 4, borrowed: 'V7' }],
            [0, { deg: 2, inv: 'first' }, 3, { deg: 4, borrowed: 'V7' }],
            [0, { deg: 4, inv: 'first', borrowed: 'V7' }, 0, 3]
        ],
        consequent: [
            [3, { deg: 0, inv: 'first' }, { deg: 4, borrowed: 'V7' }, 0],
            [5, 3, { deg: 4, borrowed: 'V7' }, 0],
            [1, { deg: 4, inv: 'first', borrowed: 'V7' }, { deg: 4, borrowed: 'V7' }, 0]
        ],
        bridgeAntecedent: [
            [2, { deg: 6, inv: 'first' }, 5, 2],
            [5, 2, 3, 6]
        ],
        bridgeConsequent: [
            [3, 5, { deg: 4, borrowed: 'V7' }, 0],
            [2, 3, { deg: 4, borrowed: 'V7' }, 0]
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
        ],
        bridgeAntecedent: [
            [5, 3, 1, 4]
        ],
        bridgeConsequent: [
            [3, 1, 4, 0]
        ]
    }
};

// Ensure an 8-bar musical period plan exists within the 32-bar A -> A' -> B -> A'' macro-form
function ensurePeriodPlan(measureNumber, preset) {
    const periodIdx = Math.floor(measureNumber / 8);
    const macroChapterIdx = Math.floor(measureNumber / 32);
    const macroSectionIdx = periodIdx % 4; // 0=A, 1=A', 2=B, 3=A''
    const macroSection = MACRO_SECTION_LABELS[macroSectionIdx];
    const ps = AppState.phraseState;

    if (ps.periodIdx === periodIdx && ps.chordDegrees.length === 8) {
        // Keep chordPlan synchronized if chordDegrees were overridden externally
        if (
            !ps.chordPlan ||
            ps.chordPlan.length !== 8 ||
            ps.chordDegrees.some((d, i) => ps.chordPlan[i].deg !== d)
        ) {
            ps.chordPlan = ps.chordDegrees.map(d => normalizeChordSpec(d));
        }
        ps.macroSection = macroSection;
        return ps;
    }

    const bank = PHRASE_ARC_TEMPLATES[preset] || PHRASE_ARC_TEMPLATES.default;
    const isBridge = (macroSectionIdx === 2);
    const antBank = (isBridge && bank.bridgeAntecedent) ? bank.bridgeAntecedent : bank.antecedent;
    const conBank = (isBridge && bank.bridgeConsequent) ? bank.bridgeConsequent : bank.consequent;

    const prevAntSig = (ps.chordDegrees || []).slice(0, 4).join(',');
    const antPool = antBank.filter(a => {
        if (antBank.length === 1) return true;
        return a.map(x => normalizeChordSpec(x).deg).join(',') !== prevAntSig;
    });
    const ant = antPool[Math.floor(Math.random() * antPool.length)];
    const con = conBank[Math.floor(Math.random() * conBank.length)];
    const plan = [...ant, ...con].map(normalizeChordSpec);

    if (ps.macroChapterIdx !== macroChapterIdx) {
        ps.macroChapterIdx = macroChapterIdx;
        ps.sectionAMotif = [];
    }

    ps.periodIdx = periodIdx;
    ps.macroSection = macroSection;
    ps.chordPlan = plan;
    ps.chordDegrees = plan.map(item => item.deg);
    ps.motifEvents = [];
    ps.pendingResolutionMidi = null;
    return ps;
}

// Phrase-structured harmonic selector: returns { deg, inv, borrowed } for measureNumber
function chooseNextChordSpec(prevDegree, preset, mode, measureNumber) {
    const ps = ensurePeriodPlan(measureNumber, preset);
    return ps.chordPlan[measureNumber % 8];
}

// Backward-compatible wrapper returning numeric scale degree
function chooseNextChordDegree(prevDegree, preset, mode, measureNumber) {
    return chooseNextChordSpec(prevDegree, preset, mode, measureNumber).deg;
}

// Build chord structure (root, bassPc/inversion, 3rd, 5th, 7th, 9th, symbol, Roman numeral, guide tones)
function buildContemplativeChord(rootKey, mode, degree, richness, preset, spec = null) {
    const sigInfo = getModalSignatureInfo(rootKey, mode);
    const scalePcs = getScalePitchClasses(rootKey, mode);
    const tonicPc = scalePcs[0];
    const requestedBorrowed = spec && spec.borrowed ? spec.borrowed : null;
    const requestedInv = spec && spec.inv ? spec.inv : 'root';

    let rootPc = scalePcs[degree % 7];
    let thirdPc = scalePcs[(degree + 2) % 7];
    let fifthPc = scalePcs[(degree + 4) % 7];
    let seventhPc = scalePcs[(degree + 6) % 7];
    let ninthPc = scalePcs[(degree + 1) % 7];

    // Handle modal interchange / borrowed colors (explicit from Theme DNA or probabilistic when richness === 'borrowed')
    let isBorrowedMinorIv = false;
    let isSecondaryDom = false;
    let isHarmonicMinorV7 = false;
    let isBorrowedFlatVI = false;
    let isBorrowedFlatVII = false;

    const allowBorrowedColor = (richness === 'borrowed' || richness === 'extensions');

    if (requestedBorrowed === 'iv6' && mode === 'major' && allowBorrowedColor) {
        rootPc = scalePcs[3];
        thirdPc = (rootPc + 3) % 12;
        fifthPc = (rootPc + 7) % 12;
        seventhPc = (rootPc + 9) % 12; // Major 6th (e.g. D in Fm6 / A in Cm6)
        isBorrowedMinorIv = true;
    } else if (requestedBorrowed === 'bVI' && (mode === 'major' || mode === 'lydian' || mode === 'mixolydian') && allowBorrowedColor) {
        // Heroic Zelda/cinematic flat-VI major7 (e.g. Ebmaj7 in G major)
        rootPc = (tonicPc + 8) % 12;
        thirdPc = (rootPc + 4) % 12;
        fifthPc = (rootPc + 7) % 12;
        seventhPc = (rootPc + 11) % 12;
        ninthPc = (rootPc + 2) % 12;
        isBorrowedFlatVI = true;
    } else if (requestedBorrowed === 'bVII' && (mode === 'major' || mode === 'lydian') && allowBorrowedColor) {
        // Heroic Zelda/cinematic flat-VII major (e.g. Fmaj7 in G major)
        rootPc = (tonicPc + 10) % 12;
        thirdPc = (rootPc + 4) % 12;
        fifthPc = (rootPc + 7) % 12;
        seventhPc = (rootPc + 11) % 12;
        ninthPc = (rootPc + 2) % 12;
        isBorrowedFlatVII = true;
    } else if (requestedBorrowed === 'V7' && (mode === 'aeolian' || mode === 'dorian') && richness !== 'triads') {
        // Authentic harmonic-minor V7 (raised leading tone, signature Chilly Gonzales cadence!)
        rootPc = scalePcs[4];
        thirdPc = (rootPc + 4) % 12;
        fifthPc = (rootPc + 7) % 12;
        seventhPc = (rootPc + 10) % 12;
        isHarmonicMinorV7 = true;
    } else if (richness === 'borrowed' && !requestedBorrowed) {
        if (mode === 'major' && degree === 3 && Math.random() < 0.45) {
            // Borrow minor iv6 (flatten the 3rd of IV and add major 6th = D natural in C major)
            thirdPc = (rootPc + 3) % 12;
            seventhPc = (rootPc + 9) % 12;
            isBorrowedMinorIv = true;
        } else if (degree === 1 && Math.random() < 0.3) {
            // Secondary dominant V7/V (II7)
            thirdPc = (rootPc + 4) % 12;
            seventhPc = (rootPc + 10) % 12;
            isSecondaryDom = true;
        }
    }

    const isBorrowed = isBorrowedMinorIv || isSecondaryDom || isHarmonicMinorV7 || isBorrowedFlatVI || isBorrowedFlatVII;

    // Compute intervals relative to chord root
    const thirdInterval = (thirdPc - rootPc + 12) % 12; // 3 = minor, 4 = major
    const fifthInterval = (fifthPc - rootPc + 12) % 12; // 7 = perfect, 6 = dim
    const seventhInterval = (seventhPc - rootPc + 12) % 12; // 9 = 6th (iv6), 10 = m7, 11 = Maj7

    const isMinor = thirdInterval === 3;
    const isDim = fifthInterval === 6;
    const isMaj7 = seventhInterval === 11;

    // Construct Roman numeral base
    const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
    let romanBase = romanNumerals[degree % 7];
    if (isMinor || isDim) romanBase = romanBase.toLowerCase();
    if (isDim) romanBase += '°';

    const rootUseFlats = (isBorrowedFlatVI || isBorrowedFlatVII || isBorrowedMinorIv) ? true : sigInfo.useFlats;
    const rootName = formatPitchClass(rootPc, rootUseFlats, 'en', sigInfo.flats);
    let suffix = isMinor ? 'm' : (isDim ? 'dim' : '');
    let romanSuffix = '';

    // Determine active chord tones and extensions based on richness
    const chordPcs = [rootPc, thirdPc, fifthPc];
    const guideTonePcs = new Set([thirdPc]);
    const hasSeventh = (richness === 'sevenths' || richness === 'extensions' || richness === 'borrowed');
    let hasNinth = false;

    if (hasSeventh) {
        chordPcs.push(seventhPc);
        guideTonePcs.add(seventhPc);

        if (!isDim && !isBorrowedMinorIv) {
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

    if ((richness === 'extensions' || (richness === 'borrowed' && !isDim)) && !isBorrowedMinorIv && !isSecondaryDom && !isHarmonicMinorV7) {
        // Add lush 9ths, add9, or sus2 for Minecraft / Gymnopédie / Licorice / Zelda
        const ninthInterval = (ninthPc - rootPc + 12) % 12;
        if (ninthInterval === 2) {
            if ((preset === 'minecraft' || preset === 'zelda') && Math.random() < 0.45 && !isMinor) {
                chordPcs.push(ninthPc);
                hasNinth = true;
                suffix = isMaj7 ? 'maj9' : 'add9';
                romanSuffix = isMaj7 ? 'Δ9' : 'add9';
            } else if (Math.random() < 0.65) {
                chordPcs.push(ninthPc);
                hasNinth = true;
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
        romanBase = 'iv';
        romanSuffix = '6 (emp.)';
    } else if (isBorrowedFlatVI) {
        romanBase = '♭VI';
        romanSuffix = hasSeventh ? 'Δ7' : '';
    } else if (isBorrowedFlatVII) {
        romanBase = '♭VII';
        romanSuffix = hasSeventh ? 'Δ7' : '';
    } else if (isHarmonicMinorV7) {
        suffix = '7';
        romanBase = 'V';
        romanSuffix = '7';
    } else if (isSecondaryDom) {
        suffix = '7';
        romanBase = 'V/V';
        romanSuffix = '';
    }

    // Resolve slash-chord bass pitch class for 1st inversions (walking bass) or tonic pedal drones
    let bassPc = rootPc;
    let inversion = 'root';
    let slashSuffix = '';
    let invRomanTag = '';

    if (requestedInv === 'first' && thirdPc !== rootPc) {
        bassPc = thirdPc;
        inversion = 'first';
        const bassName = formatPitchClass(bassPc, rootUseFlats, 'en', sigInfo.flats);
        slashSuffix = `/${bassName}`;
        invRomanTag = hasSeventh ? '⁶₅' : '⁶';
    } else if (requestedInv === 'pedal' && tonicPc !== rootPc) {
        bassPc = tonicPc;
        inversion = 'pedal';
        const pedalName = formatPitchClass(bassPc, sigInfo.useFlats, 'en', sigInfo.flats);
        slashSuffix = `/${pedalName}`;
        invRomanTag = '/I';
    }

    return {
        degree,
        rootPc,
        bassPc,
        inversion,
        thirdPc,
        fifthPc,
        seventhPc: hasSeventh ? seventhPc : null,
        ninthPc: hasNinth ? ninthPc : null,
        hasSeventh,
        hasNinth,
        isBorrowed,
        chordPcs,
        guideTonePcs,
        preferFlats: isBorrowedMinorIv || isBorrowedFlatVI || isBorrowedFlatVII,
        preferSharps: (isSecondaryDom || (isHarmonicMinorV7 && sigInfo.flats === 0)) && sigInfo.flats === 0,
        symbol: `${rootName}${suffix}${slashSuffix}`,
        roman: `${romanBase}${romanSuffix}${invRomanTag}`
    };
}

// Parsimonious voice-leading helper: minimizes semitone movement from prevVoicingMidis across C3–G4
// Honors inverted/pedal chord.bassPc for smooth stepwise basslines and tonic drones
function buildSmoothLeftHandVoicing(chord, prevVoicingMidis) {
    const bassPc = chord.bassPc !== undefined ? chord.bassPc : chord.rootPc;
    const prevBass = (prevVoicingMidis && prevVoicingMidis.length > 0) ? prevVoicingMidis[0] : 43;
    const bassCandidates = [];
    for (const octBase of [36, 48]) {
        const m = octBase + bassPc;
        if (m >= 36 && m <= 52) bassCandidates.push(m);
    }
    if (bassCandidates.length === 0) bassCandidates.push(36 + bassPc);
    bassCandidates.sort((a, b) => Math.abs(a - prevBass) - Math.abs(b - prevBass));
    const bassMidi = bassCandidates[0];

    // Select 3 upper chord-tone pitch classes strictly respecting chord richness (triads vs 7ths vs 9ths)
    // For 1st-inversion chords (3rd in bass), include the chord root clearly in the upper voices
    let targetPcs;
    if (!chord.hasSeventh) {
        targetPcs = chord.inversion === 'first'
            ? [chord.rootPc, chord.fifthPc, chord.thirdPc]
            : [chord.thirdPc, chord.fifthPc, chord.rootPc];
    } else if (chord.inversion === 'first') {
        targetPcs = [
            chord.rootPc,
            chord.seventhPc !== null && chord.seventhPc !== undefined ? chord.seventhPc : chord.fifthPc,
            chord.fifthPc
        ];
    } else {
        targetPcs = [
            chord.thirdPc,
            chord.seventhPc !== null && chord.seventhPc !== undefined ? chord.seventhPc : chord.fifthPc,
            chord.hasNinth && chord.ninthPc !== null && chord.ninthPc !== undefined ? chord.ninthPc : chord.fifthPc
        ];
    }

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

    // Exhaustively score permutations to minimize total semitone movement while keeping 1-hand spans ergonomic
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

        // Enforce playable 1-hand block span (<= 12 semitones / 1 octave) and reject unison overlaps
        if (chosen[0] === chosen[1] || chosen[1] === chosen[2]) continue;
        const span = chosen[2] - chosen[0];
        if (span > 12) continue;

        const motionCost = Math.abs(chosen[0] - prevUpper[0])
            + Math.abs(chosen[1] - prevUpper[1])
            + Math.abs(chosen[2] - prevUpper[2]);
        const spanPenalty = span > 10 ? (span - 10) * 1.5 : 0;
        const centerPenalty = Math.abs(((chosen[0] + chosen[2]) / 2) - 58) * 0.25;
        const totalCost = motionCost + spanPenalty + centerPenalty;
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
        case '6/8': return 3; // Represented as 3 quarter-unit beats (2 compound dotted-quarter pulses)
        case '5/4': return 5;
        default: return 4;
    }
}

// Adapt the active Treble scale pool cleanly during borrowed chords (e.g. harmonic minor B♮ on G7, Ab on Fm6, Eb/F/Bb on bVI/bVII)
function buildChordAdaptedScalePcs(baseScalePcs, chord) {
    if (!chord || !chord.isBorrowed) return baseScalePcs;
    const adapted = [...baseScalePcs];
    for (const cPc of chord.chordPcs) {
        if (adapted.includes(cPc)) continue;
        // Replace whichever scale tone sits 1 semitone away from this borrowed chord tone to avoid harsh minor-2nd clashes
        const clashIdx = adapted.findIndex(s => ((s - cPc + 12) % 12) === 1 || ((cPc - s + 12) % 12) === 1);
        if (clashIdx !== -1) {
            adapted[clashIdx] = cPc;
        } else {
            adapted.push(cPc);
        }
    }
    return [...new Set(adapted)];
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
    const activePreset = AppState.activePreset;
    const dna = getThemeDNA(activePreset);
    const presetDefaults = activePreset ? STYLE_PRESETS[activePreset] : null;
    const rhDensity = Number(AppState.rightHandDensity);

    const periodIndex = Math.floor(measureIndex / 8);
    const barInPeriod = measureIndex % 8;
    const macroSectionIdx = periodIndex % 4; // 0=A, 1=A', 2=B (Bridge), 3=A'' (Return)
    const macroSection = MACRO_SECTION_LABELS[macroSectionIdx];
    const isHalfCadenceBar = (barInPeriod === 3);
    const isFullCadenceBar = (barInPeriod === 7);
    const isCadenceBar = isHalfCadenceBar || isFullCadenceBar;

    // Evolve LH texture gently during Section B (Bridge) when using the preset's default LH pattern
    let lhPattern = AppState.leftHandPattern;
    if (
        macroSectionIdx === 2 &&
        presetDefaults &&
        lhPattern === presetDefaults.leftHandPattern &&
        dna.bridgeLhPattern
    ) {
        lhPattern = dna.bridgeLhPattern;
    }

    const pedFlags = computePedagogyFlagsForMeasureIndex(measureIndex);
    const nextPedFlags = computePedagogyFlagsForMeasureIndex(measureIndex + 1);
    const nextWillModulate = (AppState.progressiveModulation && ((measureIndex + 1) % 8 === 0));
    const prevMeas = measureIndex > 0 ? getMeasureByIndex(measureIndex - 1) : null;
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

    // Select next chord spec from the active 32-bar / 8-bar period arc
    const chordSpec = chooseNextChordSpec(AppState.lastChordDegree, activePreset, mode, measureIndex);
    const nextDegree = measureIndex === 0 ? 0 : chordSpec.deg;
    const effectiveSpec = measureIndex === 0 ? { deg: 0, inv: 'root', borrowed: null } : chordSpec;
    AppState.lastChordDegree = nextDegree;

    const chord = buildContemplativeChord(rootKey, mode, nextDegree, richness, activePreset, effectiveSpec);
    const voicing = buildSmoothLeftHandVoicing(chord, AppState.lastVoicingMidis);
    AppState.lastVoicingMidis = [voicing.bassMidi, ...voicing.upperMidis];

    // Authentic chord-tone companion pitches above bassMidi (respects diminished 5ths & 1st inversions!)
    const fifthInterval = chord.inversion === 'first'
        ? ((chord.rootPc - chord.bassPc + 12) % 12) || 7
        : ((chord.fifthPc - chord.rootPc + 12) % 12);
    const diatonicFifthMidi = voicing.bassMidi + fifthInterval;
    const octaveMidi = voicing.bassMidi + 12;
    const ninthMidi = voicing.bassMidi + 14;
    const tenthMidi = voicing.upperMidis[0] > octaveMidi ? voicing.upperMidis[0] : (voicing.upperMidis[0] + 12);

    const lhEvents = [];
    const rhEvents = [];

    // ==================== 1. LEFT HAND (BASS CLEF) GENERATION ====================
    if (isSixEight) {
        // Authentic Compound Duple (6/8 = 2 dotted-quarter beats of 1.5 quarter-beats each)
        if (lhPattern === 'satie') {
            lhEvents.push({ startBeat: 0, durationBeats: 1.5, notes: [voicing.bassMidi], isRest: false });
            lhEvents.push({ startBeat: 1.5, durationBeats: 1.5, notes: voicing.upperMidis, isRest: false });
        } else if (lhPattern === 'arpeggio_slow') {
            lhEvents.push({ startBeat: 0, durationBeats: 1, notes: [voicing.bassMidi], isRest: false });
            lhEvents.push({ startBeat: 1, durationBeats: 0.5, notes: [diatonicFifthMidi], isRest: false });
            lhEvents.push({ startBeat: 1.5, durationBeats: 1, notes: [octaveMidi], isRest: false });
            lhEvents.push({ startBeat: 2.5, durationBeats: 0.5, notes: [voicing.upperMidis[0]], isRest: false });
        } else if (lhPattern === 'nordic_fifths') {
            lhEvents.push({ startBeat: 0, durationBeats: 1.5, notes: [voicing.bassMidi, diatonicFifthMidi], isRest: false });
            lhEvents.push({ startBeat: 1.5, durationBeats: 1.5, notes: [diatonicFifthMidi, octaveMidi], isRest: false });
        } else if (lhPattern === 'sustained_voicing') {
            lhEvents.push({ startBeat: 0, durationBeats: 3, notes: [voicing.bassMidi, voicing.upperMidis[0], voicing.upperMidis[1]], isRest: false });
        } else if (lhPattern === 'ostinato_eighths') {
            const top1 = voicing.upperMidis[0];
            const top2 = voicing.upperMidis[1];
            const pattern6 = dna.fairyWaveLh
                ? [voicing.bassMidi, diatonicFifthMidi, octaveMidi, top1, octaveMidi, diatonicFifthMidi]
                : (dna.baroqueBassLh
                    ? [voicing.bassMidi, top1, top2, top1, voicing.bassMidi, top2]
                    : [voicing.bassMidi, diatonicFifthMidi, top1, top2, diatonicFifthMidi, top1]);
            for (let e = 0; e < 6; e++) {
                lhEvents.push({ startBeat: e * 0.5, durationBeats: 0.5, notes: [pattern6[e]], isRest: false });
            }
        }
    } else if (lhPattern === 'satie') {
        // Beat 0: Low Bass Root/Inversion, Beat 1 (& 2): Warm middle-register chord voicing
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
        if (dna.openTenthLh && beatsPerMeasure === 4) {
            // Voxel Ambient / C418 signature: wide open 10th spread with warm ringing half-note breath
            const safeTenth = Math.min(64, tenthMidi);
            lhEvents.push({ startBeat: 0, durationBeats: 1, notes: [voicing.bassMidi], isRest: false });
            lhEvents.push({ startBeat: 1, durationBeats: 1, notes: [diatonicFifthMidi], isRest: false });
            lhEvents.push({ startBeat: 2, durationBeats: 2, notes: [safeTenth], isRest: false });
        } else {
            // Gentle quarter-note broken arpeggio (1 - 5 - 8 - 10)
            const arpPool = [voicing.bassMidi, diatonicFifthMidi, octaveMidi, Math.min(66, tenthMidi), diatonicFifthMidi];
            for (let b = 0; b < beatsPerMeasure; b++) {
                lhEvents.push({
                    startBeat: b,
                    durationBeats: 1,
                    notes: [arpPool[b % arpPool.length]],
                    isRest: false
                });
            }
        }
    } else if (lhPattern === 'nordic_fifths') {
        // Resonant open fifths and octaves (Skyrim style, supports tonic pedal drones cleanly)
        if (beatsPerMeasure >= 4) {
            lhEvents.push({
                startBeat: 0,
                durationBeats: 2,
                notes: [voicing.bassMidi, diatonicFifthMidi],
                isRest: false
            });
            lhEvents.push({
                startBeat: 2,
                durationBeats: beatsPerMeasure - 2,
                notes: [diatonicFifthMidi, octaveMidi],
                isRest: false
            });
        } else {
            lhEvents.push({
                startBeat: 0,
                durationBeats: 2,
                notes: [voicing.bassMidi, diatonicFifthMidi, octaveMidi],
                isRest: false
            });
            lhEvents.push({
                startBeat: 2,
                durationBeats: 1,
                notes: [diatonicFifthMidi],
                isRest: false
            });
        }
    } else if (lhPattern === 'sustained_voicing') {
        // Sustained close-voiced guide-tone chords (split 5/4 into authentic tied 3 + 2 notation)
        const sustainedNotes = [voicing.bassMidi, voicing.upperMidis[0], voicing.upperMidis[1]];
        if (beatsPerMeasure === 5) {
            lhEvents.push({
                startBeat: 0,
                durationBeats: 3,
                notes: sustainedNotes,
                isRest: false,
                tieToNext: true
            });
            lhEvents.push({
                startBeat: 3,
                durationBeats: 2,
                notes: [...sustainedNotes],
                isRest: false,
                isTiedFromPrev: true
            });
        } else {
            lhEvents.push({
                startBeat: 0,
                durationBeats: beatsPerMeasure,
                notes: sustainedNotes,
                isRest: false
            });
        }
    } else if (lhPattern === 'ostinato_eighths') {
        const top1 = voicing.upperMidis[0];
        const top2 = voicing.upperMidis[1];
        const top3 = voicing.upperMidis[2];
        let pattern;
        if (dna.fairyWaveLh) {
            // Zelda / Fairy Fountain shimmering ascending-descending broken harp wave
            const wavePeak = chord.hasNinth ? Math.min(67, ninthMidi) : Math.min(67, tenthMidi);
            pattern = [voicing.bassMidi, diatonicFifthMidi, octaveMidi, wavePeak, octaveMidi, diatonicFifthMidi, top1, diatonicFifthMidi];
        } else if (dna.baroqueBassLh) {
            // Chilly Gonzales Solo Piano: intimate crisp neo-baroque Alberti/walking figure
            pattern = [voicing.bassMidi, top1, top2, top1, voicing.bassMidi, top2, top3, top2];
        } else {
            // Licorice / Neo-classical continuous eighth-note broken chords
            pattern = [voicing.bassMidi, diatonicFifthMidi, top1, diatonicFifthMidi, top2, diatonicFifthMidi, top1, diatonicFifthMidi];
        }
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
    const baseScalePcs = getScalePitchClasses(rootKey, mode);
    const scalePcs = buildChordAdaptedScalePcs(baseScalePcs, chord);
    const minMidi = AppState.allowLedgerLines ? 60 : 64; // C4 or E4
    const maxMidi = AppState.allowLedgerLines ? 84 : 77; // C6 or F5

    // Build pool of candidate scale MIDI notes in Treble Clef
    const scaleMidis = [];
    for (let m = minMidi; m <= maxMidi; m++) {
        if (scalePcs.includes(midiToPc(m))) {
            scaleMidis.push(m);
        }
    }

    // 8-bar period melodic arch + 32-bar macro-form lift (A: calm, A': +8%, B: +14% peak, A'': warm settle)
    const PHRASE_CONTOUR_RATIO = [0.42, 0.50, 0.58, 0.48, 0.62, 0.78, 0.64, 0.36];
    const MACRO_CONTOUR_SHIFT = [0.0, 0.08, 0.14, -0.02];
    const targetRatio = Math.max(0.18, Math.min(0.92, PHRASE_CONTOUR_RATIO[barInPeriod] + MACRO_CONTOUR_SHIFT[macroSectionIdx]));
    const phraseTargetMidi = scaleMidis[Math.min(scaleMidis.length - 1, Math.max(0, Math.round((scaleMidis.length - 1) * targetRatio)))];

    const findClosestScaleIdx = (midi) => {
        let bestIdx = 0;
        let bestDiff = Infinity;
        for (let k = 0; k < scaleMidis.length; k++) {
            const d = Math.abs(scaleMidis[k] - midi);
            if (d < bestDiff) { bestDiff = d; bestIdx = k; }
        }
        return bestIdx;
    };

    const ps = AppState.phraseState;

    // Pick next lyrical melody note guided by phrase contour, heroic leaps, and expressive suspensions/appoggiaturas
    const pickNextMelodyNote = (preferChordTone = false, preferTonicResolution = false, allowSuspension = false) => {
        // 1. Honor any pending appoggiatura/suspension resolution first (authentic tension -> release!)
        if (ps.pendingResolutionMidi !== null && !preferTonicResolution) {
            const resIdx = findClosestScaleIdx(ps.pendingResolutionMidi);
            const resMidi = scaleMidis[resIdx];
            ps.pendingResolutionMidi = null;
            AppState.lastMelodyMidi = resMidi;
            return resMidi;
        }
        if (preferTonicResolution) {
            ps.pendingResolutionMidi = null;
        }

        let maxSemis = 5;
        if (AppState.intervalLeap === 'stepwise') maxSemis = 4;
        if (AppState.intervalLeap === 'moderate') maxSemis = 7;
        if (AppState.intervalLeap === 'wide') maxSemis = 12;

        // Theme-authentic heroic upward leap (Skyrim / Zelda folk-heroic arch on phrase openings)
        const triggerHeroicLeap = (
            preferChordTone &&
            !preferTonicResolution &&
            (barInPeriod === 0 || barInPeriod === 4 || barInPeriod === 5) &&
            Math.random() < dna.heroicLeapChance
        );
        if (triggerHeroicLeap) {
            const leapCandidates = scaleMidis.filter(m =>
                m - AppState.lastMelodyMidi >= 5 &&
                m - AppState.lastMelodyMidi <= 9 &&
                chord.chordPcs.includes(midiToPc(m))
            );
            if (leapCandidates.length > 0) {
                const chosenLeap = leapCandidates[Math.floor(Math.random() * leapCandidates.length)];
                AppState.lastMelodyMidi = chosenLeap;
                return chosenLeap;
            }
        }

        // Theme-authentic expressive appoggiatura / suspension (4->3, 9->1, or Lydian #4->5)
        if (allowSuspension && !preferTonicResolution && !isFullCadenceBar && Math.random() < dna.suspensionChance) {
            const suspCandidates = [];
            for (let k = 1; k < scaleMidis.length - 1; k++) {
                const m = scaleMidis[k];
                if (Math.abs(m - AppState.lastMelodyMidi) > maxSemis) continue;
                const pc = midiToPc(m);
                const lowerChordTone = scaleMidis[k - 1];
                const upperChordTone = scaleMidis[k + 1];
                // Non-chord tone sitting 1 scale step above chord 3rd or root -> resolves down!
                if (
                    !chord.chordPcs.includes(pc) &&
                    (midiToPc(lowerChordTone) === chord.thirdPc || midiToPc(lowerChordTone) === chord.rootPc)
                ) {
                    suspCandidates.push({ suspMidi: m, targetMidi: lowerChordTone });
                } else if (
                    mode === 'lydian' &&
                    ((pc - chord.rootPc + 12) % 12) === 6 &&
                    midiToPc(upperChordTone) === chord.fifthPc
                ) {
                    // Lydian #4 resolving gracefully UP to the 5th
                    suspCandidates.push({ suspMidi: m, targetMidi: upperChordTone });
                }
            }
            if (suspCandidates.length > 0) {
                suspCandidates.sort((a, b) => Math.abs(a.suspMidi - phraseTargetMidi) - Math.abs(b.suspMidi - phraseTargetMidi));
                const pick = suspCandidates[0];
                ps.pendingResolutionMidi = pick.targetMidi;
                AppState.lastMelodyMidi = pick.suspMidi;
                return pick.suspMidi;
            }
        }

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
            // Satie / Zelda love luminous guide tones (7th/9th/3rd) on strong beats
            const colorBonus = (preferChordTone && chord.guideTonePcs.has(midiToPc(m))) ? 0.9 : 0;
            const score = contourPull + conjunctBonus + repeatPenalty + colorBonus + Math.random() * 2.1;
            if (score > bestScore) {
                bestScore = score;
                bestNote = m;
            }
        }

        AppState.lastMelodyMidi = bestNote;
        return bestNote;
    };

    const buildRhNoteArray = (mainNote, isStrongBeat = false) => {
        const notes = [mainNote];
        // Section A' gently blossoms with tender 3rd/6th dyads on strong beats even when base density < 4
        const blossomHarmony = (macroSectionIdx === 1 && isStrongBeat && rhDensity >= 2 && Math.random() < 0.34);
        if ((rhDensity === 4 && Math.random() < 0.72) || blossomHarmony) {
            const idxInScale = scaleMidis.indexOf(mainNote);
            const harmonyOffset = Math.random() < 0.7 ? 2 : 5;
            if (idxInScale - harmonyOffset >= 0) {
                notes.unshift(scaleMidis[idxInScale - harmonyOffset]);
            }
        }
        return notes;
    };

    // Helper to replay a captured motif template transposed onto the current harmony
    const populateFromMotifTemplate = (templateEvents, approxAnchorTarget, allowBlossom = false) => {
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
        const lastNoteSlotIdx = templateEvents.reduce((acc, ev, idx) => (ev.isRest ? acc : idx), -1);

        for (let idx = 0; idx < templateEvents.length; idx++) {
            const mEv = templateEvents[idx];
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
            const wantChord = mEv.wasChordal || (allowBlossom && idx === 0);
            rhEvents.push({
                startBeat: mEv.startBeat,
                durationBeats: mEv.durationBeats,
                notes: wantChord ? buildRhNoteArray(noteMidi, idx === 0) : [noteMidi],
                isRest: false
            });
        }
        ps.pendingResolutionMidi = null;
    };

    // 1) Macro-form Section A' (bar 8) and A'' (bar 24) recall Section A's opening motif!
    let usedMotifRecall = false;
    if (
        barInPeriod === 0 &&
        (macroSectionIdx === 1 || macroSectionIdx === 3) &&
        !incomingTieNotes &&
        ps.sectionAMotif.length > 0 &&
        ps.sectionAMotifTimeSig === timeSig
    ) {
        const targetAnchor = macroSectionIdx === 1
            ? Math.min(maxMidi - 2, ps.sectionAAnchorMidi + 4) // A' rises gently
            : ps.sectionAAnchorMidi;                           // A'' returns warmly home
        populateFromMotifTemplate(ps.sectionAMotif, targetAnchor, macroSectionIdx === 1);
        usedMotifRecall = true;
    }

    // 2) Within every 8-bar period, Bars 2 & 4 perform call-and-response / sequence replay of Bar 0's motif
    if (
        !usedMotifRecall &&
        (barInPeriod === 2 || barInPeriod === 4) &&
        !incomingTieNotes &&
        ps.motifEvents.length > 0 &&
        ps.motifTimeSig === timeSig
    ) {
        let approxAnchorTarget = barInPeriod === 2
            ? (ps.motifAnchorMidi + (Math.random() < 0.75 ? 3 : -2))
            : phraseTargetMidi;

        // Crystalline octave-up echo on phrase answers for Voxel Ambient (Minecraft) & Hyrule (Zelda)
        if (
            barInPeriod === 2 &&
            AppState.allowLedgerLines &&
            Math.random() < dna.highEchoChance &&
            ps.motifAnchorMidi + 10 <= maxMidi
        ) {
            approxAnchorTarget = Math.min(maxMidi - 2, ps.motifAnchorMidi + 12);
        }

        populateFromMotifTemplate(ps.motifEvents, approxAnchorTarget, macroSectionIdx === 1);
        usedMotifRecall = true;
    }

    if (usedMotifRecall) {
        // Motif sequence cleanly populated rhEvents
    } else if (isSixEight) {
        // Compound 6/8 melody shaped in two 1.5-beat compound pulses
        if ((rhDensity === 1 || isFullCadenceBar) && !incomingTieNotes && Math.random() < (isFullCadenceBar ? 0.65 : 0.45)) {
            const mainNote = pickNextMelodyNote(true, isFullCadenceBar, false);
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

                // Breathing rest on final pulse of cadence bars or spacious ambient measures
                if (cStart === 1.5 && ((isCadenceBar && Math.random() < 0.30) || (!isCadenceBar && Math.random() < dna.restChance))) {
                    rhEvents.push({ startBeat: 1.5, durationBeats: 1.5, notes: [], isRest: true });
                    continue;
                }

                if (!isCadenceBar && rhDensity === 3 && Math.random() < 0.52) {
                    for (let k = 0; k < 3; k++) {
                        const n = pickNextMelodyNote(cStart === 0 && k === 0, false, k === 0);
                        rhEvents.push({
                            startBeat: cStart + k * 0.5,
                            durationBeats: 0.5,
                            notes: [n],
                            isRest: false
                        });
                    }
                } else if (!(isCadenceBar && cStart === 1.5) && rhDensity >= 2 && Math.random() < (rhDensity === 2 ? 0.45 : 0.35)) {
                    const n1 = pickNextMelodyNote(cStart === 0, false, true);
                    rhEvents.push({
                        startBeat: cStart,
                        durationBeats: 1,
                        notes: buildRhNoteArray(n1, cStart === 0),
                        isRest: false
                    });
                    const n2 = pickNextMelodyNote(false, false, false);
                    rhEvents.push({
                        startBeat: cStart + 1,
                        durationBeats: 0.5,
                        notes: [n2],
                        isRest: false
                    });
                } else {
                    const mainNote = pickNextMelodyNote(cStart === 0 || isCadenceBar, isFullCadenceBar && cStart === 1.5, cStart === 0 && !isCadenceBar);
                    rhEvents.push({
                        startBeat: cStart,
                        durationBeats: 1.5,
                        notes: buildRhNoteArray(mainNote, cStart === 0),
                        isRest: false,
                        tieToNext: (cStart === 1.5 && allowOutgoingTie && Math.random() < 0.22)
                    });
                }
            }
        }
    } else {
        // Simple / Asymmetric meters (3/4, 4/4, 5/4)
        let beatCursor = 0;

        // Satie / Gymnopédie trademark Beat-1 quarter-rest pickup (LH strikes bass alone, RH floats in on Beat 2!)
        if (
            !incomingTieNotes &&
            !isFullCadenceBar &&
            beatsPerMeasure >= 3 &&
            Math.random() < dna.beatOnePickupChance
        ) {
            rhEvents.push({ startBeat: 0, durationBeats: 1, notes: [], isRest: true });
            beatCursor = 1;
        }

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
                const cadNote = pickNextMelodyNote(true, isFullCadenceBar, false);
                rhEvents.push({
                    startBeat: beatCursor,
                    durationBeats: remaining,
                    notes: buildRhNoteArray(cadNote, true),
                    isRest: false,
                    tieToNext: false
                });
                beatCursor += remaining;
                continue;
            }

            // Intentional breathing rest (governed by theme DNA: high in Voxel Ambient, lower in Licorice/Gonzales)
            if (beatCursor > 0 && remaining >= 1 && ps.pendingResolutionMidi === null && Math.random() < dna.restChance) {
                rhEvents.push({
                    startBeat: beatCursor,
                    durationBeats: 1,
                    notes: [],
                    isRest: true
                });
                beatCursor += 1;
                continue;
            }

            // Chilly Gonzales / Zelda signature dotted-quarter + eighth lyrical lilt on beats 0 or 2 in 4/4
            if (
                (activePreset === 'gonzales' || activePreset === 'zelda') &&
                !isCadenceBar &&
                remaining >= 2 &&
                (beatCursor === 0 || beatCursor === 2) &&
                Math.random() < (activePreset === 'gonzales' ? 0.34 : 0.28)
            ) {
                const n1 = pickNextMelodyNote(beatCursor === 0, false, true);
                rhEvents.push({
                    startBeat: beatCursor,
                    durationBeats: 1.5,
                    notes: buildRhNoteArray(n1, beatCursor === 0),
                    isRest: false
                });
                const n2 = pickNextMelodyNote(false, false, false);
                rhEvents.push({
                    startBeat: beatCursor + 1.5,
                    durationBeats: 0.5,
                    notes: [n2],
                    isRest: false
                });
                beatCursor += 2;
                continue;
            }

            let dur = 1;
            if (rhDensity === 1) {
                if (remaining >= 3 && beatsPerMeasure === 3) dur = 3;
                else if (remaining >= 2) dur = 2;
                else dur = 1;
            } else if (rhDensity === 2) {
                if (remaining >= 2 && Math.random() < (activePreset === 'gymnopedie' ? 0.62 : 0.45)) dur = 2;
                else dur = 1;
            } else if (rhDensity === 3) {
                if (remaining >= 1 && Math.random() < 0.48) {
                    const n1 = pickNextMelodyNote(beatCursor === 0, false, true);
                    rhEvents.push({
                        startBeat: beatCursor,
                        durationBeats: 0.5,
                        notes: [n1],
                        isRest: false
                    });
                    const n2 = pickNextMelodyNote(false, false, false);
                    rhEvents.push({
                        startBeat: beatCursor + 0.5,
                        durationBeats: 0.5,
                        notes: [n2],
                        isRest: false
                    });
                    beatCursor += 1;
                    continue;
                } else {
                    dur = (remaining >= 2 && Math.random() < 0.28) ? 2 : 1;
                }
            } else if (rhDensity === 4) {
                dur = (remaining >= 2 && Math.random() < 0.45) ? 2 : 1;
            }

            const canSuspendHere = (beatCursor === 0 || beatCursor === 2) && (beatCursor + dur < beatsPerMeasure);
            const mainNote = pickNextMelodyNote(beatCursor === 0, isFullCadenceBar && beatCursor + dur >= beatsPerMeasure, canSuspendHere);
            const notes = buildRhNoteArray(mainNote, beatCursor === 0);

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
    // Also persist Section A's Bar 0 motif so Sections A' and A'' recall the chapter's main theme!
    if (barInPeriod === 0 && !incomingTieNotes) {
        const firstPitched = rhEvents.find(e => !e.isRest && e.notes.length > 0);
        if (firstPitched) {
            const firstNoteMidi = firstPitched.notes[firstPitched.notes.length - 1];
            const anchorIdx = findClosestScaleIdx(firstNoteMidi);
            const captured = rhEvents.map(ev => {
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
            ps.motifAnchorMidi = firstNoteMidi;
            ps.motifTimeSig = timeSig;
            ps.motifEvents = captured;

            if (macroSectionIdx === 0) {
                ps.sectionAMotif = captured.map(item => ({ ...item }));
                ps.sectionAMotifTimeSig = timeSig;
                ps.sectionAAnchorMidi = firstNoteMidi;
            }
        }
    }

    // Compute comfortable Treble register guide/chord tones (C4=60 to G5=79) for Guided Improvisation
    const improGuideMidis = [];
    const targetPcs = chord.hasSeventh && chord.seventhPc !== null
        ? [chord.rootPc, chord.thirdPc, chord.fifthPc, chord.seventhPc]
        : [chord.rootPc, chord.thirdPc, chord.fifthPc];
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
        macroSection,
        preset: activePreset,
        rootKey,
        mode,
        timeSig,
        beatsPerMeasure,
        chord,
        voicingMidis: [voicing.bassMidi, ...voicing.upperMidis],
        lhEvents,
        rhEvents,
        improGuideMidis,
        isEarTraining: pedFlags.isEarTraining,
        earRevealed: false,
        isImprovisation: pedFlags.isImprovisation
    };
}

// Resolve a measure by its global 0-based index while supporting rolling window pruning
function getMeasureByIndex(globalIndex) {
    const localIdx = globalIndex - AppState.measureWindowOffset;
    if (localIdx < 0 || localIdx >= AppState.measures.length) return null;
    return AppState.measures[localIdx];
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
    AppState.measureWindowOffset = 0;
    AppState.generatedMeasureCounter = 0;
    AppState.currentMeasureIndex = 0;
    AppState.currentBeatFloat = 0;
    AppState.lastTriggeredSubBeat = -1;
    AppState.lastChordDegree = 0;
    AppState.lastMelodyMidi = 69;
    AppState.lastVoicingMidis = [50, 57, 60, 64];
    AppState.generationRootKey = AppState.rootKey;
    AppState.phraseState.periodIdx = -1;
    AppState.phraseState.macroChapterIdx = -1;
    AppState.phraseState.macroSection = 'A';
    AppState.phraseState.chordPlan = [];
    AppState.phraseState.motifEvents = [];
    AppState.phraseState.sectionAMotif = [];
    AppState.phraseState.pendingResolutionMidi = null;

    for (let i = 0; i < 16; i++) {
        AppState.measures.push(generateNextMeasure());
    }
    if (typeof resyncAudioScheduler === 'function') {
        resyncAudioScheduler();
    }
    updateHeaderSummary();
    updateHudInfo();
    renderScore();
}

// Ensure infinite lookahead buffer always has >=12 measures ahead while pruning old measures to bound RAM & Page canvas height
function ensureInfiniteBuffer() {
    while (AppState.measureWindowOffset + AppState.measures.length < AppState.currentMeasureIndex + 12) {
        AppState.measures.push(generateNextMeasure());
    }
    // Prune in multiples of 24 (LCM of 2/3/4 measures-per-row and 8-bar periods) to keep Page rows & phrases aligned
    const behindCount = AppState.currentMeasureIndex - AppState.measureWindowOffset;
    if (behindCount >= 48) {
        const pruneCount = Math.floor((behindCount - 24) / 24) * 24;
        if (pruneCount > 0) {
            AppState.measures.splice(0, pruneCount);
            AppState.measureWindowOffset += pruneCount;
        }
    }
}

// Regenerate upcoming measures seamlessly when a user tweaks any parameter live
function refreshUpcomingMeasuresLive(applyCurrentIfPausedAtStart = true) {
    const canReplaceCurrent = applyCurrentIfPausedAtStart && !AppState.isPlaying && AppState.currentBeatFloat < 0.05;
    const keepGlobalUntil = canReplaceCurrent ? AppState.currentMeasureIndex : (AppState.currentMeasureIndex + 1);
    const keepLocalCount = Math.max(0, keepGlobalUntil - AppState.measureWindowOffset);
    AppState.measures = AppState.measures.slice(0, keepLocalCount);
    AppState.generatedMeasureCounter = AppState.measureWindowOffset + AppState.measures.length;
    AppState.generationRootKey = AppState.rootKey;

    // Restore voice-leading memory from the last kept measure so newly generated measures connect smoothly
    const lastKept = AppState.measures.length > 0 ? AppState.measures[AppState.measures.length - 1] : null;
    if (lastKept) {
        AppState.lastChordDegree = lastKept.chord ? lastKept.chord.degree : 0;
        if (lastKept.voicingMidis && lastKept.voicingMidis.length >= 4) {
            AppState.lastVoicingMidis = [...lastKept.voicingMidis];
        }
        const lastPitchedRh = [...(lastKept.rhEvents || [])].reverse().find(e => !e.isRest && e.notes && e.notes.length > 0);
        if (lastPitchedRh) {
            AppState.lastMelodyMidi = lastPitchedRh.notes[lastPitchedRh.notes.length - 1];
        }
    } else {
        AppState.lastChordDegree = 0;
        AppState.lastMelodyMidi = 69;
        AppState.lastVoicingMidis = [50, 57, 60, 64];
    }

    AppState.phraseState.periodIdx = -1;
    AppState.phraseState.chordPlan = [];
    AppState.phraseState.motifEvents = [];
    AppState.phraseState.pendingResolutionMidi = null;
    ensureInfiniteBuffer();
    if (typeof resyncAudioScheduler === 'function') {
        resyncAudioScheduler();
    }
    updateHeaderSummary();
    updateHudInfo();
    renderScore();
}
