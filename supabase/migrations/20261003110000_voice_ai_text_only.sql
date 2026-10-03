-- Forward-only cleanup: the previous migration may already be deployed.
-- These are bounded usage counters, not shopping items or user history.
delete from private.voice_ai_usage where operation = 'transcribe';
delete from private.voice_ai_global_usage where operation = 'transcribe';
alter table private.voice_ai_usage drop constraint voice_ai_usage_operation_check;
alter table private.voice_ai_usage add constraint voice_ai_usage_operation_check check (operation = 'extract');
alter table private.voice_ai_global_usage drop constraint voice_ai_global_usage_operation_check;
alter table private.voice_ai_global_usage add constraint voice_ai_global_usage_operation_check check (operation = 'extract');

-- Preserve the RPC signature and extraction counters for existing text clients.
create or replace function public.consume_voice_ai_quota(actor_id uuid, operation text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current_minute timestamptz := date_trunc('minute', clock_timestamp());
  current_day date := (clock_timestamp() at time zone 'UTC')::date;
  user_usage private.voice_ai_usage%rowtype;
  global_usage private.voice_ai_global_usage%rowtype;
begin
  if actor_id is null or operation is null or operation <> 'extract' then
    raise exception using errcode = '22023', message = 'Invalid voice quota scope';
  end if;
  insert into private.voice_ai_global_usage values (operation, current_day, 0) on conflict do nothing;
  select * into global_usage from private.voice_ai_global_usage usage
    where usage.operation = consume_voice_ai_quota.operation for update;
  insert into private.voice_ai_usage values (actor_id, operation, current_minute, 0, current_day, 0) on conflict do nothing;
  select * into user_usage from private.voice_ai_usage usage
    where usage.actor_id = consume_voice_ai_quota.actor_id and usage.operation = consume_voice_ai_quota.operation for update;
  if global_usage.usage_day <> current_day then global_usage.daily_requests := 0; end if;
  if user_usage.usage_day <> current_day then user_usage.daily_requests := 0; end if;
  if user_usage.minute_window <> current_minute then user_usage.minute_requests := 0; end if;
  -- Count reservations (including upstream failures) to bound retries and expense.
  if user_usage.minute_requests >= 6 or user_usage.daily_requests >= 60 or global_usage.daily_requests >= 500 then return false; end if;
  update private.voice_ai_global_usage usage
    set usage_day = current_day, daily_requests = global_usage.daily_requests + 1
    where usage.operation = consume_voice_ai_quota.operation;
  update private.voice_ai_usage usage
    set minute_window = current_minute, usage_day = current_day,
        minute_requests = user_usage.minute_requests + 1, daily_requests = user_usage.daily_requests + 1
    where usage.actor_id = consume_voice_ai_quota.actor_id and usage.operation = consume_voice_ai_quota.operation;
  return true;
end;
$$;
revoke all on function public.consume_voice_ai_quota(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_voice_ai_quota(uuid, text) to service_role;
