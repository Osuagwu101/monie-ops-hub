-- Phase 3 post-migration audit cleanup.
-- Migration 003 already established these least-privilege assistant read policies.
-- Migration 005 recreated equivalent predicates under new names; remove only the
-- redundant copies so PostgreSQL does not evaluate duplicate permissive policies.

drop policy if exists merchants_read_assigned_or_director on public.merchants;
drop policy if exists terminals_read_assigned_or_director on public.terminals;
drop policy if exists performance_read_assigned_or_director on public.terminal_performance_snapshots;
