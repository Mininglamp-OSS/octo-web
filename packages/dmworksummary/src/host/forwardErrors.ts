export class SummaryForwardContextExpiredError extends Error {
  constructor() {
    super("Summary forwarding context expired");
    this.name = "SummaryForwardContextExpiredError";
  }
}
