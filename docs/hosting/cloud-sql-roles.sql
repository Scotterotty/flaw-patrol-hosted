-- Flaw Patrol database and its two logins, for Cloud SQL for PostgreSQL (16 or 17).
-- Run once, as the "postgres" admin user, with psql (Cloud SQL Studio works too):
--   psql "host=PRIVATE-IP user=postgres dbname=postgres sslmode=require" \
--     -v migrator_pw="'...'" -v app_pw="'...'" -f cloud-sql-roles.sql
--
-- flawpatrol_migrator  owns the tables and may change them. Used ONLY by the migrate Job.
-- flawpatrol_app       may read, add, change and delete rows. Cannot create, change or
--                      drop tables. This is the login the app runs with (DATABASE_URL).

CREATE ROLE flawpatrol_migrator LOGIN PASSWORD :migrator_pw;
CREATE ROLE flawpatrol_app LOGIN PASSWORD :app_pw;

-- Cloud SQL's postgres user isn't a full superuser, so it must be a member of a role
-- to make that role a database owner.
GRANT flawpatrol_migrator TO postgres;
CREATE DATABASE flawpatrol OWNER flawpatrol_migrator;

\connect flawpatrol

-- Nobody else may create things in the schema; the app may use it.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO flawpatrol_migrator;
GRANT USAGE ON SCHEMA public TO flawpatrol_app;

-- Every table and sequence the migrator creates from now on is open to the app for rows only.
ALTER DEFAULT PRIVILEGES FOR ROLE flawpatrol_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flawpatrol_app;
ALTER DEFAULT PRIVILEGES FOR ROLE flawpatrol_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO flawpatrol_app;

-- Only needed if tables already exist (for example after restoring a copy of the old
-- server's database as flawpatrol_migrator). Harmless otherwise.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flawpatrol_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO flawpatrol_app;
