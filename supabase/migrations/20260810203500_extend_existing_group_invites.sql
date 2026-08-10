update private.group_invites
set max_uses = 100
where expires_at > now()
  and max_uses = 1;

comment on table private.group_invites is
  'Invite codes are stored only as SHA-256 hashes outside exposed API schemas; active links may be reused up to their max_uses limit.';
