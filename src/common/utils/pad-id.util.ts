const PAD_LENGTH = 20;
const MAX_MEMBER = BigInt('99999999999999999999');

export function toZsetMember(userId: string | number): string {
  const inverted = MAX_MEMBER - BigInt(userId);
  return inverted.toString().padStart(PAD_LENGTH, '0');
}

export function fromZsetMember(member: string): string {
  const inverted = BigInt(member);
  return (MAX_MEMBER - inverted).toString();
}
