import { voiceDependencies } from "../_shared/voice-runtime.ts";
import { createExtractionHandler } from "./handler.ts";

Deno.serve(createExtractionHandler(voiceDependencies));
