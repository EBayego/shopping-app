create function private.claim_group_invite(
  target_group_id uuid,
  actor_id uuid,
  invite_code text,
  expires_in interval,
  allowed_uses integer
)
returns uuid
language sql
set search_path = ''
as $$
  insert into private.group_invites as existing (
    group_id, code_hash, created_by, expires_at, max_uses
  ) values (
    target_group_id, extensions.digest(invite_code, 'sha256'),
    actor_id, now() + expires_in, allowed_uses
  )
  on conflict (code_hash) do update set
    group_id = excluded.group_id,
    created_by = excluded.created_by,
    created_at = now(),
    expires_at = excluded.expires_at,
    max_uses = excluded.max_uses,
    use_count = 0
  where existing.expires_at <= now()
  returning id;
$$;

revoke all on function private.claim_group_invite(uuid, uuid, text, interval, integer) from public, anon, authenticated;

create or replace function public.generate_group_invite(
  target_group_id uuid,
  expires_in interval default interval '7 days',
  allowed_uses integer default 100
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  random_bytes bytea;
  random_value integer;
  invite_code text;
  saved_invite_id uuid;
  attempt integer;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if not exists (
    select 1 from public.group_members
    where group_id = target_group_id
      and profile_id = actor_id
      and role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'Only a group owner can create invites';
  end if;

  if expires_in is null or expires_in < interval '5 minutes' or expires_in > interval '30 days' then
    raise exception using errcode = '22023', message = 'Invite expiry must be between 5 minutes and 30 days';
  end if;
  if allowed_uses is null or allowed_uses < 1 or allowed_uses > 100 then
    raise exception using errcode = '22023', message = 'Allowed uses must be between 1 and 100';
  end if;

  for attempt in 1..128 loop
    random_bytes := extensions.gen_random_bytes(3);
    random_value := get_byte(random_bytes, 0) * 65536
      + get_byte(random_bytes, 1) * 256 + get_byte(random_bytes, 2);
    -- Reject the partial bucket so every six-digit code is equally likely.
    if random_value >= 16000000 then
      continue;
    end if;
    invite_code := lpad((random_value % 1000000)::text, 6, '0');

    saved_invite_id := private.claim_group_invite(
      target_group_id, actor_id, invite_code, expires_in, allowed_uses
    );

    if saved_invite_id is not null then
      return invite_code;
    end if;
  end loop;

  raise exception using errcode = '53000', message = 'No invite code is available; try again';
end;
$$;

comment on function public.generate_group_invite(uuid, interval, integer) is
  'Creates a random six-digit code, valid for 7 days by default. Active hashes are unique; expired codes can be allocated again atomically. Legacy invitations remain valid.';
