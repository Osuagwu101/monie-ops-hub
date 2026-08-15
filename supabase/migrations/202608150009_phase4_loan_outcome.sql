-- Phase 4: record a confirmed loan disbursement as a distinct human outcome.
-- Kept in its own migration because PostgreSQL requires a newly added enum value
-- to be committed before later database objects safely reference it.

alter type public.task_outcome_code
  add value if not exists 'loan_disbursed';
