/***********************************************************************
 * 8. UI CONTROLS, PRESET MANAGEMENT & EVENT LISTENERS
 ***********************************************************************/
function updateHeaderSummary() {
    const sigInfo = getModalSignatureInfo(AppState.rootKey, AppState.mode);
    const modeLabel = MODE_LABELS_FR[AppState.mode] || 'Majeur';
    const summaryEl = document.getElementById('harmonicSummaryText');
    if (summaryEl) {
        summaryEl.textContent = `${sigInfo.labelFr} ${modeLabel} • ${AppState.timeSig} • Lecture infinie`;
    }

    const presetObj = STYLE_PRESETS[AppState.activePreset];
    const badgeEl = document.getElementById('activePresetBadge');
    if (badgeEl) {
        badgeEl.textContent = presetObj ? presetObj.name : 'Personnalisé';
    }
}

// Keep UI key selector & header badge synchronized with the measure currently under the playhead
function syncPlayheadKeyToUI() {
    const measure = getMeasureByIndex(AppState.currentMeasureIndex);
    if (!measure) return;
    if (AppState.rootKey !== measure.rootKey) {
        AppState.rootKey = measure.rootKey;
        const selKey = document.getElementById('selectRootKey');
        if (selKey && selKey.value !== measure.rootKey) {
            selKey.value = measure.rootKey;
        }
        updateHeaderSummary();
    }
}

function updateHudInfo() {
    const measure = getMeasureByIndex(AppState.currentMeasureIndex);
    if (!measure) return;
    syncPlayheadKeyToUI();
    const secTag = measure.macroSection ? ` · ${measure.macroSection}` : '';
    document.getElementById('hudMeasureNum').textContent = `${measure.index + 1}${secTag}`;
    document.getElementById('hudCurrentChord').textContent = measure.chord.symbol;
    document.getElementById('hudCurrentRoman').textContent = measure.chord.roman;

    // Update MIDI / Mic Wait banner if active
    const banner = document.getElementById('midiWaitBanner');
    const modeLbl = document.getElementById('waitBannerModeLabel');
    const micBadge = document.getElementById('micDetectedNoteBadge');
    if (AppState.scrollMode === 'midi_wait' || AppState.scrollMode === 'mic_wait') {
        banner.classList.remove('hidden');
        banner.classList.add('flex');
        if (modeLbl) {
            modeLbl.textContent = AppState.scrollMode === 'mic_wait' ? '🎙️ Jouez :' : '🎹 Attente :';
        }
        if (micBadge) {
            micBadge.classList.toggle('hidden', AppState.scrollMode !== 'mic_wait');
        }
        const subBeat = Math.round(AppState.currentBeatFloat * 2) / 2;
        const expected = getExpectedSubBeatNotes(measure, subBeat);
        const sigInfo = getModalSignatureInfo(measure.rootKey, measure.mode);
        const names = expected.map(m => formatPitchClass(midiToPc(m), sigInfo.useFlats, 'fr', sigInfo.flats));
        document.getElementById('midiExpectedNotesLabel').textContent =
            names.length > 0 ? [...new Set(names)].join(', ') : 'Silence';
    } else {
        banner.classList.add('hidden');
        banner.classList.remove('flex');
    }

    // Update floating Pedagogy Status Banner (Ear Training / Improvisation / Look-Ahead)
    const pedBanner = document.getElementById('pedagogyActiveBanner');
    const pedText = document.getElementById('pedagogyBannerText');
    if (pedBanner && pedText) {
        if (measure.isEarTraining && !measure.earRevealed) {
            pedBanner.classList.remove('hidden');
            pedBanner.classList.add('flex');
            pedBanner.className = 'pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-950/90 border border-violet-400/70 text-violet-200 shadow hover:bg-violet-900 transition cursor-pointer';
            pedText.textContent = '👂 À l\'oreille — Toucher pour révéler';
        } else if (measure.isEarTraining && measure.earRevealed) {
            pedBanner.classList.remove('hidden');
            pedBanner.classList.add('flex');
            pedBanner.className = 'pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-400/70 text-emerald-200 shadow transition';
            pedText.textContent = '👂 Notes révélées ✓';
        } else if (measure.isImprovisation) {
            pedBanner.classList.remove('hidden');
            pedBanner.classList.add('flex');
            pedBanner.className = 'pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/90 border border-amber-400/70 text-amber-200 shadow transition';
            pedText.textContent = '✨ Improvisation MD (Cibles ◆)';
        } else if (AppState.lookAheadMode !== 'off') {
            pedBanner.classList.remove('hidden');
            pedBanner.classList.add('flex');
            pedBanner.className = 'pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-950/90 border border-sky-400/70 text-sky-200 shadow transition';
            pedText.textContent = AppState.lookAheadMode === 'measure'
                ? '👁️ Regard +1 Mesure'
                : '👁️ Regard +1 Temps';
        } else {
            pedBanner.classList.add('hidden');
            pedBanner.classList.remove('flex');
        }
    }
}

