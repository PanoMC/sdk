/** An expected failure: the CLI prints the message as is (no stack) and exits 1. */
export class ClientGenError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'ClientGenError'
  }
}
