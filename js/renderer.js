/***********************************************************************
 * 5. HIGH-DPI GRAND STAFF NOTATION RENDERER (CANVAS)
 * Optimized for both Desktop and Small Smartphone Horizontal Mode
 ***********************************************************************/
const scoreCanvas = document.getElementById('scoreCanvas');
const scoreCtx = scoreCanvas.getContext('2d');
let cachedCanvasPixelW = 0;
let cachedCanvasPixelH = 0;

// Only resize the GPU backing store when canvas pixel dimensions actually change
function syncCanvasBackingSize(cssW, cssH, dpr) {
    const safeW = Math.max(1, Math.round(cssW));
    const safeH = Math.max(1, Math.round(cssH));
    const pxW = Math.max(1, Math.round(safeW * dpr));
    const pxH = Math.max(1, Math.round(safeH * dpr));
    if (pxW !== cachedCanvasPixelW || pxH !== cachedCanvasPixelH) {
        scoreCanvas.width = pxW;
        scoreCanvas.height = pxH;
        scoreCanvas.style.height = `${safeH}px`;
        cachedCanvasPixelW = pxW;
        cachedCanvasPixelH = pxH;
    }
    scoreCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scoreCtx.clearRect(0, 0, safeW, safeH);
}

// Map a MIDI note to its diatonic step relative to Middle C (C4 = step 0) and accidental
// Supports full modal key signatures (0..7 sharps/flats) & per-measure accidental memory
function midiToStaffStepAndAccidental(midi, rootKey, mode = 'major', measureStepAccMap = null, chordBias = null) {
    const sigInfo = getModalSignatureInfo(rootKey, mode);
    const octave = Math.floor(midi / 12) - 1; // C4 = 60 -> octave 4
    const pc = midiToPc(midi);

    // Sharp vs Flat spelling maps: [diatonicLetterIndex (0..6), accidental ('', '♯', '♭')]
    const sharpMap = [
        [0, ''],  [0, '♯'], [1, ''],  [1, '♯'], [2, ''],  [3, ''],
        [3, '♯'], [4, ''],  [4, '♯'], [5, ''],  [5, '♯'], [6, '']
    ];
    const flatMap = [
        [0, ''],  [1, '♭'], [1, ''],  [2, '♭'], [2, ''],  [3, ''],
        [4, '♭'], [4, ''],  [5, '♭'], [5, ''],  [6, '♭'], [6, '']
    ];

    const sharpOrderLetters = [3, 0, 4, 1, 5, 2, 6]; // F, C, G, D, A, E, B
    const flatOrderLetters  = [6, 2, 5, 1, 4, 0, 3]; // B, E, A, D, G, C, F
    const sharpPcOrder      = [6, 1, 8, 3, 10, 5, 0];
    const flatPcOrder       = [10, 3, 8, 1, 6, 11, 4];

    let letterIdx;
    let rawAcc;
    let effectiveOctave = octave;

    if (sigInfo.flats >= 6 && pc === 11) {
        letterIdx = 0; // Cb in 6-7 flat keys
        rawAcc = '♭';
        effectiveOctave = Math.floor((midi + 1) / 12) - 1;
    } else if (sigInfo.flats >= 7 && pc === 4) {
        letterIdx = 3; // Fb in 7 flat keys
        rawAcc = '♭';
    } else {
        let useFlats = sigInfo.useFlats;
        const inKeySharp = sigInfo.sharps > 0 && sharpPcOrder.slice(0, sigInfo.sharps).includes(pc);
        const inKeyFlat = sigInfo.flats > 0 && flatPcOrder.slice(0, sigInfo.flats).includes(pc);
        if (!inKeySharp && !inKeyFlat && chordBias) {
            if (chordBias.preferFlats) useFlats = true;
            else if (chordBias.preferSharps) useFlats = false;
        }
        [letterIdx, rawAcc] = useFlats ? flatMap[pc] : sharpMap[pc];
    }

    const diatonicStepFromC4 = (effectiveOctave - 4) * 7 + letterIdx;

    let keyImpliedAcc = '';
    if (sigInfo.sharps > 0 && sharpOrderLetters.slice(0, sigInfo.sharps).includes(letterIdx)) {
        keyImpliedAcc = '♯';
    } else if (sigInfo.flats > 0 && flatOrderLetters.slice(0, sigInfo.flats).includes(letterIdx)) {
        keyImpliedAcc = '♭';
    }

    const activeBaselineAcc = (measureStepAccMap && measureStepAccMap.has(diatonicStepFromC4))
        ? measureStepAccMap.get(diatonicStepFromC4)
        : keyImpliedAcc;

    let displayAccidental = '';
    if (rawAcc !== activeBaselineAcc) {
        displayAccidental = rawAcc === '' ? '♮' : rawAcc;
    }
    if (measureStepAccMap) {
        measureStepAccMap.set(diatonicStepFromC4, rawAcc);
    }

    return {
        step: diatonicStepFromC4,
        accidental: displayAccidental,
        pc
    };
}

// Convert diatonic step from C4 to vertical Y coordinate on Treble or Bass staff
function stepToStaffY(stepFromC4, isTreble, staffTopY, lineGap) {
    const halfGap = lineGap / 2;
    if (isTreble) {
        // Top line of Treble Staff is F5 = step +10 from C4
        const stepsBelowF5 = 10 - stepFromC4;
        return staffTopY + stepsBelowF5 * halfGap;
    } else {
        // Top line of Bass Staff is A3 = step -2 from C4
        const stepsBelowA3 = -2 - stepFromC4;
        return staffTopY + stepsBelowA3 * halfGap;
    }
}

// Store hit-boxes of rendered beats so clicking/tapping on the score jumps/auditions that beat
let renderedBeatHitboxes = [];

function renderScore() {
    const container = document.getElementById('scoreViewportContainer');
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;

    const isDark = AppState.sheetTheme === 'dark';
    container.style.backgroundColor = isDark ? '#171513' : '#f7f3e8';

    // Urtext / Henle classical engraving palette
    const palette = isDark ? {
        bg: '#171513',
        staffLine: '#5e554b',
        ink: '#efe7db',
        mutedInk: '#a19485',
        chordText: '#f5b051',
        romanText: '#b8aa99',
        guideTone: '#f59e0b',
        rhHighlight: '#38bdf8',
        lhHighlight: '#34d399',
        cursorFill: 'rgba(245, 158, 11, 0.11)',
        cursorStroke: 'rgba(245, 158, 11, 0.65)'
    } : {
        bg: '#f7f3e8',
        staffLine: '#847766',
        ink: '#181512',
        mutedInk: '#635648',
        chordText: '#8c460c',
        romanText: '#5e5143',
        guideTone: '#b45309',
        rhHighlight: '#0369a1',
        lhHighlight: '#047857',
        cursorFill: 'rgba(180, 83, 9, 0.09)',
        cursorStroke: 'rgba(180, 83, 9, 0.55)'
    };

    renderedBeatHitboxes = [];

    if (AppState.viewLayout === 'ribbon') {
        // Single-system horizontal infinite ribbon
        const height = container.clientHeight;
        syncCanvasBackingSize(width, height, dpr);
        renderHorizontalRibbon(scoreCtx, width, height, palette);
    } else {
        // Multi-system page view (responsive for smartphone landscape and desktop, with generous vertical spacing)
        const isCompact = container.clientHeight < 420 || width < 760;
        const measuresPerRow = width < 680 ? 2 : (width < 1100 ? 3 : 4);
        const totalRows = Math.ceil(AppState.measures.length / measuresPerRow);
        const rowHeight = isCompact ? 225 : 285;
        const totalHeight = Math.max(container.clientHeight, totalRows * rowHeight + 70);

        syncCanvasBackingSize(width, totalHeight, dpr);
        renderPageSystems(scoreCtx, width, totalHeight, measuresPerRow, rowHeight, palette, isCompact);
    }
}

// Helper to draw crisp legible text with a subtle paper halo so lines never strike through characters
function drawHaloText(ctx, text, x, y, fillColor, haloColor, haloWidth = 3.0) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = haloColor;
    ctx.lineWidth = haloWidth;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
    ctx.restore();
}

// Steinberg Bravura SMuFL (Standard Music Font Layout) codepoints (1 em = 4 * lineGap)
const SMUFL = {
    gClef: '\uE050',              // Anchored on G4 line (trebleTopY + lineGap * 3)
    fClef: '\uE062',              // Anchored on F3 line (bassTopY + lineGap * 1)
    noteheadWhole: '\uE0A2',      // Ronde (4 beats)
    noteheadHalf: '\uE0A3',       // Blanche (2-3 beats)
    noteheadBlack: '\uE0A4',      // Noire / Croche (<= 1.5 beats)
    noteheadDiamondHalf: '\uE0DB',// Hollow diamond notehead for Guided Improvisation
    flag8thUp: '\uE240',          // Eighth-note flag up (anchored at stem top)
    flag8thDown: '\uE241',        // Eighth-note flag down (anchored at stem bottom)
    accidentalFlat: '\uE260',     // Flat (♭) vertically centered at y
    accidentalNatural: '\uE261',  // Natural (♮) vertically centered at y
    accidentalSharp: '\uE262',    // Sharp (♯) vertically centered at y
    restHalf: '\uE4E4',           // Half rest sitting on middle staff line
    restQuarter: '\uE4E5',        // Quarter rest (Soupir) centered on middle staff line
    rest8th: '\uE4E6',            // Eighth rest (Demi-soupir) centered on middle staff line
    timeSigDigit: (d) => String.fromCodePoint(0xE080 + (Number(d) || 0)),
    timeSigString: (str) => String(str).split('').map((ch) => {
        const n = Number(ch);
        return Number.isInteger(n) && ch >= '0' && ch <= '9'
            ? String.fromCodePoint(0xE080 + n)
            : ch;
    }).join(''),
    accidentalFromSymbol: (sym) => {
        if (sym === '♯' || sym === '#') return '\uE262';
        if (sym === '♭' || sym === 'b') return '\uE260';
        if (sym === '♮') return '\uE261';
        return sym;
    }
};

