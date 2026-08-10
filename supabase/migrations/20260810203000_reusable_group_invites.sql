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
  invite_code text;
  compact_code text;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.group_members
    where group_id = target_group_id
      and profile_id = actor_id
      and role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'Only a group owner can create invites';
  end if;

  if expires_in < interval '5 minutes' or expires_in > interval '30 days' then
    raise exception using errcode = '22023', message = 'Invite expiry must be between 5 minutes and 30 days';
  end if;

  if allowed_uses < 1 or allowed_uses > 100 then
    raise exception using errcode = '22023', message = 'Allowed uses must be between 1 and 100';
  end if;

  compact_code := upper(encode(extensions.gen_random_bytes(12), 'hex'));
  invite_code := concat_ws(
    '-',
    substring(compact_code from 1 for 4),
    substring(compact_code from 5 for 4),
    substring(compact_code from 9 for 4),
    substring(compact_code from 13 for 4),
    substring(compact_code from 17 for 4),
    substring(compact_code from 21 for 4)
  );

  insert into private.group_invites (
    group_id,
    code_hash,
    created_by,
    expires_at,
    max_uses
  ) values (
    target_group_id,
    extensions.digest(invite_code, 'sha256'),
    actor_id,
    now() + expires_in,
    allowed_uses
  );

  return invite_code;
end;
$$;

comment on function public.generate_group_invite(uuid, interval, integer) is
  'Creates a reusable, human-readable invite code; only its SHA-256 hash is persisted.';
