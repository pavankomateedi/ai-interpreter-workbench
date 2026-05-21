import { describe, expect, it } from 'vitest';
import { SentenceBoundaryDetector } from '../../../src/cascade/SentenceBoundaryDetector.js';

describe('SentenceBoundaryDetector', () => {
  it('emits a completed sentence and buffers the trailing fragment', () => {
    const sbd = new SentenceBoundaryDetector();
    expect(sbd.append('The patient is stable. We continue')).toEqual(['The patient is stable.']);
    // "We continue" has no terminal punctuation yet, so it stays buffered.
    expect(sbd.flush()).toEqual(['We continue']);
  });

  it('does not split on a known abbreviation', () => {
    const sbd = new SentenceBoundaryDetector();
    const out = sbd.append('Dr. Smith arrived. He waited.');
    expect(out).toEqual(['Dr. Smith arrived.']);
    expect(sbd.flush()).toEqual(['He waited.']);
  });

  it('does not split on a decimal number', () => {
    const sbd = new SentenceBoundaryDetector();
    const out = sbd.append('Take 2.5 mg today. Then rest.');
    expect(out).toEqual(['Take 2.5 mg today.']);
  });

  it('splits multiple sentences in a single append', () => {
    const sbd = new SentenceBoundaryDetector();
    expect(sbd.append('One. Two. Three.')).toEqual(['One.', 'Two.']);
    expect(sbd.flush()).toEqual(['Three.']);
  });

  it('handles question and exclamation marks', () => {
    const sbd = new SentenceBoundaryDetector();
    expect(sbd.append('Are you ready? Yes! Let us go.')).toEqual(['Are you ready?', 'Yes!']);
  });

  it('accumulates across multiple appends before a boundary', () => {
    const sbd = new SentenceBoundaryDetector();
    expect(sbd.append('The patient has')).toEqual([]);
    expect(sbd.append('hypertension. Next.')).toEqual(['The patient has hypertension.']);
  });

  it('flush returns nothing when there is no buffered text', () => {
    const sbd = new SentenceBoundaryDetector();
    expect(sbd.flush()).toEqual([]);
  });
});