function isBravuraLoaded() {
    return Boolean(document.fonts && document.fonts.check && document.fonts.check('36px Bravura'));
}

// Draw authentic Engraved Grand Staff Brace (Accolade), Treble Clef, Bass Clef, Key Signature, and Time Signature
const KEY_SIG_STEPS = {
    trebleSharp: [10, 7, 11, 8, 5, 9, 6],     // F#, C#, G#, D#, A#, E#, B#
    bassSharp:   [-4, -7, -3, -6, -9, -5, -8],
    trebleFlat:  [6, 9, 5, 8, 4, 7, 3],       // Bb, Eb, Ab, Db, Gb, Cb, Fb
    bassFlat:    [-8, -5, -9, -6, -10, -7, -11]
};

function getKeySignatureAdvance(sigInfo, isCompact = false) {
    const count = Math.max(sigInfo?.sharps || 0, sigInfo?.flats || 0);
    if (count === 0) return 0;
    const stepX = count >= 5 ? (isCompact ? 7.8 : 9.4) : (isCompact ? 9.5 : 11.2);
    return count * stepX;
}

function drawKeySignatureGlyphs(ctx, startX, trebleTopY, bassTopY, lineGap, sigInfo, palette, isCompact = false) {
    const sharps = sigInfo?.sharps || 0;
    const flats = sigInfo?.flats || 0;
    const count = Math.max(sharps, flats);
    if (count === 0) return startX;

    const useBravura = isBravuraLoaded();
    const smuflFont = `${Math.round(lineGap * 4)}px "Bravura", serif`;
    const accStepX = count >= 5 ? (isCompact ? 7.8 : 9.4) : (isCompact ? 9.5 : 11.2);
    let cursorX = startX;

    const isSharp = sharps > 0;
    const tSteps = isSharp ? KEY_SIG_STEPS.trebleSharp : KEY_SIG_STEPS.trebleFlat;
    const bSteps = isSharp ? KEY_SIG_STEPS.bassSharp : KEY_SIG_STEPS.bassFlat;
    const smuflGlyph = isSharp ? SMUFL.accidentalSharp : SMUFL.accidentalFlat;
    const fallbackGlyph = isSharp ? '♯' : '♭';
    const fallbackOffset = isSharp ? 0.55 : 0.52;

    for (let i = 0; i < count && i < 7; i++) {
        const ty = stepToStaffY(tSteps[i], true, trebleTopY, lineGap);
        const by = stepToStaffY(bSteps[i], false, bassTopY, lineGap);
        if (useBravura) {
            ctx.font = smuflFont;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            drawHaloText(ctx, smuflGlyph, cursorX, ty, palette.ink, palette.bg, 2.0);
            drawHaloText(ctx, smuflGlyph, cursorX, by, palette.ink, palette.bg, 2.0);
        } else {
            ctx.font = `600 ${Math.round(lineGap * 1.85)}px "Cormorant Garamond", Georgia, serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            drawHaloText(ctx, fallbackGlyph, cursorX, ty + lineGap * fallbackOffset, palette.ink, palette.bg, 2.2);
            drawHaloText(ctx, fallbackGlyph, cursorX, by + lineGap * fallbackOffset, palette.ink, palette.bg, 2.2);
        }
        cursorX += accStepX;
    }
    return cursorX;
}

function drawSystemHeader(ctx, x, trebleTopY, bassTopY, lineGap, rootKey, mode, timeSig, palette, isCompact = false) {
    const staffHeight = lineGap * 4;
    const bottomY = bassTopY + staffHeight;
    const totalGrandHeight = bottomY - trebleTopY;
    const useBravura = isBravuraLoaded();
    const smuflFont = `${(lineGap * 4).toFixed(1)}px Bravura, serif`;

    ctx.save();
    ctx.strokeStyle = palette.ink;
    ctx.fillStyle = palette.ink;

    // 1. Engraved System Barline
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, trebleTopY);
    ctx.lineTo(x, bottomY);
    ctx.stroke();

    // 2. Filled Calligraphic Grand Staff Accolade (Brace)
    const bx = x - (isCompact ? 4 : 5);
    const midY = trebleTopY + totalGrandHeight * 0.5;
    const wCurve = isCompact ? 5.5 : 7.5;
    ctx.beginPath();
    ctx.moveTo(bx + 1, trebleTopY);
    ctx.bezierCurveTo(
        bx - wCurve, trebleTopY + totalGrandHeight * 0.11,
        bx + 1.5, midY - totalGrandHeight * 0.09,
        bx - wCurve * 0.95, midY
    );
    ctx.bezierCurveTo(
        bx + 1.5, midY + totalGrandHeight * 0.09,
        bx - wCurve, bottomY - totalGrandHeight * 0.11,
        bx + 1, bottomY
    );
    ctx.bezierCurveTo(
        bx - wCurve * 0.45, bottomY - totalGrandHeight * 0.13,
        bx + 3.2, midY + totalGrandHeight * 0.07,
        bx - wCurve * 0.35, midY
    );
    ctx.bezierCurveTo(
        bx + 3.2, midY - totalGrandHeight * 0.07,
        bx - wCurve * 0.45, trebleTopY + totalGrandHeight * 0.13,
        bx + 1, trebleTopY
    );
    ctx.closePath();
    ctx.fill();

    // 3. Treble Clef (gClef \uE050) & Bass Clef (fClef \uE062) using Bravura SMuFL font
    if (useBravura) {
        ctx.font = smuflFont;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(SMUFL.gClef, x + (isCompact ? 5 : 7), trebleTopY + lineGap * 3);
        ctx.fillText(SMUFL.fClef, x + (isCompact ? 5 : 7), bassTopY + lineGap * 1);
    } else {
        ctx.font = `${Math.round(lineGap * 4.85)}px "Cormorant Garamond", Georgia, serif`;
        ctx.fillText('𝄞', x + (isCompact ? 5 : 8), trebleTopY + lineGap * 3.58);
        ctx.font = `${Math.round(lineGap * 3.75)}px "Cormorant Garamond", Georgia, serif`;
        ctx.fillText('𝄢', x + (isCompact ? 6 : 9), bassTopY + lineGap * 2.98);
    }

    // 4. Key Signature accidentals using true modal key signature (up to 7 sharps/flats)
    let cursorX = x + (isCompact ? 36 : 45);
    const sigInfo = getModalSignatureInfo(rootKey, mode || 'major');
    cursorX = drawKeySignatureGlyphs(ctx, cursorX, trebleTopY, bassTopY, lineGap, sigInfo, palette, isCompact);

    // 5. Engraved Time Signature numerals (SMuFL \uE080-\uE089)
    cursorX += isCompact ? 8 : 11;
    const [num, den] = timeSig.split('/');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (useBravura) {
        ctx.font = smuflFont;
        const numGlyph = SMUFL.timeSigString(num);
        const denGlyph = SMUFL.timeSigString(den);
        drawHaloText(ctx, numGlyph, cursorX + 7, trebleTopY + lineGap * 1, palette.ink, palette.bg, 2.2);
        drawHaloText(ctx, denGlyph, cursorX + 7, trebleTopY + lineGap * 3, palette.ink, palette.bg, 2.2);
        drawHaloText(ctx, numGlyph, cursorX + 7, bassTopY + lineGap * 1, palette.ink, palette.bg, 2.2);
        drawHaloText(ctx, denGlyph, cursorX + 7, bassTopY + lineGap * 3, palette.ink, palette.bg, 2.2);
    } else {
        ctx.font = `700 ${Math.round(lineGap * 2.38)}px "Cormorant Garamond", Georgia, serif`;
        drawHaloText(ctx, num, cursorX + 7, trebleTopY + lineGap * 1.88, palette.ink, palette.bg, 2.5);
        drawHaloText(ctx, den, cursorX + 7, trebleTopY + lineGap * 3.88, palette.ink, palette.bg, 2.5);
        drawHaloText(ctx, num, cursorX + 7, bassTopY + lineGap * 1.88, palette.ink, palette.bg, 2.5);
        drawHaloText(ctx, den, cursorX + 7, bassTopY + lineGap * 3.88, palette.ink, palette.bg, 2.5);
    }

    ctx.restore();
    return cursorX + (isCompact ? 22 : 28);
}

// Draw the 5 horizontal staff lines for Treble and Bass with crisp Urtext hairline weight
function drawGrandStaffLines(ctx, startX, endX, trebleTopY, bassTopY, lineGap, palette) {
    ctx.save();
    ctx.strokeStyle = palette.staffLine;
    ctx.lineWidth = 0.95;

    for (let i = 0; i < 5; i++) {
        const ty = Math.round(trebleTopY + i * lineGap) + 0.5;
        const by = Math.round(bassTopY + i * lineGap) + 0.5;

        ctx.beginPath();
        ctx.moveTo(startX, ty);
        ctx.lineTo(endX, ty);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(startX, by);
        ctx.lineTo(endX, by);
        ctx.stroke();
    }
    ctx.restore();
}

// Render Horizontal Infinite Ribbon mode (Adaptive for Smartphone Landscape & Desktop with anti-overlap spacing)
function renderHorizontalRibbon(ctx, width, height, palette) {
    const isCompactHeight = height < 390;
    const isSmallWidth = width < 780;
    const isCompact = isCompactHeight || isSmallWidth;

    // Reserve space for floating HUD at top and Roman numerals at bottom
    const topReserve = isCompactHeight ? 48 : 68;
    const bottomReserve = isCompactHeight ? 32 : 52;
    const availHeight = Math.max(120, height - topReserve - bottomReserve);

    // Generous middle separation between Treble and Bass so stems, ledger lines, and labels never collide
    const bassOffsetGaps = isCompactHeight ? 9.4 : 10.6;
    const totalGaps = bassOffsetGaps + 4;
    const maxGap = isCompactHeight ? 10.8 : 12.8;
    const lineGap = Math.max(7.2, Math.min(maxGap, availHeight / (totalGaps + 2.2)));

    const grandStaffHeight = lineGap * totalGaps;
    const trebleTopY = Math.round(topReserve + (availHeight - grandStaffHeight) * 0.52);
    const bassTopY = Math.round(trebleTopY + lineGap * bassOffsetGaps);

    const leftMargin = isCompact ? 14 : 28;
    const rightMargin = isCompact ? 8 : 16;
    const currentMeas = AppState.measures[AppState.currentMeasureIndex] || AppState.measures[0];
    if (!currentMeas) return;

    // Draw full-width staff lines
    drawGrandStaffLines(ctx, leftMargin, width - rightMargin, trebleTopY, bassTopY, lineGap, palette);

    // Draw fixed system header on the left
    const headerEndX = drawSystemHeader(
        ctx,
        leftMargin,
        trebleTopY,
        bassTopY,
        lineGap,
        currentMeas.rootKey,
        currentMeas.mode,
        currentMeas.timeSig,
        palette,
        isCompact
    );

    // Playhead fixed anchor X in Continuous mode, or sliding in Measure mode
    const playheadAnchorX = headerEndX + (isCompact ? 46 : 86);
    const remainingW = Math.max(220, width - headerEndX - rightMargin);
    const measureWidth = isCompact
        ? Math.max(205, Math.min(280, remainingW * 0.46))
        : Math.max(275, Math.min(380, width * 0.35));

    // Clip measure scrolling region to the right of the header
    ctx.save();
    ctx.beginPath();
    ctx.rect(headerEndX, 0, width - headerEndX - rightMargin, height);
    ctx.clip();

    // Calculate smooth horizontal scroll offset
    const scrollFraction = AppState.scrollMode === 'measure'
        ? 0
        : (AppState.currentBeatFloat / currentMeas.beatsPerMeasure);
    const globalScrollX = (AppState.currentMeasureIndex + scrollFraction) * measureWidth;

    // Render visible window of measures
    const startMeasIdx = Math.max(0, AppState.currentMeasureIndex - 1);
    const endMeasIdx = Math.min(AppState.measures.length - 1, AppState.currentMeasureIndex + 6);

    for (let mIdx = startMeasIdx; mIdx <= endMeasIdx; mIdx++) {
        const measure = AppState.measures[mIdx];
        const measX = playheadAnchorX + (mIdx * measureWidth) - globalScrollX;

        // Draw playhead highlight inside active measure
        if (mIdx === AppState.currentMeasureIndex) {
            const beatOffset = (AppState.currentBeatFloat / measure.beatsPerMeasure) * measureWidth;
            const cursorX = AppState.scrollMode === 'measure' ? (measX + beatOffset) : playheadAnchorX;
            const cursorPadY = isCompactHeight ? 20 : 30;

            ctx.save();
            ctx.fillStyle = palette.cursorFill;
            ctx.strokeStyle = palette.cursorStroke;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.roundRect(
                cursorX - (isCompact ? 10 : 13),
                trebleTopY - cursorPadY,
                isCompact ? 20 : 26,
                (bassTopY + lineGap * 4) - trebleTopY + cursorPadY * 2,
                6
            );
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(cursorX, trebleTopY - cursorPadY);
            ctx.lineTo(cursorX, bassTopY + lineGap * 4 + cursorPadY);
            ctx.stroke();
            ctx.restore();
        }

        drawSingleMeasure(ctx, measure, measX, measureWidth, trebleTopY, bassTopY, lineGap, palette, isCompact);
    }

    ctx.restore();
}

// Render Multi-Line Page View mode with generous vertical separation so systems never collide
function renderPageSystems(ctx, width, totalHeight, measuresPerRow, rowHeight, palette, isCompact = false) {
    const lineGap = isCompact ? 8.4 : 10.0;
    const leftMargin = isCompact ? 16 : 32;
    const rightMargin = isCompact ? 12 : 28;
    const totalRows = Math.ceil(AppState.measures.length / measuresPerRow);

    for (let row = 0; row < totalRows; row++) {
        const rowTop = (isCompact ? 48 : 56) + row * rowHeight;
        const trebleTopY = rowTop + (isCompact ? 32 : 42);
        const bassTopY = Math.round(trebleTopY + lineGap * (isCompact ? 9.2 : 10.2));

        const firstMeas = AppState.measures[row * measuresPerRow];
        if (!firstMeas) break;

        drawGrandStaffLines(ctx, leftMargin, width - rightMargin, trebleTopY, bassTopY, lineGap, palette);
        const headerEndX = drawSystemHeader(
            ctx,
            leftMargin,
            trebleTopY,
            bassTopY,
            lineGap,
            firstMeas.rootKey,
            firstMeas.mode,
            firstMeas.timeSig,
            palette,
            isCompact
        );

        const availableWidth = (width - rightMargin) - headerEndX;
        const measureWidth = availableWidth / measuresPerRow;

        for (let col = 0; col < measuresPerRow; col++) {
            const mIdx = row * measuresPerRow + col;
            const measure = AppState.measures[mIdx];
            if (!measure) break;

            const measX = headerEndX + col * measureWidth;

            // Draw active playhead cursor on the current measure
            if (mIdx === AppState.currentMeasureIndex) {
                const paddingX = isCompact ? 20 : 28;
                const innerW = measureWidth - paddingX * 2;
                const cursorX = measX + paddingX + (AppState.currentBeatFloat / measure.beatsPerMeasure) * innerW;

                ctx.save();
                ctx.fillStyle = palette.cursorFill;
                ctx.strokeStyle = palette.cursorStroke;
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.roundRect(cursorX - 11, trebleTopY - 22, 22, (bassTopY + lineGap * 4) - trebleTopY + 44, 5);
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(cursorX, trebleTopY - 22);
                ctx.lineTo(cursorX, bassTopY + lineGap * 4 + 22);
                ctx.stroke();
                ctx.restore();
            }

            drawSingleMeasure(ctx, measure, measX, measureWidth, trebleTopY, bassTopY, lineGap, palette, isCompact, col === 0);
        }
    }
}

function getKeyChangeWidth(prevSigInfo, sigInfo, isCompact = false) {
    if (!prevSigInfo || !sigInfo || prevSigInfo.fifths === sigInfo.fifths) return 0;
    const targetSig = (sigInfo.sharps === 0 && sigInfo.flats === 0) ? prevSigInfo : sigInfo;
    return Math.ceil(getKeySignatureAdvance(targetSig, isCompact) + (isCompact ? 10 : 14));
}

function drawKeyChangeAtBarline(ctx, measX, trebleTopY, bassTopY, lineGap, prevSigInfo, sigInfo, palette, isCompact = false) {
    const staffHeight = lineGap * 4;
    // Draw engraved double thin barline before key change
    ctx.save();
    ctx.strokeStyle = palette.staffLine;
    ctx.lineWidth = 1.15;
    for (const dx of [0, 3.5]) {
        ctx.beginPath();
        ctx.moveTo(measX + dx, trebleTopY);
        ctx.lineTo(measX + dx, bassTopY + staffHeight);
        ctx.stroke();
    }

    const startX = measX + (isCompact ? 11 : 14);
    if (sigInfo.sharps === 0 && sigInfo.flats === 0 && (prevSigInfo.sharps > 0 || prevSigInfo.flats > 0)) {
        // Cancel previous accidentals with naturals
        const count = Math.max(prevSigInfo.sharps, prevSigInfo.flats);
        const tSteps = prevSigInfo.sharps > 0 ? KEY_SIG_STEPS.trebleSharp : KEY_SIG_STEPS.trebleFlat;
        const bSteps = prevSigInfo.sharps > 0 ? KEY_SIG_STEPS.bassSharp : KEY_SIG_STEPS.bassFlat;
        const useBravura = isBravuraLoaded();
        const smuflFont = `${Math.round(lineGap * 4)}px "Bravura", serif`;
        const stepX = count >= 5 ? (isCompact ? 7.8 : 9.4) : (isCompact ? 9.5 : 11.2);
        let cx = startX;
        for (let i = 0; i < count && i < 7; i++) {
            const ty = stepToStaffY(tSteps[i], true, trebleTopY, lineGap);
            const by = stepToStaffY(bSteps[i], false, bassTopY, lineGap);
            if (useBravura) {
                ctx.font = smuflFont;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                drawHaloText(ctx, SMUFL.accidentalNatural, cx, ty, palette.ink, palette.bg, 2.0);
                drawHaloText(ctx, SMUFL.accidentalNatural, cx, by, palette.ink, palette.bg, 2.0);
            } else {
                ctx.font = `600 ${Math.round(lineGap * 1.85)}px "Cormorant Garamond", Georgia, serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                drawHaloText(ctx, '♮', cx, ty + lineGap * 0.54, palette.ink, palette.bg, 2.2);
                drawHaloText(ctx, '♮', cx, by + lineGap * 0.54, palette.ink, palette.bg, 2.2);
            }
            cx += stepX;
        }
    } else {
        drawKeySignatureGlyphs(ctx, startX, trebleTopY, bassTopY, lineGap, sigInfo, palette, isCompact);
    }
    ctx.restore();
}

