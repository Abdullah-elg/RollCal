// What each RSVP answer is called. Once an event is over the answers are
// final and read in the past tense ("Went", "Didn't go"), and nobody can
// change theirs any more (the server holds to that too: rsvp-lock.sql).
import type { RsvpStatus } from '../types';

export function eventEnded(endsAt: string, now = Date.now()): boolean {
  return new Date(endsAt).getTime() <= now;
}

export function rsvpLabel(status: RsvpStatus | 'host', ended: boolean): string {
  switch (status) {
    case 'host':
      return 'Host';
    case 'going':
      return ended ? 'Went' : 'Going';
    case 'maybe':
      return 'Maybe';
    case 'not_going':
      return ended ? "Didn't go" : "Can't go";
  }
}
