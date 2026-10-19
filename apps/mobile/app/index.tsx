import { useNavigation, type NativeStackNavigationProp } from "expo-router";
import { useEffect, useState } from "react";

import { Screen } from "../components/screen";
import { ScreenState } from "../components/screen-state";
import { useSession } from "../features/auth/session-provider";
import { useGroupsQuery } from "../features/groups/queries";
import { readLastGroup } from "../features/navigation/last-screen-storage";

type StartupRoutes = {
  "groups/index": undefined;
  "groups/[groupId]": { groupId: string };
};

export default function IndexScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<StartupRoutes>>();
  const session = useSession();
  const profileId = session.status === "ready" ? session.session.user.id : null;
  const groups = useGroupsQuery();
  const [savedScreen, setSavedScreen] = useState<{
    profileId: string;
    groupId: string | null;
  } | null>(null);

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    void readLastGroup(profileId)
      .catch(() => null)
      .then((groupId) => {
        if (active) setSavedScreen({ profileId, groupId });
      });
    return () => {
      active = false;
    };
  }, [profileId]);

  useEffect(() => {
    if (!profileId || savedScreen?.profileId !== profileId) return;
    if (savedScreen.groupId !== null && groups.isLoading) return;

    const groupId = groups.data?.some(
      (group) => group.id === savedScreen.groupId,
    )
      ? savedScreen.groupId
      : null;
    // Keep the home screen behind a restored group so Back always returns home.
    navigation.reset(
      groupId
        ? {
            index: 1,
            routes: [
              { name: "groups/index" },
              { name: "groups/[groupId]", params: { groupId } },
            ],
          }
        : { index: 0, routes: [{ name: "groups/index" }] },
    );
  }, [groups.data, groups.isLoading, navigation, profileId, savedScreen]);

  return (
    <Screen scroll={false}>
      <ScreenState loading title="Abriendo tu lista" />
    </Screen>
  );
}
