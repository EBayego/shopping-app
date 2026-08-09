import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Screen } from "../../components/screen";
import { ScreenState } from "../../components/screen-state";
import { useSession } from "../../features/auth/session-provider";
import { useJoinGroupMutation } from "../../features/groups/queries";
import { getErrorMessage } from "../../lib/errors";
import { useUiStore } from "../../stores/ui-store";

function firstParameter(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default function JoinGroupScreen() {
  const params = useLocalSearchParams<{ inviteCode: string | string[] }>();
  const inviteCode = firstParameter(params.inviteCode).trim();
  const join = useJoinGroupMutation();
  const session = useSession();
  const setPendingInviteCode = useUiStore(
    (state) => state.setPendingInviteCode,
  );
  const clearPendingInviteCode = useUiStore(
    (state) => state.clearPendingInviteCode,
  );

  useEffect(() => {
    if (!inviteCode) return;
    setPendingInviteCode(inviteCode);
    if (session.status !== "ready" || join.status !== "idle") return;
    join.mutate(inviteCode, {
      onSuccess: (result) => {
        clearPendingInviteCode();
        router.replace({
          pathname: "/groups/[groupId]",
          params: { groupId: result.groupId, joinOutcome: result.outcome },
        });
      },
    });
  }, [
    clearPendingInviteCode,
    inviteCode,
    join,
    session.status,
    setPendingInviteCode,
  ]);

  if (!inviteCode) {
    return (
      <Screen scroll={false}>
        <ScreenState
          title="Falta el código de invitación"
          message="Vuelve a grupos e introduce un código."
        />
      </Screen>
    );
  }
  if (join.isPending || join.isIdle) {
    return (
      <Screen scroll={false}>
        <ScreenState loading title="Comprobando invitación" />
      </Screen>
    );
  }
  if (join.isError) {
    return (
      <Screen scroll={false}>
        <ScreenState
          title="No ha sido posible unirse"
          message={getErrorMessage(join.error)}
          retry={() => join.reset()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <ScreenState loading title="Abriendo grupo" />
    </Screen>
  );
}
