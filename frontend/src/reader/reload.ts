/** Loads the document again. Its own module so a test can see the call: jsdom
 * does not navigate. */

export function reloadDocument(): void {
  window.location.reload();
}
