const NOTE_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const TONE_NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const INTERVALS = {
  ROOT: 0,
  MINOR_2ND: 1, MAJOR_2ND: 2,
  MINOR_3RD: 3, MAJOR_3RD: 4,
  PERFECT_4TH: 5, TRITONE: 6, PERFECT_5TH: 7,
  MINOR_6TH: 8, MAJOR_6TH: 9,
  MINOR_7TH: 10, MAJOR_7TH: 11,
  OCTAVE: 12,
  FLAT_9TH: 13, NINTH: 14, SHARP_9TH: 15,
  ELEVENTH: 17, SHARP_11TH: 18,
  FLAT_13TH: 20, THIRTEENTH: 21,
};

const TRIAD = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

export function triad(type) {
  return [...(TRIAD[type] || TRIAD.major)];
}

export function add7th(intervals, type = 'dominant') {
  const seventh = { major: 11, dominant: 10, minor: 10, diminished: 9 };
  return [...intervals, seventh[type] ?? 10];
}

export function extend(intervals, degree) {
  const extensions = { 9: 14, 11: 17, 13: 21 };
  return extensions[degree] ? [...intervals, extensions[degree]] : intervals;
}

export function alter(intervals, alterations) {
  const result = [...intervals];
  const altMap = {
    'b5': { from: 7, to: 6 },
    '#5': { from: 7, to: 8 },
    'b9': { add: 13 },
    '#9': { add: 15 },
    'b13': { add: 20 },
    '#11': { add: 18 },
  };

  alterations.forEach(alt => {
    const rule = altMap[alt];
    if (rule) {
      if (rule.from !== undefined) {
        const idx = result.indexOf(rule.from);
        if (idx !== -1) result[idx] = rule.to;
      }
      if (rule.add !== undefined && !result.includes(rule.add)) {
        result.push(rule.add);
      }
    }
  });

  return result.sort((a, b) => a - b);
}

export const CHORD_TYPES = {
  '': { intervals: triad('major'), symbol: '', category: 'triad' },
  'm': { intervals: triad('minor'), symbol: 'm', category: 'triad' },
  'dim': { intervals: triad('diminished'), symbol: '°', category: 'triad' },
  'aug': { intervals: triad('augmented'), symbol: '+', category: 'triad' },
  'sus2': { intervals: [0, 2, 7], symbol: 'sus2', category: 'triad' },
  'sus4': { intervals: triad('sus4'), symbol: 'sus4', category: 'triad' },
  'maj7': { intervals: add7th(triad('major'), 'major'), symbol: 'Δ7', category: 'seventh' },
  '7': { intervals: add7th(triad('major'), 'dominant'), symbol: '7', category: 'dominant' },
  'm7': { intervals: add7th(triad('minor'), 'minor'), symbol: 'm7', category: 'seventh' },
  'm7b5': { intervals: add7th(triad('diminished'), 'minor'), symbol: 'ø7', category: 'seventh' },
  'dim7': { intervals: add7th(triad('diminished'), 'diminished'), symbol: '°7', category: 'seventh' },
  'mMaj7': { intervals: add7th(triad('minor'), 'major'), symbol: 'mΔ7', category: 'seventh' },
  '7sus4': { intervals: [0, 5, 7, 10], symbol: '7sus4', category: 'dominant' },
  'add9': { intervals: [0, 4, 7, 14], symbol: 'add9', category: 'triad' },
  'madd9': { intervals: [0, 3, 7, 14], symbol: 'm(add9)', category: 'triad' },
  '6': { intervals: [0, 4, 7, 9], symbol: '6', category: 'sixth' },
  'm6': { intervals: [0, 3, 7, 9], symbol: 'm6', category: 'sixth' },
  'maj9': { intervals: extend(add7th(triad('major'), 'major'), 9), symbol: 'Δ9', category: 'extended' },
  '9': { intervals: extend(add7th(triad('major'), 'dominant'), 9), symbol: '9', category: 'dominant' },
  'm9': { intervals: extend(add7th(triad('minor'), 'minor'), 9), symbol: 'm9', category: 'extended' },
  '11': { intervals: extend(extend(add7th(triad('major'), 'dominant'), 9), 11), symbol: '11', category: 'dominant' },
  'm11': { intervals: extend(extend(add7th(triad('minor'), 'minor'), 9), 11), symbol: 'm11', category: 'extended' },
  '13': { intervals: extend(extend(extend(add7th(triad('major'), 'dominant'), 9), 11), 13), symbol: '13', category: 'dominant' },
  '7b5': { intervals: alter(add7th(triad('major'), 'dominant'), ['b5']), symbol: '7♭5', category: 'altered' },
  '7#5': { intervals: alter(add7th(triad('major'), 'dominant'), ['#5']), symbol: '7♯5', category: 'altered' },
  '7b9': { intervals: alter(add7th(triad('major'), 'dominant'), ['b9']), symbol: '7♭9', category: 'altered' },
  '7#9': { intervals: alter(add7th(triad('major'), 'dominant'), ['#9']), symbol: '7♯9', category: 'altered' },
  '7alt': { intervals: alter(add7th(triad('major'), 'dominant'), ['b5', '#5', 'b9', '#9']), symbol: '7alt', category: 'altered' },
};

