class VoiceLeader {
  constructor(options = {}) {
    this.octaveRange = options.octaveRange || 2;
    this.midiMin = options.midiMin || 36;
    this.midiMax = options.midiMax || 96;
  }

  chromaticDistance(note1, note2) {
    return Math.abs(note1 - note2);
  }

  findClosestVoicingGreedy(currentVoicing, targetPitchClasses) {
    if (currentVoicing.length !== targetPitchClasses.length) {
      throw new Error('Current voicing and target chord must have same length');
    }

    const availablePitchClasses = [...targetPitchClasses];
    const nextVoicing = [];

    for (const currentNote of currentVoicing) {
      let bestNote = null;
      let bestDistance = Infinity;
      let bestPcIndex = null;

      for (let i = 0; i < availablePitchClasses.length; i++) {
        const pc = availablePitchClasses[i];
        const octave = Math.floor(currentNote / 12);

        for (let octOffset = -this.octaveRange; octOffset <= this.octaveRange; octOffset++) {
          const candidate = pc + (octave + octOffset) * 12;

          if (candidate >= this.midiMin && candidate <= this.midiMax) {
            const distance = this.chromaticDistance(currentNote, candidate);

            if (distance < bestDistance) {
              bestDistance = distance;
              bestNote = candidate;
              bestPcIndex = i;
            }
          }
        }
      }

      nextVoicing.push(bestNote);
      availablePitchClasses.splice(bestPcIndex, 1);
    }

    return nextVoicing;
  }

  calculateTotalDistance(voicing1, voicing2) {
    return voicing1.reduce((sum, note, i) => sum + this.chromaticDistance(note, voicing2[i]), 0);
  }
}

export default VoiceLeader;