import { secureStoreAdapter } from "../../services/secure-store-adapter";

let pendingWrite: Promise<void> = Promise.resolve();

function storageKey(profileId: string): string {
  return `shopping-app-last-group-${profileId}`;
}

export async function readLastGroup(profileId: string): Promise<string | null> {
  await pendingWrite;
  return secureStoreAdapter.getItem(storageKey(profileId));
}

export function rememberLastScreen(
  profileId: string,
  pathname: string,
): Promise<void> {
  // The entry route must read the previous launch before saving a new screen.
  if (pathname === "/") return pendingWrite;

  const groupId = /^\/groups\/([^/]+)$/.exec(pathname)?.[1] ?? null;
  // Serialize writes so a slow group save cannot overwrite a later return home.
  const write = pendingWrite.then(() =>
    groupId === null
      ? secureStoreAdapter.removeItem(storageKey(profileId))
      : secureStoreAdapter.setItem(storageKey(profileId), groupId),
  );
  pendingWrite = write.catch(() => undefined);
  return write;
}