const VARIATION_GROUPS = {
  major: ['', 'maj7', 'maj9', '6', 'add9', 'sus2', 'sus4'],
  minor: ['m', 'm7', 'm9', 'm6', 'madd9', 'm11'],
  dominant: ['7', '9', '11', '13', '7sus4', '7b9', '7#9', '7alt'],
};

export function getVariations(chord) {
  const typeData = CHORD_TYPES[chord.type] || CHORD_TYPES[''];
  let group;

  if (chord.type.includes('m') && !chord.type.includes('maj')) {
    group = VARIATION_GROUPS.minor;
  } else if (typeData.category === 'dominant' || typeData.category === 'altered') {
    group = VARIATION_GROUPS.dominant;
  } else {
    group = VARIATION_GROUPS.major;
  }

  return group.map(type => new Chord(chord.root, type));
}

export class Chord {
  constructor(root, type = '') {
    this.root = root % 12;
    this.type = type;
    this.typeData = CHORD_TYPES[type] || CHORD_TYPES[''];
  }

  get intervals() {
    return this.typeData.intervals;
  }

  get pitchClasses() {
    return this.intervals.map(i => (this.root + i) % 12);
  }

  get symbol() {
    return NOTE_NAMES[this.root] + this.typeData.symbol;
  }

  get category() {
    return this.typeData.category;
  }

  encode() {
    return `${this.root}:${this.type}`;
  }

  static decode(encoded) {
    const [root, type] = encoded.split(':');
    return new Chord(parseInt(root), type || '');
  }
}

function matchChordType(intervals) {
  const normalized = [...new Set(intervals)].sort((a, b) => a - b);
  let bestMatch = null;
  let bestScore = -1;

  for (const [type, data] of Object.entries(CHORD_TYPES)) {
    const typeIntervals = data.intervals.map(i => i % 12);
    const matches = normalized.filter(i => typeIntervals.includes(i)).length;
    const score = matches / Math.max(normalized.length, typeIntervals.length);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = type;
    }
  }

  return { type: bestMatch, score: bestScore };
}

export function detect(pitchClasses) {
  const pcs = [...new Set(pitchClasses.map(p => p % 12))];
  let bestResult = null;
  let bestScore = -1;

  for (const root of pcs) {
    const intervals = pcs.map(p => (p - root + 12) % 12).sort((a, b) => a - b);
    const match = matchChordType(intervals);

    if (match.score > bestScore) {
      bestScore = match.score;
      bestResult = { root, type: match.type, intervals, score: match.score };
    }
  }

  return bestResult ? new Chord(bestResult.root, bestResult.type) : null;
}

const SCALE_DEGREES = {
  I: 0, bII: 1, II: 2, bIII: 3, III: 4, IV: 5,
  '#IV': 6, bV: 6, V: 7, '#V': 8, bVI: 8, VI: 9, bVII: 10, VII: 11,
};

