import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getOwnProfile,
  updateDisplayName,
} from "../../repositories/profile-repository";

const profileKey = (userId: string) => ["profile", userId] as const;

export function useProfileQuery(userId: string) {
  return useQuery({
    queryKey: profileKey(userId),
    queryFn: () => getOwnProfile(userId),
    enabled: userId.length > 0,
  });
}

export function useUpdateProfileMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) => updateDisplayName(userId, displayName),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: profileKey(userId) }),
  });
}
