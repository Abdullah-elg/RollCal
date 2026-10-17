# RollCal auth emails

Paste each file into Supabase → Authentication → Emails → the matching template, and set its subject.

| Template | File | Subject |
| --- | --- | --- |
| Confirm sign up | `confirm-signup.html` | `{{ .Token }} is your RollCal code` |
| Reset password | `reset-password.html` | `{{ .Token }} is your RollCal reset code` |
| Magic link or OTP | `magic-link.html` | `{{ .Token }} is your RollCal sign-in code` |
| Reauthentication | `reauthentication.html` | `{{ .Token }} is your RollCal verification code` |
| Change email address | `change-email.html` | `Confirm your new RollCal email` |
| Invite user | `invite-user.html` | `You’re invited to RollCal` |

Confirm sign up, Reset password, Magic link and Reauthentication send a 6-digit code, because the app asks for a code (it never opens email links). Change email and Invite user use a link; the app doesn't use either yet.