// Synchronize Look-Ahead mode ('off' | 'beat' | 'measure') across Header button & Drawer select
function setLookAheadMode(mode) {
    AppState.lookAheadMode = mode;
    const sel = document.getElementById('selectLookAheadMode');
    if (sel && sel.value !== mode) sel.value = mode;

    const btn = document.getElementById('btnLookAhead');
    const lbl = document.getElementById('labelLookAhead');
    if (btn) {
        const active = mode !== 'off';
        btn.className = active
            ? 'px-1.5 py-1 rounded-md text-[11px] font-medium bg-sky-500/20 text-sky-300 border border-sky-400/50 transition flex items-center gap-1'
            : 'px-1.5 py-1 rounded-md text-[11px] font-medium text-studio-300 hover:text-parchment-100 hover:bg-studio-800 transition flex items-center gap-1';
    }
    if (lbl) {
        lbl.textContent = mode === 'beat' ? 'Regard +1t' : (mode === 'measure' ? 'Regard +1m' : 'Regard');
    }
    updateHudInfo();
    renderScore();
}

// Synchronize Ear Training toggle across Header button & Drawer checkbox
function setEarTrainingEnabled(enabled) {
    AppState.earTrainingEnabled = Boolean(enabled);
    const chk = document.getElementById('chkEarTraining');
    if (chk && chk.checked !== AppState.earTrainingEnabled) chk.checked = AppState.earTrainingEnabled;

    const btn = document.getElementById('btnEarTraining');
    if (btn) {
        btn.className = AppState.earTrainingEnabled
            ? 'px-1.5 py-1 rounded-md text-[11px] font-medium bg-violet-500/25 text-violet-200 border border-violet-400/60 transition flex items-center gap-1'
            : 'px-1.5 py-1 rounded-md text-[11px] font-medium text-studio-300 hover:text-parchment-100 hover:bg-studio-800 transition flex items-center gap-1';
    }
    syncPedagogyFlagsOnMeasures();
}

// Synchronize Guided Improvisation toggle across Header button & Drawer checkbox
function setImproMeasureEnabled(enabled) {
    AppState.improMeasureEnabled = Boolean(enabled);
    const chk = document.getElementById('chkImproMeasure');
    if (chk && chk.checked !== AppState.improMeasureEnabled) chk.checked = AppState.improMeasureEnabled;

    const btn = document.getElementById('btnImproMeasure');
    if (btn) {
        btn.className = AppState.improMeasureEnabled
            ? 'px-1.5 py-1 rounded-md text-[11px] font-medium bg-amber-500/25 text-amber-200 border border-amber-400/60 transition flex items-center gap-1'
            : 'px-1.5 py-1 rounded-md text-[11px] font-medium text-studio-300 hover:text-parchment-100 hover:bg-studio-800 transition flex items-center gap-1';
    }
    syncPedagogyFlagsOnMeasures();
}

// Synchronize Sound Type across both Header and Drawer selectors & play audition note
function setSoundType(newSoundType, playPreview = true) {
    AppState.soundType = newSoundType;
    const headerSel = document.getElementById('selectSoundTypeHeader');
    const drawerSel = document.getElementById('selectSoundTypeDrawer');
    if (headerSel && headerSel.value !== newSoundType) headerSel.value = newSoundType;
    if (drawerSel && drawerSel.value !== newSoundType) drawerSel.value = newSoundType;

    if (playPreview) {
        audioEngine.init();
        const meas = getMeasureByIndex(AppState.currentMeasureIndex);
        if (meas) {
            triggerMeasureBeatAudio(meas, 0, true);
        } else {
            audioEngine.playNote(60, 1.2, 0.72);
            audioEngine.playNote(64, 1.2, 0.68);
            audioEngine.playNote(67, 1.2, 0.68);
        }
    }
}

// Synchronize Reverb across Header and Drawer sliders
function setReverbAmount(percentValue) {
    const clamped = Math.max(0, Math.min(100, Number(percentValue)));
    const s1 = document.getElementById('sliderReverb');
    const s2 = document.getElementById('sliderReverbDrawer');
    const v2 = document.getElementById('valReverbDrawer');
    if (s1) s1.value = String(clamped);
    if (s2) s2.value = String(clamped);
    if (v2) v2.textContent = `${Math.round(clamped)}%`;
    audioEngine.updateReverbMix(clamped / 100);
}

