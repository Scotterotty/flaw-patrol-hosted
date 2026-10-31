/**
 * The "What's new" window after sign-in (ver_88). Add one entry at the TOP in
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
