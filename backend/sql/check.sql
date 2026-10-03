-- Read-only check. Changes nothing.
-- Supabase dashboard → SQL Editor → New query → paste → Run.
-- Shows every table in your public schema, whether Row Level Security is on,
-- and whether it's one of ReelLingo's tables.
SELECT
  c.relname AS table_name,
  CASE WHEN c.relrowsecurity THEN 'ON' ELSE 'OFF  <-- needs fixing' END AS row_level_security,
  CASE WHEN c.relname IN ('jobs', 'plans', 'subscriptions', 'payments', 'credits', 'profiles', 'voices', 'glossary_terms', 'teams', 'team_members', 'api_keys', 'cost_events', 'provider_budgets', 'user_budgets', 'app_settings', 'integrations') THEN 'ReelLingo' ELSE 'other' END AS created_by,
  (SELECT count(*) FROM information_schema.columns col WHERE col.table_schema = 'public' AND col.table_name = c.relname) AS columns
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY row_level_security DESC, table_name;
