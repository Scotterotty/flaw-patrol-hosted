/**
 * The How-to guide (ver_174): every task in Flaw Patrol, written end to end in plain words.
 * Opened from "How-to guide" under Settings in the left menu, or by typing "how do I" in Search.
 * It never opens by itself.
 *
 * Each step says what to do and what you should see after it. A step with a `target`
 * gets a Show me button: the guide goes to the right page, opens the boxes on the way,
 * then makes the real button glow (it has data-howto="<target>" in the code).
 * tests/e2e/how-to-guide.spec.ts and src/lib/how-to.test.ts check every target still exists,
 * so renaming or moving a button fails the build until the guide is updated.
 *
 * Words in **double stars** are Flaw Patrol button and page names; they show in bold.
 * Keep secret extras (the mini game and its parts) out of here.
 */

export type HowToStep = {
  /** What to do, one action. */
  text: string;
  /** "You should see" after doing it. */
  see?: string;
  /** data-howto name of the button or box this step is about. With it, the step gets Show me. */
  target?: string;
  /** You do this one yourself (type, or pick a file): the guide moves on once it's changed, and never presses it for you. */
  type?: boolean;
  /** Saves or creates something: Show me on a later step never presses it for you. */
  saves?: boolean;
};

export type HowToTask = {
  id: string;
  group: HowToGroup;
  title: string;
  /** One line under the title in the list. */
  sub: string;
  /** Only Admins can do it; others are told who to ask. */
  admins?: boolean;
  /** Where to be before step 1, when Show me can't take you there by itself. */
  start?: string;
  steps: HowToStep[];
  /** The task to do after this one. */
  next?: string;
  /** Other words people might search for. */
  words?: string;
};

export const HOW_TO_GROUPS = ["Get started", "Write tests", "Run tests", "Bugs", "Bug bashes", "Results", "Settings"] as const;
export type HowToGroup = (typeof HOW_TO_GROUPS)[number];

