import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { Screen } from "../../components/screen";
import { ScreenState } from "../../components/screen-state";
import { getErrorMessage } from "../../lib/errors";
import { completeSocialIdentityLink } from "../../repositories/auth-repository";

export default function AuthCallbackScreen() {
  const callbackStarted = useRef(false);
  const callbackUrl = Linking.useURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!callbackUrl || callbackStarted.current) return;
    callbackStarted.current = true;

    void completeSocialIdentityLink(callbackUrl).then(
      ({ intent, provider }) => {
        router.replace({
          pathname: "/settings",
          params: { oauthIntent: intent, oauthProvider: provider },
        });
      },
      (callbackError: unknown) => setError(getErrorMessage(callbackError)),
    );
  }, [callbackUrl]);

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