// Synchronize Master Volume slider (0..100%)
function setMasterVolume(percentValue) {
    const clamped = Math.max(0, Math.min(100, Number(percentValue)));
    const slider = document.getElementById('sliderMasterVolume');
    const label = document.getElementById('valMasterVolume');
    if (slider) slider.value = String(clamped);
    if (label) label.textContent = `${Math.round(clamped)}%`;
    audioEngine.updateMasterVolume(clamped / 100);
}

// Synchronize LH <-> RH Mix Balance (-100 = LH solo, 0 = balanced, +100 = RH solo)
function setHandBalance(percentValue) {
    const clamped = Math.max(-100, Math.min(100, Math.round(Number(percentValue) || 0)));
    AppState.handBalance = clamped / 100;
    const slider = document.getElementById('sliderHandBalance');
    const label = document.getElementById('valHandBalance');
    if (slider) slider.value = String(clamped);
    if (label) {
        if (Math.abs(clamped) <= 5) label.textContent = 'Équil.';
        else if (clamped <= -95) label.textContent = 'MG';
        else if (clamped >= 95) label.textContent = 'MD';
        else label.textContent = clamped < 0 ? `MG+${Math.abs(clamped)}` : `MD+${clamped}`;
    }
}

// Synchronize Scroll Mode across Header, Drawer selectors, and Mic Wait quick-toggle button
async function setScrollMode(modeValue) {
    AppState.scrollMode = modeValue;
    const s1 = document.getElementById('selectScrollMode');
    const s2 = document.getElementById('selectScrollModeDrawer');
    if (s1 && s1.value !== modeValue) s1.value = modeValue;
    if (s2 && s2.value !== modeValue) s2.value = modeValue;

    // Update quick-toggle Mic Wait button style in Header
    const btnMic = document.getElementById('btnMicWait');
    if (btnMic) {
        const isMic = modeValue === 'mic_wait';
        btnMic.className = isMic
            ? 'px-1.5 py-1 rounded-md text-[11px] font-medium bg-emerald-500/25 text-emerald-200 border border-emerald-400/60 transition flex items-center gap-1'
            : 'px-1.5 py-1 rounded-md text-[11px] font-medium text-studio-300 hover:text-parchment-100 hover:bg-studio-800 transition flex items-center gap-1';
    }

    if (AppState.scrollMode === 'midi_wait' || AppState.scrollMode === 'mic_wait') {
        AppState.isPlaying = false;
        stopAudioScheduler();
        document.getElementById('iconPlay').classList.remove('hidden');
        document.getElementById('iconPause').classList.add('hidden');
        document.getElementById('labelPlayPause').textContent = 'Lecture';
    }

    if (AppState.scrollMode === 'mic_wait') {
        const ok = await micPitchDetector.start();
        if (!ok) {
            setScrollMode('continuous');
            return;
        }
    } else {
        micPitchDetector.stop();
    }

    updateHudInfo();
    renderScore();
}

// Highlight active preset button card (pass null to clear all highlights for custom scenarios)
function updatePresetCardHighlights(activeKey) {
    document.querySelectorAll('.preset-btn').forEach(btn => {
        const isSelected = Boolean(activeKey) && btn.getAttribute('data-preset') === activeKey;
        btn.className = isSelected
            ? 'preset-btn text-left p-2 rounded-xl border border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/15 transition group'
            : 'preset-btn text-left p-2 rounded-xl border border-studio-700 bg-studio-850 hover:bg-studio-800 transition group';
    });
}

// Apply one of the 4 signature contemplative presets
function applyStylePreset(presetKey) {
    const p = STYLE_PRESETS[presetKey];
    if (!p) return;

    AppState.activePreset = presetKey;
    AppState.tempo = p.tempo;
    AppState.rootKey = p.rootKey;
    AppState.generationRootKey = p.rootKey;
    AppState.mode = p.mode;
    AppState.timeSig = p.timeSig;
    AppState.harmonicRichness = p.harmonicRichness;
    AppState.leftHandPattern = p.leftHandPattern;
    AppState.rightHandDensity = Number(p.rightHandDensity);
    AppState.intervalLeap = p.intervalLeap;

    // Sync UI inputs
    document.getElementById('sliderTempo').value = p.tempo;
    document.getElementById('valTempo').textContent = `${p.tempo} BPM`;
    document.getElementById('selectRootKey').value = p.rootKey;
    document.getElementById('selectMode').value = p.mode;
    document.getElementById('selectTimeSig').value = p.timeSig;
    document.getElementById('selectHarmonicRichness').value = p.harmonicRichness;
    document.getElementById('selectLeftHandPattern').value = p.leftHandPattern;
    document.getElementById('selectRightHandDensity').value = p.rightHandDensity;
    document.getElementById('selectIntervalLeap').value = p.intervalLeap;
    if (p.soundType) setSoundType(p.soundType, false);
    setReverbAmount(p.reverb);

    updatePresetCardHighlights(presetKey);
    rebuildScoreStream();
}

