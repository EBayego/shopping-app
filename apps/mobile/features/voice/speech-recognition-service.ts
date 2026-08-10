export type SpeechRecognitionErrorCode =
  | "PERMISSION_DENIED"
  | "PERMISSION_BLOCKED"
  | "CANCELLED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "EMPTY_TRANSCRIPT"
  | "NATIVE_ERROR";

export class SpeechRecognitionError extends Error {
  readonly code: SpeechRecognitionErrorCode;

  constructor(code: SpeechRecognitionErrorCode, message: string) {
    super(message);
    this.name = "SpeechRecognitionError";
    this.code = code;
  }
}

export interface SpeechRecognitionOptions {
  locale: string;
  timeoutMs: number;
}

export interface SpeechRecognitionService {
  recognize(options: SpeechRecognitionOptions): Promise<string>;
  cancel(): void;
  openSettings(): Promise<void>;
}
