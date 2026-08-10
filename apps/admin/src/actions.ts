import type { SupabaseRestClient } from "./supabase.js";

export class AdminActions {
  constructor(
    private readonly client: SupabaseRestClient,
    private readonly actor: string,
  ) {}

  async setProviderStatus(retailerId: string, status: string): Promise<void> {
    assertUuid(retailerId, "retailerId");
    if (status !== "ACTIVE" && status !== "DEGRADED" && status !== "DISABLED") {
      throw new TypeError("Invalid provider status");
    }
    await this.client.rpc("admin_set_provider_status", {
      target_retailer_id: retailerId,
      target_status: status,
      actor: this.actor,
    });
  }

  async requestRefresh(input: {
    retailerId: string;
    requestType: string;
    postalCode: string;
    productIds: string[];
  }): Promise<void> {
    assertUuid(input.retailerId, "retailerId");
    if (
      input.requestType !== "PRICE_REFRESH" &&
      input.requestType !== "CATALOG_SYNC"
    ) {
      throw new TypeError("Invalid refresh request type");
    }
    if (!/^\d{5}$/.test(input.postalCode)) {
      throw new TypeError("Invalid postal code");
    }
    await this.client.rpc("admin_request_refresh", {
      target_retailer_id: input.retailerId,
      target_request_type: input.requestType,
      target_postal_code: input.postalCode,
      target_product_ids: input.productIds,
      actor: this.actor,
    });
  }

  acceptMatch(matchId: string): Promise<unknown> {
    assertUuid(matchId, "matchId");
    return this.client.rpc("admin_accept_product_match", {
      target_match_id: matchId,
      actor: this.actor,
    });
  }

  rejectMatch(matchId: string): Promise<unknown> {
    assertUuid(matchId, "matchId");
    return this.client.rpc("admin_reject_product_match", {
      target_match_id: matchId,
      actor: this.actor,
    });
  }

  reassignMatch(matchId: string, canonicalProductId: string): Promise<unknown> {
    assertUuid(matchId, "matchId");
    assertUuid(canonicalProductId, "canonicalProductId");
    return this.client.rpc("admin_reassign_product_match", {
      target_match_id: matchId,
      target_canonical_product_id: canonicalProductId,
      actor: this.actor,
    });
  }

  updateCanonical(
    canonicalProductId: string,
    changes: Record<string, unknown>,
  ): Promise<unknown> {
    assertUuid(canonicalProductId, "canonicalProductId");
    if (Object.keys(changes).length === 0) {
      throw new TypeError("No canonical changes supplied");
    }
    return this.client.rpc("admin_update_canonical_product", {
      target_canonical_product_id: canonicalProductId,
      changes,
      actor: this.actor,
    });
  }
}

export function parseProductIds(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 500);
}

function assertUuid(value: string, name: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new TypeError(`${name} must be a UUID`);
  }
}
