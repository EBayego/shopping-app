import { describe, expect, it } from "vitest";

import { groupKeys } from "./query-keys";

describe("groupKeys", () => {
  it("isolates group lists by authenticated profile", () => {
    expect(groupKeys.list("anonymous-user")).not.toEqual(
      groupKeys.list("google-user"),
    );
  });

  it("allows invalidating every cached version of one group", () => {
    const scope = groupKeys.detailScope("group-1");
    const detail = groupKeys.detail("profile-1", "group-1");

    expect(detail.slice(0, scope.length)).toEqual(scope);
  });
});
