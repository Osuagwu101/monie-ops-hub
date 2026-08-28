CREATE TABLE public.report_contact_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.report_imports(id) ON DELETE CASCADE,
  terminal_external_id text NOT NULL,
  terminal_serial text,
  terminal_id uuid REFERENCES public.terminals(id),
  merchant_id uuid REFERENCES public.merchants(id),
  business_name text NOT NULL,
  resolution_status text NOT NULL CHECK (resolution_status IN ('verified','review','no_contact')),
  resolution_reason text NOT NULL,
  phone_number text,
  account_number text,
  task_created boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, terminal_external_id)
);

GRANT SELECT ON public.report_contact_resolutions TO authenticated;
GRANT ALL ON public.report_contact_resolutions TO service_role;

ALTER TABLE public.report_contact_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Directors can read contact resolutions"
  ON public.report_contact_resolutions
  FOR SELECT
  TO authenticated
  USING (public.is_director());

CREATE TRIGGER report_contact_resolutions_set_updated_at
  BEFORE UPDATE ON public.report_contact_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX report_contact_resolutions_report_status_idx
  ON public.report_contact_resolutions (report_id, resolution_status);

CREATE UNIQUE INDEX tasks_report_terminal_type_idx
  ON public.tasks (planning_report_id, terminal_id, task_type)
  WHERE planning_report_id IS NOT NULL AND terminal_id IS NOT NULL AND auto_generated;

