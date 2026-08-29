-- Harden batch application so duplicate/omitted Browser Use rows can never
-- inflate counts or silently disappear. Every expected terminal receives one
-- deterministic outcome.

create or replace function public.contact_bootstrap_apply_batch(
  p_token text,
  p_run_id uuid,
  p_results jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_run public.contact_bootstrap_runs;
  v_report_date date;
  v_expected jsonb;
  v_expected_item jsonb;
  v_item jsonb;
  v_verified_payload jsonb := '[]'::jsonb;
  v_verified integer := 0;
  v_review integer := 0;
  v_not_found integer := 0;
  v_processed integer := 0;
  v_outcome text;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  if jsonb_typeof(p_results) <> 'array' then raise exception 'p_results must be an array'; end if;
  select * into v_run from public.contact_bootstrap_runs where id=p_run_id for update;
  if v_run.id is null then raise exception 'Contact bootstrap run not found'; end if;
  select report_date into v_report_date from public.report_imports where id=v_run.report_id;
  v_expected := public.contact_bootstrap_batch(v_run.report_id,v_run.next_offset,v_run.batch_size);

  for v_expected_item in select value from jsonb_array_elements(v_expected) loop
    v_item := null;
    select value into v_item
    from jsonb_array_elements(p_results)
    where upper(btrim(value->>'terminalId'))=upper(btrim(v_expected_item->>'terminalId'))
      and upper(btrim(value->>'terminalSerial'))=upper(btrim(v_expected_item->>'terminalSerial'))
      and lower(btrim(value->>'businessName'))=lower(btrim(v_expected_item->>'businessName'))
    limit 1;

    if v_item is null then
      v_review := v_review + 1;
      insert into public.business_contact_lookup_audit(
        terminal_id,terminal_serial,requested_business_name,outcome,source_report_date,source_reference,details
      ) values(
        btrim(v_expected_item->>'terminalId'),
        btrim(v_expected_item->>'terminalSerial'),
        btrim(v_expected_item->>'businessName'),
        'REVIEW',v_report_date,'contact_vault_bootstrap',
        jsonb_build_object('status','review','reason','missing_from_browser_batch')
      );
      continue;
    end if;

    v_processed := v_processed + 1;
    v_outcome := lower(coalesce(v_item->>'status','review'));
    if v_outcome='verified'
       and nullif(btrim(coalesce(v_item->>'phoneNumber','')),'') is not null
       and nullif(btrim(coalesce(v_item->>'posAccountNumber','')),'') is not null then
      v_verified_payload := v_verified_payload || jsonb_build_array(jsonb_build_object(
        'businessName',btrim(v_expected_item->>'businessName'),
        'phoneNumber',btrim(v_item->>'phoneNumber'),
        'posAccountNumber',btrim(v_item->>'posAccountNumber'),
        'terminalId',btrim(v_expected_item->>'terminalId'),
        'terminalSerial',btrim(v_expected_item->>'terminalSerial'),
        'matchMethod','EXACT_NAME_AND_TERMINAL',
        'crmSourcePath',nullif(v_item->>'sourcePath','')
      ));
      v_verified := v_verified + 1;
    else
      if v_outcome='not_found' then
        v_not_found:=v_not_found+1;
      else
        v_review:=v_review+1;
      end if;
      insert into public.business_contact_lookup_audit(
        terminal_id,terminal_serial,requested_business_name,outcome,source_report_date,source_reference,details
      ) values(
        btrim(v_expected_item->>'terminalId'),
        btrim(v_expected_item->>'terminalSerial'),
        btrim(v_expected_item->>'businessName'),
        case when v_outcome='not_found' then 'NOT_FOUND' else 'REVIEW' end,
        v_report_date,'contact_vault_bootstrap',jsonb_build_object('status',v_outcome)
      );
    end if;
  end loop;

  if jsonb_array_length(v_verified_payload)>0 then
    perform public.upsert_verified_business_contacts(v_verified_payload,v_report_date,'contact_vault_bootstrap');
  end if;

  update public.contact_bootstrap_runs
  set next_offset = least(total_items,next_offset+jsonb_array_length(v_expected)),
      verified_count=verified_count+v_verified,
      review_count=review_count+v_review,
      not_found_count=not_found_count+v_not_found,
      browser_task_id=null,
      status=case when next_offset+jsonb_array_length(v_expected) >= total_items then 'completed' else 'polling' end,
      completed_at=case when next_offset+jsonb_array_length(v_expected) >= total_items then now() else null end,
      diagnostics=jsonb_build_object(
        'lastBatchExpected',jsonb_array_length(v_expected),
        'lastBatchMatched',v_processed,
        'lastBatchVerified',v_verified,
        'lastBatchReview',v_review,
        'lastBatchNotFound',v_not_found
      ),
      updated_at=now()
  where id=v_run.id
  returning * into v_run;

  return jsonb_build_object(
    'done',v_run.status='completed','nextOffset',v_run.next_offset,'totalItems',v_run.total_items,
    'verifiedTotal',v_run.verified_count,'reviewTotal',v_run.review_count,'notFoundTotal',v_run.not_found_count,
    'nextBatch',case when v_run.status='completed' then '[]'::jsonb else public.contact_bootstrap_batch(v_run.report_id,v_run.next_offset,v_run.batch_size) end
  );
end;
$$;
revoke all on function public.contact_bootstrap_apply_batch(text,uuid,jsonb) from public;
grant execute on function public.contact_bootstrap_apply_batch(text,uuid,jsonb) to anon,authenticated;
