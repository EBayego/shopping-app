import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { Screen } from "../../components/screen";
import { ScreenState } from "../../components/screen-state";
import { useSession } from "./session-provider";

export function SessionGate({ children }: PropsWithChildren) {
  const session = useSession();

  return (
    <>
      {children}
      {session.status !== "ready" ? (
        <View style={styles.overlay}>
          <Screen scroll={false}>
            {session.status === "loading" ? (
              <ScreenState
                loading
                title="Preparando tu sesión"
                message="Restaurando el acceso seguro…"
              />
            ) : (
              <ScreenState
                title="No se pudo iniciar la sesión"
                message={session.error}
                retry={() => void session.retry()}
              />
            )}
          </Screen>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
  },
});
