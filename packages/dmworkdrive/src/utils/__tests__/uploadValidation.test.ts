import { describe, it, expect } from 'vitest';
import {
  MAX_UPLOAD_SIZE,
  MIN_UPLOAD_SIZE,
  validateUploads,
} from '../uploadValidation';

function file(name: string, size: number): File {
  return { name, size, type: 'text/plain' } as unknown as File;
}

describe('validateUploads', () => {
  it('accepts a normal-sized file', () => {
    const { accepted, rejected } = validateUploads([file('a.pdf', 100_000)]);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('rejects empty files with reason "empty"', () => {
    const { accepted, rejected } = validateUploads([file('zero.bin', 0)]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toEqual([{ file: expect.any(Object), reason: 'empty' }]);
    expect(rejected[0].file.name).toBe('zero.bin');
  });

  it('rejects files that exceed the max size with reason "tooLarge"', () => {
    const huge = file('huge.zip', MAX_UPLOAD_SIZE + 1);
    const { accepted, rejected } = validateUploads([huge]);
    expect(accepted).toHaveLength(0);
    expect(rejected[0].reason).toBe('tooLarge');
    expect(rejected[0].file).toBe(huge);
  });

  it('accepts a file exactly at MIN_UPLOAD_SIZE (boundary)', () => {
    const { accepted } = validateUploads([file('one-byte.txt', MIN_UPLOAD_SIZE)]);
    expect(accepted).toHaveLength(1);
  });

  it('accepts a file exactly at MAX_UPLOAD_SIZE (boundary)', () => {
    const { accepted } = validateUploads([file('exact.zip', MAX_UPLOAD_SIZE)]);
    expect(accepted).toHaveLength(1);
  });

  it('partitions a mixed batch — each file lands in exactly one bucket', () => {
    const good = file('a.pdf', 1000);
    const empty = file('zero.bin', 0);
    const huge = file('huge.zip', MAX_UPLOAD_SIZE + 1);
    const alsoGood = file('b.png', 5_000_000);

    const { accepted, rejected } = validateUploads([good, empty, huge, alsoGood]);
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf', 'b.png']);
    expect(rejected.map((r) => `${r.file.name}:${r.reason}`)).toEqual([
      'zero.bin:empty',
      'huge.zip:tooLarge',
    ]);
  });

  it('handles an empty input', () => {
    const { accepted, rejected } = validateUploads([]);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([]);
  });
});
