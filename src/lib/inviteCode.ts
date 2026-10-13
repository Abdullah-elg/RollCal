// Human-friendly invite codes: 8 chars, no ambiguous characters (0/O, 1/I/L).
// ~40 bits of entropy - plenty for a party invite, easy to read out loud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