// LocalStorage custom scenario persistence
const STORAGE_KEY = 'atelier_contemplatif_scenarios_v1';

function loadSavedScenarios() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}

function renderSavedScenariosList() {
    const listEl = document.getElementById('savedScenariosList');
    const scenarios = loadSavedScenarios();
    listEl.replaceChildren();

    if (scenarios.length === 0) {
        const emptyP = document.createElement('p');
        emptyP.className = 'text-[11px] text-studio-400 italic';
        emptyP.textContent = 'Aucun scénario personnalisé enregistré.';
        listEl.appendChild(emptyP);
        return;
    }

    scenarios.forEach((sc, idx) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between p-2 rounded-lg bg-studio-850 border border-studio-800 text-xs';

        const loadBtn = document.createElement('button');
        loadBtn.className = 'text-left flex-1 hover:text-amber-300 transition truncate pr-2';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'font-medium';
        nameSpan.textContent = String(sc.name || 'Scénario');

        const metaSpan = document.createElement('span');
        metaSpan.className = 'text-[10px] font-mono text-studio-400 ml-1';
        metaSpan.textContent = `(${sc.rootKey} ${MODE_LABELS_FR[sc.mode] || ''} • ${sc.timeSig})`;

        loadBtn.appendChild(nameSpan);
        loadBtn.appendChild(metaSpan);
        loadBtn.addEventListener('click', () => {
            const latest = loadSavedScenarios()[idx];
            if (!latest) return;
            AppState.activePreset = null;
            AppState.tempo = latest.tempo;
            AppState.rootKey = latest.rootKey;
            AppState.generationRootKey = latest.rootKey;
            AppState.mode = latest.mode;
            AppState.timeSig = latest.timeSig;
            AppState.harmonicRichness = latest.harmonicRichness;
            AppState.leftHandPattern = latest.leftHandPattern;
            AppState.rightHandDensity = Number(latest.rightHandDensity);
            AppState.intervalLeap = latest.intervalLeap;
            if (typeof latest.allowLedgerLines === 'boolean') {
                AppState.allowLedgerLines = latest.allowLedgerLines;
                document.getElementById('chkLedgerLines').checked = latest.allowLedgerLines;
            }
            if (typeof latest.progressiveModulation === 'boolean') {
                AppState.progressiveModulation = latest.progressiveModulation;
                document.getElementById('chkModulation').checked = latest.progressiveModulation;
            }
            if (latest.soundType) setSoundType(latest.soundType, false);
            if (typeof latest.reverb === 'number') setReverbAmount(latest.reverb);
            if (typeof latest.masterVolume === 'number') setMasterVolume(latest.masterVolume);
            if (typeof latest.handBalance === 'number') setHandBalance(latest.handBalance);
            if (latest.lookAheadMode) setLookAheadMode(latest.lookAheadMode);
            if (typeof latest.earTrainingEnabled === 'boolean') setEarTrainingEnabled(latest.earTrainingEnabled);
            if (typeof latest.improMeasureEnabled === 'boolean') setImproMeasureEnabled(latest.improMeasureEnabled);

            document.getElementById('sliderTempo').value = latest.tempo;
            document.getElementById('valTempo').textContent = `${latest.tempo} BPM`;
            document.getElementById('selectRootKey').value = latest.rootKey;
            document.getElementById('selectMode').value = latest.mode;
            document.getElementById('selectTimeSig').value = latest.timeSig;
            document.getElementById('selectHarmonicRichness').value = latest.harmonicRichness;
            document.getElementById('selectLeftHandPattern').value = latest.leftHandPattern;
            document.getElementById('selectRightHandDensity').value = String(latest.rightHandDensity);
            document.getElementById('selectIntervalLeap').value = latest.intervalLeap;
            updatePresetCardHighlights(null);

            rebuildScoreStream();
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'text-studio-400 hover:text-red-400 px-1.5';
        delBtn.title = 'Supprimer';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', () => {
            const list = loadSavedScenarios();
            list.splice(idx, 1);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
            renderSavedScenariosList();
        });

        row.appendChild(loadBtn);
        row.appendChild(delBtn);
        listEl.appendChild(row);
    });
}

