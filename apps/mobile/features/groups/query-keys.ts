export const groupKeys = {
  root: ["groups"] as const,
  list: (profileId: string) => ["groups", "list", profileId] as const,
  detailScope: (groupId: string) => ["groups", "detail", groupId] as const,
  detail: (profileId: string, groupId: string) =>
    ["groups", "detail", groupId, profileId] as const,
};
