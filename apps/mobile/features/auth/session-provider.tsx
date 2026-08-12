import type { Session } from "@supabase/supabase-js";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { getErrorMessage } from "../../lib/errors";
import { queryClient } from "../../lib/query-client";
import { restoreOrCreateAnonymousSession } from "../../repositories/auth-repository";
import { getSupabaseClient } from "../../services/supabase";

type SessionState =
  | { status: "loading"; session: null; error: null }
  | { status: "ready"; session: Session; error: null }
  | { status: "error"; session: null; error: string };

type SessionContextValue = SessionState & {
  retry: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const restoreInFlight = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<SessionState>({
    status: "loading",
    session: null,
    error: null,
  });

  const restoreOrCreateSession = useCallback((): Promise<void> => {
    if (restoreInFlight.current) return restoreInFlight.current;
    const task = (async () => {
      setState({ status: "loading", session: null, error: null });
      try {
        const { session } = await restoreOrCreateAnonymousSession();
        setState({ status: "ready", session, error: null });
      } catch (error) {
        setState({
          status: "error",
          session: null,
          error: getErrorMessage(error),
        });
      }
    })();
    restoreInFlight.current = task;
    void task.then(
      () => {
        if (restoreInFlight.current === task) restoreInFlight.current = null;
      },
      () => {
        if (restoreInFlight.current === task) restoreInFlight.current = null;
      },
    );
    return task;
  }, []);

  useEffect(() => {
    void restoreOrCreateSession();

    let supabase;
    try {
      supabase = getSupabaseClient();
    } catch {
      return undefined;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setState({ status: "ready", session, error: null });
      } else {
        queryClient.clear();
        void restoreOrCreateSession();
      }
    });
    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        if (nextState === "active") void supabase.auth.startAutoRefresh();
        else void supabase.auth.stopAutoRefresh();
      },
    );

    return () => {
      data.subscription.unsubscribe();
      appStateSubscription.remove();
      void supabase.auth.stopAutoRefresh();
    };
  }, [restoreOrCreateSession]);

  const value = useMemo<SessionContextValue>(
    () => ({ ...state, retry: restoreOrCreateSession }),
    [restoreOrCreateSession, state],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
