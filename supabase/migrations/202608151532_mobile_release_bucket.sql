-- One-time public delivery location for the signed internal Android build.
-- The native debug-signed internal APK includes all supported Android ABIs and is about 131 MB.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('app-downloads','app-downloads',true,209715200,array['application/vnd.android.package-archive','application/octet-stream'])
on conflict(id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

-- Temporary exact-object upload permission used only by the controlled GitHub release workflow.
-- A follow-up migration removes this INSERT policy immediately after the APK is verified live.
drop policy if exists monie_brm_release_one_time_insert on storage.objects;
create policy monie_brm_release_one_time_insert on storage.objects
for insert to anon
with check (
  bucket_id='app-downloads'
  and name='moniepoint-brm-1.0.0-internal.apk'
);
