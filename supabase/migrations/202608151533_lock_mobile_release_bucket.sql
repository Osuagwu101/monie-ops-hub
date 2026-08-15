-- Remove the temporary one-time anonymous upload permission after the controlled APK publish.
drop policy if exists monie_brm_release_one_time_insert on storage.objects;
