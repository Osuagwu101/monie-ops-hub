-- Phase 3 source-integrity hardening.
-- A Moniepoint report record may only be created after its private immutable PDF
-- exists in Storage at the canonical report-date/SHA-256 path.

create or replace function public.validate_report_source_object()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_prefix text;
begin
  if new.source_kind <> 'moniepoint_pdf' then
    return new;
  end if;

  if new.source_storage_path is null or btrim(new.source_storage_path) = '' then
    raise exception 'Moniepoint report source storage path is required';
  end if;

  v_expected_prefix := new.report_date::text || '/' || lower(new.source_sha256) || '/';
  if left(new.source_storage_path, length(v_expected_prefix)) <> v_expected_prefix then
    raise exception 'Report source path does not match report date and SHA-256 digest';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'moniepoint-reports'
      and o.name = new.source_storage_path
  ) then
    raise exception 'Official report PDF is missing from immutable storage';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_report_source_object() from public;

create trigger report_imports_validate_source_object
before insert on public.report_imports
for each row execute function public.validate_report_source_object();
