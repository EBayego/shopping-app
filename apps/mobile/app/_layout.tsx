import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionGate } from "../features/auth/session-gate";
import { SessionProvider } from "../features/auth/session-provider";
import { colors } from "../lib/theme";
import { queryClient } from "../lib/query-client";
import { OfflineSyncProvider } from "../offline/offline-sync-provider";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <SessionProvider>
          <OfflineSyncProvider>
            <SessionGate>
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: colors.surface },
                  headerTintColor: colors.text,
                  headerShadowVisible: false,
                  contentStyle: { backgroundColor: colors.background },
                }}
              >
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen
                  name="onboarding"
                  options={{ title: "Crear grupo" }}
                />
                <Stack.Screen
                  name="groups/index"
                  options={{ title: "Mis grupos" }}
                />
                <Stack.Screen
                  name="groups/[groupId]"
                  options={{ title: "Lista compartida" }}
                />
                <Stack.Screen
                  name="comparison/[listId]"
                  options={{ title: "Comparar cesta" }}
                />
                <Stack.Screen
                  name="join/[inviteCode]"
                  options={{ title: "Unirse a un grupo" }}
                />
                <Stack.Screen name="settings" options={{ title: "Ajustes" }} />
              </Stack>
            </SessionGate>
          </OfflineSyncProvider>
          <StatusBar style="dark" />
        </SessionProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