// Draw all musical contents of a single measure with strict anti-overlap layout
function drawSingleMeasure(ctx, measure, measX, measWidth, trebleTopY, bassTopY, lineGap, palette, isCompact = false, suppressModKeySig = false) {
    const staffHeight = lineGap * 4;
    const midGrandY = (trebleTopY + staffHeight + bassTopY) / 2;

    // Detect mid-stream key modulation from previous measure
    const measArrIdx = AppState.measures.indexOf(measure);
    const prevMeas = measArrIdx > 0 ? AppState.measures[measArrIdx - 1] : null;
    const sigInfo = getModalSignatureInfo(measure.rootKey, measure.mode);
    const prevSigInfo = prevMeas ? getModalSignatureInfo(prevMeas.rootKey, prevMeas.mode) : null;
    const showModKeyChange = !suppressModKeySig && prevSigInfo && prevSigInfo.fifths !== sigInfo.fifths;
    const keyChangeExtraW = showModKeyChange ? getKeyChangeWidth(prevSigInfo, sigInfo, isCompact) : 0;

    if (showModKeyChange) {
        drawKeyChangeAtBarline(ctx, measX, trebleTopY, bassTopY, lineGap, prevSigInfo, sigInfo, palette, isCompact);
    }

    // Check if Beat 0 has any accidentals on Treble or Bass so we give extra left margin after the barline
    let beatZeroHasAccidental = false;
    const checkEventsZero = [...(measure.rhEvents || []), ...(measure.lhEvents || [])];
    for (const ev of checkEventsZero) {
        if (!ev.isRest && ev.startBeat === 0 && ev.notes) {
            for (const m of ev.notes) {
                if (midiToStaffStepAndAccidental(m, measure.rootKey, measure.mode, null, measure.chord).accidental) {
                    beatZeroHasAccidental = true;
                    break;
                }
            }
        }
    }

    const basePadLeft = Math.max(isCompact ? 26 : 34, Math.round(lineGap * 2.9));
    const padLeft = basePadLeft + keyChangeExtraW + (beatZeroHasAccidental ? Math.round(lineGap * 1.15) : 0);
    const padRight = Math.max(isCompact ? 16 : 22, Math.round(lineGap * 1.8));
    const usableWidth = Math.max(72, measWidth - padLeft - padRight);

    // Auto-reveal past Ear Training measures once playhead moves to a subsequent measure
    if (measure.isEarTraining && measure.index < AppState.currentMeasureIndex) {
        measure.earRevealed = true;
    }

    // Register beat hitboxes for mouse/touch interaction
    for (let b = 0; b < measure.beatsPerMeasure; b += 0.5) {
        const bx = measX + padLeft + (b / measure.beatsPerMeasure) * usableWidth;
        renderedBeatHitboxes.push({
            measureIndex: measure.index,
            beat: b,
            x1: bx - 18,
            x2: bx + 18,
            y1: trebleTopY - 36,
            y2: bassTopY + staffHeight + 36
        });
    }

    // Compute highest Treble Y and lowest Bass Y in this measure so Chord Symbols & Roman Numerals never touch notes/stems
    let highestTrebleY = trebleTopY;
    const rhPool = measure.isImprovisation
        ? (measure.improGuideMidis || []).map(m => ({ notes: [m], isRest: false }))
        : (measure.rhEvents || []);
    for (const ev of rhPool) {
        if (!ev.isRest && ev.notes) {
            for (const midi of ev.notes) {
                const info = midiToStaffStepAndAccidental(midi, measure.rootKey, measure.mode, null, measure.chord);
                const ny = stepToStaffY(info.step, true, trebleTopY, lineGap);
                // Account for upward stem or note name above the staff
                const topExtent = ny < trebleTopY + lineGap * 2 ? (ny - lineGap * 1.6) : (ny - lineGap * 3.1);
                if (topExtent < highestTrebleY) highestTrebleY = topExtent;
            }
        }
    }

    let lowestBassY = bassTopY + staffHeight;
    for (const ev of (measure.lhEvents || [])) {
        if (!ev.isRest && ev.notes) {
            for (const midi of ev.notes) {
                const info = midiToStaffStepAndAccidental(midi, measure.rootKey, measure.mode, null, measure.chord);
                const ny = stepToStaffY(info.step, false, bassTopY, lineGap);
                const botExtent = ny > bassTopY + lineGap * 2 ? (ny + lineGap * 1.8) : (ny + lineGap * 3.1);
                if (botExtent > lowestBassY) lowestBassY = botExtent;
            }
        }
    }

    // Safe Y coordinates for Header (above Treble) and Footer (below Bass)
    const headerBaselineY = Math.min(
        trebleTopY - (isCompact ? 16 : 22),
        highestTrebleY - (AppState.noteNameMode !== 'none' ? lineGap * 1.3 : lineGap * 0.6)
    );
    const footerBaselineY = Math.max(
        bassTopY + staffHeight + (isCompact ? 20 : 26),
        lowestBassY + (AppState.noteNameMode !== 'none' ? lineGap * 1.4 : lineGap * 0.7)
    );

    // 1. Measure Number, Chord Symbol & Pedagogical Banner (Horizontally sequenced so they NEVER overlap)
    ctx.save();
    ctx.font = `500 ${isCompact ? 9 : 10}px "JetBrains Mono", monospace`;
    drawHaloText(ctx, `${measure.index + 1}`, measX + 5, trebleTopY - (isCompact ? 6 : 8), palette.mutedInk, palette.bg, 2.5);

    let headerCursorX = measX + padLeft - 4;
    if (AppState.showChords) {
        ctx.font = `600 ${isCompact ? 14 : 16}px "Cormorant Garamond", Georgia, serif`;
        drawHaloText(ctx, measure.chord.symbol, headerCursorX, headerBaselineY, palette.chordText, palette.bg, 3.0);
        headerCursorX += ctx.measureText(measure.chord.symbol).width + (isCompact ? 10 : 14);
    }

    // 0. Pedagogical Background Tints & Banners (Improvisation / Ear Training / Look-Ahead)
    if (measure.isImprovisation) {
        ctx.save();
        ctx.fillStyle = AppState.sheetTheme === 'dark' ? 'rgba(245, 158, 11, 0.09)' : 'rgba(217, 119, 6, 0.06)';
        ctx.strokeStyle = AppState.sheetTheme === 'dark' ? 'rgba(245, 158, 11, 0.40)' : 'rgba(180, 83, 9, 0.30)';
        ctx.lineWidth = 1.1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.roundRect(measX + 3, trebleTopY - lineGap * 1.1, measWidth - 6, staffHeight + lineGap * 2.2, 6);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = `600 ${isCompact ? 9 : 10}px "Inter", sans-serif`;
        const improLabel = isCompact ? '✨ IMPRO (◆)' : '✨ IMPROVISATION (◆)';
        drawHaloText(ctx, improLabel, headerCursorX, headerBaselineY, palette.guideTone, palette.bg, 2.5);
        ctx.restore();
    } else if (measure.isEarTraining) {
        ctx.save();
        const isRev = measure.earRevealed;
        ctx.fillStyle = isRev
            ? (AppState.sheetTheme === 'dark' ? 'rgba(16, 185, 129, 0.07)' : 'rgba(5, 150, 105, 0.05)')
            : (AppState.sheetTheme === 'dark' ? 'rgba(139, 92, 246, 0.09)' : 'rgba(124, 58, 237, 0.06)');
        ctx.strokeStyle = isRev
            ? (AppState.sheetTheme === 'dark' ? 'rgba(52, 211, 153, 0.38)' : 'rgba(5, 150, 105, 0.32)')
            : (AppState.sheetTheme === 'dark' ? 'rgba(167, 139, 250, 0.42)' : 'rgba(124, 58, 237, 0.32)');
        ctx.lineWidth = 1.1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.roundRect(measX + 3, trebleTopY - lineGap * 1.1, measWidth - 6, staffHeight + lineGap * 2.2, 6);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = `600 ${isCompact ? 9 : 10}px "Inter", sans-serif`;
        const earColor = isRev
            ? (AppState.sheetTheme === 'dark' ? '#34d399' : '#047857')
            : (AppState.sheetTheme === 'dark' ? '#c4b5fd' : '#6d28d9');
        const earLabel = isRev
            ? '👂 RÉVÉLÉ ✓'
            : (isCompact ? '👂 À L\'OREILLE' : '👂 À L\'OREILLE (1re note → écoutez)');
        drawHaloText(ctx, earLabel, headerCursorX, headerBaselineY, earColor, palette.bg, 2.5);
        ctx.restore();
    }

    // Look-Ahead Target Indicator ("Regard en avance")
    if (AppState.lookAheadMode === 'measure' && measure.index === AppState.currentMeasureIndex + 1) {
        ctx.font = `600 ${isCompact ? 9 : 10}px "Inter", sans-serif`;
        const lookColor = AppState.sheetTheme === 'dark' ? '#38bdf8' : '#0284c7';
        drawHaloText(ctx, '👁️ CIBLE DU REGARD →', headerCursorX, headerBaselineY - (measure.isImprovisation || measure.isEarTraining ? 12 : 0), lookColor, palette.bg, 2.5);
    } else if (AppState.lookAheadMode === 'beat' && measure.index === AppState.currentMeasureIndex) {
        const targetBeat = Math.min(measure.beatsPerMeasure - 0.3, AppState.currentBeatFloat + 1.0);
        const eyeX = measX + padLeft + (targetBeat / measure.beatsPerMeasure) * usableWidth;
        ctx.font = `600 ${isCompact ? 9 : 10}px "JetBrains Mono", monospace`;
        const lookColor = AppState.sheetTheme === 'dark' ? '#38bdf8' : '#0284c7';
        drawHaloText(ctx, '👁️+1t', Math.max(headerCursorX, eyeX - 12), headerBaselineY, lookColor, palette.bg, 2.5);
    }

    // 2. Roman Numeral analysis below Bass Staff (dynamically cleared below all bass notes/stems/labels)
    if (AppState.showRoman) {
        ctx.font = `italic 600 ${isCompact ? 12 : 14}px "Cormorant Garamond", Georgia, serif`;
        drawHaloText(ctx, measure.chord.roman, measX + padLeft - 2, footerBaselineY, palette.romanText, palette.bg, 3.0);
    }
    ctx.restore();

    // 3. Draw Right Hand (Treble) Events — or Guided Improvisation Diamond Targets
    const measureBounds = { measX, measWidth };
    if (measure.isImprovisation) {
        drawImprovisationGuideMeasure(ctx, measure, measX + padLeft, usableWidth, trebleTopY, lineGap, palette);
    } else {
        drawStaffEvents(ctx, measure.rhEvents, measure, true, measX + padLeft, usableWidth, trebleTopY, midGrandY, lineGap, palette, measureBounds);
    }

    // 4. Draw Left Hand (Bass) Events
    drawStaffEvents(ctx, measure.lhEvents, measure, false, measX + padLeft, usableWidth, bassTopY, midGrandY, lineGap, palette, measureBounds);

    // 5. If Look-Ahead Measure Masking is active on current measure, draw subtle veil reminder in the middle gap
    if (AppState.lookAheadMode === 'measure' && measure.index === AppState.currentMeasureIndex && (AppState.isPlaying || AppState.currentBeatFloat > 0.05)) {
        ctx.save();
        ctx.font = `600 ${isCompact ? 9 : 10}px "Inter", sans-serif`;
        const veilColor = AppState.sheetTheme === 'dark' ? 'rgba(56, 189, 248, 0.85)' : 'rgba(2, 132, 199, 0.85)';
        drawHaloText(ctx, '👁️ Mesure masquée — Lisez la suivante →', measX + padLeft, midGrandY + 3, veilColor, palette.bg, 3.0);
        ctx.restore();
    }

    // 6. Measure ending barline (double thin barline on 8-bar period cadence boundary)
    ctx.save();
    ctx.strokeStyle = palette.staffLine;
    ctx.lineWidth = 1.25;
    if (measure.barInPeriod === 7) {
        for (const dx of [-3.5, 0]) {
            ctx.beginPath();
            ctx.moveTo(measX + measWidth + dx, trebleTopY);
            ctx.lineTo(measX + measWidth + dx, bassTopY + staffHeight);
            ctx.stroke();
        }
    } else {
        ctx.beginPath();
        ctx.moveTo(measX + measWidth, trebleTopY);
        ctx.lineTo(measX + measWidth, bassTopY + staffHeight);
        ctx.stroke();
    }
    ctx.restore();
}