/** The 12 most-used tasks have Show me on their steps in this build; the rest come next. */
export const HOW_TO: HowToTask[] = [
  // ───────────── Get started ─────────────
  {
    id: "find-your-way",
    group: "Get started",
    title: "Find your way around",
    sub: "Umbrellas, test cycles and the left menu",
    words: "start new umbrella test cycle menu home overview where",
    steps: [
      { text: "Press **Flaw Patrol** at the top left.", see: "The Umbrellas page, with every umbrella you're on. An umbrella holds one product's cases, runs, bugs and settings." },
      { text: "Click an umbrella's name to open it.", see: "Its **Overview**, with **Runs in progress**, **Shortcuts** and the left menu." },
      { text: "Look at the left menu. **Library** holds what you test with, **Testing** is where you test, **Results** is what you found, and **Settings** is set once for everyone.", see: "The page you're on is lit in the menu.", target: "menu-overview" },
      { text: "Under **Testing**, the rows under **Test runs** are your test cycles. A test cycle is the folder a run goes in, like one per platform for a release.", see: "Each test cycle with its colored dot." },
      { text: "Press **Overview** any time to get back to the umbrella's home.", see: "The umbrella's home page again." },
    ],
    next: "search",
  },
  {
    id: "search",
    group: "Get started",
    title: "Find anything with Search",
    sub: "Cases, runs, bugs, test cycles and pages",
    words: "find look up ctrl k command key jump",
    steps: [
      { text: "Press **Search** in the top bar, or press Ctrl + K (⌘ + K on a Mac) on any page.", see: "The Search box, with **Recent** and **Go to** before you type.", target: "top-search" },
      { text: "Type part of a name, a case key like APP-12, or a Jira key. Small typos are fine.", see: "Results grouped into **Test cases**, **Test runs**, **Bugs** and more. Near misses show under **Close matches**.", target: "search-input", type: true },
      { text: "To narrow the list, press a filter like **Cases**, **Runs** or **Bugs**.", see: "Only that kind of result, with its count." },
      { text: "Inside an umbrella the box says **In** and the umbrella's name. Press its ✕ to search everywhere you have access.", see: "Results from every umbrella." },
      { text: "Use the ↑ and ↓ keys to pick a result and press Enter to open it. Ctrl + Enter opens it in a new tab.", see: "The page you picked." },
    ],
    next: "appearance",
  },
  {
    id: "appearance",
    group: "Get started",
    title: "Change your colors and fonts",
    sub: "Light or dark, your color, your fonts",
    words: "theme dark mode light mode color font look appearance",
    steps: [
      { text: "Click your name at the top right.", see: "Your account menu.", target: "top-account" },
      { text: "Choose **Appearance**.", see: "**Your account**, with the **Appearance** card open.", target: "account-appearance" },
      { text: "Under **Mode**, pick **Light**, **Dark** or **Match my computer**.", see: "The whole app changes at once. It saves by itself.", target: "appearance-mode" },
      { text: "Under **Color**, pick the color you like.", see: "Buttons and links in that color. Test results keep their own colors.", target: "appearance-color" },
      { text: "Pick a **Text font** and a **Heading font** if you want.", see: "The new fonts everywhere, including the left menu.", target: "appearance-fonts" },
    ],
    next: "profile",
  },
  {
    id: "profile",
    group: "Get started",
    title: "Set up your profile and password",
    sub: "Your name, picture and password",
    words: "name avatar photo picture password account email",
    steps: [
      { text: "Click your name at the top right and choose **Your account**.", see: "**Your account**, with cards that fold open." },
      { text: "Open **Your profile**. Type your name and add a picture if you like.", see: "Your name and picture next to your results and bugs." },
      { text: "Open **Password** to set or change your password.", see: "**Set** and the date you last changed it." },
      { text: "Open **Language** to choose **US English** or **UK English** spelling and how dates look.", see: "Spelling and dates the way you picked." },
      { text: "Open **Emails I get** to choose which summary emails you get.", see: "Your choices saved. Every email also has a Stop link." },
    ],
    next: "accessibility",
  },
  {
    id: "accessibility",
    group: "Get started",
    title: "Make it easier to see and use",
    sub: "Text size, contrast, color vision, motion",
    words: "accessibility color blind colour vision contrast bigger text motion underline",
    steps: [
      { text: "Click your name at the top right and choose **Your account**.", see: "**Your account**." },
      { text: "Open the **Accessibility** card.", see: "**Text size**, **Color vision**, **Reduce motion**, **Stronger contrast** and **Underline links**." },
      { text: "Pick a **Text size**.", see: "Bigger or smaller text everywhere." },
      { text: "Under **Color vision**, pick the option that suits you.", see: "**How statuses look now** shows Passed, Failed and the rest with shapes and patterns, so they never rely on color alone." },
      { text: "Turn on **Reduce motion**, **Stronger contrast** or **Underline links** if they help.", see: "The change straight away. This guide's glow stops pulsing too when Reduce motion is on." },
    ],
    next: "arrange-menu",
  },
  {
    id: "arrange-menu",
    group: "Get started",
    title: "Put the left menu in your order",
    sub: "Drag links into the order you use them",
    words: "menu order arrange drag reorder sidebar",
    steps: [
      { text: "At the bottom of the left menu, press **Arrange menu order**.", see: "A note at the top, and a ⠿ grip next to each link." },
      { text: "Drag a link by its ⠿ grip up or down. With the keyboard, focus the grip and press ↑ or ↓.", see: "The link in its new place. Links stay in their own section." },
      { text: "Press **Done**.", see: "Your order. Only you see it." },
      { text: "To undo it all, press **Arrange menu order**, then **Reset to default order**.", see: "The menu back in its first order." },
    ],
    next: "whats-new",
  },
  {
    id: "whats-new",
    group: "Get started",
    title: "See what's new",
    sub: "What changed in the latest versions",
    words: "release notes changes updates version",
    steps: [
      { text: "Click your name at the top right and choose **What's new**.", see: "Every version, newest at the top, in plain words." },
      { text: "Press **Show me** on an item to go straight to it.", see: "The page with the new thing on it." },
    ],
    next: "write-case",
  },

  // ───────────── Write tests ─────────────
  {
    id: "write-case",
    group: "Write tests",
    title: "Write a test case",
    sub: "A title, then steps with what should happen",
    words: "new case create test case steps expected",
    steps: [
      { text: "In the left menu, under **Library**, press **Case library**. (A test cycle that isn't in an umbrella calls it **Test cases**.)", see: "Your cases, with folders on the left.", target: "menu-cases" },
      { text: "Pick a folder on the left if you want the case in it, then press **New case** at the top right.", see: "The **New test case** page with the cursor in **Title**.", target: "cases-new" },
      { text: "Type a short **Title** that says what you check, like Sign in with email. To tag it, start with a word in brackets, like [WEB].", see: "Your title. A [WEB] start turns into a tag pill.", target: "case-title", type: true },
      { text: "Check the **Folder** and **Priority**.", see: "The folder you picked, and Medium priority unless you change it.", target: "case-folder" },
      { text: "Under **Steps**, type what to do in **Action** and what should happen in **Expected result**.", see: "Step 1 filled in.", target: "case-step", type: true },
      { text: "Press **+ Add step** for each next step. Ctrl + Enter in a step adds one below it too.", see: "A new empty step under the last one.", target: "case-add-step" },
      { text: "Press **Create case** at the bottom. To write another right away, press **Create and new** instead.", see: "The case's page, with its key (like APP-12) and **Version 1** in **Version history**.", target: "case-save", saves: true },
    ],
    next: "make-suite",
  },
  {
    id: "import-cases",
    group: "Write tests",
    title: "Import cases from a spreadsheet",
    sub: "A CSV or Excel (.xlsx) file from another tool",
    words: "import csv excel xlsx testrail qtest zephyr xray spreadsheet upload move",
    steps: [
      { text: "In the left menu, under **Library**, press **Case library**.", see: "Your cases.", target: "menu-cases" },
      { text: "Press **Import cases** at the top right.", see: "The import page with a big drop box.", target: "cases-import" },
      { text: "Drop your file on the box, or click the box and choose the file. Only the first sheet of an Excel file is read.", see: "The file's name and row count, then questions about it and a **Preview**.", target: "import-drop", type: true },
      { text: "Check **Where is this file from?** Flaw Patrol picks it from the column names, like TestRail or qTest.", see: "The tool your file came from.", target: "import-source" },
      { text: "Answer **Where should these cases live?** and **Which folder?** If your file has folders, they're kept.", see: "The place and folder picked, marked **Recommended** where it helps." },
      { text: "Answer **Have these cases been run before?** Pick **Yes** for cases your team already uses, or **No** for brand-new ones.", see: "Your answer ticked. New cases get a New tag in runs.", target: "import-run-before" },
      { text: "Check **Match your columns**. Only **Title** is required. Click a case in **Preview** to see its steps.", see: "Each column matched, and steps numbered the way they'll be saved.", target: "import-columns" },
      { text: "Press **Import** at the top of the **Preview**. It says how many cases, like Import 40 cases.", see: "✓ Imported, with how many cases went in.", target: "import-go", saves: true },
      { text: "Press **View cases**.", see: "Your new cases in the **Case library**, in their folders.", target: "import-view" },
    ],
    next: "make-suite",
  },
  {
    id: "edit-case",
    group: "Write tests",
    title: "Change a case and see its history",
    sub: "Edit, compare versions, restore an old one",
    words: "edit change version history restore undo duplicate archive",
    steps: [
      { text: "In the left menu, press **Case library** and click the case's name.", see: "The case's page with its steps and **Version history** on the right." },
      { text: "Press **Edit** at the top right.", see: "The **Edit case** page." },
      { text: "Make your change. In **What changed? (optional)**, write a short note, like Updated expected text for new checkout.", see: "Your note under the steps." },
      { text: "Press **Save new version**.", see: "The case with a new version at the top of **Version history**. Past runs keep the version they ran." },
      { text: "To look back, click an older **Version** in **Version history**.", see: "That version and what changed." },
      { text: "To bring it back, press **Restore this version**.", see: "A new version with the old steps." },
      { text: "Need a copy or want it out of the way? Open **More** at the top and press **Duplicate** or **Archive case**.", see: "A copy to edit, or the case moved to archived. Archived cases can be restored." },
    ],
    next: "folders-tags",
  },
  {
    id: "folders-tags",
    group: "Write tests",
    title: "Sort cases with folders and tags",
    sub: "Keep the library tidy and easy to filter",
    words: "folder tag label organize move filter",
    steps: [
      { text: "In the left menu, press **Case library**.", see: "The folder list on the left and your cases on the right." },
      { text: "Use the folder list's buttons to add a folder, or a folder's own menu to rename or move it.", see: "The new folder in the list." },
      { text: "To move cases, tick them in the list and pick a folder in **Move to folder…**.", see: "The cases in their new folder." },
      { text: "To tag a case, start its **Title** with a word in brackets, like [WEB] or [CHECKOUT], or add tags when editing it.", see: "A tag pill on the case." },
      { text: "Click a tag, or use the filters above the list, to see only those cases.", see: "Only the matching cases, with how many there are." },
    ],
    next: "shared-steps",
  },
  {
    id: "shared-steps",
    group: "Write tests",
    title: "Reuse steps with shared steps",
    sub: "Write steps like Sign in once, use them everywhere",
    words: "shared steps reuse common login parameter",
    steps: [
      { text: "In the left menu, under **Library**, press **Shared steps**.", see: "Every shared step and how many cases use it." },
      { text: "Press **New shared step**.", see: "The **New shared step** page." },
      { text: "Type a **Name**, like Log in as {{role}}. A word in {{double braces}} is a blank each case can fill in.", see: "Your name. Blanks show under **Parameters**." },
      { text: "Add the steps with **Action** and **Expected result**, and **+ Add step** for more.", see: "Your steps listed in order." },
      { text: "Press **Create shared step**.", see: "The shared step's page." },
      { text: "To use it, edit a case and press **+ Insert shared step** under its steps. Pick it, fill in any blanks, and press **Add … steps**.", see: "The shared steps in your case as 3.1, 3.2 and so on. Changing the shared step later updates every case." },
      { text: "Already wrote the steps in a case? Tick them on the edit page and press **Make shared step from** the selected steps.", see: "A **Make a shared step** box. Save it to turn them into one." },
    ],
    next: "test-data",
  },
  {
    id: "test-data",
    group: "Write tests",
    title: "Run one case with many values",
    sub: "Test data: the case runs once per row",
    words: "test data parameters values rows data driven table",
    steps: [
      { text: "Open a case and press **Edit**.", see: "The **Edit case** page." },
      { text: "Change a step to use a blank in double braces, like Sign in as {{role}}.", see: "Your step with the blank." },
      { text: "Under the steps, press **+ Add test data**.", see: "A small table with a column for each blank." },
      { text: "Press **+ Add row** for each value, like admin, viewer and guest. Or press **Paste rows from a sheet** and paste from Excel or Google Sheets.", see: "One row per value." },
      { text: "Press **Save new version**.", see: "The test data table on the case's page." },
      { text: "In a run, the case shows each row in turn. Use [ and ] to move between rows.", see: "The step filled in with each value, and one result per row." },
    ],
    next: "make-suite",
  },
  {
    id: "make-suite",
    group: "Write tests",
    title: "Make a test suite",
    sub: "A saved list of cases you run together",
    words: "suite smoke regression group list",
    steps: [
      { text: "In the left menu, under **Library**, press **Test suites**.", see: "Every suite, with how many cases each has.", target: "menu-suites" },
      { text: "Press **New suite** at the top right.", see: "The **New test suite** page.", target: "suites-new" },
      { text: "Under **1. Name**, type a name like Smoke or Checkout regression.", see: "Your name in the box.", target: "suite-name", type: true },
      { text: "Under **2. Add cases**, pick a folder, then tick the cases this suite runs. The button above the list ticks a whole folder.", see: "The ticked cases listed under **3. In this suite**.", target: "suite-cases" },
      { text: "Under **3. In this suite**, use ↑ and ↓ to put the cases in the order they run.", see: "Your cases in order.", target: "suite-chosen" },
      { text: "Press **Create suite** at the top right.", see: "The suite's page at version 1. Changing its cases later saves a new version, and past runs keep theirs.", target: "suite-save", saves: true },
    ],
    next: "create-run",
  },
  {
    id: "charters",
    group: "Write tests",
    title: "Explore with a charter",
    sub: "A mission with no steps, a timer and a log",
    words: "charter exploratory explore session timer mission",
    steps: [
      { text: "In the left menu, under **Library**, press **Charters**.", see: "Every charter, plus the test personas you can explore as." },
      { text: "Press **New charter** and pick **Blank charter**, or **From a tour or checklist…** for a ready-made one.", see: "The **New charter** page." },
      { text: "Fill in **Explore** (where to look), **With** (what to use) and **To discover** (what you want to learn). Pick a **Time limit**.", see: "Your mission written out." },
      { text: "Press **Create charter**.", see: "The charter's page." },
      { text: "Press **▶ Start exploring**, check the time and who explores, then press **Start exploring**.", see: "A timer at the top and a log for notes, bugs, questions and ideas." },
      { text: "Type what you notice and press Enter. Change the kind to **Bug**, **Question** or **Idea** before you log it.", see: "Each entry in the log with its time." },
      { text: "Press **Finish exploring**, say how it went, then press **Finish**.", see: "The session saved to the run and the charter's history." },
    ],
    next: "requirements",
  },
  {
    id: "requirements",
    group: "Write tests",
    title: "Link cases to requirements",
    sub: "See which Jira stories have tests",
    words: "requirements stories epics jira coverage traceability link",
    steps: [
      { text: "In the left menu, under **Library**, press **Requirements**. (It needs Jira connected.)", see: "Every Jira story or Epic, next to the cases that test it, with results and open bugs." },
      { text: "Find a requirement with no cases.", see: "It says so on its row." },
      { text: "Press **+ New case** on its row. Type a few titles, then write their steps one after another.", see: "The new cases, already linked." },
      { text: "Or press **Add existing cases** to link cases you already have.", see: "The cases listed under the requirement." },
      { text: "On any case's page, press **+ Link requirement** on the right to link it from there.", see: "The requirement listed on the case." },
    ],
    next: "glossary",
  },
  {
    id: "glossary",
    group: "Write tests",
    title: "Look up or add a word",
    sub: "The Glossary of your team's words",
    words: "glossary word meaning term dictionary define acronym",
    steps: [
      { text: "Select a word on any page, like in a test step.", see: "A small **Look it up** button by the word." },
      { text: "Press **Look it up**, or press G.", see: "What the word means, if the team has written it down." },
      { text: "Nobody has explained it yet? The button says **Look it up / Add to Glossary**. Write a plain meaning and press **Add term**, or press **Ask the team** if you don't know it.", see: "The word in the Glossary, with a dotted underline wherever it shows up." },
      { text: "To see every word, press **Glossary** under **Library** in the left menu.", see: "The whole list, with **+ Add a term**." },
    ],
    next: "flag-case",
  },
  {
    id: "flag-case",
    group: "Write tests",
    title: "Flag a case that needs fixing",
    sub: "Mark it so whoever looks after it can find it",
    words: "flag needs update wrong outdated broken case",
    steps: [
      { text: "Open the case's page, or find it in a run.", see: "A **Flag** button near the case's title." },
      { text: "Press **Flag**.", see: "The **Flag this case** box." },
      { text: "Pick the reason, like **Needs updating**, and add a short note.", see: "Your reason and note." },
      { text: "Press **Flag case**.", see: "An orange flag on the case. **Flagged cases** on the Overview lists every flagged one." },
      { text: "Once it's fixed, press the flag again and clear it.", see: "The flag gone." },
    ],
    next: "create-run",
  },

  // ───────────── Run tests ─────────────
  {
    id: "create-run",
    group: "Run tests",
    title: "Create a run",
    sub: "Pick what to test and where",
    words: "start run new run test run execute begin testing",
    steps: [
      { text: "In the left menu, under **Testing**, press **Test runs**.", see: "Every run, newest first, with **Create a run** at the top right.", target: "menu-runs" },
      { text: "Press **Create a run**. It's also on the umbrella's **Overview**.", see: "The **Create a run** box.", target: "run-create" },
      { text: "In an umbrella, pick **What kind of run?**, like **Smoke test**. (**Release candidate** and **Bug bash** open their own boxes.)", see: "The kind you picked, with **Change** next to it.", target: "run-kind" },
      { text: "Under **What to run**, pick **Whole Case library**, **A suite**, or **Pick cases** to search and tick them.", see: "Your choice lit up, with the suite list or the cases to tick.", target: "run-what" },
      { text: "Under **Test cycle**, tick where the run goes. **＋ New test cycle** makes one right there.", see: "The test cycle ticked.", target: "run-where" },
      { text: "Fill in **Run name**, **Release**, **Build**, **Environment** and **Assign every case to** if you need them. All are optional.", see: "A suggested name in gray if you leave the name blank.", target: "run-name" },
      { text: "Press **Create and test now** to start testing yourself, or **Create run** to start it for others (it names the kind, like **Create smoke test**).", see: "The runner open on the first case, or the run's page.", target: "run-go", saves: true },
    ],
    next: "test-case",
  },
  {
    id: "test-case",
    group: "Run tests",
    title: "Test a case in a run",
    sub: "Mark each step and save, with the keyboard if you like",
    words: "runner execute pass fail blocked retest skip step result keyboard save",
    steps: [
      { text: "In the left menu, under **Testing**, press **Test runs**.", see: "The active runs.", target: "menu-runs" },
      { text: "Click a run's name.", see: "The run's page with every case, its status and who it's assigned to.", target: "run-row" },
      { text: "Press **Start testing** at the top right (it says **Continue testing** once someone has started). Or press **Test** on one case.", see: "The runner, with the case's steps.", target: "run-start-testing" },
      { text: "For each step, press **Passed**, **Failed**, **Blocked**, **Retest** or **Skipped** under it. The keys P, F, B, R and S do the same, and ↑ ↓ or J K move between steps.", see: "The step's button filled in with its color.", target: "runner-status" },
      { text: "If a step failed, write what you saw in **What actually happened?** under it.", see: "Your note under the step, with **Report bug** next to it.", target: "runner-actual", type: true },
      { text: "Copy a screenshot and press Ctrl + V on the page to attach it to the step you're on.", see: "The picture listed under the step." },
      { text: "Add a **Comment on this case** if it helps.", see: "Your comment in the box.", target: "runner-comment", type: true },
      { text: "Press **Save and next** (Ctrl + Enter). On the last case it says **Save and finish**.", see: "The next case, and \"Step results saved\".", target: "runner-save", saves: true },
    ],
    next: "report-bug",
  },
  {
    id: "assign-cases",
    group: "Run tests",
    title: "Share cases out in a run",
    sub: "Assign cases to people",
    words: "assign assignee share split hand out who tests",
    steps: [
      { text: "Open the run's page from **Test runs**.", see: "Every case in the run, with **Assigned to**." },
      { text: "Tick the cases you want to hand out, or tick the box at the top to tick every case shown.", see: "How many are ticked." },
      { text: "Open **Assign selected to…** and pick a person.", see: "Their name next to each ticked case." },
      { text: "People open their own cases from **My assigned cases** on the Overview, or by filtering the run by **Assigned to me**.", see: "Only the cases waiting for them." },
    ],
    next: "close-run",
  },
  {
    id: "known-bugs",
    group: "Run tests",
    title: "Check bugs found before",
    sub: "Still happens or Didn't happen, without filing twice",
    words: "known bugs still happens didn't happen again same bug duplicate",
    steps: [
      { text: "Test a case that had bugs in earlier runs.", see: "A yellow **Known bugs** box at the top of the case." },
      { text: "Check each bug while you test.", see: "Each bug with its status from Jira." },
      { text: "Press **Still happens** if you see it again, or **Didn't happen** if you don't.", see: "Still happens fails its step and links the same bug. Nothing new is filed." },
      { text: "Press **Save and next**.", see: "Your check saved on the bug's history." },
    ],
    next: "retest",
  },
  {
    id: "retest",
    group: "Run tests",
    title: "Retest what didn't pass",
    sub: "A new run with just the failed, blocked and retest cases",
    words: "retest rerun failed again fix verify",
    steps: [
      { text: "Open the run's page.", see: "A **Retest** button at the top, with how many cases didn't pass." },
      { text: "Press **Retest … not passed**.", see: "A new run box, already named with (retest)." },
      { text: "Check the name, release and who it's assigned to, then create it.", see: "A new run with only those cases." },
    ],
    next: "close-run",
  },
  {
    id: "close-run",
    group: "Run tests",
    title: "Close a run",
    sub: "Lock the results when testing is done",
    words: "close finish complete end lock reopen run",
    steps: [
      { text: "Open the run's page.", see: "Once every case has a result, a green note says so." },
      { text: "Press **Close run**. It asks first if some cases haven't been tested.", see: "The run marked **Closed**. It moves to the **Closed** tab in **Test runs**." },
      { text: "To change something later, open the run, open **More** and press **Reopen run**.", see: "The run active again." },
    ],
    next: "reports",
  },
  {
    id: "automated-results",
    group: "Run tests",
    title: "Bring in automated test results",
    sub: "Upload a JUnit, NUnit or Playwright results file",
    words: "automation upload junit nunit playwright xml results ci pipeline",
    steps: [
      { text: "In the left menu, press **Test runs**.", see: "**Bring in results** at the top right." },
      { text: "Open **Bring in results** and choose **Automated test results**.", see: "The upload box: **1. Drop the file**, **2. Where they go**, **3. Check and save**." },
      { text: "Drop the results file (or a folder or .zip with screenshots and videos).", see: "How many tests were found." },
      { text: "Pick the test cycle the results go to, or make a new one, and press **Next: check results**.", see: "Each test matched to a case with the same name, or offered **Link** or **Make new case**." },
      { text: "Press **Save … results**.", see: "A 🤖 Automated run with every result. Failed Playwright tests show their screenshot, video and replay." },
    ],
    next: "github-pull",
  },
  {
    id: "github-pull",
    group: "Run tests",
    title: "Pull results from GitHub",
    sub: "Bring in a GitHub Actions run",
    words: "github actions pull workflow ci repository repo",
    start: "An Admin connects GitHub first in Settings → GitHub.",
    steps: [
      { text: "In the left menu, under **Results**, press **Repositories**.", see: "Each connected GitHub repo and how its tests are doing." },
      { text: "Press **⬇ Pull from GitHub**.", see: "The **Pull from GitHub** box with recent workflow runs." },
      { text: "Pick a workflow run and where the results go. **+ New test cycle** makes a place for them.", see: "The results checked the same way as an upload." },
      { text: "Save them.", see: "A 🤖 Automated run you can open, with failed tests first." },
    ],
    next: "release-candidate",
  },
  {
    id: "release-candidate",
    group: "Run tests",
    title: "Test a release candidate",
    sub: "One test cycle per platform for a release",
    words: "release candidate rc release status platform version ship",
    steps: [
      { text: "On the umbrella's **Overview**, press **▶ Create a run**.", see: "The **Create a run** box." },
      { text: "Under **What kind of run?**, pick **Release candidate**.", see: "The release box, which makes one test cycle per platform." },
      { text: "Type the release name, pick the platforms and what to run, then start it.", see: "A test cycle and a run for each platform." },
      { text: "Watch it from **Reports** → **Release status**, or **Release status** under Shortcuts on the Overview.", see: "Where each platform stands for that release." },
    ],
    next: "reports",
  },
  {
    id: "screen-capture",
    group: "Run tests",
    title: "Take a screenshot or record your screen",
    sub: "Built into the runner, no other tool needed",
    words: "screenshot record video capture screen attach file evidence",
    steps: [
      { text: "Open a case in a run.", see: "The runner." },
      { text: "Press **Take screenshot** and pick the window or screen to share.", see: "The picture attached to the case." },
      { text: "Press **Record screen**, do what you need, then stop sharing in your browser.", see: "The video attached, ready to add to a bug." },
      { text: "Or press **Attach file to case** to add a file from your computer.", see: "The file listed on the case." },
    ],
    next: "report-bug",
  },

  // ───────────── Bugs ─────────────
  {
    id: "report-bug",
    group: "Bugs",
    title: "Report a bug from a failed step",
    sub: "Flaw Patrol fills most of it in for you",
    words: "bug report file jira defect issue failed step",
    start: "Start in the runner, on the case you're testing (see Test a case in a run).",
    steps: [
      { text: "Press **Failed** under the step that went wrong (or press F).", see: "The step turns red, with a box under it.", target: "runner-fail" },
      { text: "Type what you saw in **What actually happened?**", see: "Your words under the step.", target: "runner-actual", type: true },
      { text: "Press **Report bug** under it. When Jira is connected it says **Report bug in Jira**.", see: "The **Report a bug** box, already filled in from the step, run and case.", target: "runner-report-bug" },
      { text: "If your team has more than one template, pick one. Check the **Summary** and pick a **Severity**.", see: "The bug's text, ready to send.", target: "bug-summary", type: true },
      { text: "Press **Save bug**, or **File bug in Jira** when Jira is connected.", see: "The bug linked on the step. Next time anyone runs this case, it shows under Known bugs.", target: "bug-submit", saves: true },
      { text: "Press **Save and next** to save the case.", see: "The next case.", target: "runner-save", saves: true },
    ],
    next: "write-bug",
  },
  {
    id: "write-bug",
    group: "Bugs",
    title: "Write a bug",
    sub: "For a bug you found outside a test",
    words: "write bug new bug log issue found outside test",
    steps: [
      { text: "In the left menu, press **+** next to **Bugs**. (**+ Write a bug** on the Overview does the same.)", see: "The **Write a bug** box.", target: "menu-bugs-plus" },
      { text: "If you're asked, pick the test cycle it **Goes to**.", see: "The test cycle picked." },
      { text: "Pick a template. **Plain** is fine for most bugs.", see: "The template's boxes.", target: "write-bug-template" },
      { text: "Type a short **Summary** that says what's wrong.", see: "Your summary.", target: "bug-summary", type: true },
      { text: "Fill in **Steps to reproduce**, **What happened** and **What you expected**, then pick a **Severity**.", see: "Every box filled in. Anything still needed is listed by the save button." },
      { text: "Add **Found in** and **+ Attach files** if you have them. Tick **Also file it in Jira** to send it there too.", see: "Your files listed." },
      { text: "Press **Save bug** (or **Save and file in Jira**).", see: "Saved, with the bug's key. It's on the **Bugs** page.", target: "write-bug-save", saves: true },
    ],
    next: "bug-templates",
  },
  {
    id: "find-bugs",
    group: "Bugs",
    title: "Find and send bugs",
    sub: "The Bugs page, and bugs not in Jira yet",
    words: "bugs list search filter critical jira send not in jira",
    steps: [
      { text: "In the left menu, under **Results**, press **Bugs**.", see: "Every open bug across your test cycles." },
      { text: "Type in **Search bugs, Jira keys or case IDs**, or press a chip like **Critical**, **Written on its own** or a platform.", see: "Only the matching bugs." },
      { text: "Press **Open** to switch to **Open and closed**.", see: "Fixed and closed bugs too." },
      { text: "If some bugs aren't in Jira yet, press **Send them to Jira** in the yellow note, then **Send to Jira** on a bug.", see: "The bug's Jira key on its row." },
    ],
    next: "bug-templates",
  },
  {
    id: "bug-templates",
    group: "Bugs",
    title: "Make a bug template",
    sub: "The bug form your team wants",
    words: "bug template form fields layout headings jira",
    steps: [
      { text: "In the left menu, press **Settings**.", see: "Your umbrella's settings." },
      { text: "Find **Bug templates** and press **Change**.", see: "Your templates, and **New template**." },
      { text: "Press **New template**. Pick **Start blank**, **Copy one of these templates**, **Copy a Jira bug's layout** or **The ready-made detailed layout**, give it a name, and press **Next**.", see: "The template editor with a live preview." },
      { text: "Add headings with **+ Add heading**: text boxes, choices, file slots or tables.", see: "The preview changing as you go." },
      { text: "Press **Save template**.", see: "Your template in the list. Bugs filed with it get the same headings, and it says what's missing before sending." },
    ],
    next: "start-bash",
  },

  // ───────────── Bug bashes ─────────────
  {
    id: "start-bash",
    group: "Bug bashes",
    title: "Start a bug bash",
    sub: "Everyone explores for a set time and logs bugs",
    words: "bug bash start explore together team session hunt",
    steps: [
      { text: "In the left menu, under **Testing**, press **Bug bashes**.", see: "Past and planned bashes.", target: "menu-bashes" },
      { text: "Press **🐞 Start a bug bash**.", see: "The **Start a bug bash** box.", target: "bash-start" },
      { text: "Type a **Name**, like Checkout bash.", see: "Your name in the box.", target: "bash-name", type: true },
      { text: "Pick **How long** it runs, and **When?**: **Now** or **Pick a date and time**.", see: "Your choices lit up.", target: "bash-length" },
      { text: "Type an area to test, like Checkout, and press Enter. Add a few, or press a suggestion.", see: "Each area as a pill.", target: "bash-areas" },
      { text: "Fill in **Build**, **Environment** and **Link** if people need them, and pick a **Bug template**.", see: "Everyone sees these when they join." },
      { text: "Press **Start bug bash** (or **Schedule bug bash**).", see: "\"Your bash is live. Invite people.\" with the join link.", target: "bash-go", saves: true },
      { text: "Press **Copy link** and send it in chat or email, then press **Open the bash**.", see: "The live board, with the time left.", target: "bash-copy" },
    ],
    next: "join-bash",
  },
  {
    id: "join-bash",
    group: "Bug bashes",
    title: "Join a bug bash and log finds",
    sub: "Pick an area and log bugs in one line",
    words: "join bash log find bug question idea plus one see it too",
    steps: [
      { text: "Open the join link, or press **Join the bash** on the Overview or the bug bash pill in the top bar.", see: "**Pick an area to test**." },
      { text: "Pick an area, then press **Start bashing**.", see: "**Log a bug** in the middle and **Live finds** next to it." },
      { text: "Type what went wrong in one line. Change the kind to **Question**, **Note** or **Idea** if it isn't a bug. Press B anywhere to jump back here.", see: "Look-alike finds float up while you type." },
      { text: "Someone already logged it? Press **+1, I see it too** on their find instead.", see: "Their find with one more person who saw it." },
      { text: "Otherwise press **Log bug**.", see: "Your find at the top of **Live finds** for everyone." },
    ],
    next: "wrap-up-bash",
  },
  {
    id: "wrap-up-bash",
    group: "Bug bashes",
    title: "Wrap up a bug bash",
    sub: "Review, merge and file the bugs",
    words: "wrap up end finish bash file bugs report merge duplicates",
    steps: [
      { text: "Open the bash. Whoever started it can press **End early**, or wait for the time to run out.", see: "The bash in **Wrap up**." },
      { text: "Check each bug. Untick **File it** to leave one out, change its severity, and merge duplicates.", see: "Only the bugs you want ticked." },
      { text: "Press **File … and wrap up** (or **Wrap up** when there's nothing to file).", see: "The bugs filed, and the bash report with **Bugs by area** and **Worst bugs**." },
      { text: "Missed one? Press **File this bug…** on it in the report.", see: "The usual bug box, filled in from the find." },
    ],
    next: "risk-board",
  },
  {
    id: "risk-board",
    group: "Bug bashes",
    title: "Plan with the risk board",
    sub: "What's most likely to break, and how much it would hurt",
    words: "risk board likelihood impact priority plan release",
    steps: [
      { text: "In the left menu, under **Testing**, press **Risk board**.", see: "A 3 by 3 board: how likely to break, against how much it would hurt." },
      { text: "Pick a release.", see: "That release's requirements as cards." },
      { text: "Drag a card to the square that fits it.", see: "The card in its new square, saved for everyone." },
      { text: "Press **Start a bug bash** on the board.", see: "The bash box filled in with the riskiest items first." },
    ],
    next: "reports",
  },

  // ───────────── Results ─────────────
  {
    id: "reports",
    group: "Results",
    title: "See how testing is going",
    sub: "Reports, a summary to paste, and exports",
    words: "reports report summary pass rate export pdf excel confluence status progress",
    steps: [
      { text: "In the left menu, under **Results**, press **Reports**.", see: "**Reports** with a one-line summary: runs, pass rate, open bugs and where most failures are.", target: "menu-reports" },
      { text: "Pick a release, or change the **From** and **To** dates.", see: "Everything on the page follows your choice." },
      { text: "Press **Copy summary** and paste it into chat or email.", see: "The summary line, ready to paste.", target: "reports-copy" },
      { text: "Press a tab like **Trends**, **Failing steps** or **Bugs found** for more detail. **Release status** shows where one release stands.", see: "That report." },
      { text: "Open **Export** and pick PDF, Excel or **Copy for Confluence or email**.", see: "A file, or a neat table that keeps its look when pasted.", target: "reports-export" },
    ],
    next: "custom-report",
  },
  {
    id: "custom-report",
    group: "Results",
    title: "Build your own report",
    sub: "Put together the boxes you need",
    words: "custom report dashboard build own boxes parts",
    steps: [
      { text: "Open **Reports** and find a box you want.", see: "**+ Add to report** on each box." },
      { text: "Press **+ Add to report** and pick a report, or make a new one.", see: "The box added." },
      { text: "Open the **Custom reports** tab.", see: "Your reports." },
      { text: "Open your report to put its parts in your order and add your own notes.", see: "Your report the way you want it, ready to export." },
    ],
    next: "google-sheet",
  },
  {
    id: "google-sheet",
    group: "Results",
    title: "Send results to a Google Sheet",
    sub: "Fill in the columns of a sheet you already use",
    words: "google sheet spreadsheet export sync fill columns",
    steps: [
      { text: "Open the run's page and open **More** at the top right. Press **Google Sheet**.", see: "The **Send results to a Google Sheet** box." },
      { text: "Press **Copy script**. In your Google Sheet, open **Extensions › Apps Script**, replace what's there with it, and save.", see: "The script saved in your sheet." },
      { text: "In Apps Script, click **Deploy › New deployment**, pick **Web app**, set **Who has access** to **Anyone**, and deploy.", see: "A Web app URL from Google." },
      { text: "Paste it into **Web app URL**. Under **How to send**, pick **Fill in my columns** or **A tab of its own**.", see: "Your choice ticked." },
      { text: "Press **Look at the sheet**, check which columns it fills, then press **Link and send**.", see: "Your sheet filled in. Cells someone typed in are never changed." },
    ],
    next: "alerts",
  },
  {
    id: "alerts",
    group: "Results",
    title: "Get Slack posts and email summaries",
    sub: "Tell people how testing went",
    words: "slack email digest alert notify summary channel",
    steps: [
      { text: "In the left menu, press **Settings**.", see: "Your umbrella's settings." },
      { text: "Find **Slack alerts** and press its button, then press **＋ Add channel**.", see: "Steps to connect a Slack channel." },
      { text: "Find **Email digests** and set them up. Press **Send me a sample** to see one.", see: "A sample summary email in your inbox within a minute or two." },
      { text: "Each person picks their own emails in **Your account** → **Emails I get**.", see: "Their choices saved." },
    ],
    next: "invite",
  },

  // ───────────── Settings ─────────────
  {
    id: "invite",
    group: "Settings",
    title: "Invite someone",
    sub: "Add a teammate and send their invite link",
    admins: true,
    words: "invite add member people teammate user join access",
    steps: [
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Members** and press **Manage**.", see: "Everyone on the team, and **Add someone by email**.", target: "settings-members" },
      { text: "Type their email in **Add someone by email**.", see: "Their email in the box.", target: "invite-email", type: true },
      { text: "Pick their role: **Member**, **Lead**, **Admin** or **Viewer**.", see: "The role you picked.", target: "invite-role" },
      { text: "Keep **Email them an invite link** ticked if it's there.", see: "The box ticked." },
      { text: "Press **Add**.", see: "\"… was added as Member\". Without email, a message to send them, with **Copy message**.", target: "invite-add", saves: true },
      { text: "If there's a message, press **Copy message** and paste it into Slack, Teams or an email. The link works once, for 7 days.", see: "\"Copied\"." },
    ],
    next: "roles",
  },
  {
    id: "roles",
    group: "Settings",
    title: "Choose what each role can do",
    sub: "Before you invite people",
    admins: true,
    words: "roles permissions rights access lead viewer member admin",
    steps: [
      { text: "In the left menu, press **Settings**.", see: "Your umbrella's settings." },
      { text: "Scroll down to **What can they do** and open it.", see: "Each thing people can do, with a tick for each role." },
      { text: "Pick a **Preset**: **Everyone** keeps every feature open, **Tighter** holds more back.", see: "The ticks change to match." },
      { text: "Change any tick you like, then press **Save**.", see: "\"Saved\". It applies to the Case library and every test cycle." },
    ],
    next: "connect-jira",
  },
  {
    id: "connect-jira",
    group: "Settings",
    title: "Connect Jira",
    sub: "File bugs straight into Jira",
    admins: true,
    words: "jira connect atlassian api token integration",
    steps: [
      { text: "In the left menu, press **Settings**.", see: "Your umbrella's settings." },
      { text: "Find **Jira connection** and press **Connect**.", see: "The Jira form." },
      { text: "Fill in **Jira site**, **Jira project key**, **Account email** and **API token** (make one at id.atlassian.com). **Issue type** is usually Bug.", see: "Every box filled in." },
      { text: "Press **Connect Jira**.", see: "**✓ Connected**. Every test cycle in the umbrella files bugs there." },
    ],
    next: "connect-github",
  },
  {
    id: "connect-github",
    group: "Settings",
    title: "Connect GitHub and CI uploads",
    sub: "Bring automated results in by themselves",
    admins: true,
    words: "github ci upload token pipeline teamcity actions automation connect repo",
    steps: [
      { text: "In the left menu, press **Settings**.", see: "Your umbrella's settings." },
      { text: "Find **GitHub**, open it, and fill in **Repository**, **Access token**, **Workflow** and **Results files**.", see: "Your repo's details." },
      { text: "Press **Save and test**, then **Save**.", see: "The repo connected. **Repositories** shows up in the left menu." },
      { text: "For any other pipeline, find **CI uploads**, name a token like GitHub Actions and press **+ New token**.", see: "The token and the step to add to your pipeline. Copy it now: it shows once." },
    ],
    next: "tools",
  },
  {
    id: "tools",
    group: "Settings",
    title: "Turn tools on or off",
    sub: "Show only what your team uses",
    admins: true,
    words: "tools features turn on off hide menu",
    steps: [
      { text: "In the left menu, press **Settings**.", see: "Your umbrella's settings." },
      { text: "Find **Tools** and press **Change**.", see: "Every tool, with what it includes." },
      { text: "Tick the tools your team uses and untick the rest.", see: "The left menu changes to match. Nothing is deleted when a tool is off." },
    ],
    next: "add-cycle",
  },
  {
    id: "add-cycle",
    group: "Settings",
    title: "Add a test cycle",
    sub: "A new place for runs, like a platform or sprint",
    words: "test cycle new add platform sprint project",
    steps: [
      { text: "In the left menu, press **Settings**.", see: "Your umbrella's settings, with the **Test cycles** table." },
      { text: "Press **Add test cycle** under the table.", see: "A box for the new test cycle." },
      { text: "Type its **Name** and pick a platform if it has one, then save.", see: "The test cycle in the left menu under **Test runs**." },
      { text: "Quicker: in **Create a run**, press **＋ New test cycle**. It's made with the run.", see: "The run in its new test cycle." },
    ],
    next: "archive",
  },
  {
    id: "archive",
    group: "Settings",
    title: "Archive or restore",
    sub: "Put an umbrella or test cycle away without deleting it",
    admins: true,
    words: "archive restore delete hide remove old",
    steps: [
      { text: "In the left menu, press **Settings**.", see: "Your umbrella's settings." },
      { text: "Scroll down to **Archive** and press **Archive…**, then **Yes, archive**.", see: "It moves to the **Archived** fold on the Umbrellas page. Cases, runs, bugs and reports all stay." },
      { text: "To bring it back, open it from the **Archived** fold, go to its **Settings**, and press **Restore…**, then **Yes, restore**.", see: "Everything back as it was." },
    ],
  },
];

