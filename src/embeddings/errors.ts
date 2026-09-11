export class EmbeddingsNotConfiguredError extends Error {
  constructor(detail: string) {
    super(detail);
  }
}
