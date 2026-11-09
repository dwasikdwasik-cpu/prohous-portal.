-- Browser playback endpoints only. RTSP logins/passwords stay on the streaming gateway.
create table public.investment_cameras (
 id uuid primary key default gen_random_uuid(),
 investment_id uuid not null references public.investments(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 1 and 120),
 playback_type text not null default 'hls' check (playback_type in ('hls','embed')),
 playback_url text check (
  playback_url is null or (
   char_length(playback_url) between 9 and 2048 and
   playback_url ~ '^https://[^/?#@[:space:]]+([/?][^#[:space:]]*)?$' and
   (playback_type <> 'hls' or split_part(playback_url,'?',1) ~* '\.m3u8$')
  )
 ),
 client_visible boolean not null default false,
 created_at timestamptz not null default now(),
 constraint camera_requires_playback check (not client_visible or playback_url is not null)
);
create index investment_cameras_investment_idx on public.investment_cameras(investment_id);
alter table public.investment_cameras enable row level security;
revoke all on public.investment_cameras from anon,authenticated;
grant select,insert,update,delete on public.investment_cameras to authenticated;
grant all on public.investment_cameras to service_role;

create policy camera_read on public.investment_cameras for select to authenticated
using (
 (select public.is_admin()) or (
  client_visible and public.can_access_investment(investment_id)
 )
);
create policy camera_insert on public.investment_cameras for insert to authenticated
with check ((select public.is_admin()) and private.investment_is_active(investment_id));
create policy camera_update on public.investment_cameras for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()) and private.investment_is_active(investment_id));
create policy camera_delete on public.investment_cameras for delete to authenticated
using ((select public.is_admin()));
