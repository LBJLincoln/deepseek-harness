/** The one failure kind the program reports; the message is what it prints. */
export class GlobError extends Error {
  /**
   * @param message - the reported reason, printed after `error: `.
   */
  constructor(message) {
    super(message)
    this.name = 'GlobError'
  }
}
