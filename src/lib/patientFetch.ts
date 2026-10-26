// The fetch the Supabase client uses: the normal one, plus a time limit.
//
// On a phone, a connection the app keeps reusing can quietly go dead (low
// power mode, mobile data, moving between networks). A request sent down it
// waits a minute or more before iOS gives up, so a screen sat on its spinner
// until Wi-Fi was turned on and forced a new connection. Now:
//   * reads (GET, HEAD, and making photo links) give up after
//     READ_TIMEOUT_MS and try once more, which opens a fresh connection;
//   * the sign-in refresh gives up after AUTH_TIMEOUT_MS (Supabase retries
//     it itself), since every other request waits on it;
//   * other writes run as before: retrying could send a message or payment
//     twice, and uploads can rightly take a while on mobile data.

const READ_TIMEOUT_MS = 12_000;
const AUTH_TIMEOUT_MS = 15_000;

// Shorter in tests, so they don't wait 12 seconds.
let timeScale = 1;
export const setTimeScaleForTests = (scale: number) => {
  timeScale = scale;
};

// A request that stopped because time ran out, told apart from one the caller
// cancelled.
class RequestTimeout extends Error {
  constructor() {
    super('The request took too long');
    this.name = 'RequestTimeout';
  }
}

// fetch, giving up after ms. Still honours a cancel from the caller.
function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  if (callerSignal?.aborted) controller.abort();
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener?.('abort', onCallerAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms * timeScale);
  return fetch(input, { ...init, signal: controller.signal })
    .catch((err) => {
      throw timedOut ? new RequestTimeout() : err;
    })
    .finally(() => {
      clearTimeout(timer);
      callerSignal?.removeEventListener?.('abort', onCallerAbort);
    });
}

const urlOf = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

export async function patientFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  // Making photo links is a POST, but asking twice is harmless.
  const safeToRepeat =
    method === 'GET' || method === 'HEAD' || urlOf(input).includes('/storage/v1/object/sign/');
  if (safeToRepeat) {
    try {
      return await fetchWithTimeout(input, init, READ_TIMEOUT_MS);
    } catch (err) {
      // Only a stall is worth a second go; a cancel or a real error isn't.
      if (!(err instanceof RequestTimeout)) throw err;
      return fetchWithTimeout(input, init, READ_TIMEOUT_MS);
    }
  }
  if (urlOf(input).includes('/auth/v1/token')) {
    return fetchWithTimeout(input, init, AUTH_TIMEOUT_MS);
  }
  return fetch(input, init);
}
