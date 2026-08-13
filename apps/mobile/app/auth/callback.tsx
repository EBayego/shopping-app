import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { Screen } from "../../components/screen";
import { ScreenState } from "../../components/screen-state";
import {
  parseOAuthCallbackRouteParams,
} from "../../features/auth/oauth-callback";
import { getErrorMessage } from "../../lib/errors";
import { completeSocialIdentityLink } from "../../repositories/auth-repository";

const CALLBACK_PARAMS_TIMEOUT_MS = 5_000;
const CALLBACK_EXCHANGE_TIMEOUT_MS = 20_000;

export default function AuthCallbackScreen() {
  const callbackStarted = useRef(false);
  const params = useLocalSearchParams();
  const [error, setError] = useState<string | null>(null);
  const callback = parseOAuthCallbackRouteParams(params);

  useEffect(() => {
    if (callbackStarted.current) return;

    if (!callback.code && !callback.errorDescription) {
      const missingParamsTimeout = setTimeout(() => {
        console.warn("[auth-callback] OAuth callback received without parameters");
        setError(
          "La app se abrió, pero no recibió el código de acceso. Vuelve a intentarlo desde Ajustes.",
        );
      }, CALLBACK_PARAMS_TIMEOUT_MS);
      return () => clearTimeout(missingParamsTimeout);
    }

    callbackStarted.current = true;
    let ignoreResult = false;
    console.info("[auth-callback] Completing OAuth callback", {
      hasCode: callback.code !== null,
      hasError: callback.errorDescription !== null,
    });

    const exchangeTimeout = setTimeout(() => {
      ignoreResult = true;
      console.warn("[auth-callback] OAuth code exchange timed out");
      setError(
        "Supabase está tardando demasiado en completar el acceso. Comprueba la conexión y vuelve a intentarlo.",
      );
    }, CALLBACK_EXCHANGE_TIMEOUT_MS);

    void completeSocialIdentityLink(callback).then(
      ({ intent, provider }) => {
        clearTimeout(exchangeTimeout);
        if (ignoreResult) return;
        console.info("[auth-callback] OAuth callback completed", {
          intent,
          provider,
        });
        router.replace({
          pathname: "/settings",
          params: { oauthIntent: intent, oauthProvider: provider },
        });
      },
      (callbackError: unknown) => {
        clearTimeout(exchangeTimeout);
        if (ignoreResult) return;
        const message = getErrorMessage(callbackError);
        console.error("[auth-callback] OAuth callback failed", message);
        setError(message);
      },
    );

    return () => {
      ignoreResult = true;
      clearTimeout(exchangeTimeout);
    };
  }, [callback.code, callback.errorDescription]);

  return (
    <Screen scroll={false}>
      {error ? (
        <ScreenState
          title="No se pudo vincular la cuenta"
          message={error}
          retry={() => router.replace("/settings")}
        />
      ) : (
        <ScreenState
          loading
          title="Terminando el inicio de sesión"
          message="Estamos vinculando tu cuenta sin perder tus listas ni grupos."
        />
      )}
    </Screen>
  );
}
