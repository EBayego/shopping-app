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
}

export interface SpeechRecognitionResult {
  transcript: string;
  segments: readonly string[];
}

export interface SpeechRecognitionService {
  recognize(
    options: SpeechRecognitionOptions,
  ): Promise<SpeechRecognitionResult>;
  stop(): void;
  cancel(): void;
  openSettings(): Promise<void>;
}
