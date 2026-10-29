Flaw Patrol (ready-to-run build)
================================

You need Node.js 22 or newer (https://nodejs.org) and a Postgres database
(a free one from https://neon.tech works).

Start it
  1. Open a terminal in this folder.
  2. Run:  node start.mjs
  3. The first time, paste your database connection string when asked.
     It is saved as .env in the folder you unzip versions into, so each new
     version unzipped there finds the settings itself:
         FlawPatrol\.env
         FlawPatrol\Flaw_Patrol_ver_51\Flaw_Patrol\start.mjs
         FlawPatrol\Flaw_Patrol_ver_52\Flaw_Patrol\start.mjs
     (It looks one and two folders above start.mjs.)
     Upgrading from version 50 or older: unzip into the same folder as your
     older versions. The first start finds the older .env and offers to copy
     it up to the shared folder (press Enter to accept).
     A .env inside this folder still wins if you put one there.
     The .env holds your database password: don't share it publicly.
  4. Open http://localhost:3000 once it says Ready.

Nothing needs installing: the app and everything it uses are in this folder.
Press Ctrl+C in the terminal to stop it.
