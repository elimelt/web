import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { Chord, detect, getCommonProgressions } from '../frontend/music/chord-theory.js';
import VoiceLeader from '../frontend/music/voicing.js';

const root = resolve(import.meta.dirname, '..');
test('every generated page and module points to existing local assets', async () => {
  for (const directory of ['frontend', 'infra/homepage']) {
    const base = resolve(root, 'dist', directory);
    const files = await readdir(base, { recursive: true });
    assert(!files.some(file => file.endsWith('.ts')), 'TypeScript sources must not be published');
    for (const file of files.filter(file => /\.(html|m?js)$/.test(file))) {
      const full = resolve(base, file);
      const source = await readFile(full, 'utf8');
      const references: string[] = [];
      if (file.endsWith('.html')) {
        references.push(...Array.from(source.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)/g), match => match[1]));
        references.push(...Array.from(source.matchAll(/<link\b[^>]*\bhref=["']([^"']+)/g), match => match[1]));
        for (const match of source.matchAll(/<script\b[^>]*\btype=["']importmap["'][^>]*>([\s\S]*?)<\/script>/g)) {
          const { imports } = JSON.parse(match[1]) as { imports: Record<string, string> };
          references.push(...Object.values(imports).filter(reference => !reference.endsWith('/')));
        }
      } else {
        const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        for (const node of parsed.statements) {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const specifier = node.moduleSpecifier.text;
            if (specifier.startsWith('.')) references.push(specifier);
          }
        }
      }
      for (const reference of references.filter(reference => !/^https?:/.test(reference))) {
        await access(resolve(dirname(full), reference.split('?')[0]));
      }
    }
  }
});

test('chord encoding, detection, and progressions preserve musical behavior', () => {
  const chord = new Chord(0, 'maj7');
  assert.deepEqual(chord.pitchClasses, [0, 4, 7, 11]);
  assert.equal(Chord.decode(chord.encode()).symbol, chord.symbol);
  assert.equal(detect([60, 64, 67])?.symbol, 'C');
  const progression = getCommonProgressions(0);
  assert(progression.diatonic.length > 0);
  assert(progression.diatonic.every(chord => chord.pitchClasses.every(pc => pc >= 0 && pc < 12)));
});

test('voice leading preserves pitches and rejects mismatched voice counts', () => {
  const leader = new VoiceLeader();
  const result = leader.findClosestVoicingGreedy([60, 64, 67], [2, 5, 9]);
  assert.deepEqual(result.map(note => note % 12).sort((a, b) => a - b), [2, 5, 9]);
  assert(result.every(note => note >= 36 && note <= 96));
  assert.throws(() => leader.findClosestVoicingGreedy([60], [0, 4, 7]));
});
