import { toZsetMember, fromZsetMember } from '../pad-id.util.js';

describe('pad-id.util', () => {
  describe('toZsetMember', () => {
    it('should pad user id 1 to 20 digits', () => {
      const member = toZsetMember('1');
      expect(member).toHaveLength(20);
    });

    it('should accept numeric input', () => {
      expect(toZsetMember(1)).toBe(toZsetMember('1'));
    });

    it('should produce smaller member for larger id (inverted for ASC tie-break)', () => {
      const memberSmallId = toZsetMember('1');
      const memberLargeId = toZsetMember('2');
      expect(memberSmallId > memberLargeId).toBe(true);
    });

    it('should preserve ordering across a wide range of ids', () => {
      const ids = ['1', '100', '999', '10000', '9999999'];
      const members = ids.map((id) => toZsetMember(id));
      for (let i = 0; i < members.length - 1; i++) {
        expect(members[i] > members[i + 1]).toBe(true);
      }
    });

    it('should handle id 0', () => {
      const member = toZsetMember('0');
      expect(member).toHaveLength(20);
      expect(member).toBe('99999999999999999999');
    });

    it('should handle maximum 20-digit id', () => {
      const maxId = '99999999999999999999';
      const member = toZsetMember(maxId);
      expect(member).toBe('00000000000000000000');
    });

    it('should handle large bigint ids (10M+ range)', () => {
      const id = '10000000';
      const member = toZsetMember(id);
      expect(member).toHaveLength(20);
      expect(typeof member).toBe('string');
    });
  });

  describe('fromZsetMember', () => {
    it('should reverse toZsetMember for id 1', () => {
      expect(fromZsetMember(toZsetMember('1'))).toBe('1');
    });

    it('should reverse toZsetMember for id 0', () => {
      expect(fromZsetMember(toZsetMember('0'))).toBe('0');
    });

    it('should reverse toZsetMember for large id', () => {
      expect(fromZsetMember(toZsetMember('99999999999999999999'))).toBe(
        '99999999999999999999',
      );
    });
  });

  describe('roundtrip', () => {
    const testIds = [
      '1',
      '42',
      '1000',
      '999999',
      '10000000',
      '100000000',
      '9999999999',
      '99999999999999999999',
    ];

    it.each(testIds)('should roundtrip id=%s correctly', (id) => {
      expect(fromZsetMember(toZsetMember(id))).toBe(id);
    });
  });

  describe('deterministic tie-break ordering', () => {
    it('should sort members so lower userId comes first in ZREVRANGE when scores tie', () => {
      const id1Member = toZsetMember('1');
      const id2Member = toZsetMember('2');
      const id100Member = toZsetMember('100');

      const sorted = [id1Member, id2Member, id100Member].sort().reverse();
      expect(fromZsetMember(sorted[0])).toBe('1');
      expect(fromZsetMember(sorted[1])).toBe('2');
      expect(fromZsetMember(sorted[2])).toBe('100');
    });

    it('should correctly order 1000 consecutive ids', () => {
      const members: { id: number; member: string }[] = [];
      for (let i = 1; i <= 1000; i++) {
        members.push({ id: i, member: toZsetMember(String(i)) });
      }

      const sorted = [...members].sort((a, b) =>
        b.member.localeCompare(a.member),
      );

      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i].id).toBe(i + 1);
      }
    });
  });
});