CREATE OR REPLACE FUNCTION public.bootstrap_manual_report(p_report_id uuid, p_assigned_to uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_report public.report_imports;
  v_assignee uuid;
  v_row record;
  v_terminal public.terminals;
  v_merchant public.merchants;
  v_status text;
  v_reason text;
  v_phone text;
  v_account text;
  v_merchant_matches integer;
  v_verified integer := 0;
  v_review integer := 0;
  v_no_contact integer := 0;
  v_tasks integer := 0;
  v_task_type public.task_type;
  v_task_created boolean;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  select * into v_report from public.report_imports where id = p_report_id;
  if v_report.id is null then
    raise exception 'Report not found';
  end if;
  if v_report.processing_status <> 'processed' then
    raise exception 'Report has not finished processing';
  end if;

  v_assignee := coalesce(
    p_assigned_to,
    (select id from public.profiles where role = 'assistant' and is_active order by created_at limit 1),
    auth.uid()
  );
  if v_assignee is null then
    raise exception 'No active assistant is available to receive tasks';
  end if;

  delete from public.report_contact_resolutions where report_id = p_report_id;

  for v_row in
    select r.terminal_external_id,
           max(r.terminal_serial) as terminal_serial,
           min(r.business_name) as business_name,
           bool_or(r.section_kind = 'non_transacting'::public.report_terminal_section) as non_transacting,
           bool_or(coalesce(r.official_target_met, false)) as target_met,
           max(coalesce(r.days_since_last_transaction, 0)) as days_since
    from public.report_terminal_rows r
    where r.report_id = p_report_id
    group by r.terminal_external_id
  loop
    v_terminal := null;
    v_merchant := null;
    v_phone := null;
    v_account := null;
    v_task_created := false;

    select * into v_terminal from public.terminals t where t.terminal_id = v_row.terminal_external_id;

    if v_terminal.id is null then
      v_status := 'review';
      v_reason := 'Terminal ID is not present in the terminal registry.';
    elsif v_row.terminal_serial is null or v_terminal.serial_number is null then
      v_status := 'review';
      v_reason := 'Terminal serial number is missing, so the merchant contact cannot be verified.';
    elsif upper(btrim(v_row.terminal_serial)) <> upper(btrim(v_terminal.serial_number)) then
      v_status := 'review';
      v_reason := 'Terminal serial number in the report does not match the registered serial number.';
    elsif v_terminal.merchant_id is null then
      v_status := 'review';
      v_reason := 'Terminal is not linked to a merchant record.';
    else
      select count(distinct t.merchant_id) into v_merchant_matches
      from public.terminals t
      where t.serial_number is not null
        and upper(btrim(t.serial_number)) = upper(btrim(v_terminal.serial_number));

      if coalesce(v_merchant_matches, 0) > 1 then
        v_status := 'review';
        v_reason := 'Terminal serial number maps to more than one merchant.';
      else
        select * into v_merchant from public.merchants m where m.id = v_terminal.merchant_id;
        v_phone := nullif(btrim(coalesce(v_merchant.phone_number, '')), '');
        v_account := nullif(btrim(coalesce(v_merchant.account_number, '')), '');

        if v_phone is null and v_account is null then
          v_status := 'no_contact';
          v_reason := 'Merchant has no stored phone number or account number.';
        else
          v_status := 'verified';
          v_reason := 'Terminal ID and serial number resolve to a single merchant with stored contact data.';
        end if;
      end if;
    end if;

    if v_status = 'verified' and not v_row.target_met then
      if v_row.non_transacting or v_row.days_since >= 7 then
        v_task_type := 'FOLLOW_UP'::public.task_type;
      else
        v_task_type := 'TA'::public.task_type;
      end if;

      if not exists (
        select 1 from public.tasks t
        where t.planning_report_id = p_report_id
          and t.terminal_id = v_terminal.id
          and t.task_type = v_task_type
      ) then
        insert into public.tasks(
          task_date, task_type, status, priority, merchant_id, terminal_id, assigned_to,
          reason, recommended_talking_points, auto_generated, planning_report_id, created_by
        ) values (
          v_report.report_date,
          v_task_type,
          'assigned'::public.task_status,
          case when v_task_type = 'FOLLOW_UP'::public.task_type then 1 else 2 end,
          v_terminal.merchant_id,
          v_terminal.id,
          v_assignee,
          case
            when v_task_type = 'FOLLOW_UP'::public.task_type
              then 'Non-transacting terminal in the official report for ' || v_report.report_date::text || '.'
            else 'Official target not met in the report for ' || v_report.report_date::text || '.'
          end,
          'Verified contact from stored merchant record. Confirm terminal status and agree a transaction commitment.',
          true,
          p_report_id,
          auth.uid()
        );
        v_tasks := v_tasks + 1;
        v_task_created := true;
      end if;
    end if;

    insert into public.report_contact_resolutions(
      report_id, terminal_external_id, terminal_serial, terminal_id, merchant_id,
      business_name, resolution_status, resolution_reason, phone_number, account_number, task_created
    ) values (
      p_report_id, v_row.terminal_external_id, v_row.terminal_serial, v_terminal.id, v_terminal.merchant_id,
      v_row.business_name, v_status, v_reason, v_phone, v_account, v_task_created
    );

    if v_status = 'verified' then
      v_verified := v_verified + 1;
    elsif v_status = 'no_contact' then
      v_no_contact := v_no_contact + 1;
    else
      v_review := v_review + 1;
    end if;
  end loop;

  insert into public.audit_events(actor_user_id, actor_kind, event_type, entity_type, entity_id, payload)
  values (
    auth.uid(), 'director', 'manual_report_bootstrapped', 'report_import', p_report_id::text,
    jsonb_build_object(
      'report_date', v_report.report_date,
      'verified_matches', v_verified,
      'review_required', v_review,
      'no_contact_blockers', v_no_contact,
      'tasks_created', v_tasks
    )
  );

  return jsonb_build_object(
    'reportId', p_report_id,
    'reportDate', v_report.report_date,
    'verifiedMatches', v_verified,
    'reviewRequired', v_review,
    'noContactBlockers', v_no_contact,
    'tasksCreated', v_tasks
  );
end;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_manual_report(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_manual_report(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.manual_report_bootstrap_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_report public.report_imports;
  v_rows integer := 0;
  v_verified integer := 0;
  v_review integer := 0;
  v_no_contact integer := 0;
  v_tasks integer := 0;
  v_contacts_cached integer := 0;
  v_last_resolved timestamptz;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  select * into v_report
  from public.report_imports
  where processing_status = 'processed'
  order by report_date desc, imported_at desc
  limit 1;

  select count(*) into v_contacts_cached
  from public.merchants m
  where nullif(btrim(coalesce(m.phone_number, '')), '') is not null
     or nullif(btrim(coalesce(m.account_number, '')), '') is not null;

  if v_report.id is not null then
    select count(*) into v_rows from public.report_terminal_rows where report_id = v_report.id;

    select
      count(*) filter (where resolution_status = 'verified'),
      count(*) filter (where resolution_status = 'review'),
      count(*) filter (where resolution_status = 'no_contact'),
      max(updated_at)
    into v_verified, v_review, v_no_contact, v_last_resolved
    from public.report_contact_resolutions
    where report_id = v_report.id;

    select count(*) into v_tasks
    from public.tasks
    where planning_report_id = v_report.id and auto_generated;
  end if;

  return jsonb_build_object(
    'reportImported', v_report.id is not null,
    'reportId', v_report.id,
    'latestReportDate', v_report.report_date,
    'sourceFilename', v_report.source_filename,
    'importedAt', v_report.imported_at,
    'rowsParsed', coalesce(v_rows, 0),
    'contactsCached', coalesce(v_contacts_cached, 0),
    'verifiedMatches', coalesce(v_verified, 0),
    'reviewRequired', coalesce(v_review, 0),
    'noContactBlockers', coalesce(v_no_contact, 0),
    'tasksCreated', coalesce(v_tasks, 0),
    'lastResolvedAt', v_last_resolved
  );
end;
$$;

REVOKE ALL ON FUNCTION public.manual_report_bootstrap_status() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.manual_report_bootstrap_status() TO authenticated;