// Toggle Play / Pause (or audition & step forward while in Wait modes)
function togglePlayPause() {
    audioEngine.init();
    const iconPlay = document.getElementById('iconPlay');
    const iconPause = document.getElementById('iconPause');
    const label = document.getElementById('labelPlayPause');

    if (AppState.scrollMode === 'midi_wait' || AppState.scrollMode === 'mic_wait') {
        AppState.isPlaying = false;
        stopAudioScheduler();
        iconPlay.classList.remove('hidden');
        iconPause.classList.add('hidden');
        label.textContent = 'Lecture';
        advanceOneSubBeatStep(true);
        return;
    }

    AppState.isPlaying = !AppState.isPlaying;

    if (AppState.isPlaying) {
        iconPlay.classList.add('hidden');
        iconPause.classList.remove('hidden');
        label.textContent = 'Pause';
        AppState.lastFrameTime = performance.now();
        startAudioScheduler();
    } else {
        stopAudioScheduler();
        iconPlay.classList.remove('hidden');
        iconPause.classList.add('hidden');
        label.textContent = 'Lecture';
    }
}

// Open / Close Configuration Drawer with Mobile Backdrop support
function toggleConfigDrawer(forceOpen) {
    const drawer = document.getElementById('configDrawer');
    const backdrop = document.getElementById('drawerBackdrop');
    const isHidden = drawer.classList.contains('hidden');
    const shouldOpen = forceOpen !== undefined ? forceOpen : isHidden;

    if (shouldOpen) {
        drawer.classList.remove('hidden');
        backdrop.classList.remove('hidden');
    } else {
        drawer.classList.add('hidden');
        backdrop.classList.add('hidden');
    }

    setTimeout(() => {
        renderScore();
    }, 40);
}

