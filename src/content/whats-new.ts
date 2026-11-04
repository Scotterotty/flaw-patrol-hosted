/**
 * The "What's new" window after sign-in. Add one entry at the TOP in
 * every build, in the same plain words as the release notes, one line each.
 * Builds with no entry don't pop up. Never write secret features here.
 *
 * who: "all" (default), "lead" (leads and admins), "admin" or "workspace"
 * (workspace admins only, for Workspace settings). game: only for
 * people with the mini game on. link: where Show me goes; {umbrella} becomes
 * the person's umbrella, and the link is left out when they have none.
 * Titles and text are shown through spell(), so UK English readers see colour.
 */
export type WhatsNewItem = {
  kind: "new" | "better" | "fix";
  title: string;
  text?: string;
  who?: "all" | "lead" | "admin" | "workspace";
  game?: boolean;
  link?: string;
};

export type WhatsNewEntry = { version: number; date: string; items: WhatsNewItem[] };

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: 170,
    date: "2026-11-04",
    items: [
      {
        kind: "better",
        title: "Import finds your column names by itself",
        text: "A checklist sheet with info rows on top (Tester, Release…) now imports right away: we find the row with your column names. Pick a different row from the box if we got it wrong.",
      },
      {
        kind: "better",
        title: "Section rows become folders when you import",
        text: "A row with only a name in it, like \"Queen Mary Space\", becomes a top folder for the cases under it. A Category column becomes the Folder too.",
      },
      {
        kind: "better",
        title: "Long titles split on import",
        text: "When a title has several lines, the first line is the title and the rest goes to Expected. It's picked for you; you can keep the whole text instead.",
      },
      {
        kind: "new",
        title: "Sheet results go straight into a run",
        text: "If your checklist already has results filled in, Bring them into a run on the import's done screen opens Results from a spreadsheet with the same file.",
      },
      {
        kind: "new",
        title: "Write a bug without a test",
        text: "Found a bug outside a test? Press + Write a bug on the Bugs page or Overview, or the + next to Bugs in the left menu. Pick a template, write it, and save it here or straight into Jira.",
      },
      {
        kind: "better",
        title: "Requirements can show every issue type",
        text: "Settings → Jira → Requirements → Issue types you can link → Every issue type. A release then lists every ticket with that Fix Version (Bugs, Epics, Improvements…), not just Stories and Tasks.",
        who: "lead",
      },
    ],
  },
  {
    version: 169,
    date: "2026-11-04",
    items: [
      {
        kind: "better",
        title: "Bug bash board is one click away",
        text: "Once you join a bug bash, two tabs sit under its name: My area, where you log, and Whole bash, with everyone's finds, who's where and the clock.",
      },
      {
        kind: "better",
        title: "The red bug bash pill knows you're in",
        text: "It says Back to it once you've joined and takes you to your area.",
      },
      {
        kind: "new",
        title: "Open any find on the bug bash board",
        text: "Click a find on the board to see everything about it: details, screenshots, who sees it too, and what people added. Copy link sends someone straight to it. Finds on the report open the same way.",
      },
      {
        kind: "new",
        title: "Add an area while a bug bash is on",
        text: "What's being tested → Edit → Add an area. Everyone sees it right away with a New tag.",
      },
      {
        kind: "better",
        title: "Bug bash results have one clear home",
        text: "Each bash's report. Get there from See results on Bug bashes, the line on Charters, or Your work.",
      },
      {
        kind: "better",
        title: "Wrap up shows each bug's client",
        text: "The Wrap up table has a Client column, so you can check or change where each bug was seen before it's filed.",
        who: "lead",
      },
    ],
  },
  {
    version: 168,
    date: "2026-11-04",
    items: [
      {
        kind: "better",
        title: "Members list is for Admins only",
        text: "Only Admins see who's on an umbrella or test cycle, with their emails and roles. Everyone else sees which Admin to ask when they need someone added or a role changed.",
      },
    ],
  },
  {
    version: 167,
    date: "2026-11-04",
    items: [
      {
        kind: "fix",
        title: "Glossary underlines in steps with test data",
        text: "Steps with test data values now underline Glossary terms too. Before, a step with a blue test data value lost all its underlines.",
      },
    ],
  },
  {
    version: 166,
    date: "2026-11-04",
    items: [
      {
        kind: "new",
        title: "Bring in spreadsheet results from an umbrella",
        text: "Test runs → Bring in results → Results from a spreadsheet. Pick the test cycle first, then your sheet.",
        who: "lead",
        link: "/g/{umbrella}/runs",
      },
      {
        kind: "new",
        title: "Add a sheet to a run in progress",
        text: "Choose A run in progress or A new run. The sheet only fills cases that are still untested. If it disagrees with a result here, you see both and nothing changes unless you tick Use the sheet's result.",
        who: "lead",
      },
      {
        kind: "fix",
        title: "Sheets find the cases in an umbrella's Case library",
        text: "Importing a run into an umbrella's test cycle now matches the umbrella's cases. A blank or Select in the sheet is read as no result.",
        who: "lead",
      },
    ],
  },
  {
    version: 165,
    date: "2026-11-04",
    items: [
      {
        kind: "better",
        title: "Cases with only a title run like any other case",
        text: "The title shows as step 1 with the usual Passed, Failed and Blocked buttons and keys. That step sets the case result. Nothing is added to the case itself.",
      },
    ],
  },
  {
    version: 164,
    date: "2026-11-03",
    items: [
      {
        kind: "new",
        title: "Share results with Qase",
        text: "Connect a Qase project in Settings → Qase. Results you save here go to Qase, and results saved in Qase come into your test cycle with a small Qase tag.",
        who: "lead",
        link: "/g/{umbrella}/settings#qase",
      },
      {
        kind: "new",
        title: "Qase bar on each test cycle",
        text: "Once Qase is connected, a green bar on the test cycle shows it's in sync, with Sync now and a link to the Qase run.",
      },
    ],
  },
  {
    version: 163,
    date: "2026-11-03",
    items: [
      {
        kind: "new",
        title: "Runs in progress on the Overview",
        text: "Your umbrella's Overview now starts with the runs waiting to be tested, from every test cycle, each with a big Start testing button.",
        link: "/g/{umbrella}",
      },
      {
        kind: "better",
        title: "Start testing is easier to spot",
        text: "Each run in progress has a bigger ▶ Start testing button. Resume is now ▶ Continue testing, the same as on the run page.",
      },
      {
        kind: "better",
        title: "Start a run is now Create a run",
        text: "The button that makes a new run is called Create a run. It turns gray while runs are waiting, so Start testing stands out.",
      },
    ],
  },
  {
    version: 162,
    date: "2026-11-03",
    items: [
      {
        kind: "fix",
        title: "Security updates",
        text: "Newer versions of the parts Flaw Patrol is built on close the high-severity security alerts. Nothing changes in how you use it.",
        who: "workspace",
      },
    ],
  },
  {
    version: 161,
    date: "2026-11-03",
    items: [
      {
        kind: "new",
        title: "Requirements from several Jira projects",
        text: "In Jira settings, Requirements, pick These projects and add each Jira project, like Unity, Unreal and Web. Their stories show together on the Requirements page and the Risk board.",
        who: "lead",
      },
      {
        kind: "new",
        title: "Show stories from one project",
        text: "With two or more requirement projects, the Requirements page and the Risk board get Show stories from buttons, so you can look at one project at a time.",
      },
      {
        kind: "new",
        title: "Pick more than one release",
        text: "Click + Add another release next to the Jira release buttons to see two releases together, for projects that name the same release differently. Click a release's × to take it off.",
      },
      {
        kind: "fix",
        title: "Any release shows every requirement",
        text: "On the Requirements page, Any release now lists every requirement from Jira, like each Product Feature, not only the ones a case already links to. Big projects show every item, not just the first page.",
      },
      {
        kind: "new",
        title: "Hide done",
        text: "A Hide done switch next to the All, No cases and Failing buttons hides requirements Jira counts as Done. It's on at first; turn it off to see them.",
      },
      {
        kind: "better",
        title: "Folder actions in one ⋯ menu",
        text: "In the Folders list, one ⋯ button (or a right-click) opens New subfolder, Rename, Move and Delete, so folder names keep their room. The rename box now lines up inside the list.",
      },
    ],
  },
  {
    version: 160,
    date: "2026-11-03",
    items: [
      {
        kind: "better",
        title: "Calmer bug bash finds",
        text: "Each find in Live finds and on the board now reads in plain words: \"2 see it\", \"1 note\" and \"On Unity, Web\". How bad it is sits on the right of every row, so you can scan down it.",
      },
      {
        kind: "fix",
        title: "Easier-to-see drag handle",
        text: "The handle you drag to resize a panel now has a line and grip dots you can see, and it sits in the middle of the panel instead of near the bottom.",
      },
    ],
  },
  {
    version: 159,
    date: "2026-11-03",
    items: [
      {
        kind: "new",
        title: "Ready to host on a shared server",
        text: "Flaw Patrol can run on one always-on server behind your company's web proxy, so everyone opens the same link and nobody runs a copy on their laptop. Whoever sets it up follows \"Host it on a server\" in the README.",
        who: "workspace",
      },
    ],
  },
  {
    version: 158,
    date: "2026-11-03",
    items: [
      {
        kind: "fix",
        title: "Platform plus a tag finds your cases",
        text: "On Test cases, a platform button like Web now also finds cases tagged Web and cases picked for Web, not only cases in its suites. So Web plus a tag like Account shows the Web Account cases.",
      },
      {
        kind: "better",
        title: "Tag numbers follow the platform",
        text: "With a platform picked, the numbers on the Tags row count only that platform's cases. Tags with none there step out of the row.",
      },
    ],
  },
  {
    version: 157,
    date: "2026-11-03",
    items: [
      {
        kind: "better",
        title: "Tags are A to Z",
        text: "The Tags row on Test cases now lists tags A to Z. Click Most cases next to Tags to put the biggest first. Your pick is kept on this computer. Tag lists everywhere else are A to Z too.",
      },
    ],
  },
  {
    version: 156,
    date: "2026-11-03",
    items: [
      {
        kind: "new",
        title: "Make side panels wider or narrower",
        text: "Drag the line beside a side panel, like the case list when you run tests or the folders on Test cases. Double-click the line to put it back. Your sizes are kept on this computer.",
      },
      {
        kind: "new",
        title: "Make big boxes bigger",
        text: "Boxes like Report a bug have an Expand this box button next to the ✕. Press it again to shrink it.",
      },
      {
        kind: "better",
        title: "Reset panel sizes",
        text: "Account → Appearance has Reset panel sizes, which puts every panel back to its normal size.",
        link: "/account#appearance",
      },
    ],
  },
  {
    version: 155,
    date: "2026-11-02",
    items: [
      {
        kind: "better",
        title: "New versions keep your settings",
        text: "Flaw Patrol keeps a hidden copy of your settings on this computer. When you unzip a new version, it asks Use them? Press Enter, and your saved Jira token and sign-in keep working.",
      },
      {
        kind: "fix",
        title: "No more scary warning from browser add-ons",
        text: "Add-ons like Testim that change the page no longer cause an error message while Flaw Patrol loads.",
      },
    ],
  },
  {
    version: 154,
    date: "2026-11-02",
    items: [
      {
        kind: "better",
        title: "Bug bashes that need a wrap-up stand out",
        text: "On Bug bashes, only a live bash has a red border. Coming up is blue. An ended bash says Needs wrap-up, how many bugs are waiting and who files them, with a Wrap up and file bugs button.",
      },
    ],
  },
  {
    version: 153,
    date: "2026-11-02",
    items: [
      {
        kind: "new",
        title: "Schedule a bug bash days ahead",
        text: "When you start a bug bash, pick When? and then Pick a date and time. It shows as Coming up on Bug bashes and opens by itself at that time. Everyone sees the time on their own clock.",
      },
      {
        kind: "new",
        title: "Add a bug bash to your calendar",
        text: "Use Add to calendar on a coming-up bash. It works with Outlook, Google and Apple, has the Join link, and reminds you 10 minutes before.",
      },
      {
        kind: "better",
        title: "Change the time or cancel a bash before it starts",
        text: "Whoever set it up, or a lead, can use Change time or Cancel bash on the Bug bashes page or the bash's own page. If Slack is on, the channel hears about it.",
      },
    ],
  },
  {
    version: 152,
    date: "2026-11-02",
    items: [
      {
        kind: "new",
        title: "Count a bug bash toward a release",
        text: "When you start a bug bash, pick a release under Count it toward a release? It stays on every platform the bash lists. That release's Release status shows the bash and every bug it found, and the platform percentages don't change. Forgot? Use Change next to Counts toward on the bash's page or report.",
      },
    ],
  },
  {
    version: 151,
    date: "2026-11-02",
    items: [
      {
        kind: "new",
        title: "Keep a test cycle in Current",
        text: "Pin a test cycle with 📌 Keep in Current and it stays in Current, even after a newer test cycle for its platform is made. Use ⋯ on its row in Test cycles, or its row in Settings. Build health starts pinned.",
        who: "lead",
        link: "/g/{umbrella}/projects",
      },
    ],
  },
  {
    version: 150,
    date: "2026-11-02",
    items: [
      {
        kind: "better",
        title: "Section titles in test cases",
        text: "A step with nothing to check, like SIGN IN / OUT STEPS with no expected result (or a dash or N/A), now shows as a title for the steps below it. It has no result buttons and no number, and it isn't counted as a step. The case editor marks these rows as Section title.",
      },
      {
        kind: "new",
        title: "Rename a suite",
        text: "Use ✎ Rename next to a suite's name, Rename suite… in its More menu, or the ⋯ menu in the suites list. Its cases don't change, and old runs show what the suite was called then.",
      },
      {
        kind: "better",
        title: "Your work stays short",
        text: "Your work on the Umbrellas page shows your top 3 runs and a total. Show all opens the rest and is remembered. Runs read Run 7 instead of R7, and work in archived test cycles no longer shows.",
        link: "/",
      },
    ],
  },
  {
    version: 149,
    date: "2026-11-02",
    items: [
      {
        kind: "better",
        title: "Hand testing shows in Reports as soon as it starts",
        text: "Cases you've started but not finished now count as In progress on Reports → Execution status, the runs table, exports and Release status. They stay out of pass rates until you save a result.",
        link: "/g/{umbrella}/reports",
      },
      {
        kind: "better",
        title: "By run on Overview",
        text: "How testing is going's By build is now By run: runs you test by hand get striped bars next to the automated builds, with how much of each is done. Pick Both, ✋ Manual or 🤖 Automated; your pick is remembered.",
        link: "/g/{umbrella}",
      },
    ],
  },
  {
    version: 148,
    date: "2026-11-02",
    items: [
      {
        kind: "better",
        title: "Automated cases stay out of runs you test by hand",
        text: "Start a run now leaves out the cases your automation already runs. Tick Also include the automated cases if someone should check them by hand too. Where they are in a run, they have a 🤖 Automated tag.",
      },
      {
        kind: "new",
        title: "Remove from run",
        text: "Take a case nobody has tested yet out of a run from its row on the run page, with Undo. Older runs with automated cases offer Take them out of this run.",
      },
    ],
  },
  {
    version: 147,
    date: "2026-11-02",
    items: [
      {
        kind: "better",
        title: "Lines between shared steps",
        text: "Steps inside a shared step block now have a thin line above each one, like other steps, so it's easy to see where each step and its expected result start and end.",
      },
    ],
  },
  {
    version: 146,
    date: "2026-11-02",
    items: [
      {
        kind: "new",
        title: "Say which platform you're on in a bug bash",
        text: "When you join a bug bash, you can pick the platform you're testing on, like Web or iPhone, or type your own. It's optional. Each bug keeps the platform it was found on, +1 I see it too keeps yours, and you can switch platform under Your area.",
      },
      {
        kind: "new",
        title: "Bugs by platform on the bug bash report",
        text: "The board shows how many people are on each platform, so you can see which one nobody is testing. The report counts bugs per platform, and filed bugs say where they were found.",
      },
      {
        kind: "better",
        title: "Choose the platforms when you start a bug bash",
        text: "Start a bug bash fills in your umbrella's platforms. Add or remove some, or untick Ask people which platform they're on to skip it.",
      },
    ],
  },
  {
    version: 145,
    date: "2026-11-02",
    items: [
      {
        kind: "new",
        title: "Feedback button at the top of every page",
        text: "Tell us what's broken, confusing or great about Flaw Patrol. Take a screenshot of the page, circle or box what you mean, add arrows and words, and hide anything private. Your note says where you were by itself. Replies show up on the Feedback page.",
        link: "/feedback",
      },
      {
        kind: "new",
        title: "Feedback page for workspace admins",
        text: "See everyone's feedback, filter by status, kind and where it was sent from, reply, set a status, or turn it into a bug on a test cycle's Bugs page.",
        who: "workspace",
        link: "/feedback",
      },
    ],
  },
  {
    version: 144,
    date: "2026-11-02",
    items: [
      {
        kind: "better",
        title: "Bug templates and Jira bug layout are one section",
        text: "Settings → Bug templates now holds everything. Change layout… on the first template picks the plain layout, a shared one, or a copy of a Jira bug. The separate Jira bug layout row is gone, and Jira Priority moved to the Jira connection, next to Severity.",
        who: "lead",
        link: "/g/{umbrella}/settings#bug-templates",
      },
    ],
  },
  {
    version: 143,
    date: "2026-11-02",
    items: [
      {
        kind: "new",
        title: "Jira Priority on every new bug",
        text: "Pick it once in Settings → Jira, under the bug layout. It starts on the priority your Jira uses for bugs nobody has triaged yet, so whoever triages sets the real one. The bug box shows which one Jira will get.",
        who: "admin",
      },
      {
        kind: "better",
        title: "Severity lands in Jira's Severity field",
        text: "When your Jira only lets Severity (or another field) be set after a bug exists, Flaw Patrol now fills it a moment after creating the bug, instead of writing it into the description. The Severity list also uses your Jira's own names.",
      },
    ],
  },
  {
    version: 142,
    date: "2026-11-02",
    items: [
      {
        kind: "better",
        title: "More security checks behind the scenes",
        text: "New tests make sure people who aren't signed in, aren't on the team or don't have the role are turned away from every page, action and file. Nothing changes in how you sign in or work.",
        who: "workspace",
      },
    ],
  },
  {
    version: 141,
    date: "2026-11-02",
    items: [
      {
        kind: "new",
        title: "Found-in version on Jira bugs",
        text: "Turn it on in Settings → Jira → Found-in version, and new bugs get the release being tested in Jira's Affects versions. It comes from the run's Release, so most people never touch it.",
        who: "admin",
      },
      {
        kind: "new",
        title: "Found in, in the bug box",
        text: "When it's on, the bug box shows Found in under Severity, already picked. Change it, or pick Leave it out. A release Jira doesn't have goes in the description instead, and the box says so first.",
      },
      {
        kind: "better",
        title: "Filter bugs by version",
        text: "The Bugs page shows each bug's version under Found in, with a filter to see what one release turned up.",
      },
    ],
  },
  {
    version: 140,
    date: "2026-11-01",
    items: [
      {
        kind: "fix",
        title: "One Keeper of Words crown for the whole team",
        text: "The Glossary is one list for everyone, so its crown is one crown too. Adding terms no longer crowns you in every umbrella at once.",
        game: true,
      },
      {
        kind: "better",
        title: "Crown notes show in their own umbrella and close by themselves",
        text: "A crown note waits until you open that umbrella, and it closes after 10 seconds. Point at it to keep it open.",
        game: true,
      },
    ],
  },
  {
    version: 139,
    date: "2026-11-01",
    items: [
      {
        kind: "better",
        title: "Priority, Folder and Tag on every Reports tab",
        text: "Pick them on any tab and they stay picked when you switch tabs. The summary line says what it's counting. Session findings has Tag only.",
      },
      {
        kind: "better",
        title: "Reports no longer compare people",
        text: "The People tab and the Tester filter are gone, from Custom reports and exports too. Reports show how the product is doing, not who did the most.",
      },
    ],
  },
  {
    version: 138,
    date: "2026-11-01",
    items: [
      {
        kind: "new",
        title: "Test data: run one case with different values",
        text: "Write \"Sign in as {{role}}\" in a step, then click + Add test data under the steps and list admin, viewer and guest. The case runs three times, once for each row, and each row gets its own pass or fail. It's optional: cases without a table work as before.",
      },
      {
        kind: "better",
        title: "Shared steps fill in from test data",
        text: "A shared step blank with the same name as a test data column takes each row's value. Other blanks still ask for one value.",
      },
      {
        kind: "better",
        title: "See which row failed",
        text: "Bugs name the row and its values, history pips get a stripe per row, and Failing steps says which row. Reports still count the case once.",
      },
      { kind: "fix", title: "Fixed a console warning on the case edit page" },
    ],
  },
  {
    version: 137,
    date: "2026-11-01",
    items: [
      {
        kind: "better",
        title: "Every run marked with a release counts toward it",
        text: "A Smoke test or your own kind of run with Release 2.1 now shows on 2.1's Release status, and each column names the kind of run. Leave Release blank to keep a run out.",
        link: "/g/{umbrella}/rc",
      },
      {
        kind: "better",
        title: "Start a run instead",
        text: "Typing a release that already has test cycles in Release candidate points you to Start a run, with the release filled in.",
      },
      {
        kind: "better",
        title: "Invites say who invited you and sign you straight in",
        text: "New people see who invited them and to what, type the name the team will see, choose a password, and land on their home page.",
        who: "lead",
      },
      { kind: "better", title: "Close run asks first when cases haven't been tested", text: "It says how many and whose lists they come off. Closing a run where every case has a result is still one click." },
      { kind: "fix", title: "Viewers aren't offered in Assign lists, and don't hit dead ends", text: "No Import cases shortcut or Start a run button for Viewers, and test cycle rows in Settings say View." },
      { kind: "fix", title: "Times on your own clock", text: "Bug bash reports, the Reports date range and the Activity log show your time zone and follow your Language setting." },
    ],
  },
  {
    version: 136,
    date: "2026-11-01",
    items: [
      {
        kind: "better",
        title: "One bar when you come back to a session",
        text: "A half-done exploring session says where you left off and when the timer paused in the same bar as Stop testing, with Keep exploring next to it. The charter's reminders show once, in the Timer panel.",
      },
      {
        kind: "better",
        title: "Easier to use on a phone",
        text: "During a session, a small timer bar stays at the top as you scroll. On a run, each case is a card with its Test, Continue or Retest button on screen. Tabs that run off the edge fade to show there are more.",
      },
      {
        kind: "better",
        title: "Reminders and Prompts have their own boxes",
        text: "On the charter form, Reminders and Prompts sit in boxes like Mission, so they're easy to spot.",
      },
      {
        kind: "fix",
        title: "Small wording and layout fixes",
        text: "Counts say 1 result, 1 run and 1 case. Sessions shorter than a minute say Under 1 min, not 0 min. Import a run has one breadcrumb and the same width as Test runs, and Overview no longer shows the word Overview under the name.",
      },
    ],
  },
  {
    version: 135,
    date: "2026-11-01",
    items: [
      {
        kind: "better",
        title: "Import moves expected results out of the step",
        text: "When a qTest file has the expected results under the step name in the same cell, Import puts them in Expected. The preview shows the moved lines in green, and Keep one more line in the step fixes a step whose name is two sentences.",
      },
      {
        kind: "fix",
        title: "Excel files with merged cells import",
        text: "An .xlsx file with an empty block of merged cells no longer stops with Something went wrong.",
      },
    ],
  },
  {
    version: 134,
    date: "2026-11-01",
    items: [
      {
        kind: "fix",
        title: "Dropdowns show their whole text",
        text: "Dropdowns are now as wide as their longest choice, so Member no longer shows as Membe. This covers Invite your team, Members, Join requests, bug status on Bugs, the test cycle and run pickers on your umbrella, and the release picker.",
      },
    ],
  },
  {
    version: 133,
    date: "2026-11-01",
    items: [
      {
        kind: "better",
        title: "Automated results don't need a release",
        text: "Upload automation results and Pull from GitHub now ask Where they go. Picking a release candidate test cycle no longer counts the run toward its release unless you tick Count these toward release. Your pick is remembered for each GitHub repo.",
      },
      {
        kind: "new",
        title: "Make a test cycle right in the upload box",
        text: "Pick + New test cycle in Where they go. It starts as Build health with no release, a place for builds you just want to keep an eye on.",
      },
      {
        kind: "new",
        title: "By build in How testing is going",
        text: "On your umbrella's home, By build shows one bar per automated run, newest on the right, with a Last build line on top. Click a bar to open that run.",
        link: "/g/{umbrella}",
      },
      {
        kind: "better",
        title: "No release tag on Test runs",
        text: "Automated runs that don't count toward any release say No release, so it's clear they aren't part of release testing.",
      },
    ],
  },
  {
    version: 132,
    date: "2026-11-01",
    items: [
      {
        kind: "new",
        title: "Email a summary when a run finishes or a bug bash ends",
        text: "Turn it on in your umbrella's Settings → Email digests. Pick who gets them, add email groups or addresses, and press Send me a sample to see one.",
        link: "/g/{umbrella}/settings#email-digests",
      },
      {
        kind: "better",
        title: "Slack posts say what failed",
        text: "Run finished now lists what failed (regressions first), the bugs filed, who tested and the pass rate against the last run. Bug bash ended has its own alert. Each channel can pick Counts only instead.",
      },
      {
        kind: "new",
        title: "Choose which emails you get",
        text: "Your account → Emails I get: runs you tested in, all runs or none, the same for bug bashes, and release testing done. Every email has a Stop link too.",
        link: "/account#emails",
      },
      {
        kind: "new",
        title: "Email groups",
        text: "Save a list of people and addresses once, like Mobile leads, and use it in any umbrella's Email digests. Make one right in the Also send to box.",
      },
    ],
  },
  {
    version: 131,
    date: "2026-11-01",
    items: [
      {
        kind: "new",
        title: "See how testing is going on your umbrella's home",
        text: "A new box under Shortcuts shows the pass rate for your last 6 releases, with manual and automated results kept apart, plus cases tested, bugs found, and cases that are flaky or keep failing.",
        link: "/g/{umbrella}",
      },
      {
        kind: "new",
        title: "Show more releases, or hide the box",
        text: "Pick Last 10, Last 20 or All releases from its menu, or press Hide to fold it to one line. Flaw Patrol remembers both just for you.",
        link: "/g/{umbrella}",
      },
    ],
  },
  {
    version: 130,
    date: "2026-11-01",
    items: [
      {
        kind: "better",
        title: "Loading signs stay out of the way",
        text: "Pressing a result, Save, a tick or a filter now only shows the thin line at the top, so nothing covers the buttons you're using.",
      },
      {
        kind: "better",
        title: "Your spinner shows when you move to another page",
        text: "Clicking a menu item, a library tab, a link or Back shows your spinner in the corner with where you're going, same as before.",
      },
      {
        kind: "better",
        title: "Slow saves say so at the top",
        text: "If a save takes more than 10 seconds, a small Still saving, hang tight tag shows at the top middle.",
      },
    ],
  },
  {
    version: 129,
    date: "2026-11-01",
    items: [
      {
        kind: "better",
        title: "Your account opens much faster with the mini game on",
        text: "Crowns are counted once for all your umbrellas, so the page takes about 2 seconds instead of 12 or more.",
        game: true,
      },
      {
        kind: "better",
        title: "Settings and Test runs pages open faster",
        text: "Umbrella Settings, Test runs and every page's menu ask the database for what they need in fewer steps.",
      },
      {
        kind: "better",
        title: "Workspace settings opens about twice as fast",
        text: "It works out the mini game numbers for everyone together instead of one person at a time.",
        who: "workspace",
      },
    ],
  },
  {
    version: 128,
    date: "2026-11-01",
    items: [
      {
        kind: "new",
        title: "Each umbrella picks the tools it uses",
        text: "New umbrella asks What will you use?: Everything, Bug bashes and risk, Test cases and runs, or Pick my own. Tools that are off leave the menu, Overview, Reports and search. Nothing is deleted.",
      },
      {
        kind: "new",
        title: "Change an umbrella's tools in Settings → Tools",
        text: "Admins switch tools on and off. A tool that needs another turns it on too, and turning off one that has things in it asks first.",
        who: "admin",
        link: "/g/{umbrella}/settings#tools",
      },
      {
        kind: "better",
        title: "Old links to a tool that's off explain where it went",
        text: "They say what's kept and offer Turn on to Admins, or Ask an admin to everyone else.",
      },
    ],
  },
  {
    version: 127,
    date: "2026-11-01",
    items: [
      {
        kind: "fix",
        title: "Moving a test cycle into an umbrella follows its Roles",
        text: "You can move a test cycle into an umbrella only if you can add test cycles there. Move into an umbrella lists just those umbrellas.",
        who: "lead",
      },
      {
        kind: "fix",
        title: "A bug bash start posts to Slack once",
        text: "When two people open a scheduled bash right as it starts, Slack gets one start message, not two.",
      },
      {
        kind: "fix",
        title: "A wrapped-up bash stays as it was",
        text: "Once a bug bash is wrapped up, its +1s and area checklists can't change anymore.",
      },
    ],
  },
  {
    version: 126,
    date: "2026-10-31",
    items: [
      {
        kind: "fix",
        title: "Umbrellas are archived, never deleted",
        text: "Name and test cycles no longer has Delete group for an umbrella. To put one away, use Archive in its Settings, which keeps everything and can be undone.",
      },
      {
        kind: "fix",
        title: "Renaming an umbrella follows its Roles",
        text: "Only people the umbrella's Roles card allows can rename it or move test cycles in and out. People who aren't on the umbrella can't change it at all.",
        who: "lead",
      },
      {
        kind: "fix",
        title: "I saw it again keeps your Jira edits",
        text: "Adding a row now only adds that row to the table in the Jira bug. Anything you changed in the Jira description, and the link back to the run, stays as it is.",
      },
    ],
  },
  {
    version: 125,
    date: "2026-10-31",
    items: [
      {
        kind: "new",
        title: "Bug bashes use your bug templates",
        text: "Start a bug bash has a Bug template choice that starts on your team's default. Log a bug shows the template's headings, and you can switch template for one bug.",
      },
      {
        kind: "new",
        title: "Log now, fill in the rest later",
        text: "A missing Must have never stops you logging. Live finds shows Needs 1 or Ready, and anyone can open the bug and add what's missing.",
      },
      {
        kind: "better",
        title: "Wrap up shows which bugs are ready",
        text: "A Ready? column with Fill in. Bugs still missing something stay here when the rest are filed, and they go to Jira or Bugs with the template's headings.",
      },
      {
        kind: "fix",
        title: "Times in template tables read normally",
        text: "The Date and time cell in tables like Reproduction history shows a plain date and time with your time zone, not a long code.",
      },
    ],
  },
  {
    version: 124,
    date: "2026-10-31",
    items: [
      {
        kind: "better",
        title: "Report bug for case starts from what failed",
        text: "The summary comes from the first failed step and its note, not the case's title. Without Jira, a new What happened box fills in the run, build, steps, expected and actual result, and you can change it.",
      },
      {
        kind: "better",
        title: "A failed step's note box stays in view",
        text: "Clicking Failed scrolls the step's note box and Report bug into view and puts the cursor in the note. The F key only scrolls. The Case result line has a Go to step link.",
      },
      {
        kind: "new",
        title: "Viewers are told they're Viewers",
        text: "A short note at the top says what a Viewer can do, names the admins, and has Ask for Member access. Pages no longer tell Viewers to press buttons they don't have.",
      },
      {
        kind: "fix",
        title: "Bug bashes don't add test cases or count as runs",
        text: "A bug bash's area charters stay with the bash. Case counts and Runs in progress only count what your team wrote and ran, and a live bug bash shows on its own.",
      },
      {
        kind: "better",
        title: "Test runs leads with Start a run",
        text: "Import a run and Upload automation results are now one Bring in results menu: Automated test results, or Results from a spreadsheet.",
      },
      {
        kind: "better",
        title: "Stop testing instead of Hand it back",
        text: "In the runner, Stop testing frees a case so someone else can test it. Your marks so far are kept, and it says so under the button.",
      },
      {
        kind: "new",
        title: "Reports opens with a one-line summary",
        text: "Above the tabs: runs, pass rate, open bugs, blocked cases and where most failures are, for the dates and filters you picked. Copy summary puts it on the clipboard for Slack or email. The Testers tab is now People.",
      },
    ],
  },
  {
    version: 123,
    date: "2026-11-01",
    items: [
      {
        kind: "better",
        title: "Loading spinners folds to one line",
        text: "On Your account, under Appearance, Loading spinners now starts closed and shows what you picked. Click the line to open it and tick spinners. It remembers if you leave it open.",
        link: "/account#appearance",
      },
    ],
  },
  {
    version: 122,
    date: "2026-11-01",
    items: [
      {
        kind: "better",
        title: "The version number is easy to find",
        text: "It's now in small gray text under Arrange menu order at the bottom of the left menu, and at the bottom of the menu under your name. Click it to copy it for a bug report.",
      },
    ],
  },
  {
    version: 121,
    date: "2026-11-01",
    items: [
      {
        kind: "better",
        title: "Joining a bug bash is easy to spot",
        text: "Until you join, the bug bash page shows three short steps and a big Join the bug bash button. Click it, pick an area right there on the page, then Start bashing. Slack and shared links open the same page with the areas ready to pick.",
      },
      {
        kind: "better",
        title: "Add to it closes the find",
        text: "In a bug bash, Add to it and Answer save and close the find, with a green line saying it worked. Every open find also has a Close button.",
      },
      {
        kind: "better",
        title: "Logging a find always says it worked",
        text: "After Log bug, Log question, Log note or Log idea, a green line says it's logged and at the top of Live finds, even when it isn't filed to Jira.",
      },
    ],
  },
  {
    version: 120,
    date: "2026-10-31",
    items: [
      {
        kind: "better",
        title: "Pages open faster",
        text: "The umbrella home, Test runs, Release status, Case library, a single case and Settings ask the database for everything at once instead of one thing after another. On a far-away database that's often half the wait or less.",
      },
      {
        kind: "better",
        title: "Start boxes get ready when you open them",
        text: "Start next release and Start a bug bash fill themselves in when you open them, with your spinner meanwhile, so the page under them opens sooner. Resting the mouse on the option starts it early, and opening a box again needs no second wait.",
      },
      {
        kind: "better",
        title: "Settings opens in one step",
        text: "Links to Settings from other pages (Connect Jira, Restore, Slack alerts, Choose what roles can do) now go straight to the right row in the umbrella's Settings, without a stop on the way.",
      },
      {
        kind: "better",
        title: "Saving a case is quicker",
        text: "Save draws the page you go to once, instead of drawing the editor again first.",
      },
      {
        kind: "fix",
        title: "Your account: no error when you fold a card",
        text: "Opening or closing a card on Your account no longer shows an error in the browser's console.",
      },
      {
        kind: "better",
        title: "Mini game pages open in seconds",
        text: "The Leaderboard, your Account page and Workspace settings work out everyone's XP far faster. Every number stays exactly the same.",
        game: true,
      },
    ],
  },
  {
    version: 119,
    date: "2026-10-31",
    items: [
      {
        kind: "new",
        title: "Bug templates",
        text: "Make your own bug layouts in Settings → Bug templates: text boxes, choices, files like a .txt crash log, and tables. A live preview shows the form and the finished bug. Testers and up can make them; only Admins can delete one.",
        link: "/g/{umbrella}/settings#bug-templates",
      },
      {
        kind: "new",
        title: "Pick a template when you report a bug",
        text: "Report a bug shows your templates, with the default picked. It says what's still missing before you can report it, and bugs already reported never change when a template does.",
      },
      {
        kind: "new",
        title: "I saw it again",
        text: "On Bugs, What was reported shows a templated bug's answers. If its table grows, I saw it again adds a row with the date, your name, build, environment and device filled in, instead of a new bug.",
      },
    ],
  },
  {
    version: 118,
    date: "2026-10-31",
    items: [
      {
        kind: "fix",
        title: "Start a release before you have suites",
        text: "A platform you add in Start a new release now picks its test cases like the others: cases from folders, a new suite, or No runs yet. Before, it only offered suites, so with none you were stuck. If there are no cases at all, a note says so and Start still works.",
      },
      {
        kind: "better",
        title: "Clearer Start a run when there are no suites",
        text: "Picking A suite with none yet explains what a suite is, with a Pick cases instead button and a Make a suite link that opens in a new tab. With no cases at all, the box says so and links to writing or importing cases.",
      },
      {
        kind: "new",
        title: "Make a suite (optional) on the setup card",
        text: "A new umbrella's setup card has a Make a suite step before Run your first tests. It's optional: you can always run the whole Case library or pick cases.",
        who: "lead",
      },
    ],
  },
  {
    version: 117,
    date: "2026-10-31",
    items: [
      {
        kind: "better",
        title: "One Settings page for an umbrella and its test cycles",
        text: "The left menu now has one Settings link. A Test cycles table at the bottom shows each test cycle's team, Jira and Slack, marked Same or Its own. Press Change on a row to set something different for that test cycle only. Test cycles under an umbrella no longer have a settings page of their own, and old links open their row.",
        link: "/g/{umbrella}/settings#test-cycles",
      },
      {
        kind: "new",
        title: "Other settings, explained",
        text: "Every settings page ends with a small box that says what Your account (only you) and Workspace settings (the whole company) are for.",
      },
    ],
  },
  {
    version: 116,
    date: "2026-10-31",
    items: [
      {
        kind: "new",
        title: "Your spinner whenever Flaw Patrol is working",
        text: "When a page or a save takes more than a third of a second, a thin bar slides along the top and your loading spinner shows in the bottom-right corner with what it's doing, like Opening Test runs… After 10 seconds it adds Still working, hang tight. Quick things show nothing, so the screen doesn't flicker.",
      },
      {
        kind: "better",
        title: "Start shows your spinner straight away",
        text: "Press Start in Start a run or Start next release and your spinner shows at once with what it's making, then Opening it… when the run is ready. Every spinner is the same size wherever it shows.",
      },
    ],
  },
  {
    version: 115,
    date: "2026-10-31",
    items: [
      {
        kind: "better",
        title: "Anyone can join a live bug bash from its link",
        text: "Share a bug bash link anywhere, like in Slack. Anyone signed in to your Flaw Patrol can open it, pick an area and log bugs, even if they aren't on your team. They see that bug bash only.",
      },
      {
        kind: "new",
        title: "Ask to join from a shared link",
        text: "Opening any other link to a team you aren't on now says what it is and who its admins are, with an Ask to join button, instead of Not found.",
      },
      {
        kind: "new",
        title: "Add people who ask to join",
        text: "When someone asks, you'll see a red dot on your picture. Their request is at the top of Settings → Members: pick a role and press Add, or Ignore. If Slack alerts are set up, the request is posted there too.",
        who: "admin",
      },
      {
        kind: "better",
        title: "A clearer first page for people on no team yet",
        text: "It shows who will see your request to join, with Cancel request, or tells you to ask whoever invited you for your invite link.",
      },
    ],
  },
  {
    version: 114,
    date: "2026-10-31",
    items: [
      {
        kind: "fix",
        title: "Invites now come with the link people need",
        text: "When you add someone new in Settings → Members and email isn't set up, the message to copy now has their one-time invite link. Before, it only pointed to the sign-in page, which couldn't let them in.",
        who: "admin",
      },
      {
        kind: "better",
        title: "See when an invite link runs out",
        text: "People who haven't signed in yet show \"link works until\" a date on the Members list. Past that date, use Copy invite link to make a new one.",
        who: "admin",
      },
    ],
  },
  {
    version: 113,
    date: "2026-10-31",
    items: [
      {
        kind: "new",
        title: "Glossary: your team's words, explained",
        text: "Glossary is a new item in the left menu, under Library. It's one shared list of the words your team uses, each with a plain meaning. Search it, see which questions need an answer, and copy a term's link to share.",
        link: "/glossary",
      },
      {
        kind: "new",
        title: "Look up any word you select",
        text: "Select a word anywhere, like on the Risk board or in a test step, and pick Look it up (or press G). You'll see its meaning, or you can add it to the Glossary right there. Not sure what it means? Pick Ask the team and someone will answer.",
      },
      {
        kind: "new",
        title: "Known words are underlined",
        text: "Words that are in the Glossary get a dotted underline in test steps, the runner, charters and requirements. Point at one to see what it means. Don't want the lines? Turn off Underline terms everywhere on the Glossary page, or pick Hide underlines.",
      },
      {
        kind: "new",
        title: "Glossary XP, titles, a frame and a crown",
        text: "Earn XP for adding terms and answering teammates' questions, and when teammates look up terms you wrote. New titles: Word Finder, Team Translator and Walking Dictionary. New frame: Bookworm. New crown: Keeper of Words.",
        game: true,
      },
    ],
  },
  {
    version: 112,
    date: "2026-10-31",
    items: [
      {
        kind: "better",
        title: "See your teammates' progress sooner",
        text: "When someone starts a case or marks a step, the Run List in the runner and the list on the run page now show it within about a second or two, instead of 4 to 6 seconds. It also keeps updating while you're partway through your own case, where before it waited until you saved.",
      },
    ],
  },
  {
    version: 111,
    date: "2026-10-31",
    items: [
      {
        kind: "better",
        title: "Save and next is faster",
        text: "Saving a case and opening the next one now takes about a third less time. Flaw Patrol no longer reloads the case you just left, loads the next case once instead of up to three times, and looks up its details side by side.",
      },
    ],
  },
  {
    version: 110,
    date: "2026-10-31",
    items: [
      {
        kind: "fix",
        title: "Shared step headings no longer count as steps",
        text: "A heading row at the top of a shared step needs no result, so it no longer shows as an unlit dot in the Run List or counts toward step totals on the run page, in reports and in a case's history.",
      },
    ],
  },
  {
    version: 109,
    date: "2026-10-31",
    items: [
      {
        kind: "better",
        title: "Result buttons sit under Expected",
        text: "In a test, each step's Passed, Failed, Blocked, Retest and Skipped buttons are now right under what should happen, so you read and mark in one place.",
      },
    ],
  },
  {
    version: 108,
    date: "2026-10-31",
    items: [
      {
        kind: "better",
        title: "You can see a run starting",
        text: "After you press Start, the box stays open with Starting… and then Opening it… until the run page shows. Run pages open faster too.",
      },
      {
        kind: "new",
        title: "Pick your loading spinners",
        text: "Choose from 13 spinners, like Patrol radar, Bug crawl and Pawn hop. Tick the ones you like and Flaw Patrol plays one of them while it's busy.",
        link: "/account#appearance",
      },
    ],
  },
  {
    version: 107,
    date: "2026-10-31",
    items: [
      {
        kind: "better",
        title: "Clearer folder choices when you import",
        text: "Import now offers Use the file's folders, Put them all in one folder, or Don't use folders. Click the folder the file's folders go in, or make a new one. Dropdowns only show when there's a real folder to pick.",
      },
      {
        kind: "new",
        title: "Tell import whether the cases are new",
        text: "Import asks Have these cases been run before? Cases you've already run elsewhere aren't tagged New in runs.",
      },
      {
        kind: "better",
        title: "Import warnings in plain words",
        text: "The preview names the case each warning is about. Show me the step opens the case and highlights the step, and the Row column is now File row.",
      },
      {
        kind: "better",
        title: "Easier-to-read New banner in runs",
        text: "The run page's New cases banner uses your theme colors. When every case is new it skips the All/New switch, and Not new? Mark them as run before clears the New tags.",
      },
      {
        kind: "better",
        title: "Simpler hint when picking cases",
        text: "New test suite and Start a run now just say Pick a folder, then tick the cases.",
      },
    ],
  },
  {
    version: 106,
    date: "2026-10-31",
    items: [
      {
        kind: "better",
        title: "Clearer words when you start a release",
        text: "In Start a run, Release candidate, each platform you tick now says Pick test cases for Web, and the box at the bottom says Pressing Start creates, listing each test cycle with its runs and case count. A new platform's Remove button sits next to its suite.",
      },
      {
        kind: "better",
        title: "Clearer suite description hint",
        text: "New test suite's Description is optional and its hint now gives an example of what the suite covers, instead of When to run it.",
      },
    ],
  },
  {
    version: 105,
    date: "2026-10-31",
    items: [
      {
        kind: "fix",
        title: "Area tags work before you set up platforms",
        text: "If an umbrella has no platforms yet, a case's one [bracket] tag, like WEB, now counts as its platform. So right after an import, the Case library offers to turn words like Hub or In Space into tags. Each case gets one area tag, so a second word like UI stays in the title.",
      },
    ],
  },
  {
    version: 104,
    date: "2026-10-31",
    items: [
      {
        kind: "fix",
        title: "The limit on CI uploads now holds everywhere",
        text: "Each CI token can still send 20 uploads a minute. The count is now kept in the database, so it holds after a restart and when Flaw Patrol runs on more than one server. A pipeline over the limit is told to wait a minute.",
        who: "lead",
      },
    ],
  },
  {
    version: 103,
    date: "2026-10-31",
    items: [
      {
        kind: "fix",
        title: "Your first password now comes from your invite or password link",
        text: "The sign-in page no longer lets you choose a first password for an account that already exists, so nobody else can claim it. If you don't have a password yet, use the invite link in your email, or ask an Admin for a new link.",
      },
      {
        kind: "fix",
        title: "Safer uploads of automation results",
        text: "Zips you upload or pull from GitHub are checked as they unpack: up to 5,000 files, 200 MB per file and 500 MB in all. A zip over the limit gets a clear message instead of slowing the app down.",
      },
      {
        kind: "better",
        title: "Members shows who still needs a password link",
        text: "Someone who signed in with a company button but has no password now shows no password yet (send a password link) on their Members row.",
        who: "admin",
      },
    ],
  },
  {
    version: 102,
    date: "2026-10-31",
    items: [
      {
        kind: "new",
        title: "The word after the platform becomes a tag",
        text: "In a title like Unity · Spaces Deep Link or Unity · Hub - Space List, the word after the platform is the part of the app you're testing. The Case library offers to turn those words into tags (Review…), so you can filter by Spaces or Hub on every platform. Untick a word and it won't be offered again.",
      },
      {
        kind: "better",
        title: "Area tags as you type and when you import",
        text: "In the Title box, a word that's already a tag turns into one when you type the space after it, and a new word with a dash after it asks Make it a tag? Backspace turns it back into text. Imports pick up area words too, with a tick box for each new one.",
      },
    ],
  },
  {
    version: 101,
    date: "2026-10-31",
    items: [
      {
        kind: "new",
        title: "Custom reports: build your own report from any Reports tab",
        text: "Reports has a new Custom reports tab. Click + Add to report on any box in Run reports, Release status or Requirements, or start a report there, then tick the parts you want, put them in your order, add notes, and give a part its own release or dates.",
        link: "/g/{umbrella}/reports/custom",
      },
      {
        kind: "new",
        title: "Export a custom report as PDF, Excel, or for Confluence and email",
        text: "The PDF never cuts a box in half: long tables break between rows and repeat their column names, and you can start any part on a new page.",
      },
      {
        kind: "better",
        title: "No more Time logged on the Testers report",
        text: "Testing isn't a race, so the Testers tab and its export no longer show how long anyone spent.",
      },
    ],
  },
  {
    version: 100,
    date: "2026-10-30",
    items: [
      {
        kind: "better",
        title: "Faster Umbrellas page after you sign in",
        text: "The Umbrellas page now loads all its umbrella cards at the same time and works out each card's release line, like RC 22 · 1 of 3 done, with a quick count instead of the whole Release status report. Everything on the cards looks the same, it just shows up sooner.",
      },
    ],
  },
  {
    version: 99,
    date: "2026-10-30",
    items: [
      {
        kind: "better",
        title: "Nothing is picked for you when you start a run",
        text: "Start a run and Release candidate now open blank: you pick what to run, the test cycle, the platforms and anything carried over from last time. Last time's choices show up as blue suggestions, like Use 2.1 or Use Demo RC 2. A list at the bottom shows what's still needed, and Start and test now opens the first case.",
        link: "/g/{umbrella}",
      },
      {
        kind: "better",
        title: "Clearer New test suite page",
        text: "Numbered steps, the Case library folders listed beside the cases with Tick all, and a Can't find a case? tip that explains why a case might not show up. Pick cases in Start a run has the same folder list.",
      },
      {
        kind: "new",
        title: "Type a new CSP version, or add a new platform, right where you pick",
        text: "Pick-list run fields like CSP version now take a typed value too. Wherever you pick a platform there's a New platform button, and the new platform shows up across the whole umbrella.",
      },
    ],
  },
  {
    version: 98,
    date: "2026-10-30",
    items: [
      {
        kind: "new",
        title: "Seasonal quest maps",
        text: "Quest maps now dress up for the time of year: blossoms in spring, sunflowers in summer, falling leaves in fall, a spooky dusk for Halloween, snow in winter and twinkling lights from Dec 15 to Jan 1. Each map keeps the look of the day its run started. Turn it off with Seasonal maps in Account → Mini game.",
        game: true,
        link: "/account",
      },
    ],
  },
  {
    version: 97,
    date: "2026-10-30",
    items: [
      {
        kind: "new",
        title: "A result for each check in a shared step",
        text: "When a shared step lists several checks under its name, each check gets its own P F B R S buttons in the runner. One failed check fails the step, and the step's own buttons fill the checks you haven't marked. Rows in capitals show as headings that need no result.",
      },
      {
        kind: "better",
        title: "Anyone can make a new umbrella",
        text: "New umbrella is on the Umbrellas page for everyone except Viewers. Whoever makes an umbrella becomes its Admin.",
        link: "/",
      },
      {
        kind: "fix",
        title: "Account cards stay open or folded",
        text: "Opening or folding a card on Your account and leaving the page right away now keeps your choice.",
      },
    ],
  },
  {
    version: 96,
    date: "2026-10-30",
    items: [
      {
        kind: "better",
        title: "Everyone can use every feature by default",
        text: "Members can now do what only leads could before, like importing, making suites and closing runs. Archiving and deleting stay with admins, and Viewers still only look. Admins can tighten this in What can they do, in umbrella Settings.",
      },
      {
        kind: "new",
        title: "Colors for color blindness",
        text: "Account → Appearance → Color vision: red-green safe, blue-yellow safe or no color, with shapes and patterns so Passed and Failed never rely on color alone.",
        link: "/account",
      },
      {
        kind: "better",
        title: "Tidier Account page",
        text: "Each Account card folds to a one-line summary. Open the ones you need, and they stay open the next time.",
      },
      {
        kind: "new",
        title: "Crowns",
        text: "Hold the most results on a platform or in a folder over the last 30 days and you wear its crown, like Ruler of the Web. See them under Account → Mini game.",
        game: true,
      },
      {
        kind: "new",
        title: "Sentry errors while you test",
        text: "Connect Sentry in umbrella Settings. When you fail or block a step, the runner shows the errors Sentry caught during that step, and you can put them straight on the bug.",
        who: "lead",
      },
      {
        kind: "new",
        title: "[WEB] in a title becomes a colored tag",
        text: "Leading [brackets] in case titles turn into tags you can click to filter. A banner in the Case library converts the titles you already have.",
      },
      {
        kind: "better",
        title: "Search forgives typos",
        text: "Every search box finds close spellings too, under a Close matches label, so “wb” still finds “web”. Searching a tag name finds cases with that tag.",
      },
      {
        kind: "better",
        title: "Clearer exploring",
        text: "Start exploring opens a small box, sessions end with Finish exploring, and exploring counts as Explored instead of Passed or Failed. Test personas moved to a tab on the Charters page.",
      },
      {
        kind: "new",
        title: "Company bug templates",
        text: "Workspace admins can share a bug template with everyone whose email ends a certain way. It shows under Shared with you in every umbrella's Bug template section. The OKO layout is shared this way.",
      },
      {
        kind: "new",
        title: "Write new cases from a requirement",
        text: "On Requirements, + New case and + New charter make cases already linked to the requirement. Type several titles at once and write their steps one after another.",
      },
      {
        kind: "new",
        title: "Bug bashes: see what others find as they find it",
        text: "Live finds next to the log box shows everyone's bugs, questions, notes and ideas in your area, so nobody logs the same bug twice. Add to a find, +1 it, or answer a question. Areas can link to Jira issues, pull requests and web pages, and the Risk board can start a bash.",
      },
      {
        kind: "new",
        title: "Known bugs from earlier runs",
        text: "A case shows the bugs found on it in earlier runs, with Still happens and Didn't happen. Report bug asks if it's the same bug before you file a second copy.",
      },
      {
        kind: "new",
        title: "New and Updated cases in runs",
        text: "Cases never run before get a New tag, and cases whose steps changed get an Updated tag with the old wording crossed out.",
      },
      {
        kind: "better",
        title: "Plan this release is easier to follow",
        text: "The Risk board's Plan box explains each choice, and can add to a run that's already in progress.",
      },
    ],
  },
  {
    version: 95,
    date: "2026-10-29",
    items: [
      {
        kind: "new",
        title: "One Start a run button: pick the kind of run first",
        text: "Start a run asks what kind of run it is: Smoke test, Release candidate, Bug bash, or your own kind. A kind can remember its usual suite. Release candidate and Bug bash open their own boxes. Runs show their kind, and Test runs and Reports can filter by it.",
        link: "/g/{umbrella}",
      },
      {
        kind: "better",
        title: "Make the test cycle while you start the run",
        text: "Step 2 of Start a run, Where it goes, ends with + New test cycle. Name it, and it's made when you press Start, with the run in it.",
      },
      {
        kind: "better",
        title: "Reports never add hand testing and automation together",
        text: "Execution status shows Manual testing and Automated tests on their own. Automation counts each automated case once, by its latest result. Trends and Step results split the same way.",
      },
      {
        kind: "better",
        title: "Automated cases look like your other cases",
        text: "Plain titles, steps from the test when it has them, and a line saying when automation last ran each one. The Case library's Who runs it filter shows cases run by hand, by automation, or both.",
      },
      {
        kind: "better",
        title: "Step pips move as you test",
        text: "The run list's step pips update as you mark each step, and saved cases keep their pips.",
      },
      {
        kind: "better",
        title: "Retried Playwright tests: one attempt at a time",
        text: "A test Playwright retried shows the last attempt's screenshot, video and replay, with an Attempt switch to see the earlier one.",
      },
      {
        kind: "new",
        title: "Use your profile picture as your quest pawn",
        text: "Pick My picture in Choose your pawn to show your profile picture inside a ring.",
        game: true,
      },
      {
        kind: "better",
        title: "Testing isn't only for release candidates",
        text: "Wording across Flaw Patrol no longer assumes every run is for a release. The setup card says Run your first tests. Release status counts release candidates and plain runs, not smoke tests.",
      },
      {
        kind: "fix",
        title: "Test cycle settings stay in the left menu",
        text: "Under Settings, the left menu lists each current test cycle's settings next to the umbrella's on every page, not only while you're inside that test cycle.",
      },
    ],
  },
  {
    version: 94,
    date: "2026-10-29",
    items: [
      {
        kind: "better",
        title: "Pass or fail: Bug found is gone",
        text: "A step or case is Passed or Failed, and a failure is where you file or link the bug. Blocked, Retest and Skipped stay. Old Bug found results now show as Failed.",
      },
      {
        kind: "fix",
        title: "Bug bash bugs that weren't filed still count",
        text: "At wrap-up, each bug has a File it tick box. If a bug doesn't reach Jira, you stay on the review screen and see why. The report counts every bug found, tags the ones not filed yet, and has File this bug… to file them later.",
      },
      {
        kind: "better",
        title: "Bug bashes stay separate from releases",
        text: "When you start a bug bash, you choose up front whether to attach it to a test cycle. Release status has an Include bug bashes switch. Serious bash bugs always show in its critical bug list, tagged from bug bash.",
      },
      {
        kind: "better",
        title: "Hide umbrellas you don't use",
        text: "Tick umbrellas on the Umbrellas page and press Hide for me. Only you stop seeing them. Find them again under Hidden by you. Admins also get Archive… there, and dragging an umbrella by its top edge is easier.",
        link: "/",
      },
      {
        kind: "new",
        title: "Member and Viewer roles",
        text: "Tester is now called Member. The new Viewer role can see everything, flag cases and join bug bashes, but doesn't edit, run or archive.",
        who: "lead",
      },
      {
        kind: "better",
        title: "Clearer words everywhere",
        text: "Release instead of RC, Platform instead of client, and Import cases on the Case library. Release status shows one column per platform, and severity names match Jira's.",
      },
      {
        kind: "better",
        title: "Easier on a phone",
        text: "The runner shows the case first, with the run's cases behind a Run list button. Hand it back gives a case back for someone else to take.",
      },
      {
        kind: "better",
        title: "GitHub runs keep their GitHub name",
        text: "Runs pulled from GitHub are named after the workflow and run, like Browser tests · GitHub run 16, on Test runs and on the Repositories page.",
        who: "lead",
      },
      {
        kind: "fix",
        title: "Arrange menu order drags again",
        text: "Dragging a left menu link no longer snaps back. It stays where you drop it.",
      },
      {
        kind: "better",
        title: "Your pawn on the quest map",
        text: "The Quest map page has a Your pawn card with Change gear and Change pawn. Your pawn waits at the start of runs you haven't tested in yet, and automated runs no longer get a map.",
        game: true,
      },
    ],
  },
  {
    version: 93,
    date: "2026-10-29",
    items: [
      {
        kind: "new",
        title: "Bug bashes",
        text: "Everyone explores for a set time, picks an area and logs bugs in one line. Whoever starts it wraps up, merges duplicates and files the bugs, then gets a report to share. Find Bug bashes in the left menu.",
        link: "/g/{umbrella}/runs",
      },
      {
        kind: "new",
        title: "Charters page, with tours and checklists",
        text: "Charters have their own page in the Library menu. New charter → From a tour or checklist fills in everything but the area, with prompts you tick off during the session.",
      },
      {
        kind: "new",
        title: "Risk board",
        text: "See which requirements in a Jira release are most likely to break and how much it would hurt. Move cards to correct the first guess, then press Plan this RC to make the run.",
      },
      {
        kind: "new",
        title: "Screenshots, videos and replays from Playwright",
        text: "Upload a zip of your Playwright results and failed tests show their screenshot, video and a step-by-step replay that opens right here.",
      },
      {
        kind: "new",
        title: "Regression flag",
        text: "A case that passed in the last RC and fails now gets a Regression badge, and its Jira bug gets the regression label.",
      },
      {
        kind: "better",
        title: "Arrange your own menu",
        text: "Press Arrange menu order at the bottom of the left menu to drag links into the order you like. Only you see it.",
      },
      {
        kind: "better",
        title: "Tick all in Pick cases",
        text: "Start a run → Pick cases has Tick all and Untick all next to the filters.",
      },
    ],
  },
  {
    version: 92,
    date: "2026-10-28",
    items: [
      {
        kind: "new",
        title: "Workspace settings",
        text: "Company sign-in, invite emails, the activity log and Game admin now live on one page in the name menu, for workspace admins only.",
        who: "workspace",
        link: "/workspace",
      },
      {
        kind: "new",
        title: "Sign in with Microsoft, Google or your company's SSO",
        text: "Set it up in Workspace settings → Sign-in, test it with your own account, then turn it on. Email and password can then be turned off for everyone but admins.",
        who: "workspace",
        link: "/workspace#sign-in",
      },
      {
        kind: "new",
        title: "Invite emails",
        text: "Once email is set up, adding someone emails them an invite. Members lists show when it was sent, with Resend and Copy invite link.",
        who: "admin",
      },
      {
        kind: "new",
        title: "Activity log",
        text: "See who changed what: sign-ins, people, settings, deletes and runs. It never records results, cases run or bugs filed.",
        who: "workspace",
        link: "/workspace#activity",
      },
    ],
  },
  {
    version: 91,
    date: "2026-10-28",
    items: [
      {
        kind: "better",
        title: "Start next RC: pick cases from folders, or reuse last RC's",
        text: "Each platform can take whole folders or single cases from the Case library, or the same cases as last RC. Same testers on same cases and bug re-checks now also work for platforms with no runs yet.",
        who: "lead",
        link: "/g/{umbrella}",
      },
      {
        kind: "new",
        title: "Export any report",
        text: "One Export menu on every Reports page: CSV, image, Copy for Confluence, a PDF report of the tabs you pick, or an Excel workbook.",
        link: "/g/{umbrella}/reports",
      },
      {
        kind: "new",
        title: "Send to Jira for bugs saved before Jira was connected",
        link: "/g/{umbrella}/bugs",
      },
      {
        kind: "better",
        title: "Severity names come from your Jira",
        text: "Settings → Jira shows the severity field and which values count as critical. Without Jira, bugs use Critical, Major, Minor and Trivial.",
        who: "admin",
        link: "/g/{umbrella}/settings#jira",
      },
      {
        kind: "new",
        title: "CI uploads: your pipeline can send results by itself",
        text: "Make a token in Settings → CI uploads and copy the ready-made GitHub Actions step.",
        who: "admin",
        link: "/g/{umbrella}/settings#ci-uploads",
      },
      {
        kind: "better",
        title: "Automation uploads link tests to cases with the same name",
        text: "Check them in the preview and press Undo on any that are wrong.",
        who: "lead",
      },
      {
        kind: "better",
        title: "Imports keep the file's folders",
        text: "A file with a Folder or Section column makes those folders by default. TestRail Type values become tags.",
        who: "lead",
      },
      { kind: "fix", title: "Reports add up: Testers are listed A to Z, Step results use Bug found, and Retest says how many weren't passed" },
      { kind: "fix", title: "Role descriptions match the Roles grid, and inviting from a test cycle adds people to its umbrella" },
    ],
  },
  {
    version: 90,
    date: "2026-10-28",
    items: [
      {
        kind: "better",
        title: "Reports show manual and automated runs apart",
        text: "Pass rate by run draws a solid line for runs tested by hand and a dashed 🤖 line for uploaded or GitHub runs. A new Runs filter shows All, Manual or Automated.",
        link: "/g/{umbrella}/reports",
      },
      {
        kind: "fix",
        title: "Test suites in Reports count every run of the suite",
        text: "Runs started by picking exactly a suite's cases now count as that suite's runs, and get linked to the suite when they start.",
      },
      {
        kind: "fix",
        title: "Import a run can link a Case library suite",
        who: "lead",
      },
      {
        kind: "better",
        title: "Language choices are now US English and UK English",
        text: "Change yours in Your account → Language.",
        link: "/account#language",
      },
    ],
  },
  {
    version: 89,
    date: "2026-10-28",
    items: [
      {
        kind: "new",
        title: "Run fields: pick the extra details your runs ask for",
        text: "Each umbrella can add up to 5 fields, like Firmware or Region, as text or a list. Umbrellas you already have keep CSP version.",
        who: "lead",
        link: "/g/{umbrella}/settings#run-fields",
      },
      {
        kind: "better",
        title: "Start next RC: tick any platform and choose what it runs",
        text: "Each ticked platform has one dropdown: run last RC's suites again, pick suites from the library, or start brand new.",
        who: "lead",
        link: "/g/{umbrella}?start=rc",
      },
      {
        kind: "better",
        title: "Stories are now Requirements",
        text: "Link any Jira issue type, filter by type, and let an Epic count its child issues.",
      },
      {
        kind: "better",
        title: "GitHub runs show each build step",
        text: "See which step failed, so a broken build looks different from failing tests.",
      },
      {
        kind: "better",
        title: "Click a pip in a case's history to open that run",
      },
      {
        kind: "better",
        title: "Every popup box has an ✕ to close it",
      },
      {
        kind: "fix",
        title: "Recordings with no sound and the mic off attach again",
        text: "Imported steps also show > instead of &gt;.",
      },
    ],
  },
  {
    version: 88,
    date: "2026-10-28",
    items: [
      {
        kind: "new",
        title: "This window shows what changed",
        text: "It opens once after each new version. Open it again any time from your name in the top bar, then What's new.",
        link: "/whats-new",
      },
      {
        kind: "better",
        title: "Add any of the case's screenshots and recordings to a bug",
        text: "In the bug box, + Add lists captures from other steps and the whole case, and can take a screenshot or record the screen right there.",
      },
      {
        kind: "fix",
        title: "No wrong reporter warning when the Jira token is yours",
        text: "Notes after filing a bug, like a file Jira refused, now show in the bug box instead of a pop-up.",
      },
      {
        kind: "fix",
        title: "No false \"Jira wouldn't link it\" note when a bug is linked to a story",
        text: "The link was made, but Flaw Patrol misread Jira's empty answer and said it failed.",
      },
      {
        kind: "fix",
        title: "Connecting GitHub saves the workflow too",
        text: "Save and test now saves the picked workflow. A repo without one says Setup not finished and shows the picker.",
        who: "admin",
        link: "/g/{umbrella}/settings",
      },
      {
        kind: "better",
        title: "Clearer GitHub message when a token can't see the repo",
        text: "It says which GitHub account the token belongs to and what to change.",
        who: "admin",
        link: "/g/{umbrella}/settings",
      },
    ],
  },
];
