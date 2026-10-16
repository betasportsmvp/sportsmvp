-- Phase 1 attendance: one session per group-local date, created on the first attendance
-- action, and a single audited command for recording or correcting attendance.
--
-- Policy
--   * Dates are the group's local calendar date (groups.timezone). Future dates are rejected.
--   * A member may record only their own attendance, from today back `backdate_days` days.
--   * Owners and admins may record any active member's attendance on any past date.
--   * Every change writes an `attendance.recorded` audit event with before/after values,
--     who made it, and whether it was late or on someone else's behalf.

-- The group's current local calendar date (null for groups the caller isn't in).
create function public.group_local_today(p_group_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone g.timezone)::date from public.groups g
  where g.id = p_group_id and public.is_group_member(g.id);
$$;

create function public.upsert_attendance(
  p_group_id uuid,
  p_local_date date,
  p_user_id uuid,
  p_status public.attendance_status,
  p_idempotency_key text
)
returns public.attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_user();
  v_receipt jsonb;
  v_group public.groups;
  v_today date;
  v_is_admin boolean;
  v_session public.sessions;
  v_before public.attendance;
  v_after public.attendance;
begin
  select result into v_receipt from public.command_receipts
  where user_id = v_uid and command = 'upsert_attendance' and idempotency_key = p_idempotency_key;
  if found then
    select * into v_after from public.attendance where id = (v_receipt ->> 'attendance_id')::uuid;
    return v_after;
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'forbidden';
  end if;
  if p_local_date is null or p_status is null then
    raise exception 'invalid_attendance';
  end if;

  select * into v_group from public.groups where id = p_group_id;
  v_today := (now() at time zone v_group.timezone)::date;
  v_is_admin := public.has_group_role(p_group_id, array['owner', 'admin']::public.member_role[]);

  if p_user_id is distinct from v_uid and not v_is_admin then
    raise exception 'forbidden';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = p_user_id and m.left_at is null
  ) then
    raise exception 'member_not_found';
  end if;
  if p_local_date > v_today then
    raise exception 'future_date';
  end if;
  if not v_is_admin and p_local_date < v_today - v_group.backdate_days then
    raise exception 'outside_backdate_window';
  end if;

  insert into public.sessions (group_id, local_date, created_by)
  values (p_group_id, p_local_date, v_uid)
  on conflict (group_id, local_date) do nothing
  returning * into v_session;
  if v_session.id is null then
    select * into v_session from public.sessions where group_id = p_group_id and local_date = p_local_date;
  else
    perform public.write_audit(p_group_id, v_uid, 'session.created', 'session', v_session.id, null,
      to_jsonb(v_session));
  end if;

  select * into v_before from public.attendance
  where session_id = v_session.id and user_id = p_user_id
  for update;

  if v_before.id is not null and v_before.status = p_status then
    v_after := v_before;
  else
    insert into public.attendance (session_id, user_id, status, recorded_by, recorded_at)
    values (v_session.id, p_user_id, p_status, v_uid, now())
    on conflict (session_id, user_id) do update
      set status = excluded.status, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at
    returning * into v_after;

    perform public.write_audit(p_group_id, v_uid, 'attendance.recorded', 'attendance', v_after.id,
      case when v_before.id is null then null
           else jsonb_build_object('status', v_before.status, 'recorded_by', v_before.recorded_by,
                                   'recorded_at', v_before.recorded_at) end,
      jsonb_build_object(
        'session_id', v_session.id,
        'local_date', p_local_date,
        'user_id', p_user_id,
        'status', v_after.status,
        'recorded_by', v_uid,
        'recorded_at', v_after.recorded_at,
        'group_today', v_today,
        'late', p_local_date < v_today,
        'on_behalf', p_user_id <> v_uid
      ));
  end if;

  insert into public.command_receipts (user_id, command, idempotency_key, result)
  values (v_uid, 'upsert_attendance', p_idempotency_key, jsonb_build_object('attendance_id', v_after.id));

  return v_after;
end;
$$;

revoke execute on function public.group_local_today(uuid) from public, anon, authenticated;
revoke execute on function
  public.upsert_attendance(uuid, date, uuid, public.attendance_status, text)
from public, anon, authenticated;
grant execute on function
  public.group_local_today(uuid),
  public.upsert_attendance(uuid, date, uuid, public.attendance_status, text)
to authenticated;