const PROGRESSION_RULES = {
  'I': [
    { degree: 'II', type: 'm7', category: 'diatonic', name: 'ii-V setup' },
    { degree: 'IV', type: 'maj7', category: 'diatonic', name: 'subdominant' },
    { degree: 'IV', type: 'm', category: 'modal', name: 'iv (minor plagal)' },
    { degree: 'V', type: '7', category: 'diatonic', name: 'dominant' },
    { degree: 'VI', type: 'm7', category: 'diatonic', name: 'relative minor' },
    { degree: 'III', type: 'm7', category: 'diatonic', name: 'mediant' },
    { degree: 'bVII', type: '7', category: 'modal', name: '♭VII (mixolydian)' },
    { degree: 'bIII', type: 'maj7', category: 'modal', name: '♭III (borrowed)' },
    { degree: 'bVI', type: 'maj7', category: 'modal', name: '♭VI (borrowed)' },
    { degree: 'II', type: '7', category: 'substitution', name: 'II7 (V/V)' },
    { degree: 'III', type: '7', category: 'substitution', name: 'III7 (V/vi)' },
    { degree: 'VI', type: '7', category: 'substitution', name: 'VI7 (V/ii)' },
    { degree: 'VII', type: '7', category: 'substitution', name: 'VII7 (V/iii)' },
    { degree: 'bVI', type: '7', category: 'substitution', name: '♭VI7 (tritone of II7)' },
    { degree: 'bVII', type: '7', category: 'substitution', name: '♭VII7 (tritone of III7)' },
    { degree: 'bVI', type: '7', category: 'substitution', name: '♭VI7 (Coltrane)' },
    { degree: '#IV', type: 'dim7', category: 'substitution', name: '#iv° (to V)' },
  ],
  'ii': [
    { degree: 'V', type: '7', category: 'diatonic', name: 'V7 (ii-V)' },
    { degree: 'V', type: '7b9', category: 'diatonic', name: 'V7♭9' },
    { degree: 'V', type: '7alt', category: 'diatonic', name: 'V7alt' },
    { degree: 'bII', type: '7', category: 'substitution', name: 'tritone sub of V' },
    { degree: 'bII', type: '7b9', category: 'substitution', name: 'tritone sub ♭9' },
    { degree: 'bV', type: 'dim7', category: 'substitution', name: 'dim approach to V' },
    { degree: 'IV', type: 'm7', category: 'substitution', name: 'related ii (up m3)' },
  ],
  'V': [
    { degree: 'I', type: 'maj7', category: 'resolution', name: 'resolve to I' },
    { degree: 'I', type: '', category: 'resolution', name: 'resolve to I (triad)' },
    { degree: 'VI', type: 'm7', category: 'deceptive', name: 'deceptive to vi' },
    { degree: 'bVI', type: 'maj7', category: 'deceptive', name: 'deceptive to ♭VI' },
    { degree: 'IV', type: 'maj7', category: 'backdoor', name: 'backdoor IV' },
    { degree: 'II', type: 'm7', category: 'turnaround', name: 'back to ii' },
    { degree: 'bII', type: '7', category: 'substitution', name: 'tritone sub (same target)' },
    { degree: 'bVI', type: '7', category: 'substitution', name: '♭VI7 (chromatic dom)' },
    { degree: 'VI', type: '7', category: 'substitution', name: 'VI7 (chromatic dom)' },
  ],
  'IV': [
    { degree: 'IV', type: 'm', category: 'modal', name: 'IV → iv' },
    { degree: 'IV', type: 'm7', category: 'modal', name: 'IV → iv7' },
    { degree: 'V', type: '7', category: 'diatonic', name: 'to dominant' },
    { degree: 'I', type: 'maj7', category: 'plagal', name: 'plagal to I' },
    { degree: 'II', type: 'm7', category: 'diatonic', name: 'to ii' },
    { degree: 'bVII', type: '7', category: 'modal', name: 'backdoor dominant' },
    { degree: 'II', type: '7', category: 'substitution', name: 'II7 (dominant of V)' },
    { degree: 'III', type: '7', category: 'substitution', name: 'III7 (tritone of ♭VII)' },
    { degree: '#IV', type: 'dim7', category: 'substitution', name: '#iv° (passing dim)' },
  ],
  'iv': [
    { degree: 'I', type: 'maj7', category: 'plagal', name: 'minor plagal to I' },
    { degree: 'I', type: '', category: 'plagal', name: 'minor plagal to I (triad)' },
    { degree: 'V', type: '7', category: 'diatonic', name: 'to dominant' },
    { degree: 'bVII', type: '7', category: 'modal', name: 'backdoor dominant' },
    { degree: 'bVI', type: 'maj7', category: 'modal', name: 'to ♭VI' },
    { degree: 'bII', type: 'maj7', category: 'substitution', name: '♭IIΔ (Neapolitan)' },
    { degree: '#IV', type: 'dim7', category: 'substitution', name: '#iv° (to V)' },
  ],
  'vi': [
    { degree: 'II', type: 'm7', category: 'diatonic', name: 'to ii' },
    { degree: 'IV', type: 'maj7', category: 'diatonic', name: 'to IV' },
    { degree: 'V', type: '7', category: 'diatonic', name: 'to V' },
    { degree: 'III', type: '7', category: 'secondary', name: 'V/vi (secondary dom)' },
    { degree: 'bVII', type: 'maj7', category: 'substitution', name: '♭VIIΔ (sub for vi)' },
    { degree: 'bVII', type: '7', category: 'substitution', name: '♭VII7 (tritone of III7)' },
    { degree: 'bVI', type: 'maj7', category: 'substitution', name: '♭VI (chromatic med)' },
  ],
  'bVII': [
    { degree: 'I', type: 'maj7', category: 'resolution', name: 'backdoor resolve' },
    { degree: 'IV', type: 'maj7', category: 'diatonic', name: 'to IV' },
    { degree: 'bVI', type: 'maj7', category: 'modal', name: 'to ♭VI' },
    { degree: 'III', type: '7', category: 'substitution', name: 'III7 (tritone sub)' },
    { degree: 'IV', type: 'm7', category: 'substitution', name: 'iv (ii of ♭VII)' },
  ],
  'bVI': [
    { degree: 'bVII', type: '7', category: 'modal', name: 'to ♭VII' },
    { degree: 'V', type: '7', category: 'diatonic', name: 'to V' },
    { degree: 'I', type: 'maj7', category: 'resolution', name: 'to I' },
    { degree: 'IV', type: 'm7', category: 'modal', name: 'to iv' },
    { degree: 'VI', type: 'm7', category: 'substitution', name: 'vi (chromatic)' },
    { degree: 'II', type: '7', category: 'substitution', name: 'II7 (tritone of ♭VI7)' },
    { degree: 'V', type: '7#5', category: 'substitution', name: 'V7#5 (aug 6th res)' },
  ],
  'bIII': [
    { degree: 'bVI', type: 'maj7', category: 'modal', name: 'to ♭VI' },
    { degree: 'bVII', type: '7', category: 'modal', name: 'to ♭VII' },
    { degree: 'IV', type: 'maj7', category: 'diatonic', name: 'to IV' },
    { degree: 'bVI', type: '7', category: 'substitution', name: '♭VI7 (V of ♭II)' },
    { degree: 'I', type: 'maj7', category: 'substitution', name: 'I (chromatic med)' },
  ],
  'bII': [
    { degree: 'I', type: 'maj7', category: 'resolution', name: 'resolve to I' },
    { degree: 'bVI', type: 'maj7', category: 'deceptive', name: 'deceptive to ♭VI' },
    { degree: 'V', type: '7', category: 'substitution', name: 'V7 (original dom)' },
    { degree: 'II', type: 'm7', category: 'substitution', name: 'ii (chromatic)' },
  ],
  'iii': [
    { degree: 'VI', type: 'm7', category: 'diatonic', name: 'to vi' },
    { degree: 'IV', type: 'maj7', category: 'diatonic', name: 'to IV' },
    { degree: 'II', type: 'm7', category: 'diatonic', name: 'to ii' },
    { degree: 'I', type: 'maj7', category: 'substitution', name: 'I (tonic sub)' },
    { degree: 'VI', type: '7', category: 'substitution', name: 'VI7 (V/ii)' },
    { degree: 'bIII', type: 'maj7', category: 'substitution', name: '♭III (chromatic)' },
  ],
  '#iv': [
    { degree: 'V', type: '7', category: 'resolution', name: 'resolve to V' },
    { degree: 'I', type: 'maj7', category: 'resolution', name: 'resolve to I/5' },
  ],
  'III': [
    { degree: 'VI', type: 'm7', category: 'resolution', name: 'resolve to vi' },
    { degree: 'bVII', type: '7', category: 'substitution', name: '♭VII7 (tritone back)' },
    { degree: 'IV', type: 'maj7', category: 'deceptive', name: 'deceptive to IV' },
  ],
  'VI': [
    { degree: 'II', type: 'm7', category: 'resolution', name: 'resolve to ii' },
    { degree: 'bVII', type: 'maj7', category: 'deceptive', name: 'deceptive to ♭VII' },
    { degree: 'bIII', type: '7', category: 'substitution', name: '♭III7 (tritone sub)' },
  ],
  'II': [
    { degree: 'V', type: '7', category: 'resolution', name: 'resolve to V' },
    { degree: 'bVI', type: '7', category: 'substitution', name: '♭VI7 (tritone sub)' },
    { degree: 'II', type: 'm7', category: 'substitution', name: 'ii (back to minor)' },
  ],

  'any': [
    { degree: 'II', type: 'm7', category: 'diatonic', name: 'ii (reorient)' },
    { degree: 'V', type: '7', category: 'diatonic', name: 'V7 (reorient)' },
    { degree: 'I', type: 'maj7', category: 'resolution', name: 'I (home)' },
    { degree: 'IV', type: 'maj7', category: 'diatonic', name: 'IV' },
    { degree: 'bVII', type: '7', category: 'modal', name: '♭VII' },
    { degree: 'bVI', type: 'maj7', category: 'modal', name: '♭VI' },
    { degree: 'bIII', type: 'maj7', category: 'substitution', name: '♭III (giant steps)' },
    { degree: 'bVI', type: '7', category: 'substitution', name: '♭VI7 (giant steps)' },
  ],
};