// Draw diamond-shaped chord/guide-tone cues in Treble Staff for Guided Improvisation measures
function drawImprovisationGuideMeasure(ctx, measure, startX, usableWidth, staffTopY, lineGap, palette) {
    const sigInfo = getModalSignatureInfo(measure.rootKey, measure.mode);
    const guideMidis = measure.improGuideMidis || [62, 65, 69, 72];
    const count = guideMidis.length;
    const useBravura = isBravuraLoaded();
    const smuflFont = `${(lineGap * 4).toFixed(1)}px Bravura, serif`;

    // Check if Look-Ahead masking should fade this measure
    const isMeasureMasked = (
        AppState.lookAheadMode === 'measure' &&
        measure.index === AppState.currentMeasureIndex &&
        (AppState.isPlaying || AppState.currentBeatFloat > 0.05)
    );

    ctx.save();
    if (isMeasureMasked) ctx.globalAlpha = 0.10;

    for (let idx = 0; idx < count; idx++) {
        const midi = guideMidis[idx];
        const beatPos = (idx / count) * measure.beatsPerMeasure;
        const x = startX + ((idx + 0.38) / count) * usableWidth;

        const isBeatMasked = (
            AppState.lookAheadMode === 'beat' &&
            measure.index === AppState.currentMeasureIndex &&
            beatPos <= AppState.currentBeatFloat + 0.15
        );

        ctx.save();
        if (isBeatMasked) ctx.globalAlpha = 0.10;

        const info = midiToStaffStepAndAccidental(midi, measure.rootKey, measure.mode, null, measure.chord);
        const y = stepToStaffY(info.step, true, staffTopY, lineGap);
        const isGuide = measure.chord.guideTonePcs.has(info.pc);

        // Draw ledger lines if needed
        drawLedgerLines(ctx, x, [{ midi, ...info, y, noteX: x }], true, staffTopY, lineGap, palette);

        const dx = lineGap * 0.65;
        const dy = lineGap * 0.50;
        const color = isGuide ? palette.guideTone : palette.rhHighlight;

        // Draw SMuFL hollow diamond notehead (\uE0DB) when Bravura is loaded, with fallback vector diamond
        if (useBravura) {
            ctx.font = smuflFont;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = color;
            ctx.fillText(SMUFL.noteheadDiamondHalf, x, y);
        } else {
            ctx.fillStyle = AppState.sheetTheme === 'dark' ? 'rgba(245, 158, 11, 0.22)' : 'rgba(217, 119, 6, 0.15)';
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.9;
            ctx.beginPath();
            ctx.moveTo(x, y - dy);
            ctx.lineTo(x + dx, y);
            ctx.lineTo(x, y + dy);
            ctx.lineTo(x - dx, y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        // Accidental if any
        if (info.accidental) {
            if (useBravura) {
                ctx.font = smuflFont;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                drawHaloText(ctx, SMUFL.accidentalFromSymbol(info.accidental), x - dx - lineGap * 0.72, y, color, palette.bg, 2.2);
            } else {
                ctx.font = `600 ${Math.round(lineGap * 1.75)}px "Cormorant Garamond", Georgia, serif`;
                drawHaloText(ctx, info.accidental, x - dx - lineGap * 0.95, y + lineGap * 0.48, color, palette.bg, 2.5);
            }
        }

        // Always show note name + role (★ for Guide Tone) cleanly above the diamond with paper halo
        const noteName = formatPitchClass(info.pc, sigInfo.useFlats, AppState.noteNameMode === 'en' ? 'en' : 'fr', sigInfo.flats);
        const roleTag = isGuide ? '★' : '';
        ctx.font = `italic 600 ${Math.max(10, Math.round(lineGap * 1.05))}px "Cormorant Garamond", Georgia, serif`;
        ctx.textAlign = 'left';
        drawHaloText(ctx, `${noteName}${roleTag}`, x - 7, y - dy - lineGap * 0.55, color, palette.bg, 2.8);

        ctx.restore();
    }

    ctx.restore();
}

// Draw an authentic Steinberg Bravura SMuFL notehead (\uE0A2 Whole, \uE0A3 Half, \uE0A4 Quarter/Eighth)
function drawEngravedNotehead(ctx, x, y, rx, ry, durationBeats, fillColor, lineGap) {
    ctx.save();
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = fillColor;

    if (isBravuraLoaded() && lineGap) {
        ctx.font = `${(lineGap * 4).toFixed(1)}px Bravura, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const glyph = durationBeats >= 4
            ? SMUFL.noteheadWhole
            : (durationBeats >= 2 ? SMUFL.noteheadHalf : SMUFL.noteheadBlack);
        ctx.fillText(glyph, x, y);
        ctx.restore();
        return;
    }

    if (durationBeats >= 4) {
        const wrx = rx * 1.18;
        const wry = ry * 1.04;
        ctx.beginPath();
        ctx.ellipse(x, y, wrx, wry, 0, 0, Math.PI * 2);
        ctx.ellipse(x, y, wrx * 0.52, wry * 0.68, -0.52, 0, Math.PI * 2);
        ctx.fill('evenodd');
    } else if (durationBeats >= 2) {
        const hrx = rx * 1.03;
        const hry = ry * 1.02;
        ctx.beginPath();
        ctx.ellipse(x, y, hrx, hry, -0.32, 0, Math.PI * 2);
        ctx.ellipse(x, y, hrx * 0.78, hry * 0.48, -0.58, 0, Math.PI * 2);
        ctx.fill('evenodd');
    } else {
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, -0.33, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// Draw an authentic Steinberg Bravura SMuFL eighth-note flag (\uE240 flag8thUp, \uE241 flag8thDown)
function drawEngravedFlag(ctx, stemX, stemEndY, stemUp, lineGap, color) {
    ctx.save();
    ctx.fillStyle = color;

    if (isBravuraLoaded()) {
        ctx.font = `${(lineGap * 4).toFixed(1)}px Bravura, serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(stemUp ? SMUFL.flag8thUp : SMUFL.flag8thDown, stemX - 0.6, stemEndY);
        ctx.restore();
        return;
    }

    const flagLen = lineGap * 2.15;
    const flagWidth = lineGap * 0.85;
    const thick = lineGap * 0.44;

    ctx.beginPath();
    if (stemUp) {
        ctx.moveTo(stemX, stemEndY);
        ctx.bezierCurveTo(
            stemX + flagWidth * 0.4, stemEndY + flagLen * 0.25,
            stemX + flagWidth * 1.18, stemEndY + flagLen * 0.55,
            stemX + flagWidth * 0.55, stemEndY + flagLen
        );
        ctx.bezierCurveTo(
            stemX + flagWidth * 0.92, stemEndY + flagLen * 0.58,
            stemX + flagWidth * 0.25, stemEndY + flagLen * 0.35,
            stemX, stemEndY + thick
        );
    } else {
        ctx.moveTo(stemX, stemEndY);
        ctx.bezierCurveTo(
            stemX + flagWidth * 0.4, stemEndY - flagLen * 0.25,
            stemX + flagWidth * 1.18, stemEndY - flagLen * 0.55,
            stemX + flagWidth * 0.55, stemEndY - flagLen
        );
        ctx.bezierCurveTo(
            stemX + flagWidth * 0.92, stemEndY - flagLen * 0.58,
            stemX + flagWidth * 0.25, stemEndY - flagLen * 0.35,
            stemX, stemEndY - thick
        );
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// Draw an authentic crescent-shaped engraved tie/slur (Liaison) tapering at both ends
function drawEngravedTie(ctx, startX, endX, y, curveUp, lineGap, color) {
    ctx.save();
    ctx.fillStyle = color;
    const span = Math.max(18, endX - startX);
    const midX = (startX + endX) / 2;
    const dir = curveUp ? -1 : 1;
    const archHeight = Math.min(lineGap * 1.30, Math.max(lineGap * 0.72, span * 0.17)) * dir;
    const thickness = Math.max(1.8, lineGap * 0.22) * dir;

    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.quadraticCurveTo(midX, y + archHeight, endX, y);
    ctx.quadraticCurveTo(midX, y + archHeight - thickness, startX, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// Draw events (notes, rests, stems, beams, ledger lines, guide tones, note names, and Ear/Look-Ahead masks) for one staff
function drawStaffEvents(ctx, events, measure, isTreble, startX, usableWidth, staffTopY, midGrandY, lineGap, palette, measureBounds = null) {
    const sigInfo = getModalSignatureInfo(measure.rootKey, measure.mode);
    const useBravura = isBravuraLoaded();
    const smuflFont = `${(lineGap * 4).toFixed(1)}px Bravura, serif`;
    const measureStepAccMap = new Map();

    // Check if entire measure is masked by Look-Ahead ('measure' mode)
    const isWholeMeasureLookAheadMasked = (
        AppState.lookAheadMode === 'measure' &&
        measure.index === AppState.currentMeasureIndex &&
        (AppState.isPlaying || AppState.currentBeatFloat > 0.05)
    );

    const staffBottomY = staffTopY + lineGap * 4;
    const middleLineY = staffTopY + lineGap * 2;
    // Bravura noteheadBlack / noteheadHalf half-width is 0.59 * lineGap (advance width = 1.18 * lineGap)
    const rx = lineGap * 0.59;
    const ry = lineGap * 0.45;

    // Pre-compute layout geometry for all events so eighth-note beams and accidentals never collide
    const prepared = events.map((ev, i) => {
        const x = startX + (ev.startBeat / measure.beatsPerMeasure) * usableWidth;
        const isCurrentlyPlaying = (
            measure.index === AppState.currentMeasureIndex &&
            AppState.currentBeatFloat >= ev.startBeat - 0.05 &&
            AppState.currentBeatFloat < ev.startBeat + ev.durationBeats - 0.05
        );
        const isBeatLookAheadMasked = (
            AppState.lookAheadMode === 'beat' &&
            measure.index === AppState.currentMeasureIndex &&
            ev.startBeat <= AppState.currentBeatFloat + 0.15
        );
        const eventAlpha = (isWholeMeasureLookAheadMasked || isBeatLookAheadMasked) ? 0.08 : 1.0;
        const isEarMystery = (isTreble && measure.isEarTraining && !measure.earRevealed && i > 0);

        if (ev.isRest || ev.notes.length === 0 || isEarMystery) {
            return { ev, i, x, isCurrentlyPlaying, eventAlpha, isEarMystery, isNote: false };
        }

        const noteInfos = ev.notes.map(midi => {
            const info = midiToStaffStepAndAccidental(midi, measure.rootKey, measure.mode, measureStepAccMap, measure.chord);
            const y = stepToStaffY(info.step, isTreble, staffTopY, lineGap);
            const isGuide = measure.chord.guideTonePcs.has(info.pc);
            return { midi, ...info, y, isGuide };
        }).sort((a, b) => b.y - a.y); // Bottom-most note first (largest Y)

        const bottomNote = noteInfos[0];
        const topNote = noteInfos[noteInfos.length - 1];
        const avgY = (bottomNote.y + topNote.y) / 2;
        const stemUp = isTreble ? (avgY >= middleLineY) : (avgY > middleLineY);

        // Resolve 2nd-interval horizontal displacement (on the opposite side of the stem)
        let prevDisplaced = false;
        for (let nIdx = 0; nIdx < noteInfos.length; nIdx++) {
            noteInfos[nIdx].displaced = false;
            if (nIdx > 0 && Math.abs(noteInfos[nIdx - 1].step - noteInfos[nIdx].step) === 1 && !prevDisplaced) {
                noteInfos[nIdx].displaced = true;
                prevDisplaced = true;
            } else {
                prevDisplaced = false;
            }
            noteInfos[nIdx].noteX = noteInfos[nIdx].displaced
                ? (stemUp ? (x + rx * 1.88) : (x - rx * 1.88))
                : x;
        }

        // Multi-column collision-free accidental layout (top note to bottom note)
        const leftmostNoteX = Math.min(...noteInfos.map(n => n.noteX));
        const colLastYs = []; // Tracks last Y placed in each accidental column
        for (let nIdx = noteInfos.length - 1; nIdx >= 0; nIdx--) {
            const n = noteInfos[nIdx];
            if (!n.accidental) continue;
            let assignedCol = 0;
            while (
                colLastYs[assignedCol] !== undefined &&
                Math.abs(n.y - colLastYs[assignedCol]) < lineGap * 2.65
            ) {
                assignedCol++;
            }
            colLastYs[assignedCol] = n.y;
            n.accX = leftmostNoteX - rx - lineGap * 0.72 - assignedCol * (lineGap * 1.05);
        }

        // Exact SMuFL stem anchor (stemUpSE / stemDownNW)
        const stemX = stemUp ? (x + rx - 0.6) : (x - rx + 0.6);
        const stemStartY = stemUp ? (bottomNote.y - lineGap * 0.16) : (topNote.y + lineGap * 0.16);
        const stemLen = lineGap * 3.25;
        let stemEndY = stemUp ? (topNote.y - stemLen) : (bottomNote.y + stemLen);

        // Clamp stems in the middle gap between Treble and Bass so they never collide across staves
        if (isTreble && !stemUp) {
            stemEndY = Math.min(stemEndY, midGrandY - lineGap * 0.45);
        } else if (!isTreble && stemUp) {
            stemEndY = Math.max(stemEndY, midGrandY + lineGap * 0.45);
        }

        return {
            ev, i, x, isCurrentlyPlaying, eventAlpha, isEarMystery: false, isNote: true,
            noteInfos, bottomNote, topNote, stemUp, stemX, stemStartY, stemEndY,
            beamRole: null, beamEndItem: null
        };
    });

    // Group consecutive eighth notes (0.5 beat) within the same beat group (1.5 in 6/8 compound duple, 1.0 in simple meters)
    const getBeamGroup = (startBeat) => measure.timeSig === '6/8'
        ? Math.floor((startBeat + 0.001) / 1.5)
        : Math.floor(startBeat + 0.001);

    for (let idx = 0; idx < prepared.length; ) {
        const first = prepared[idx];
        if (!first.isNote || first.ev.durationBeats !== 0.5) {
            idx++;
            continue;
        }
        const targetGroup = getBeamGroup(first.ev.startBeat);
        let endIdx = idx + 1;
        while (
            endIdx < prepared.length &&
            prepared[endIdx].isNote &&
            prepared[endIdx].ev.durationBeats === 0.5 &&
            getBeamGroup(prepared[endIdx].ev.startBeat) === targetGroup
        ) {
            endIdx++;
        }

        const run = prepared.slice(idx, endIdx);
        if (run.length >= 2) {
            const groupAvgY = run.reduce((sum, it) => sum + (it.bottomNote.y + it.topNote.y) / 2, 0) / run.length;
            const groupStemUp = isTreble ? (groupAvgY >= middleLineY) : (groupAvgY > middleLineY);

            for (const item of run) {
                item.stemUp = groupStemUp;
                for (const n of item.noteInfos) {
                    n.noteX = n.displaced
                        ? (groupStemUp ? (item.x + rx * 1.88) : (item.x - rx * 1.88))
                        : item.x;
                }
                item.stemX = groupStemUp ? (item.x + rx - 0.6) : (item.x - rx + 0.6);
                item.stemStartY = groupStemUp ? (item.bottomNote.y - lineGap * 0.16) : (item.topNote.y + lineGap * 0.16);
            }

            const last = run[run.length - 1];
            const spanX = Math.max(1, last.stemX - first.stemX);
            const stemLen = lineGap * 3.25;
            const rawEnds = run.map(it => groupStemUp ? (it.topNote.y - stemLen) : (it.bottomNote.y + stemLen));

            const maxSlope = lineGap * 0.80;
            const slopeDelta = Math.max(-maxSlope, Math.min(maxSlope, (rawEnds[rawEnds.length - 1] - rawEnds[0]) * 0.5));

            let startBeamY;
            if (groupStemUp) {
                startBeamY = Math.min(...run.map((it, k) => {
                    const t = (it.stemX - first.stemX) / spanX;
                    return rawEnds[k] - t * slopeDelta;
                }));
                if (!isTreble) {
                    const minSafe = midGrandY + lineGap * 0.45;
                    startBeamY = Math.max(startBeamY, minSafe, minSafe - slopeDelta);
                }
            } else {
                startBeamY = Math.max(...run.map((it, k) => {
                    const t = (it.stemX - first.stemX) / spanX;
                    return rawEnds[k] - t * slopeDelta;
                }));
                if (isTreble) {
                    const maxSafe = midGrandY - lineGap * 0.45;
                    startBeamY = Math.min(startBeamY, maxSafe, maxSafe - slopeDelta);
                }
            }

            for (let k = 0; k < run.length; k++) {
                const it = run[k];
                const t = (it.stemX - first.stemX) / spanX;
                it.stemEndY = startBeamY + t * slopeDelta;
                it.beamRole = k === 0 ? 'start' : (k === run.length - 1 ? 'end' : 'mid');
            }
            first.beamEndItem = last;
        }
        idx = endIdx;
    }

    // Track horizontal extent of Solfège / Note Name labels to prevent horizontal label collisions
    let lastLabelRightX = -9999;
    let lastLabelY = -9999;

    // Render all events
    for (let i = 0; i < prepared.length; i++) {
        const item = prepared[i];
        const { ev, x, isCurrentlyPlaying, eventAlpha, isEarMystery } = item;

        if (ev.isRest || ev.notes.length === 0) {
            ctx.save();
            ctx.globalAlpha = eventAlpha;
            drawRestGlyph(ctx, x, staffTopY, lineGap, ev.durationBeats, palette);
            ctx.restore();
            continue;
        }

        // EAR TRAINING MYSTERY MASKING ('?')
        if (isEarMystery) {
            ctx.save();
            ctx.globalAlpha = eventAlpha;
            const midY = staffTopY + lineGap * 2;
            const pillRadius = lineGap * 0.82;

            ctx.fillStyle = isCurrentlyPlaying
                ? (AppState.sheetTheme === 'dark' ? 'rgba(167, 139, 250, 0.35)' : 'rgba(124, 58, 237, 0.22)')
                : (AppState.sheetTheme === 'dark' ? 'rgba(139, 92, 246, 0.18)' : 'rgba(124, 58, 237, 0.12)');
            ctx.strokeStyle = isCurrentlyPlaying
                ? '#a78bfa'
                : (AppState.sheetTheme === 'dark' ? 'rgba(167, 139, 250, 0.65)' : 'rgba(109, 40, 217, 0.55)');
            ctx.lineWidth = isCurrentlyPlaying ? 2.0 : 1.3;

            ctx.beginPath();
            ctx.arc(x, midY, pillRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.font = `700 ${Math.round(lineGap * 1.2)}px "JetBrains Mono", monospace`;
            ctx.fillStyle = isCurrentlyPlaying
                ? (AppState.sheetTheme === 'dark' ? '#ede9fe' : '#4c1d95')
                : (AppState.sheetTheme === 'dark' ? '#c4b5fd' : '#6d28d9');
            ctx.fillText('?', x - 3.5, midY + 4);

            if (ev.durationBeats < 4) {
                ctx.beginPath();
                ctx.moveTo(x, midY + pillRadius);
                ctx.lineTo(x, midY + pillRadius + lineGap * 1.05);
                ctx.stroke();
            }
            ctx.restore();
            continue;
        }

        const { noteInfos, bottomNote, topNote, stemUp, stemX, stemStartY, stemEndY } = item;

        ctx.save();
        ctx.globalAlpha = eventAlpha;

        // 1. Draw ledger lines above or below the 5-line staff
        drawLedgerLines(ctx, x, noteInfos, isTreble, staffTopY, lineGap, palette);

        // 2. Draw Stems & Beams/Flags first so noteheads sit cleanly merged with stem starts
        const stemColor = isCurrentlyPlaying
            ? (isTreble ? palette.rhHighlight : palette.lhHighlight)
            : palette.ink;

        if (ev.durationBeats < 4) {
            ctx.save();
            ctx.strokeStyle = stemColor;
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.moveTo(stemX, stemStartY);
            ctx.lineTo(stemX, stemEndY);
            ctx.stroke();

            if (ev.durationBeats === 0.5) {
                if (item.beamRole === 'start' && item.beamEndItem) {
                    const endItem = item.beamEndItem;
                    const beamThick = lineGap * 0.48;
                    const dir = stemUp ? 1 : -1;
                    ctx.fillStyle = stemColor;
                    ctx.beginPath();
                    ctx.moveTo(stemX - 0.6, stemEndY);
                    ctx.lineTo(endItem.stemX + 0.6, endItem.stemEndY);
                    ctx.lineTo(endItem.stemX + 0.6, endItem.stemEndY + beamThick * dir);
                    ctx.lineTo(stemX - 0.6, stemEndY + beamThick * dir);
                    ctx.closePath();
                    ctx.fill();
                } else if (!item.beamRole) {
                    drawEngravedFlag(ctx, stemX, stemEndY, stemUp, lineGap, stemColor);
                }
            }
            ctx.restore();
        }

        // 3. Draw Bravura SMuFL Noteheads, Multi-Column Accidentals, and Augmentation Dots
        const rightmostNoteX = Math.max(...noteInfos.map(n => n.noteX));
        for (let nIdx = 0; nIdx < noteInfos.length; nIdx++) {
            const n = noteInfos[nIdx];

            let fillColor = palette.ink;
            if (isCurrentlyPlaying) {
                fillColor = isTreble ? palette.rhHighlight : palette.lhHighlight;
            } else if (AppState.highlightGuideTones && n.isGuide) {
                fillColor = palette.guideTone;
            }

            drawEngravedNotehead(ctx, n.noteX, n.y, rx, ry, ev.durationBeats, fillColor, lineGap);

            // Augmentation dot for dotted half (3 beats) or dotted quarter (1.5 beats)
            // Shift dot into the staff space if the note sits on a line so the staff line never cuts through the dot
            if (ev.durationBeats === 3 || ev.durationBeats === 1.5) {
                const distFromTopInHalfGaps = Math.round((n.y - staffTopY) / (lineGap / 2));
                const isOnLine = (distFromTopInHalfGaps % 2 === 0);
                const dotY = isOnLine ? (n.y - lineGap * 0.48) : n.y;
                const dotX = rightmostNoteX + rx + lineGap * 0.52;
                ctx.save();
                ctx.fillStyle = fillColor;
                ctx.beginPath();
                ctx.arc(dotX, dotY, Math.max(1.9, lineGap * 0.20), 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            // Engraved SMuFL Accidental glyph at its collision-free column X
            if (n.accidental && n.accX !== undefined) {
                ctx.save();
                if (useBravura) {
                    ctx.font = smuflFont;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'alphabetic';
                    drawHaloText(ctx, SMUFL.accidentalFromSymbol(n.accidental), n.accX, n.y, fillColor, palette.bg, 2.2);
                } else {
                    ctx.font = `600 ${Math.round(lineGap * 1.82)}px "Cormorant Garamond", Georgia, serif`;
                    drawHaloText(ctx, n.accidental, n.accX, n.y + lineGap * 0.52, fillColor, palette.bg, 2.6);
                }
                ctx.restore();
            }
        }

        // 4. Collision-Free Solfège / Note Name Label (placed outside the staff & opposite the stem)
        if (AppState.noteNameMode !== 'none') {
            ctx.save();
            const fontSize = Math.max(10, Math.round(lineGap * 1.02));
            ctx.font = `italic 600 ${fontSize}px "Cormorant Garamond", Georgia, serif`;

            // Build compact chord/note label (top melody note on Treble, or dyad 'Fa·La'; bass root on Bass)
            let labelStr = '';
            let hasGuide = false;
            if (isTreble) {
                const uniqueLabels = [];
                for (let k = noteInfos.length - 1; k >= 0; k--) {
                    const nm = formatPitchClass(noteInfos[k].pc, sigInfo.useFlats, AppState.noteNameMode, sigInfo.flats);
                    if (!uniqueLabels.includes(nm)) uniqueLabels.push(nm);
                    if (noteInfos[k].isGuide) hasGuide = true;
                }
                labelStr = uniqueLabels.slice(0, 2).join('·');
            } else {
                const targetN = noteInfos.find(n => n.isGuide) || bottomNote;
                labelStr = formatPitchClass(targetN.pc, sigInfo.useFlats, AppState.noteNameMode, sigInfo.flats);
                hasGuide = Boolean(targetN.isGuide);
            }

            const labelW = ctx.measureText(labelStr).width;
            let labelX = x - labelW / 2;

            // Place on the notehead side (opposite the stem) and strictly outside the 5 staff lines
            let labelY;
            if (isTreble) {
                if (stemUp) {
                    // Stem goes UP -> place label cleanly BELOW the notehead & treble staff
                    labelY = Math.max(bottomNote.y + lineGap * 1.45, staffBottomY + lineGap * 1.15);
                    labelY = Math.min(labelY, midGrandY - 4);
                } else {
                    // Stem goes DOWN -> place label cleanly ABOVE the notehead & treble staff
                    labelY = Math.min(topNote.y - lineGap * 0.90, staffTopY - lineGap * 0.65);
                }
            } else {
                if (stemUp) {
                    // Stem goes UP -> place label cleanly BELOW the bass notehead & bass staff
                    labelY = Math.max(bottomNote.y + lineGap * 1.45, staffBottomY + lineGap * 1.20);
                } else {
                    // Stem goes DOWN -> place label cleanly ABOVE the bass notehead & bass staff
                    labelY = Math.min(topNote.y - lineGap * 0.90, staffTopY - lineGap * 0.65);
                    labelY = Math.max(labelY, midGrandY + fontSize + 2);
                }
            }

            // Prevent horizontal collision with the previous beat's label
            if (labelX < lastLabelRightX + 4 && Math.abs(labelY - lastLabelY) < fontSize) {
                labelX = lastLabelRightX + 4;
            }
            lastLabelRightX = labelX + labelW;
            lastLabelY = labelY;

            const labelColor = (hasGuide && AppState.highlightGuideTones) ? palette.guideTone : palette.mutedInk;
            drawHaloText(ctx, labelStr, labelX, labelY, labelColor, palette.bg, 3.0);
            ctx.restore();
        }

        // 5. Anchor badge on 1st note of an Ear Training measure
        if (isTreble && measure.isEarTraining && !measure.earRevealed && i === 0) {
            ctx.save();
            ctx.font = `600 8.5px "Inter", sans-serif`;
            const earTagColor = AppState.sheetTheme === 'dark' ? '#c4b5fd' : '#6d28d9';
            const tagY = stemUp
                ? Math.min(topNote.y - lineGap * 0.9, staffTopY - lineGap * 0.6)
                : Math.max(bottomNote.y + lineGap * 1.5, staffBottomY + lineGap * 1.2);
            drawHaloText(ctx, '1re note', x - 14, tagY, earTagColor, palette.bg, 2.8);
            ctx.restore();
        }

        // 6. Draw Crescent Tie curves (incoming from previous barline and/or outgoing to next note/barline)
        if (ev.isTiedFromPrev) {
            const leftmostNoteX = Math.min(...noteInfos.map(n => n.noteX));
            const inTieStartX = measureBounds ? (measureBounds.measX + 2) : (x - rx - 14);
            const inTieEndX = Math.max(inTieStartX + 6, leftmostNoteX - rx - 3);
            const curveUp = !stemUp;
            const tieY = curveUp ? (topNote.y - ry - 2) : (bottomNote.y + ry + 2);
            drawEngravedTie(ctx, inTieStartX, inTieEndX, tieY, curveUp, lineGap, palette.ink);
        }
        if (ev.tieToNext) {
            const tieStartX = rightmostNoteX + rx + 3;
            const crossesBarline = ev.startBeat + ev.durationBeats >= measure.beatsPerMeasure - 0.05;
            const tieEndX = (crossesBarline && measureBounds)
                ? (measureBounds.measX + measureBounds.measWidth - 2)
                : (x + (ev.durationBeats / measure.beatsPerMeasure) * usableWidth - 5);
            const curveUp = !stemUp;
            const tieY = curveUp ? (topNote.y - ry - 2) : (bottomNote.y + ry + 2);
            drawEngravedTie(ctx, tieStartX, tieEndX, tieY, curveUp, lineGap, palette.ink);
        }

        ctx.restore();
    }
}

// Draw ledger lines above or below the staff with authentic engraving width
function drawLedgerLines(ctx, x, noteInfos, isTreble, staffTopY, lineGap, palette) {
    const staffBottomY = staffTopY + lineGap * 4;
    const ledgerHalfWidth = lineGap * 1.06;

    ctx.save();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1.15;

    for (const n of noteInfos) {
        const cx = n.noteX !== undefined ? n.noteX : x;
        // Above top line
        if (n.y <= staffTopY - lineGap + 1) {
            for (let ly = staffTopY - lineGap; ly >= n.y - 1; ly -= lineGap) {
                ctx.beginPath();
                ctx.moveTo(cx - ledgerHalfWidth, ly);
                ctx.lineTo(cx + ledgerHalfWidth, ly);
                ctx.stroke();
            }
        }
        // Below bottom line (including Middle C = C4)
        if (n.y >= staffBottomY + lineGap - 1) {
            for (let ly = staffBottomY + lineGap; ly <= n.y + 1; ly += lineGap) {
                ctx.beginPath();
                ctx.moveTo(cx - ledgerHalfWidth, ly);
                ctx.lineTo(cx + ledgerHalfWidth, ly);
                ctx.stroke();
            }
        } else if (n.step === 0) {
            // Explicit Middle C ledger line
            ctx.beginPath();
            ctx.moveTo(cx - ledgerHalfWidth, n.y);
            ctx.lineTo(cx + ledgerHalfWidth, n.y);
            ctx.stroke();
        }
    }
    ctx.restore();
}

// Draw authentic Steinberg Bravura SMuFL Quarter Rest (\uE4E5), Eighth Rest (\uE4E6), or Half Rest (\uE4E4)
function drawRestGlyph(ctx, x, staffTopY, lineGap, durationBeats, palette) {
    ctx.save();
    ctx.fillStyle = palette.ink;
    ctx.strokeStyle = palette.ink;

    if (isBravuraLoaded()) {
        ctx.font = `${(lineGap * 4).toFixed(1)}px Bravura, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const restGlyph = durationBeats >= 2
            ? SMUFL.restHalf
            : (durationBeats === 0.5 ? SMUFL.rest8th : SMUFL.restQuarter);
        ctx.fillText(restGlyph, x, staffTopY + lineGap * 2);
    } else if (durationBeats >= 2) {
        const midLineY = staffTopY + lineGap * 2;
        const blockW = lineGap * 1.15;
        const blockH = lineGap * 0.52;
        ctx.fillRect(x - blockW / 2, midLineY - blockH, blockW, blockH);
    } else if (durationBeats === 0.5) {
        const topY = staffTopY + lineGap * 1.25;
        const botY = staffTopY + lineGap * 3.1;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x + lineGap * 0.35, topY);
        ctx.lineTo(x - lineGap * 0.28, botY);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x - lineGap * 0.15, topY + lineGap * 0.28, lineGap * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.quadraticCurveTo(x, topY + lineGap * 0.55, x + lineGap * 0.32, topY + lineGap * 0.15);
        ctx.stroke();
    } else {
        const y0 = staffTopY + lineGap * 0.72;
        const s = lineGap * 0.36;
        ctx.beginPath();
        ctx.moveTo(x - s * 0.5, y0);
        ctx.lineTo(x + s * 1.35, y0 + s * 2.2);
        ctx.bezierCurveTo(
            x + s * 0.1, y0 + s * 3.1,
            x - s * 1.1, y0 + s * 3.7,
            x + s * 0.9, y0 + s * 5.2
        );
        ctx.bezierCurveTo(
            x - s * 1.4, y0 + s * 4.9,
            x - s * 1.8, y0 + s * 6.9,
            x + s * 0.1, y0 + s * 7.4
        );
        ctx.bezierCurveTo(
            x - s * 0.85, y0 + s * 6.5,
            x - s * 0.55, y0 + s * 5.4,
            x + s * 1.45, y0 + s * 5.6
        );
        ctx.lineTo(x - s * 0.25, y0 + s * 3.4);
        ctx.bezierCurveTo(
            x + s * 0.85, y0 + s * 2.5,
            x + s * 1.65, y0 + s * 2.1,
            x - s * 0.5, y0
        );
        ctx.closePath();
        ctx.fill();
    }

    // Augmentation dot for dotted half (3) or dotted quarter (1.5) rests
    if (durationBeats === 3 || durationBeats === 1.5) {
        ctx.beginPath();
        ctx.arc(x + lineGap * 0.92, staffTopY + lineGap * 1.5, Math.max(1.8, lineGap * 0.19), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}
