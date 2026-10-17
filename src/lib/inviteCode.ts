import { getRandomBytes } from 'expo-crypto';

// Human-friendly invite codes: 8 chars, no ambiguous characters (0/O, 1/I/L).
// ~40 bits of entropy - plenty for a party invite, easy to read out loud.
// Drawn from the phone's secure random source, so codes can't be predicted.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateInviteCode(): string {
  let code = '';
  while (code.length < 8) {
    for (const byte of getRandomBytes(16)) {
      // Skip the top of the byte range so every letter is equally likely.
      if (byte < 256 - (256 % ALPHABET.length) && code.length < 8) {
        code += ALPHABET[byte % ALPHABET.length];
      }
    }
  }
  return code;
}
