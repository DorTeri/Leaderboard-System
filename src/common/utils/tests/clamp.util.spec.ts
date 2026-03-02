import { clamp } from '../clamp.util.js';

describe('clamp', () => {
  it('should return value when within range', () => {
    expect(clamp(50, 1, 100)).toBe(50);
  });

  it('should return min when value is below range', () => {
    expect(clamp(-10, 1, 100)).toBe(1);
    expect(clamp(0, 1, 100)).toBe(1);
  });

  it('should return max when value is above range', () => {
    expect(clamp(5000, 1, 1000)).toBe(1000);
    expect(clamp(1001, 1, 1000)).toBe(1000);
  });

  it('should return min when value equals min', () => {
    expect(clamp(1, 1, 1000)).toBe(1);
  });

  it('should return max when value equals max', () => {
    expect(clamp(1000, 1, 1000)).toBe(1000);
  });

  it('should handle min equal to max', () => {
    expect(clamp(0, 5, 5)).toBe(5);
    expect(clamp(10, 5, 5)).toBe(5);
    expect(clamp(5, 5, 5)).toBe(5);
  });

  it('should return NaN when value is NaN (caller must validate)', () => {
    expect(clamp(NaN, 1, 100)).toBeNaN();
  });

  it('should handle very large values', () => {
    expect(clamp(Number.MAX_SAFE_INTEGER, 1, 1000)).toBe(1000);
  });
});