function getChordFunction(chordRoot, keyRoot, chordType) {
  const degree = (chordRoot - keyRoot + 12) % 12;
  const isMinor = chordType.includes('m') && !chordType.includes('maj');
  const isDom = chordType.includes('7') && !chordType.includes('maj') && !isMinor;
  const isDim = chordType.includes('dim');
  const isMaj = !isMinor && !isDom && !isDim;

  if (degree === 0) return 'I';
  if (degree === 1 && isDom) return 'bII';
  if (degree === 1 && isMaj) return 'bII';
  if (degree === 2 && isMinor) return 'ii';
  if (degree === 2 && isDom) return 'II';
  if (degree === 3) return 'bIII';
  if (degree === 4 && isMinor) return 'iii';
  if (degree === 4 && isDom) return 'III';
  if (degree === 5 && isMinor) return 'iv';
  if (degree === 5) return 'IV';
  if (degree === 6 && isDim) return '#iv';
  if (degree === 7) return 'V';
  if (degree === 8 && isDom) return 'bVI';
  if (degree === 8) return 'bVI';
  if (degree === 9 && isMinor) return 'vi';
  if (degree === 9 && isDom) return 'VI';
  if (degree === 10) return 'bVII';

  return 'any';
}

export function getNextChords(currentChord, keyRoot = 0) {
  const func = getChordFunction(currentChord.root, keyRoot, currentChord.type);
  const rules = PROGRESSION_RULES[func] || PROGRESSION_RULES['I'];

  return rules.map(rule => {
    const newRoot = (keyRoot + SCALE_DEGREES[rule.degree]) % 12;
    const chord = new Chord(newRoot, rule.type);
    return { chord, category: rule.category, description: rule.name };
  });
}

