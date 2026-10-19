import { usePathname } from "expo-router";
import { useEffect } from "react";

import { useSession } from "../auth/session-provider";
import { rememberLastScreen } from "./last-screen-storage";

export function NavigationPersistence() {
  const pathname = usePathname();
  const session = useSession();
  const profileId = session.status === "ready" ? session.session.user.id : null;

  useEffect(() => {
    if (!profileId) return;
    void rememberLastScreen(profileId, pathname).catch(() => undefined);
  }, [pathname, profileId]);

  return null;
}
