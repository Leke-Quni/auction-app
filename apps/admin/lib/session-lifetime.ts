// How long a signed-in browser may sit idle before it is signed out: 1 day. Every request refreshes it (see proxy.ts), so a browser
// that is still being used stays signed in, and one nobody has opened for that long needs the password and the emailed code again.
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