export function getCommonProgressions(keyRoot = 0) {
  return {
    diatonic: [
      new Chord(keyRoot, 'maj7'),
      new Chord((keyRoot + 2) % 12, 'm7'),
      new Chord((keyRoot + 4) % 12, 'm7'),
      new Chord((keyRoot + 5) % 12, 'maj7'),
      new Chord((keyRoot + 7) % 12, '7'),
      new Chord((keyRoot + 9) % 12, 'm7'),
    ],
    dominants: [
      new Chord((keyRoot + 7) % 12, '7'),
      new Chord((keyRoot + 7) % 12, '9'),
      new Chord((keyRoot + 7) % 12, '7b9'),
      new Chord((keyRoot + 7) % 12, '7#9'),
      new Chord((keyRoot + 7) % 12, '7alt'),
    ],
    substitutions: [
      new Chord((keyRoot + 1) % 12, '7'),
      new Chord((keyRoot + 1) % 12, '7b9'),
      new Chord((keyRoot + 10) % 12, '7'),
      new Chord((keyRoot + 2) % 12, '7'),
      new Chord((keyRoot + 4) % 12, '7'),
      new Chord((keyRoot + 9) % 12, '7'),
      new Chord((keyRoot + 3) % 12, 'maj7'),
      new Chord((keyRoot + 8) % 12, 'maj7'),
      new Chord((keyRoot + 5) % 12, 'm7'),
      new Chord((keyRoot + 8) % 12, '7'),
      new Chord((keyRoot + 6) % 12, 'dim7'),
      new Chord((keyRoot + 1) % 12, 'maj7'),
    ],
  };
}