// Bind all DOM Event Listeners
function bindEventListeners() {
    // Drawer toggle, close button, and mobile backdrop
    document.getElementById('btnToggleDrawer').addEventListener('click', () => toggleConfigDrawer());
    document.getElementById('btnCloseDrawer').addEventListener('click', () => toggleConfigDrawer(false));
    document.getElementById('drawerBackdrop').addEventListener('click', () => toggleConfigDrawer(false));

    // Transport controls
    document.getElementById('btnPlayPause').addEventListener('click', togglePlayPause);
    document.getElementById('btnStepMeasure').addEventListener('click', () => {
        audioEngine.init();
        advanceOneSubBeatStep(true);
    });
    document.getElementById('btnRegenerate').addEventListener('click', () => {
        audioEngine.init();
        rebuildScoreStream();
    });

    // Sound Type selectors (Header & Drawer)
    document.getElementById('selectSoundTypeHeader').addEventListener('change', (e) => {
        setSoundType(e.target.value, true);
    });
    document.getElementById('selectSoundTypeDrawer').addEventListener('change', (e) => {
        setSoundType(e.target.value, true);
    });

    // Tempo slider
    document.getElementById('sliderTempo').addEventListener('input', (e) => {
        AppState.tempo = Number(e.target.value);
        document.getElementById('valTempo').textContent = `${AppState.tempo} BPM`;
    });

    // Scroll Mode selectors (Header & Drawer)
    document.getElementById('selectScrollMode').addEventListener('change', (e) => {
        setScrollMode(e.target.value);
    });
    document.getElementById('selectScrollModeDrawer').addEventListener('change', (e) => {
        setScrollMode(e.target.value);
    });

    // Reverb, Master Volume & LH/RH Mix Balance sliders
    document.getElementById('sliderReverb').addEventListener('input', (e) => {
        setReverbAmount(e.target.value);
    });
    document.getElementById('sliderReverbDrawer').addEventListener('input', (e) => {
        setReverbAmount(e.target.value);
    });
    document.getElementById('sliderMasterVolume').addEventListener('input', (e) => {
        setMasterVolume(e.target.value);
    });
    document.getElementById('sliderHandBalance').addEventListener('input', (e) => {
        setHandBalance(e.target.value);
    });

    // Metronome button
    const btnMetro = document.getElementById('btnMetronome');
    btnMetro.addEventListener('click', () => {
        AppState.metronomeEnabled = !AppState.metronomeEnabled;
        btnMetro.classList.toggle('text-amber-400', AppState.metronomeEnabled);
        btnMetro.classList.toggle('border-amber-500/60', AppState.metronomeEnabled);
    });

    // View Layout toggle (Horizontal Ribbon vs Page Multi-Systems)
    document.getElementById('btnViewLayout').addEventListener('click', () => {
        AppState.viewLayout = AppState.viewLayout === 'ribbon' ? 'page' : 'ribbon';
        document.getElementById('labelViewLayout').textContent =
            AppState.viewLayout === 'ribbon' ? 'Ruban' : 'Page';
        renderScore();
    });

    // Sheet Theme toggle (Parchment vs Dark Nocturne)
    document.getElementById('btnSheetTheme').addEventListener('click', () => {
        AppState.sheetTheme = AppState.sheetTheme === 'parchment' ? 'dark' : 'parchment';
        renderScore();
    });

    // Fullscreen toggle for smartphone horizontal view
    document.getElementById('btnFullscreen').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen?.().catch(() => {});
        } else {
            document.exitFullscreen?.().catch(() => {});
        }
    });

    // Style Preset cards
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            audioEngine.init();
            applyStylePreset(btn.getAttribute('data-preset'));
        });
    });

    // Deep customization controls (live regeneration of upcoming buffer)
    document.getElementById('selectRootKey').addEventListener('change', (e) => {
        AppState.rootKey = e.target.value;
        AppState.generationRootKey = e.target.value;
        refreshUpcomingMeasuresLive();
    });
    document.getElementById('selectMode').addEventListener('change', (e) => {
        AppState.mode = e.target.value;
        refreshUpcomingMeasuresLive();
    });
    document.getElementById('chkModulation').addEventListener('change', (e) => {
        AppState.progressiveModulation = e.target.checked;
        refreshUpcomingMeasuresLive();
    });
    document.getElementById('selectHarmonicRichness').addEventListener('change', (e) => {
        AppState.harmonicRichness = e.target.value;
        refreshUpcomingMeasuresLive();
    });
    document.getElementById('selectLeftHandPattern').addEventListener('change', (e) => {
        AppState.leftHandPattern = e.target.value;
        refreshUpcomingMeasuresLive();
    });
    document.getElementById('selectRightHandDensity').addEventListener('change', (e) => {
        AppState.rightHandDensity = Number(e.target.value);
        refreshUpcomingMeasuresLive();
    });
    document.getElementById('selectTimeSig').addEventListener('change', (e) => {
        AppState.timeSig = e.target.value;
        rebuildScoreStream();
    });
    document.getElementById('selectIntervalLeap').addEventListener('change', (e) => {
        AppState.intervalLeap = e.target.value;
        refreshUpcomingMeasuresLive();
    });
    document.getElementById('chkLedgerLines').addEventListener('change', (e) => {
        AppState.allowLedgerLines = e.target.checked;
        refreshUpcomingMeasuresLive();
    });

    // Visual Aids toggles
    document.getElementById('chkShowChords').addEventListener('change', (e) => {
        AppState.showChords = e.target.checked;
        renderScore();
    });
    document.getElementById('chkShowRoman').addEventListener('change', (e) => {
        AppState.showRoman = e.target.checked;
        renderScore();
    });
    document.getElementById('chkHighlightGuideTones').addEventListener('change', (e) => {
        AppState.highlightGuideTones = e.target.checked;
        renderScore();
    });
    document.getElementById('selectNoteNames').addEventListener('change', (e) => {
        AppState.noteNameMode = e.target.value;
        renderScore();
    });

    // Cognitive Pedagogy & Mic Wait Controls (Mic Wait, Look-Ahead, Ear Training, Improvisation)
    document.getElementById('btnMicWait').addEventListener('click', () => {
        const nextMode = AppState.scrollMode === 'mic_wait' ? 'continuous' : 'mic_wait';
        setScrollMode(nextMode);
    });

    document.getElementById('btnLookAhead').addEventListener('click', () => {
        const order = ['off', 'beat', 'measure'];
        const next = order[(order.indexOf(AppState.lookAheadMode) + 1) % order.length];
        setLookAheadMode(next);
    });
    document.getElementById('selectLookAheadMode').addEventListener('change', (e) => {
        setLookAheadMode(e.target.value);
    });

    document.getElementById('btnEarTraining').addEventListener('click', () => {
        setEarTrainingEnabled(!AppState.earTrainingEnabled);
    });
    document.getElementById('chkEarTraining').addEventListener('change', (e) => {
        setEarTrainingEnabled(e.target.checked);
    });

    document.getElementById('btnImproMeasure').addEventListener('click', () => {
        setImproMeasureEnabled(!AppState.improMeasureEnabled);
    });
    document.getElementById('chkImproMeasure').addEventListener('change', (e) => {
        setImproMeasureEnabled(e.target.checked);
    });

    // Clicking the floating pedagogy badge reveals the current Ear Training measure if unrevealed
    document.getElementById('pedagogyActiveBanner').addEventListener('click', () => {
        const meas = getMeasureByIndex(AppState.currentMeasureIndex);
        if (meas && meas.isEarTraining && !meas.earRevealed) {
            meas.earRevealed = true;
            updateHudInfo();
            renderScore();
        }
    });

    // Save Custom Scenario (including chosen Sound Type)
    document.getElementById('btnSaveScenario').addEventListener('click', () => {
        const input = document.getElementById('inputScenarioName');
        const name = input.value.trim() || `Scénario ${AppState.rootKey} ${MODE_LABELS_FR[AppState.mode]}`;
        const list = loadSavedScenarios();
        list.unshift({
            name,
            tempo: AppState.tempo,
            soundType: AppState.soundType,
            reverb: Number(document.getElementById('sliderReverb').value),
            masterVolume: Math.round(AppState.masterVolume * 100),
            handBalance: Math.round(AppState.handBalance * 100),
            rootKey: AppState.rootKey,
            mode: AppState.mode,
            timeSig: AppState.timeSig,
            harmonicRichness: AppState.harmonicRichness,
            leftHandPattern: AppState.leftHandPattern,
            rightHandDensity: AppState.rightHandDensity,
            intervalLeap: AppState.intervalLeap,
            allowLedgerLines: AppState.allowLedgerLines,
            progressiveModulation: AppState.progressiveModulation,
            lookAheadMode: AppState.lookAheadMode,
            earTrainingEnabled: AppState.earTrainingEnabled,
            improMeasureEnabled: AppState.improMeasureEnabled
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 12)));
        input.value = '';
        renderSavedScenariosList();
    });

    // Score Canvas Touch-Scrubbing & Tap-to-Audition (Optimized for Smartphone Horizontal Mode)
    let isDraggingScore = false;
    let dragStartX = 0;
    let dragStartBeatGlobal = 0;
    let hasDraggedSignificantly = false;

    scoreCanvas.addEventListener('pointerdown', (e) => {
        if (AppState.viewLayout !== 'ribbon') return;
        isDraggingScore = true;
        hasDraggedSignificantly = false;
        dragStartX = e.clientX;
        const meas = getMeasureByIndex(AppState.currentMeasureIndex);
        const bpm = meas ? meas.beatsPerMeasure : 3;
        dragStartBeatGlobal = AppState.currentMeasureIndex * bpm + AppState.currentBeatFloat;
    });

    window.addEventListener('pointermove', (e) => {
        if (!isDraggingScore || AppState.viewLayout !== 'ribbon') return;
        const dx = e.clientX - dragStartX;
        if (Math.abs(dx) > 8) {
            hasDraggedSignificantly = true;
            const meas = getMeasureByIndex(AppState.currentMeasureIndex) || AppState.measures[0];
            if (!meas) return;
            const bpm = meas.beatsPerMeasure;
            const beatDelta = -(dx / 210) * bpm;
            const minGlobalBeat = AppState.measureWindowOffset * bpm;
            const targetGlobalBeat = Math.max(minGlobalBeat, dragStartBeatGlobal + beatDelta);

            AppState.currentMeasureIndex = Math.floor(targetGlobalBeat / bpm);
            AppState.currentBeatFloat = targetGlobalBeat % bpm;
            ensureInfiniteBuffer();
            updateHudInfo();
            renderScore();
        }
    });

    window.addEventListener('pointerup', () => {
        if (isDraggingScore && hasDraggedSignificantly && AppState.isPlaying) {
            resyncAudioScheduler();
        }
        isDraggingScore = false;
    });
    window.addEventListener('pointercancel', () => {
        isDraggingScore = false;
    });

    scoreCanvas.addEventListener('click', (e) => {
        if (hasDraggedSignificantly) {
            hasDraggedSignificantly = false;
            return;
        }
        audioEngine.init();
        const rect = scoreCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        for (const box of renderedBeatHitboxes) {
            if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) {
                AppState.currentMeasureIndex = box.measureIndex;
                AppState.currentBeatFloat = box.beat;
                ensureInfiniteBuffer();
                const meas = getMeasureByIndex(AppState.currentMeasureIndex);
                // If tapping an unrevealed Ear Training measure, reveal its hidden notes on second tap or if tapping upper staff
                if (meas && meas.isEarTraining && !meas.earRevealed && box.beat > 0) {
                    meas.earRevealed = true;
                }
                if (AppState.isPlaying) {
                    resyncAudioScheduler();
                } else if (meas) {
                    triggerMeasureBeatAudio(meas, box.beat, true);
                }
                updateHudInfo();
                renderScore();
                break;
            }
        }
    });

    // Re-render visible Page-View systems seamlessly when scrolling vertically
    const viewportContainer = document.getElementById('scoreViewportContainer');
    if (viewportContainer) {
        let pageScrollRaf = null;
        viewportContainer.addEventListener('scroll', () => {
            if (AppState.viewLayout !== 'page' || pageScrollRaf !== null) return;
            pageScrollRaf = requestAnimationFrame(() => {
                pageScrollRaf = null;
                renderScore();
            });
        }, { passive: true });
    }

    // Keyboard shortcuts (Space = Play/Pause, Right Arrow = Step Beat)
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        if (e.code === 'Space') {
            e.preventDefault();
            togglePlayPause();
        } else if (e.code === 'ArrowRight') {
            e.preventDefault();
            audioEngine.init();
            advanceOneSubBeatStep(true);
        }
    });

    // Responsive Resize & Orientation Change handler
    window.addEventListener('resize', () => {
        renderScore();
    });
    window.addEventListener('orientationchange', () => {
        setTimeout(renderScore, 120);
    });

    const btnInstallPWA = document.getElementById('btnInstallPWA');
    if (btnInstallPWA) {
        btnInstallPWA.addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
            deferredInstallPrompt = null;
            updatePWAStatusUI();
        });
    }
}

