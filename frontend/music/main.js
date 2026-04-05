import VoiceLeader from './voicing.js';
import { Chord, getCommonProgressions, getNextChords, getRandomChords, getVariations, detect, analyzeChordChoice, NOTE_NAMES, TONE_NOTE_NAMES } from './chord-theory.js';

const midiToFreq = midi => 440 * Math.pow(2, (midi - 69) / 12);
const midiToNote = midi => `${TONE_NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

class VoiceController {
  constructor(numVoices = 5) {
    this.voiceLeader = new VoiceLeader({ octaveRange: 2 });
    this.currentVoicing = null;
    this.numVoices = numVoices;
  }

  buildDefaultVoicing(chord) {
    const pcs = chord.pitchClasses;
    const voicing = [48 + pcs[0]];
    let baseOctave = 60;

    for (let i = 1; i < this.numVoices; i++) {
      const pc = i < pcs.length ? pcs[i] : pcs[(i - pcs.length) % (pcs.length - 1) + 1];
      let note = baseOctave + pc;
      if (voicing.length > 0 && note <= voicing[voicing.length - 1]) note += 12;
      if (note > 84) note -= 12;
      voicing.push(note);
    }

    return voicing.sort((a, b) => a - b);
  }

  getVoicing(chord) {
    let pitchClasses = chord.pitchClasses.slice(0, this.numVoices);

    while (pitchClasses.length < this.numVoices) {
      const doubleIdx = (pitchClasses.length - chord.pitchClasses.length) % (chord.pitchClasses.length - 1) + 1;
      pitchClasses.push(chord.pitchClasses[doubleIdx]);
    }

    if (!this.currentVoicing) {
      this.currentVoicing = this.buildDefaultVoicing(chord);
    } else {
      this.currentVoicing = this.voiceLeader.findClosestVoicingGreedy(this.currentVoicing, pitchClasses);
    }
    return [...this.currentVoicing];
  }

  setCustomVoicing(midiNotes) {
    this.currentVoicing = [...midiNotes].sort((a, b) => a - b);
    this.numVoices = midiNotes.length;
  }

  reset() {
    this.currentVoicing = null;
  }
}

class AudioEngine {
  constructor(numVoices, glideTime = 0.15) {
    this.synths = [];
    this.numVoices = numVoices;
    this.glideTime = glideTime;
    this.playing = false;
    this.bassSynth = null;
    this.bassEnabled = false;
    this.currentBassNote = null;
    this.currentNotes = [];
    this.touchSynths = [];
    this.touchSynthPool = [];
    this.activeTouches = new Map();
  }

  async init() {
    await Tone.start();

    for (let i = 0; i < this.numVoices; i++) {
      const synth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.05, decay: 0.1, sustain: 1, release: 0.3 },
        portamento: this.glideTime
      }).toDestination();
      synth.volume.value = -20;
      this.synths.push(synth);
    }

    this.bassSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.8, release: 0.1 }
    }).toDestination();
    this.bassSynth.volume.value = -16;

    await this.initTouchSynths();
  }

  async initTouchSynths() {
    if (this.touchSynths.length > 0) return;
    await Tone.start();

    for (let i = 0; i < 16; i++) {
      const synth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.15 }
      }).toDestination();
      synth.volume.value = -18;
      this.touchSynths.push(synth);
      this.touchSynthPool.push(synth);
    }
  }

  touchNoteOn(midi) {
    if (this.activeTouches.has(midi)) return false;
    if (this.touchSynthPool.length === 0) return false;

    const synth = this.touchSynthPool.pop();
    synth.triggerAttack(midiToNote(midi));
    this.activeTouches.set(midi, synth);
    return true;
  }

  touchNoteOff(midi) {
    const synth = this.activeTouches.get(midi);
    if (!synth) return false;

    synth.triggerRelease();
    this.activeTouches.delete(midi);
    this.touchSynthPool.push(synth);
    return true;
  }

  isTouchNotePlaying(midi) {
    return this.activeTouches.has(midi);
  }

  canPlayTouchNote() {
    return this.touchSynthPool.length > 0;
  }

  glideTo(midiNotes, rootPitchClass = null) {
    midiNotes.forEach((midi, i) => {
      if (i < this.synths.length) {
        const noteName = midiToNote(midi);
        if (this.playing) {
          this.synths[i].setNote(noteName);
        } else {
          this.synths[i].triggerAttack(noteName);
        }
      }
    });

    for (let i = midiNotes.length; i < this.synths.length; i++) {
      if (this.currentNotes[i]) this.synths[i].triggerRelease();
    }

    this.currentNotes = midiNotes.slice();

    if (this.bassEnabled && rootPitchClass !== null) {
      const bassNote = 36 + rootPitchClass;
      const bassNoteName = midiToNote(bassNote);
      if (this.currentBassNote !== null) {
        this.bassSynth.setNote(bassNoteName);
      } else {
        this.bassSynth.triggerAttack(bassNoteName);
      }
      this.currentBassNote = bassNote;
    } else if (this.currentBassNote !== null) {
      this.bassSynth.triggerRelease();
      this.currentBassNote = null;
    }

    this.playing = true;
  }

  setBassEnabled(enabled) {
    this.bassEnabled = enabled;
    if (!enabled && this.currentBassNote !== null) {
      this.bassSynth.triggerRelease();
      this.currentBassNote = null;
    }
  }

  setVoiceCount(count) {
    while (this.synths.length < count) {
      const synth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.05, decay: 0.1, sustain: 1, release: 0.3 },
        portamento: this.glideTime
      }).toDestination();
      synth.volume.value = -20;
      this.synths.push(synth);
    }
    this.numVoices = count;
  }

  stop() {
    this.synths.forEach(s => s.triggerRelease());
    if (this.bassSynth && this.currentBassNote !== null) this.bassSynth.triggerRelease();
    this.currentNotes = [];
    this.currentBassNote = null;
    this.playing = false;
  }

  setChordVolume(percent) {
    const db = percent === 0 ? -Infinity : (percent / 100) * 55 - 60;
    this.synths.forEach(synth => synth.volume.value = db);
  }

  setBassVolume(percent) {
    const db = percent === 0 ? -Infinity : (percent / 100) * 55 - 60;
    if (this.bassSynth) this.bassSynth.volume.value = db;
  }

  setTouchVolume(percent) {
    const db = percent === 0 ? -Infinity : (percent / 100) * 55 - 60;
    this.touchSynths.forEach(synth => synth.volume.value = db);
  }
}

function createPiano(container, startMidi = 48, endMidi = 84) {
  container.innerHTML = '';

  for (let midi = startMidi; midi <= endMidi; midi++) {
    const pc = midi % 12;
    if (![1, 3, 6, 8, 10].includes(pc)) {
      const key = document.createElement('div');
      key.className = 'white-key';
      key.dataset.midi = midi;
      container.appendChild(key);
    }
  }

  const whiteKeys = [...container.querySelectorAll('.white-key')];
  let whiteIndex = 0;

  for (let midi = startMidi; midi <= endMidi; midi++) {
    const pc = midi % 12;
    if ([1, 3, 6, 8, 10].includes(pc)) {
      const key = document.createElement('div');
      key.className = 'black-key';
      key.dataset.midi = midi;
      const whiteKey = whiteKeys[whiteIndex - 1];
      key.style.left = `${whiteKey.offsetLeft + whiteKey.offsetWidth - 9}px`;
      container.appendChild(key);
    } else {
      whiteIndex++;
    }
  }
}

function highlightKeys(container, midiNotes) {
  container.querySelectorAll('.active').forEach(k => k.classList.remove('active'));
  midiNotes.forEach(midi => {
    const key = container.querySelector(`[data-midi="${midi}"]`);
    if (key) key.classList.add('active');
  });
}

const NUM_VOICES = 5;
const controller = new VoiceController(NUM_VOICES);
let audio = null;
let touchAudio = null;
let currentKey = 0;
let currentChord = null;
let transposeAmount = 0;
let chordHistory = [];
let fullHistory = [];
const MAX_VISIBLE_HISTORY = 4;
const STORAGE_KEY = 'voiceLeadingSynth_chordHistory';
let isDragging = false;
let dragStartVoicing = null;
let dragStartChord = null;
let dragNoteIndex = -1;
let lastDragMidi = -1;

function loadHistory() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      fullHistory = parsed.map(item => new Chord(item.root, item.quality));
    }
  } catch (e) {
    fullHistory = [];
  }
}

function saveHistory() {
  try {
    const toSave = fullHistory.map(chord => ({ root: chord.root, quality: chord.quality }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {}
}

async function ensureTouchAudio() {
  if (touchAudio) return touchAudio;
  if (audio) {
    await audio.initTouchSynths();
    return audio;
  }
  touchAudio = new AudioEngine(0, 0);
  await touchAudio.initTouchSynths();
  touchAudio.setTouchVolume(parseInt(volPianoSlider.value));
  return touchAudio;
}

const pianoEl = document.getElementById('piano');
const chordDisplayContainerEl = document.getElementById('chord-display-container');
const chordDisplayEl = document.getElementById('chord-display');
const chordHistoryEl = document.getElementById('chord-history');
const chordNameEl = document.getElementById('chord-name');
const sheetMusicEl = document.getElementById('sheet-music');
const chordButtonsEl = document.getElementById('chord-buttons');
const startBtn = document.getElementById('start-btn');
const bassToggle = document.getElementById('bass-toggle');
const volChordSlider = document.getElementById('vol-chord');
const volBassSlider = document.getElementById('vol-bass');
const volPianoSlider = document.getElementById('vol-piano');
const octaveUpBtn = document.getElementById('octave-up');
const octaveDownBtn = document.getElementById('octave-down');
const inversionUpBtn = document.getElementById('inversion-up');
const inversionDownBtn = document.getElementById('inversion-down');
const keyboardLeftBtn = document.getElementById('keyboard-left');
const keyboardRightBtn = document.getElementById('keyboard-right');
const historyModal = document.getElementById('history-modal');
const historyModalList = document.getElementById('history-modal-list');
const historyModalClose = document.getElementById('history-modal-close');
const transposeSelect = document.getElementById('transpose-select');

function getTransposedSymbol(chord) {
  if (!chord) return '—';
  const transposedRoot = (chord.root + transposeAmount) % 12;
  return NOTE_NAMES[transposedRoot] + chord.typeData.symbol;
}

function getPianoKeys() {
  return window.innerWidth < 600 ? 2 * 12 + 1 : 4 * 12 + 1;
}

let pianoKeys = getPianoKeys();
let pianoStartMidi = 48;
const PIANO_MIN_START = 24;
const PIANO_MAX_START = 84;

loadHistory();

function updateKeyboardButtons() {
  keyboardLeftBtn.disabled = pianoStartMidi <= PIANO_MIN_START;
  keyboardRightBtn.disabled = pianoStartMidi + pianoKeys - 1 >= 108;
}

function rebuildPiano() {
  pianoKeys = getPianoKeys();
  createPiano(pianoEl, pianoStartMidi, pianoStartMidi + pianoKeys - 1);
  if (controller.currentVoicing && controller.currentVoicing.length > 0) {
    highlightKeys(pianoEl, controller.currentVoicing);
  }
  updateKeyboardButtons();
}

rebuildPiano();

let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const newKeys = getPianoKeys();
    if (newKeys !== pianoKeys) rebuildPiano();
  }, 150);
});

const NOTE_LETTERS = ['c', 'c', 'd', 'd', 'e', 'f', 'f', 'g', 'g', 'a', 'a', 'b'];
const NOTE_ACCIDENTALS = ['', '#', '', '#', '', '', '#', '', '#', '', '#', ''];

function midiToVexKey(midi) {
  const pitchClass = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  return { key: `${NOTE_LETTERS[pitchClass]}/${octave}`, accidental: NOTE_ACCIDENTALS[pitchClass] };
}

function renderSheetMusic(midiNotes, playingNotes = []) {
  sheetMusicEl.innerHTML = '';

  const chordSet = new Set(midiNotes || []);
  const playingSet = new Set(playingNotes || []);
  const allNotesSet = new Set([...chordSet, ...playingSet]);

  if (allNotesSet.size === 0) return;

  try {
    const VF = Vex.Flow;
    const renderer = new VF.Renderer(sheetMusicEl, VF.Renderer.Backends.SVG);
    renderer.resize(200, 140);
    const context = renderer.getContext();
    context.scale(0.8, 0.8);

    let allNotes = [...allNotesSet];

    if (bassToggle.classList.contains('active') && currentChord) {
      const bassRootMidi = 36 + currentChord.root;
      if (!allNotes.includes(bassRootMidi)) allNotes.push(bassRootMidi);
    }

    const sorted = allNotes.sort((a, b) => a - b);
    const bassNotes = sorted.filter(m => m < 60);
    const trebleNotes = sorted.filter(m => m >= 60);

    const trebleStave = new VF.Stave(0, 0, 220);
    trebleStave.addClef('treble');
    trebleStave.setContext(context).draw();

    const bassStave = new VF.Stave(0, 70, 220);
    bassStave.addClef('bass');
    bassStave.setContext(context).draw();

    function drawNotes(notes, clef, stave) {
      if (notes.length === 0) return;

      const keys = notes.map(m => midiToVexKey(m));
      const staveNote = new VF.StaveNote({
        clef: clef,
        keys: keys.map(k => k.key),
        duration: 'w'
      });

      keys.forEach((k, i) => {
        if (k.accidental) staveNote.addModifier(new VF.Accidental(k.accidental), i);
        const midi = notes[i];
        if (playingSet.has(midi) && !chordSet.has(midi)) {
          staveNote.setKeyStyle(i, { fillStyle: '#2196F3', strokeStyle: '#2196F3' });
        }
      });

      const voice = new VF.Voice({ num_beats: 4, beat_value: 4 }).setStrict(false);
      voice.addTickables([staveNote]);
      new VF.Formatter().joinVoices([voice]).format([voice], 100);
      voice.draw(context, stave);
    }

    drawNotes(trebleNotes, 'treble', trebleStave);
    drawNotes(bassNotes, 'bass', bassStave);
  } catch (e) {}
}

function updateSheetMusic() {
  const voicing = controller.currentVoicing || [];
  const playing = [...pressedKeys];
  renderSheetMusic(voicing, playing);

  const allNotes = [...new Set([...voicing, ...playing])];
  if (allNotes.length > 0) {
    updateChordSymbol(allNotes);
  }
}

function updateChordSymbol(midiNotes, rebuildUI = true) {
  if (!midiNotes || midiNotes.length === 0) {
    chordNameEl.textContent = '—';
    return null;
  }

  const pitchClasses = midiNotes.map(m => m % 12);
  const detectedChord = detect(pitchClasses);

  if (detectedChord) {
    chordNameEl.textContent = getTransposedSymbol(detectedChord);
    if (rebuildUI && (!currentChord || detectedChord.symbol !== currentChord.symbol)) {
      currentChord = detectedChord;
      buildChordUI();
    }
    return detectedChord;
  } else {
    const noteNames = [...new Set(pitchClasses)].sort((a, b) => a - b).map(pc => NOTE_NAMES[(pc + transposeAmount) % 12]);
    chordNameEl.textContent = noteNames.join(' ');
    return null;
  }
}

bassToggle.addEventListener('click', () => {
  bassToggle.classList.toggle('active');
  const isEnabled = bassToggle.classList.contains('active');
  if (audio) {
    audio.setBassEnabled(isEnabled);
    if (isEnabled && currentChord) {
      audio.glideTo(controller.currentVoicing || [], currentChord.root);
    }
  }
  if (controller.currentVoicing && controller.currentVoicing.length > 0) {
    renderSheetMusic(controller.currentVoicing);
  }
});

transposeSelect.addEventListener('change', () => {
  transposeAmount = parseInt(transposeSelect.value);
  if (currentChord) chordNameEl.textContent = getTransposedSymbol(currentChord);
  renderHistory();
  buildChordUI();
});

volChordSlider.addEventListener('input', () => { if (audio) audio.setChordVolume(parseInt(volChordSlider.value)); });
volBassSlider.addEventListener('input', () => { if (audio) audio.setBassVolume(parseInt(volBassSlider.value)); });
volPianoSlider.addEventListener('input', () => { if (audio) audio.setTouchVolume(parseInt(volPianoSlider.value)); });

function transposeVoicing(semitones) {
  if (!audio || !controller.currentVoicing || controller.currentVoicing.length === 0) return;

  const newVoicing = controller.currentVoicing.map(midi => midi + semitones);
  if (newVoicing.some(m => m < 36 || m > 96)) return;

  controller.currentVoicing = newVoicing;
  const detectedChord = updateChordSymbol(newVoicing);
  if (detectedChord) currentChord = detectedChord;
  audio.glideTo(newVoicing, currentChord?.root ?? null);
  renderSheetMusic(newVoicing);
  highlightKeys(pianoEl, newVoicing);
}

octaveUpBtn.addEventListener('click', () => transposeVoicing(12));
octaveDownBtn.addEventListener('click', () => transposeVoicing(-12));

function shiftInversion(direction) {
  if (!audio || !controller.currentVoicing || controller.currentVoicing.length === 0 || !currentChord) return;

  const chordTones = currentChord.pitchClasses;
  const newVoicing = controller.currentVoicing.map(midi => {
    const pc = midi % 12;
    const octave = Math.floor(midi / 12);
    const currentIdx = chordTones.indexOf(pc);
    if (currentIdx === -1) return midi + direction;

    const nextIdx = (currentIdx + direction + chordTones.length) % chordTones.length;
    const nextPc = chordTones[nextIdx];
    let newMidi = octave * 12 + nextPc;

    if (direction > 0 && nextPc <= pc) newMidi += 12;
    if (direction < 0 && nextPc >= pc) newMidi -= 12;

    return newMidi;
  });

  if (newVoicing.some(m => m < 36 || m > 96)) return;

  controller.currentVoicing = newVoicing;
  const detectedChord = updateChordSymbol(newVoicing);
  if (detectedChord) currentChord = detectedChord;
  audio.glideTo(newVoicing, currentChord?.root ?? null);
  renderSheetMusic(newVoicing);
  highlightKeys(pianoEl, newVoicing);
}

inversionUpBtn.addEventListener('click', () => shiftInversion(1));
inversionDownBtn.addEventListener('click', () => shiftInversion(-1));

keyboardLeftBtn.addEventListener('click', () => {
  if (pianoStartMidi > PIANO_MIN_START) { pianoStartMidi -= 12; rebuildPiano(); }
});
keyboardRightBtn.addEventListener('click', () => {
  if (pianoStartMidi < PIANO_MAX_START) { pianoStartMidi += 12; rebuildPiano(); }
});

const pressedKeys = new Set();

function getTouchEngine() {
  if (audio && audio.touchSynths.length > 0) return audio;
  if (touchAudio && touchAudio.touchSynths.length > 0) return touchAudio;
  return null;
}

async function handleKeyDown(midi, keyEl) {
  if (pressedKeys.has(midi)) return;

  const engine = getTouchEngine() || await ensureTouchAudio();
  if (!engine) return;

  if (engine.touchNoteOn(midi)) {
    pressedKeys.add(midi);
    keyEl.classList.add('playing');
    updateSheetMusic();
  }
}

function handleKeyUp(midi, keyEl) {
  if (!pressedKeys.has(midi)) return;

  const engine = getTouchEngine();
  if (engine) engine.touchNoteOff(midi);
  pressedKeys.delete(midi);
  keyEl.classList.remove('playing');
  updateSheetMusic();
}

function getKeyAndMidi(e) {
  const key = e.target.closest('[data-midi]');
  if (!key) return null;
  return { key, midi: parseInt(key.dataset.midi) };
}

pianoEl.addEventListener('mousedown', async (e) => {
  const data = getKeyAndMidi(e);
  if (data) await handleKeyDown(data.midi, data.key);
});

pianoEl.addEventListener('mouseup', (e) => {
  const data = getKeyAndMidi(e);
  if (data) handleKeyUp(data.midi, data.key);
});

document.addEventListener('mouseup', () => {
  pressedKeys.forEach(midi => {
    const keyEl = pianoEl.querySelector(`[data-midi="${midi}"]`);
    if (keyEl) handleKeyUp(midi, keyEl);
  });
});

pianoEl.addEventListener('mouseleave', () => {
  pressedKeys.forEach(midi => {
    const keyEl = pianoEl.querySelector(`[data-midi="${midi}"]`);
    if (keyEl) handleKeyUp(midi, keyEl);
  });
});

pianoEl.addEventListener('mouseover', async (e) => {
  if (e.buttons !== 1) return;
  const data = getKeyAndMidi(e);
  if (data) await handleKeyDown(data.midi, data.key);
});

pianoEl.addEventListener('mouseout', (e) => {
  if (e.buttons !== 1) return;
  const data = getKeyAndMidi(e);
  if (data) handleKeyUp(data.midi, data.key);
});

pianoEl.addEventListener('touchstart', async (e) => {
  e.preventDefault();
  for (const touch of e.changedTouches) {
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const key = el?.closest('[data-midi]');
    if (key) await handleKeyDown(parseInt(key.dataset.midi), key);
  }
}, { passive: false });

pianoEl.addEventListener('touchend', (e) => {
  e.preventDefault();
  for (const touch of e.changedTouches) {
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const key = el?.closest('[data-midi]');
    if (key) handleKeyUp(parseInt(key.dataset.midi), key);
  }
}, { passive: false });

pianoEl.addEventListener('touchcancel', () => {
  pressedKeys.forEach(midi => {
    const keyEl = pianoEl.querySelector(`[data-midi="${midi}"]`);
    if (keyEl) handleKeyUp(midi, keyEl);
  });
}, { passive: false });

const touchMidiMap = new Map();

pianoEl.addEventListener('touchmove', async (e) => {
  if (isDragging) return;
  e.preventDefault();

  const currentTouchMidis = new Set();

  for (const touch of e.touches) {
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const key = el?.closest('[data-midi]');
    if (key) {
      const midi = parseInt(key.dataset.midi);
      currentTouchMidis.add(midi);

      const prevMidi = touchMidiMap.get(touch.identifier);
      if (prevMidi !== midi) {
        if (prevMidi !== undefined) {
          const prevKey = pianoEl.querySelector(`[data-midi="${prevMidi}"]`);
          if (prevKey) handleKeyUp(prevMidi, prevKey);
        }
        await handleKeyDown(midi, key);
        touchMidiMap.set(touch.identifier, midi);
      }
    }
  }
}, { passive: false });

pianoEl.addEventListener('touchstart', (e) => {
  for (const touch of e.changedTouches) {
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const key = el?.closest('[data-midi]');
    if (key) touchMidiMap.set(touch.identifier, parseInt(key.dataset.midi));
  }
}, { passive: true, capture: true });

pianoEl.addEventListener('touchend', (e) => {
  for (const touch of e.changedTouches) {
    touchMidiMap.delete(touch.identifier);
  }
}, { passive: true, capture: true });

function startNoteDrag(midi) {
  if (!audio || !controller.currentVoicing || controller.currentVoicing.length === 0) return false;

  const noteIndex = controller.currentVoicing.indexOf(midi);
  if (noteIndex === -1) return false;

  isDragging = true;
  dragStartVoicing = [...controller.currentVoicing];
  dragStartChord = currentChord;
  dragNoteIndex = noteIndex;
  lastDragMidi = midi;
  document.body.style.cursor = 'ew-resize';
  return true;
}

function updateNoteDrag(newMidi) {
  if (!isDragging || dragNoteIndex === -1) return;
  if (newMidi === lastDragMidi) return;
  if (newMidi < 36 || newMidi > 96) return;
  if (controller.currentVoicing.includes(newMidi) && newMidi !== lastDragMidi) return;

  lastDragMidi = newMidi;

  const newVoicing = [...controller.currentVoicing];
  newVoicing[dragNoteIndex] = newMidi;
  newVoicing.sort((a, b) => a - b);
  dragNoteIndex = newVoicing.indexOf(newMidi);

  controller.currentVoicing = newVoicing;

  const detectedChord = updateChordSymbol(newVoicing);
  if (detectedChord) currentChord = detectedChord;

  audio.glideTo(newVoicing, currentChord?.root ?? null);
  renderSheetMusic(newVoicing);
  highlightKeys(pianoEl, newVoicing);
}

function endNoteDrag() {
  if (!isDragging) return;

  const changed = !dragStartVoicing.every(m => controller.currentVoicing.includes(m)) ||
                  !controller.currentVoicing.every(m => dragStartVoicing.includes(m));

  if (changed && dragStartChord) addToHistory(dragStartChord);

  isDragging = false;
  dragStartVoicing = null;
  dragStartChord = null;
  dragNoteIndex = -1;
  lastDragMidi = -1;
  document.body.style.cursor = '';
}

function isInCurrentVoicing(midi) {
  return controller.currentVoicing && controller.currentVoicing.includes(midi);
}

function getMidiFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const key = el?.closest('[data-midi]');
  return key ? parseInt(key.dataset.midi) : null;
}

pianoEl.addEventListener('mousedown', (e) => {
  const key = e.target.closest('[data-midi]');
  if (!key) return;

  const midi = parseInt(key.dataset.midi);
  if (isInCurrentVoicing(midi) && audio && startNoteDrag(midi)) {
    e.preventDefault();
    e.stopPropagation();
  }
}, { capture: true });

document.addEventListener('mousemove', (e) => {
  if (isDragging) {
    e.preventDefault();
    const midi = getMidiFromPoint(e.clientX, e.clientY);
    if (midi !== null) updateNoteDrag(midi);
  }
});

document.addEventListener('mouseup', () => endNoteDrag());

pianoEl.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;

  const touch = e.touches[0];
  const midi = getMidiFromPoint(touch.clientX, touch.clientY);
  if (midi !== null && isInCurrentVoicing(midi) && audio && startNoteDrag(midi)) {
    e.preventDefault();
    e.stopPropagation();
  }
}, { capture: true, passive: false });

document.addEventListener('touchmove', (e) => {
  if (isDragging && e.touches.length === 1) {
    e.preventDefault();
    const midi = getMidiFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    if (midi !== null) updateNoteDrag(midi);
  }
}, { passive: false });

document.addEventListener('touchend', () => endNoteDrag());

function addToHistory(chord) {
  if (!chord) return;
  if (fullHistory.length > 0 && fullHistory[fullHistory.length - 1].symbol === chord.symbol) return;

  fullHistory.push(chord);
  saveHistory();

  chordHistory.push(chord);
  if (chordHistory.length > MAX_VISIBLE_HISTORY) chordHistory.shift();
  renderHistory();
}

function renderHistory() {
  chordHistoryEl.innerHTML = '';

  if (fullHistory.length > chordHistory.length) {
    const ellipsis = document.createElement('button');
    ellipsis.className = 'history-chip';
    ellipsis.textContent = '···';
    ellipsis.title = `View all ${fullHistory.length} chords`;
    ellipsis.addEventListener('click', openHistoryModal);
    chordHistoryEl.appendChild(ellipsis);
  }

  chordHistory.forEach((chord) => {
    const item = document.createElement('span');
    item.className = 'history-chip';
    item.textContent = getTransposedSymbol(chord);
    item.title = `Click to play ${getTransposedSymbol(chord)}`;
    item.addEventListener('click', () => playChord(chord));
    chordHistoryEl.appendChild(item);
  });
}

function openHistoryModal() {
  historyModalList.innerHTML = '';

  [...fullHistory].reverse().forEach((chord) => {
    const item = document.createElement('button');
    item.className = 'history-modal-item';
    item.textContent = getTransposedSymbol(chord);
    item.addEventListener('click', () => { playChord(chord); closeHistoryModal(); });
    historyModalList.appendChild(item);
  });

  historyModal.classList.add('open');
}

function closeHistoryModal() {
  historyModal.classList.remove('open');
}

historyModalClose.addEventListener('click', closeHistoryModal);
historyModal.addEventListener('click', (e) => { if (e.target === historyModal) closeHistoryModal(); });

async function playChord(chord) {
  if (!audio) await startAudio();
  if (!audio) return;

  if (currentChord && currentChord.symbol !== chord.symbol) addToHistory(currentChord);

  currentChord = chord;
  const voicing = controller.getVoicing(chord);
  audio.glideTo(voicing, chord.root);

  chordDisplayContainerEl.classList.remove('inactive');
  chordNameEl.textContent = getTransposedSymbol(chord);
  renderSheetMusic(voicing);
  highlightKeys(pianoEl, voicing);
  buildChordUI();
}

const SECTION_HINTS = {
  'Current': 'same root, different color',
  'Diatonic': 'stay in key',
  'Resolution': 'resolve tension',
  'Modal': 'borrow & color',
  'Substitution': 'reharmonize',
  'Random': 'explore freely',
};

const HINT_LABELS = {
  'safe': 'Smooth voice leading',
  'interesting': 'Adds color/tension',
  'classic': 'Classic jazz move'
};

function createChordGroup(label, options, container) {
  if (!options || options.length === 0) return;

  const row = document.createElement('div');
  row.className = 'chord-row';

  const labelEl = document.createElement('div');
  labelEl.className = 'chord-row-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const buttons = document.createElement('div');
  buttons.className = 'chord-row-buttons';

  options.forEach(opt => {
    const chord = opt.chord || opt;
    const btn = document.createElement('button');
    btn.className = 'chord-btn';
    btn.textContent = getTransposedSymbol(chord);

    if (currentChord) {
      const hintType = analyzeChordChoice(currentChord, chord, currentKey);
      if (hintType) {
        btn.classList.add(`hint-${hintType}`);
        btn.title = opt.description ? `${opt.description} • ${HINT_LABELS[hintType]}` : HINT_LABELS[hintType];
      }
    }

    if (opt.description && !btn.title) btn.title = opt.description;
    btn.addEventListener('click', () => playChord(chord));
    buttons.appendChild(btn);
  });

  row.appendChild(buttons);
  container.appendChild(row);
}

const STABLE_CATEGORIES = [
  { key: 'current', label: 'Current' },
  { key: 'diatonic', label: 'Diatonic' },
  { key: 'resolution', label: 'Resolution' },
  { key: 'modal', label: 'Modal' },
  { key: 'substitution', label: 'Substitution' },
  { key: 'random', label: 'Random' },
];

function buildChordUI() {
  chordButtonsEl.innerHTML = '';

  if (!currentChord) {
    const progressions = getCommonProgressions(currentKey);
    createChordGroup('Current', [new Chord(currentKey, 'maj7')], chordButtonsEl);
    createChordGroup('Diatonic', progressions.diatonic, chordButtonsEl);
    createChordGroup('Resolution', [new Chord(currentKey, 'maj7')], chordButtonsEl);
    createChordGroup('Modal', progressions.substitutions, chordButtonsEl);
    createChordGroup('Substitution', progressions.dominants, chordButtonsEl);
    createChordGroup('Random', getRandomChords(6), chordButtonsEl);
    return;
  }

  const nextOptions = getNextChords(currentChord, currentKey);
  const grouped = { current: [], diatonic: [], resolution: [], modal: [], substitution: [] };

  nextOptions.forEach(opt => {
    const cat = opt.category || 'diatonic';
    if (cat === 'diatonic' || cat === 'turnaround' || cat === 'secondary') grouped.diatonic.push(opt);
    else if (cat === 'resolution' || cat === 'plagal' || cat === 'backdoor') grouped.resolution.push(opt);
    else if (cat === 'modal' || cat === 'deceptive') grouped.modal.push(opt);
    else if (cat === 'substitution' || cat === 'altered') grouped.substitution.push(opt);
    else grouped.diatonic.push(opt);
  });

  createChordGroup('Current', getVariations(currentChord), chordButtonsEl);

  const progressions = getCommonProgressions(currentKey);
  if (grouped.diatonic.length === 0) grouped.diatonic = progressions.diatonic.map(c => ({ chord: c }));
  if (grouped.resolution.length === 0) grouped.resolution = [{ chord: new Chord(currentKey, 'maj7') }, { chord: new Chord(currentKey, '6') }];
  if (grouped.modal.length === 0) grouped.modal = progressions.substitutions.slice(2).map(c => ({ chord: c }));
  if (grouped.substitution.length === 0) grouped.substitution = progressions.dominants.map(c => ({ chord: c }));

  createChordGroup('Diatonic', grouped.diatonic, chordButtonsEl);
  createChordGroup('Resolution', grouped.resolution, chordButtonsEl);
  createChordGroup('Modal', grouped.modal, chordButtonsEl);
  createChordGroup('Substitution', grouped.substitution, chordButtonsEl);
  createChordGroup('Random', getRandomChords(6), chordButtonsEl);
}

buildChordUI();

async function startAudio() {
  if (audio) return;

  startBtn.textContent = '⏳';
  startBtn.disabled = true;

  audio = new AudioEngine(NUM_VOICES, 0.2);
  await audio.init();

  audio.setChordVolume(parseInt(volChordSlider.value));
  audio.setBassVolume(parseInt(volBassSlider.value));
  audio.setTouchVolume(parseInt(volPianoSlider.value));

  touchAudio = null;

  playChord(new Chord(currentKey, 'maj7'));

  startBtn.textContent = '■';
  startBtn.classList.add('playing');
  startBtn.disabled = false;
}

function stopAudio() {
  if (!audio) return;

  audio.stop();
  if (audio.touchSynths.length > 0) touchAudio = audio;
  audio = null;
  currentChord = null;
  chordHistory = [];
  controller.reset();

  startBtn.textContent = '▶';
  startBtn.classList.remove('playing');
  chordDisplayContainerEl.classList.add('inactive');
  chordNameEl.textContent = '—';
  sheetMusicEl.innerHTML = '';
  chordHistoryEl.innerHTML = '';
  highlightKeys(pianoEl, []);
  buildChordUI();
}

function toggleAudio() {
  audio ? stopAudio() : startAudio();
}

startBtn.addEventListener('click', toggleAudio);

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.code === 'Space') {
    e.preventDefault();
    toggleAudio();
  } else if (e.code === 'Escape' && historyModal.classList.contains('open')) {
    closeHistoryModal();
  }
});

// MIDI Support
async function initMIDI() {
  if (!navigator.requestMIDIAccess) {
    console.log('Web MIDI API not supported');
    return;
  }

  try {
    const midiAccess = await navigator.requestMIDIAccess();

    function onMIDIMessage(e) {
      const [status, note, velocity] = e.data;
      const command = status & 0xf0;

      // Note On (0x90) with velocity > 0, or Note Off (0x80)
      if (command === 0x90 && velocity > 0) {
        midiNoteOn(note);
      } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
        midiNoteOff(note);
      }
    }

    function connectInputs(midiAccess) {
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = onMIDIMessage;
        console.log(`MIDI connected: ${input.name}`);
      }
    }

    connectInputs(midiAccess);

    midiAccess.onstatechange = (e) => {
      if (e.port.type === 'input') {
        if (e.port.state === 'connected') {
          e.port.onmidimessage = onMIDIMessage;
          console.log(`MIDI connected: ${e.port.name}`);
        } else {
          console.log(`MIDI disconnected: ${e.port.name}`);
        }
      }
    };

    console.log('MIDI initialized');
  } catch (err) {
    console.log('MIDI access denied:', err);
  }
}

async function midiNoteOn(midi) {
  const engine = getTouchEngine() || await ensureTouchAudio();
  if (!engine) return;

  if (engine.touchNoteOn(midi)) {
    pressedKeys.add(midi);
    const keyEl = pianoEl.querySelector(`[data-midi="${midi}"]`);
    if (keyEl) keyEl.classList.add('playing');
    updateSheetMusic();
  }
}

function midiNoteOff(midi) {
  if (!pressedKeys.has(midi)) return;

  const engine = getTouchEngine();
  if (engine) engine.touchNoteOff(midi);
  pressedKeys.delete(midi);
  const keyEl = pianoEl.querySelector(`[data-midi="${midi}"]`);
  if (keyEl) keyEl.classList.remove('playing');
  updateSheetMusic();
}

initMIDI();
