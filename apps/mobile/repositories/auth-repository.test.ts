import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  ensureAnonymousSession,
  type AnonymousAuthClient,
} from "../features/auth/anonymous-session";

const session = { access_token: "token" } as Session;

describe("ensureAnonymousSession", () => {
  it("crea una identidad anónima en el primer arranque", async () => {
    const auth: AnonymousAuthClient = {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: null }, error: null }),
      signInAnonymously: vi
        .fn()
        .mockResolvedValue({ data: { session }, error: null }),
    };

    await expect(ensureAnonymousSession(auth)).resolves.toEqual({
      session,
      source: "anonymous-created",
    });
    expect(auth.signInAnonymously).toHaveBeenCalledOnce();
  });

  it("restaura la sesión y no crea una segunda cuenta anónima", async () => {
    const auth: AnonymousAuthClient = {
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      signInAnonymously: vi.fn(),
    };

    await expect(ensureAnonymousSession(auth)).resolves.toEqual({
      session,
      source: "restored",
    });
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });
});