let deferredInstallPrompt = null;
let swRegistrationState = 'pending'; // 'pending' | 'ready' | 'error' | 'skipped'

function updatePWAStatusUI() {
    const badge = document.getElementById('pwaStatusBadge');
    const text = document.getElementById('pwaStatusText');
    const btn = document.getElementById('btnInstallPWA');
    if (!badge || !text) return;

    const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true;

    if (isStandalone) {
        badge.textContent = 'App active';
        badge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
        text.textContent = 'Mode application hors-ligne actif (Bravura & partition en cache).';
        if (btn) btn.classList.add('hidden');
        return;
    }

    if (window.location.protocol === 'file:') {
        badge.textContent = 'file://';
        badge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-studio-850 text-studio-400 border border-studio-700';
        text.textContent = 'Ouverture locale directe (file://). L\'app fonctionne hors-ligne ici, mais l\'installation PWA exige HTTPS ou http://localhost.';
        if (btn) btn.classList.add('hidden');
        return;
    }

    if (window.isSecureContext === false) {
        badge.textContent = 'HTTP LAN bloqué';
        badge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40';
        text.textContent = 'Un serveur Python HTTP sur IP LAN (192.168.x.x) est bloqué par le navigateur pour PWA/Micro. Utilisez HTTPS, localhost (ou adb reverse USB), ou un hébergement HTTPS statique.';
        if (btn) btn.classList.add('hidden');
        return;
    }

    if (deferredInstallPrompt) {
        badge.textContent = 'Prêt';
        badge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
        text.textContent = 'Service Worker actif. Cliquez ci-dessous pour installer hors-ligne.';
        if (btn) btn.classList.remove('hidden');
        return;
    }

    if (swRegistrationState === 'ready') {
        badge.textContent = 'Cache prêt';
        badge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
        text.textContent = 'Service Worker prêt : installez via le menu navigateur (Android : Installer / iOS Safari : Partager -> Écran d\'accueil).';
    } else if (swRegistrationState === 'error') {
        badge.textContent = 'Erreur SW';
        badge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40';
        text.textContent = 'Service Worker bloqué (certificat SSL invalide ou chemin incorrect).';
    } else {
        badge.textContent = 'En attente';
        badge.className = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-studio-850 text-studio-400 border border-studio-700';
        text.textContent = 'Initialisation du cache hors-ligne...';
    }
    if (btn) btn.classList.add('hidden');
}

function initPWAInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        updatePWAStatusUI();
    });
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        updatePWAStatusUI();
    });
    updatePWAStatusUI();
}

// Register offline Service Worker over HTTP/HTTPS origins (skipped on file://)
function registerServiceWorker() {
    if (window.location.protocol === 'file:' || window.isSecureContext === false || !('serviceWorker' in navigator)) {
        swRegistrationState = 'skipped';
        updatePWAStatusUI();
        return;
    }
    navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then(() => {
            swRegistrationState = 'ready';
            updatePWAStatusUI();
        })
        .catch((err) => {
            swRegistrationState = 'error';
            console.warn('Service Worker registration failed:', err);
            updatePWAStatusUI();
        });
}

// Application Bootstrap on window load
window.onload = function () {
    initPWAInstallPrompt();
    registerServiceWorker();
    bindEventListeners();
    renderSavedScenariosList();
    initWebMIDI();
    applyStylePreset('gymnopedie');
    if (document.fonts && document.fonts.load) {
        document.fonts.load('40px Bravura').then(() => {
            renderScore();
        }).catch(() => {});
    }
    requestAnimationFrame(animationLoop);
};