export const howToById = new Map(HOW_TO.map((t) => [t.id, t]));

/** Every Show me target, for the tests that check each one is still on its page. */
export const HOW_TO_TARGETS = [...new Set(HOW_TO.flatMap((t) => t.steps.flatMap((s) => (s.target ? [s.target] : []))))];

/** Tasks that have Show me on their steps. */
export const showMeTasks = () => HOW_TO.filter((t) => t.steps.some((s) => s.target));

/** Plain text of a step, for search and the screen-reader line. */
export const plainText = (s: string) => s.replace(/\*\*/g, "");

/**
 * Tasks that match what someone typed, best first. "how do I write a bug" finds Write a bug:
 * the question words are dropped, then every word must be in the title, line or search words.
 */
export function findHowTo(query: string, tasks: HowToTask[] = HOW_TO): HowToTask[] {
  const words = query
    .toLowerCase()
    .replace(/^\s*(how\s+(do|can|would|should)\s+(i|we|you)|how\s+to|how)\b/, "")
    .replace(/[?.!,]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  if (!words.length) return tasks;
  const scored = tasks.flatMap((t) => {
    const title = t.title.toLowerCase();
    const all = `${title} ${t.sub.toLowerCase()} ${t.words ?? ""} ${t.group.toLowerCase()} ${t.steps.map((s) => plainText(s.text)).join(" ").toLowerCase()}`;
    // A word counts when it starts a word in the text, so "bug" finds "bugs" but not "debug".
    const has = (text: string, w: string) => new RegExp(`(^|[^a-z])${w.replace(/[^a-z0-9]/g, "")}`).test(text);
    if (!words.every((w) => has(all, w))) return [];
    const score = words.filter((w) => has(title, w)).length * 3 + words.filter((w) => has(`${t.sub} ${t.words ?? ""}`.toLowerCase(), w)).length;
    return [{ t, score }];
  });
  return scored.sort((a, b) => b.score - a.score).map((x) => x.t);
}

const STOP = new Set(["a", "an", "the", "i", "my", "to", "do", "in", "on", "of", "for", "it", "is", "can", "with", "and", "or", "from", "into", "up", "get", "make", "use"]);

/** Typing these in Search shows the guide first. */
export const isHowToQuery = (q: string) => /^\s*(how\b|help\b|guide\b|tutorial\b)/i.test(q);