export function getRandomChords(count = 6) {
  const types = ['maj7', 'm7', '7', 'm7b5', 'dim7', '9', 'm9', '7b9', '7#9'];
  const chords = [];

  for (let i = 0; i < count; i++) {
    const root = Math.floor(Math.random() * 12);
    const type = types[Math.floor(Math.random() * types.length)];
    chords.push(new Chord(root, type));
  }

  return chords;
}

function countCommonTones(chord1, chord2) {
  const set1 = new Set(chord1.pitchClasses);
  return chord2.pitchClasses.filter(pc => set1.has(pc)).length;
}

function isTritoneSubstitution(fromChord, toChord) {
  const interval = (toChord.root - fromChord.root + 12) % 12;
  return interval === 6;
}

function isChromaticMediant(fromChord, toChord) {
  const interval = (toChord.root - fromChord.root + 12) % 12;
  return interval === 3 || interval === 4 || interval === 8 || interval === 9;
}

function isIIVSetup(chord, keyRoot) {
  const iiRoot = (keyRoot + 2) % 12;
  return chord.root === iiRoot && (chord.type.includes('m7') || chord.type.includes('m9'));
}

function isDominant(chord, keyRoot) {
  const vRoot = (keyRoot + 7) % 12;
  return chord.root === vRoot && (chord.type.includes('7') || chord.type.includes('9') || chord.type.includes('13'));
}

export function analyzeChordChoice(fromChord, toChord, keyRoot) {
  if (!fromChord || !toChord) return null;

  const commonTones = countCommonTones(fromChord, toChord);
  const rootMotion = (toChord.root - fromChord.root + 12) % 12;

  if (isIIVSetup(toChord, keyRoot)) return 'classic';
  if (isDominant(fromChord, keyRoot) && toChord.root === keyRoot) return 'classic';
  if ((rootMotion === 5 || rootMotion === 7) && commonTones >= 2) return 'classic';

  if (commonTones >= 3) return 'safe';
  if (fromChord.root === toChord.root && fromChord.type !== toChord.type) return 'safe';
  if ((rootMotion === 1 || rootMotion === 2 || rootMotion === 10 || rootMotion === 11) && commonTones >= 2) return 'safe';

  if (isTritoneSubstitution(fromChord, toChord)) return 'interesting';
  if (isChromaticMediant(fromChord, toChord)) return 'interesting';

  const borrowedRoots = [(keyRoot + 5) % 12, (keyRoot + 10) % 12, (keyRoot + 8) % 12, (keyRoot + 3) % 12];
  if (borrowedRoots.includes(toChord.root) && commonTones <= 1) return 'interesting';

  if (toChord.type.includes('b9') || toChord.type.includes('#9') ||
      toChord.type.includes('#11') || toChord.type.includes('alt')) {
    return 'interesting';
  }

  return null;
}

export { NOTE_NAMES, TONE_NOTE_NAMES, INTERVALS };
