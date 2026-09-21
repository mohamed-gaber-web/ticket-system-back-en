/**
 * An error whose message is safe to show to the user — thrown by request
 * validators / field cleaners. Controllers answer it with a 400 and the message
 * verbatim; anything else is a 500 with a generic message so internals never
 * leak to the client.
 */
export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
    this.status = 400;
  }
}

export const isInputError = (error) => error instanceof InputError;
