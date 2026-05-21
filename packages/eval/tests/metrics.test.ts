import { describe, expect, it } from 'vitest';
import { sentenceBleu, corpusBleu } from '../src/metrics/bleu.js';
import { chrf } from '../src/metrics/chrf.js';
import { wordErrorRate } from '../src/metrics/wer.js';

describe('sentenceBleu', () => {
  it('scores a perfect match at 1.0', () => {
    expect(sentenceBleu('the cat sat on the mat', 'the cat sat on the mat')).toBeCloseTo(1, 5);
  });

  it('scores a complete mismatch far below a partial match', () => {
    const mismatch = sentenceBleu('the cat sat on the mat', 'completely different words here');
    const partial = sentenceBleu('the cat sat on the mat', 'the cat sat on a mat');
    expect(mismatch).toBeLessThan(0.25);
    expect(mismatch).toBeLessThan(partial);
  });

  it('rewards partial overlap between 0 and 1', () => {
    const score = sentenceBleu('the cat sat on the mat', 'the cat sat on a mat');
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(1);
  });

  it('applies a brevity penalty to short candidates', () => {
    const full = sentenceBleu('the cat sat on the mat', 'the cat sat on the mat');
    const short = sentenceBleu('the cat sat on the mat', 'the cat');
    expect(short).toBeLessThan(full);
  });

  it('averages over a corpus', () => {
    const score = corpusBleu([
      { reference: 'hello world', candidate: 'hello world' },
      { reference: 'good morning', candidate: 'good evening' },
    ]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('chrf', () => {
  it('scores a perfect match at 1.0', () => {
    expect(chrf('hipertensión', 'hipertensión')).toBeCloseTo(1, 5);
  });

  it('rewards near-misses higher than unrelated strings', () => {
    const near = chrf('hipertensión', 'hipertension'); // missing accent
    const far = chrf('hipertensión', 'zzzzzz');
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0.7);
  });
});

describe('wordErrorRate', () => {
  it('is 0 for an exact transcript', () => {
    expect(wordErrorRate('the patient has hypertension', 'the patient has hypertension')).toBe(0);
  });

  it('counts a single substitution as 1/N', () => {
    expect(wordErrorRate('a b c d', 'a b x d')).toBeCloseTo(0.25, 5);
  });

  it('counts deletions and insertions', () => {
    expect(wordErrorRate('a b c d', 'a b c')).toBeCloseTo(0.25, 5); // one deletion
    expect(wordErrorRate('a b c', 'a b c d')).toBeCloseTo(1 / 3, 5); // one insertion
  });

  it('is 1.0 when the hypothesis shares nothing with a same-length reference', () => {
    expect(wordErrorRate('a b c', 'x y z')).toBeCloseTo(1, 5);
  });
});
