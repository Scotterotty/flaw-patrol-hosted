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

export const HOW_TO_GROUPS = ["Start here", "Write tests", "Run tests", "Bugs", "Bug bashes", "Results", "Settings", "Make it yours"] as const;
/** "Start here" (ver_178): the first day, in the order you'd do it. */
export const HOW_TO_START = ["find-your-way", "import-cases", "write-case", "create-run", "test-case", "report-bug", "invite", "search"];
export type HowToGroup = (typeof HOW_TO_GROUPS)[number];

/** Every task has Show me on the steps that have a button to point at (ver_174 did 13, ver_175 the rest). ver_176 added a task for every feature that had none (Scott: every feature goes in the guide, so a new feature adds its task in the same build). */
export const HOW_TO: HowToTask[] = [
  // ───────────── Get started ─────────────
  {
    id: "find-your-way",
    group: "Start here",
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
    group: "Start here",
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
    group: "Make it yours",
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
    group: "Make it yours",
    title: "Set up your profile and password",
    sub: "Your name, picture and password",
    words: "name avatar photo picture password account email",
    steps: [
      { text: "Click your name at the top right.", see: "Your account menu.", target: "top-account" },
      { text: "Choose **Your account**.", see: "**Your account**, with cards that fold open.", target: "account-page" },
      { text: "Open **Your profile**. Type your name and add a picture if you like.", see: "Your name and picture next to your results and bugs.", target: "account-profile" },
      { text: "Open **Password** to set or change your password.", see: "**Set** and the date you last changed it.", target: "account-password" },
      { text: "Open **Language** to choose **US English** or **UK English** spelling and how dates look.", see: "Spelling and dates the way you picked.", target: "account-language" },
      { text: "Open **Emails I get** to choose which summary emails you get.", see: "Your choices saved. Every email also has a Stop link.", target: "account-emails" },
    ],
    next: "accessibility",
  },
  {
    id: "accessibility",
    group: "Make it yours",
    title: "Make it easier to see and use",
    sub: "Text size, contrast, color vision, motion",
    words: "accessibility color blind colour vision contrast bigger text motion underline",
    steps: [
      { text: "Click your name at the top right.", see: "Your account menu.", target: "top-account" },
      { text: "Choose **Your account**.", see: "**Your account**, with cards that fold open.", target: "account-page" },
      { text: "Open the **Accessibility** card.", see: "**Text size**, **Color vision**, **Reduce motion**, **Stronger contrast** and **Underline links**.", target: "account-accessibility" },
      { text: "Pick a **Text size**.", see: "Bigger or smaller text everywhere.", target: "access-text-size" },
      { text: "Under **Color vision**, pick the option that suits you.", see: "**How statuses look now** shows Passed, Failed and the rest with shapes and patterns, so they never rely on color alone.", target: "access-vision" },
      { text: "Turn on **Reduce motion**, **Stronger contrast** or **Underline links** if they help.", see: "The change straight away. This guide's glow stops pulsing too when Reduce motion is on.", target: "access-aids" },
    ],
    next: "arrange-menu",
  },
  {
    id: "arrange-menu",
    group: "Make it yours",
    title: "Put the left menu in your order",
    sub: "Drag links into the order you use them",
    words: "menu order arrange drag reorder sidebar",
    steps: [
      { text: "At the bottom of the left menu, press **Arrange menu order**.", see: "A note at the top, and a ⠿ grip next to each link.", target: "arrange-menu" },
      { text: "Drag a link by its ⠿ grip up or down. With the keyboard, focus the grip and press ↑ or ↓.", see: "The link in its new place. Links stay in their own section.", target: "arrange-grip" },
      { text: "Changed your mind? **Reset to default order** puts the menu back the way it was.", see: "The menu back in its first order.", target: "arrange-reset" },
      { text: "Press **Done**.", see: "Your order. Only you see it.", target: "arrange-done" },
    ],
    next: "whats-new",
  },
  {
    id: "whats-new",
    group: "Make it yours",
    title: "See what's new",
    sub: "What changed in the latest versions",
    words: "release notes changes updates version",
    steps: [
      { text: "Click your name at the top right.", see: "Your account menu.", target: "top-account" },
      { text: "Choose **What's new**.", see: "Every version, newest at the top, in plain words.", target: "account-whats-new" },
      { text: "Press **Show me** on an item to go straight to it.", see: "The page with the new thing on it.", target: "whats-new-show-me" },
    ],
    next: "write-case",
  },

  {
    id: "send-feedback",
    group: "Make it yours",
    title: "Send feedback about Flaw Patrol",
    sub: "Tell us what's wrong or what would help, with a picture",
    words: "feedback suggestion idea complain report problem screenshot reply",
    steps: [
      { text: "Press **Feedback** in the top bar, on any page.", see: "**Take a screenshot of this page**, **Add my own picture**, **Just write a note** and **See feedback**.", target: "top-feedback" },
      { text: "Pick **Take a screenshot of this page** to draw on the page, or **Just write a note**.", see: "The **Send feedback** box.", target: "feedback-note" },
      { text: "Write what happened, or what would make it better.", see: "Your words in the box. Tick **Send without my name** if you like.", target: "feedback-message", type: true },
      { text: "Press **Send feedback**.", see: "**Thanks for the feedback**.", target: "feedback-send", saves: true },
      { text: "Later, open **Feedback** again and press **See feedback** to read replies. A red dot means there's a new one.", see: "What you've sent, where each one is at, and any replies.", target: "feedback-see" },
    ],
    next: "jira-account",
  },
  {
    id: "jira-account",
    group: "Make it yours",
    title: "Use your own Jira account for bugs",
    sub: "So bugs you file show you as the Reporter",
    words: "jira email account reporter my name filed by",
    steps: [
      { text: "Click your name at the top right.", see: "Your account menu.", target: "top-account" },
      { text: "Choose **Your account**.", see: "**Your account**, with cards that fold open.", target: "account-page" },
      { text: "Open **Jira**.", see: "The email Flaw Patrol uses for you in Jira. It starts as your sign-in email.", target: "account-jira" },
      { text: "If you use another email in Jira, type it and save.", see: "**Uses** and your Jira email on the card. Bugs you file show you as their Reporter." },
    ],
    next: "radio",
  },
  {
    id: "radio",
    group: "Make it yours",
    title: "Play the radio while you test",
    sub: "Free music stations in a small player",
    words: "music radio spotify pandora lofi listen sound player",
    steps: [
      { text: "Click your name at the top right.", see: "Your account menu.", target: "top-account" },
      { text: "Choose **Your account**.", see: "**Your account**, with cards that fold open.", target: "account-page" },
      { text: "Open **Radio**.", see: "**Show the radio player**, and a box for your own Spotify links.", target: "account-radio" },
      { text: "Tick **Show the radio player**.", see: "A radio button in the bottom corner of every page.", target: "radio-on" },
      { text: "Press the radio button in the corner and pick a station. Drag the player by its grip if it's in the way.", see: "The station playing in a small window that keeps going while you work." },
    ],
  },
  {
    id: "older-cycles",
    group: "Run tests",
    title: "Find an older test cycle",
    sub: "Open a test cycle that's no longer current, or keep it in the menu",
    words: "older old previous past test cycle project pin keep current",
    steps: [
      { text: "In the left menu, under **Test runs**, press **Older test cycles**. (It's there once an umbrella has older ones.)", see: "**Test cycles**: the newest one for each platform is current, the rest are older.", target: "menu-older-cycles" },
      { text: "Click a test cycle's name to open it.", see: "That test cycle's page. While you're in it, it shows under **Older test cycles** in the menu." },
      { text: "To keep one in the menu, press **⋯** on its row.", see: "**📌 Keep in Current**, **Settings** and **Archive…**.", target: "cycle-more" },
      { text: "Choose **📌 Keep in Current**.", see: "A ✓ next to it, and the test cycle listed under **Test runs** again." },
    ],
  },
  // ───────────── Write tests ─────────────
  {
    id: "write-case",
    group: "Start here",
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
    group: "Start here",
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
      { text: "In the left menu, under **Library**, press **Case library**.", see: "Your cases, with folders on the left.", target: "menu-cases" },
      { text: "Click the case's name.", see: "The case's page with its steps and **Version history** on the right.", target: "case-row" },
      { text: "Press **Edit** at the top right.", see: "The **Edit case** page.", target: "case-edit" },
      { text: "Make your change. In **What changed? (optional)**, write a short note, like Updated expected text for new checkout.", see: "Your note under the steps.", target: "case-change-note", type: true },
      { text: "Press **Save new version**.", see: "The case with a new version at the top of **Version history**. Past runs keep the version they ran.", target: "case-save", saves: true },
      { text: "To look back, click an older **Version** in **Version history**.", see: "That version and what changed.", target: "case-version" },
      { text: "To bring it back, press **Restore this version**.", see: "A new version with the old steps.", target: "case-restore", saves: true },
      { text: "Need a copy or want it out of the way? Open **More** at the top and press **Duplicate** or **Archive case**.", see: "A copy to edit, or the case moved to archived. Archived cases can be restored.", target: "case-more" },
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
      { text: "In the left menu, under **Library**, press **Case library**.", see: "The folder list on the left and your cases on the right.", target: "menu-cases" },
      { text: "Press **+ New** at the top of **Folders**, type a name and press Enter. A folder's ⋯ menu renames or moves it.", see: "The new folder in the list.", target: "folders-new" },
      { text: "To move cases, tick them in the list.", see: "How many are ticked, and **Move to folder…** above the list.", target: "case-tick" },
      { text: "Pick a folder in **Move to folder…**. You can also drag ticked cases onto a folder.", see: "The cases in their new folder.", target: "cases-move" },
      { text: "To tag a case, start its **Title** with a word in brackets, like [WEB] or [CHECKOUT], or add tags when editing it.", see: "A tag pill on the case." },
      { text: "Click a tag, or use the filters above the list, to see only those cases.", see: "Only the matching cases, with how many there are.", target: "cases-filters" },
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
      { text: "In the left menu, under **Library**, press **Shared steps**.", see: "Every shared step and how many cases use it.", target: "menu-shared" },
      { text: "Press **New shared step**.", see: "The **New shared step** page.", target: "shared-new" },
      { text: "Type a **Name**, like Log in as {{role}}. A word in {{double braces}} is a blank each case can fill in.", see: "Your name. Blanks show under **Parameters**.", target: "shared-name", type: true },
      { text: "Under **Steps**, type the **Action** and the **Expected result**.", see: "Step 1 filled in.", target: "shared-step", type: true },
      { text: "Press **+ Add step** for each next step.", see: "Your steps listed in order.", target: "shared-add-step" },
      { text: "Press **Create shared step**.", see: "The shared step's page.", target: "shared-save", saves: true },
      { text: "To use it in a case, press **Case library** in the left menu.", see: "Your cases.", target: "menu-cases" },
      { text: "Click the case's name.", see: "The case's page.", target: "case-row" },
      { text: "Press **Edit**.", see: "The **Edit case** page.", target: "case-edit" },
      { text: "Press **+ Insert shared step** under the steps. Pick it, fill in any blanks, and press **Add … steps**.", see: "The shared steps in your case as 3.1, 3.2 and so on. Changing the shared step later updates every case.", target: "case-insert-shared" },
      { text: "Already wrote the steps in a case? On its **Edit case** page, tick the steps you want to share.", see: "**Make shared step from** the number you ticked, above the steps.", target: "case-step-tick" },
      { text: "Press **Make shared step from … selected**.", see: "A **Make a shared step** box. Save it to turn them into one.", target: "case-make-shared" },
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
      { text: "In the left menu, under **Library**, press **Case library**.", see: "Your cases.", target: "menu-cases" },
      { text: "Click the case's name.", see: "The case's page.", target: "case-row" },
      { text: "Press **Edit**.", see: "The **Edit case** page.", target: "case-edit" },
      { text: "Change a step to use a blank in double braces, like Sign in as {{role}}.", see: "Your step with the blank.", target: "case-step", type: true },
      { text: "Under the steps, press **+ Add test data**.", see: "A small table with a column for each blank.", target: "case-add-data" },
      { text: "Press **+ Add row** for each value, like admin, viewer and guest. Or press **Paste rows from a sheet** and paste from Excel or Google Sheets.", see: "One row per value.", target: "data-add-row" },
      { text: "Press **Save new version**.", see: "The test data table on the case's page.", target: "case-save", saves: true },
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
      { text: "In the left menu, under **Library**, press **Charters**.", see: "Every charter, plus the test personas you can explore as.", target: "menu-charters" },
      { text: "Press **New charter**.", see: "**Blank charter** and **From a tour or checklist…** for a ready-made one.", target: "charters-new" },
      { text: "Pick **Blank charter**.", see: "The **New charter** page.", target: "charters-blank" },
      { text: "Fill in **Explore** (where to look), **With** (what to use) and **To discover** (what you want to learn). Pick a **Time limit**.", see: "Your mission written out.", target: "charter-mission" },
      { text: "Press **Create charter**.", see: "The charter's page.", target: "case-save", saves: true },
      { text: "Press **▶ Start exploring**.", see: "The **Start exploring** box with the time and who explores.", target: "charter-start" },
      { text: "Check the time and who explores, then press **Start exploring**.", see: "A timer at the top and a log for notes, bugs, questions and ideas.", target: "charter-start-go", saves: true },
      { text: "Type what you notice and press Enter. Change the kind to **Bug**, **Question** or **Idea** before you log it.", see: "Each entry in the log with its time.", target: "charter-log", type: true },
      { text: "Press **Finish exploring** and say how it went.", see: "**Finish exploring**, with how much of the time you used.", target: "charter-finish" },
      { text: "Press **Finish**.", see: "The session saved to the run and the charter's history.", target: "charter-finish-save", saves: true },
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
      { text: "In the left menu, under **Library**, press **Requirements**. (It needs Jira connected.)", see: "Every Jira story or Epic, next to the cases that test it, with results and open bugs.", target: "menu-stories" },
      { text: "Find a requirement with no cases.", see: "It says so on its row." },
      { text: "Press **+ New case** on its row. Type a few titles, then write their steps one after another.", see: "The new cases, already linked.", target: "story-new-case" },
      { text: "Or press **Add existing cases** to link cases you already have.", see: "The cases listed under the requirement.", target: "story-add-existing" },
      { text: "To link from a case instead, press **Case library** in the left menu.", see: "Your cases.", target: "menu-cases" },
      { text: "Click the case's name.", see: "The case's page, with **Requirements** on the right.", target: "case-row" },
      { text: "Press **+ Link requirement** on the right and pick one.", see: "The requirement listed on the case.", target: "case-link-req" },
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
      { text: "Press **Look it up**, or press G.", see: "What the word means, if the team has written it down.", target: "glossary-lookup" },
      { text: "Nobody has explained it yet? The button says **Look it up / Add to Glossary**. Write a plain meaning and press **Add term**, or press **Ask the team** if you don't know it.", see: "The word in the Glossary, with a dotted underline wherever it shows up." },
      { text: "To see every word, press **Glossary** under **Library** in the left menu.", see: "The whole list.", target: "menu-glossary" },
      { text: "Press **+ Add a term** to add one from here.", see: "The **Add a term** box.", target: "glossary-add" },
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
      { text: "In the left menu, under **Library**, press **Case library**.", see: "Your cases.", target: "menu-cases" },
      { text: "Click the case's name. (In a run, the **Flag** button is next to the case's title too.)", see: "A **Flag** button near the case's title.", target: "case-row" },
      { text: "Press **Flag**.", see: "The **Flag this case** box.", target: "case-flag" },
      { text: "Pick the reason, like **Needs updating**, and add a short note.", see: "Your reason and note.", target: "flag-reason" },
      { text: "Press **Flag case**.", see: "An orange flag on the case. **Flagged cases** on the Overview lists every flagged one.", target: "flag-save", saves: true },
      { text: "Once it's fixed, press the flag again and clear it.", see: "The flag gone.", target: "case-flag" },
    ],
    next: "create-run",
  },

  {
    id: "bulk-edit-cases",
    group: "Write tests",
    title: "Change many cases at once",
    sub: "Priority, type, persona and tags on every ticked case",
    words: "bulk edit many several cases priority type tags persona mass change update",
    steps: [
      { text: "In the left menu, under **Library**, press **Case library**.", see: "Your cases.", target: "menu-cases" },
      { text: "Tick the cases you want to change.", see: "How many are ticked, and buttons above the list.", target: "case-tick" },
      { text: "Press **Edit fields…**.", see: "The **Edit … cases** box. \"Leave as is\" keeps each case's own value.", target: "cases-edit-fields" },
      { text: "Change **Priority**, **Type** or **Persona**, or add or remove tags.", see: "A line saying what will change.", target: "bulk-priority" },
      { text: "Press **Update … cases**.", see: "The cases changed. Each changed case gets a new version.", target: "bulk-update", saves: true },
    ],
    next: "personas",
  },
  {
    id: "personas",
    group: "Write tests",
    title: "Make test personas",
    sub: "The people you pretend to be while you explore",
    words: "persona personas user type role play pretend player customer",
    steps: [
      { text: "In the left menu, under **Library**, press **Charters**.", see: "**Charters** and **Personas** tabs.", target: "menu-charters" },
      { text: "Press the **Personas** tab.", see: "Every persona, with **Write charter as** on each.", target: "charters-personas" },
      { text: "Press **+ New persona**.", see: "The **New persona** box.", target: "persona-new" },
      { text: "Type a **Name**, like First-time player, pick an icon, and say what they're like.", see: "Your persona filled in.", target: "persona-name", type: true },
      { text: "Press **Add persona**.", see: "The persona on the board. Press **Write charter as** on it to explore as them.", target: "persona-save", saves: true },
    ],
    next: "charter-reminders",
  },
  {
    id: "charter-reminders",
    group: "Write tests",
    title: "Add reminders to a charter",
    sub: "Nudges during a session, like check the time or try offline",
    words: "reminder remind alert nudge timer charter session every minutes",
    steps: [
      { text: "In the left menu, under **Library**, press **Charters**.", see: "Every charter.", target: "menu-charters" },
      { text: "Press **New charter**, or open a charter and press **Edit**.", see: "The charter, with **Reminders** under the mission.", target: "charters-new" },
      { text: "Pick **Blank charter** if you're making a new one.", see: "The **New charter** page.", target: "charters-blank" },
      { text: "Under **Reminders**, press **+ Add reminder**.", see: "A row: **Every** or **Once at**, the minutes, and what to do.", target: "add-reminder" },
      { text: "Pick when it goes off and type what to do, like Try it offline.", see: "Your reminder in the row." },
      { text: "Save the charter.", see: "The reminders go off during every session of this charter.", target: "case-save", saves: true },
    ],
  },
  // ───────────── Run tests ─────────────
  {
    id: "create-run",
    group: "Start here",
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
    group: "Start here",
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
      { text: "In the left menu, under **Testing**, press **Test runs**.", see: "The active runs.", target: "menu-runs" },
      { text: "Click the run's name.", see: "Every case in the run, with **Assigned to**.", target: "run-row" },
      { text: "Tick the cases you want to hand out, or tick the box at the top to tick every case shown.", see: "How many are ticked, and **Assign … selected to…** above the list.", target: "run-tick-all" },
      { text: "Open **Assign … selected to…** and pick a person.", see: "Their name next to each ticked case.", target: "run-assign" },
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
      { text: "Test a case that had bugs in earlier runs.", see: "A yellow **Known bugs** box at the top of the case.", target: "runner-known-bugs" },
      { text: "Check each bug while you test.", see: "Each bug with its status from Jira." },
      { text: "Press **Still happens** if you see it again.", see: "Its step fails and links the same bug. Nothing new is filed.", target: "known-still" },
      { text: "Or press **Didn't happen** if you don't.", see: "It's noted for this run. Jira isn't changed.", target: "known-gone" },
      { text: "Press **Save and next**.", see: "Your check saved on the bug's history.", target: "runner-save", saves: true },
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
      { text: "In the left menu, under **Testing**, press **Test runs**.", see: "The active runs.", target: "menu-runs" },
      { text: "Click the run's name.", see: "A **Retest** button at the top, with how many cases didn't pass.", target: "run-row" },
      { text: "Press **Retest … not passed**.", see: "A new run box, already named with (retest).", target: "run-retest" },
      { text: "Check the name, release and who it's assigned to, then press **Create run**.", see: "A new run with only those cases.", target: "new-run-go", saves: true },
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
      { text: "In the left menu, under **Testing**, press **Test runs**.", see: "The active runs.", target: "menu-runs" },
      { text: "Click the run's name.", see: "Once every case has a result, a green note and **Close run** at the top.", target: "run-row" },
      { text: "If **Close run** isn't at the top, open **More** at the top right.", see: "**Close run** in the list.", target: "run-more" },
      { text: "Press **Close run**. It asks first if some cases haven't been tested.", see: "The run marked **Closed**. It moves to the **Closed** tab in **Test runs**.", target: "run-close", saves: true },
      { text: "To change something later, open the run, open **More** and press **Reopen run**.", see: "The run active again.", target: "run-reopen" },
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
      { text: "In the left menu, under **Testing**, press **Test runs**.", see: "**Bring in results** at the top right.", target: "menu-runs" },
      { text: "Open **Bring in results**.", see: "**Automated test results** and **Results from a spreadsheet**.", target: "runs-bring-in" },
      { text: "Choose **Automated test results**.", see: "The upload box: **1. Drop the file**, **2. Where they go**, **3. Check and save**.", target: "bring-automated" },
      { text: "Drop the results file (or a folder or .zip with screenshots and videos), or press **pick files**.", see: "How many tests were found.", target: "upload-drop", type: true },
      { text: "Pick the test cycle the results go to, or make a new one.", see: "The test cycle ticked.", target: "upload-where" },
      { text: "Press **Next: check results**.", see: "Each test matched to a case with the same name, or offered **Link** or **Make new case**.", target: "upload-check" },
      { text: "Press **Save … results**.", see: "A 🤖 Automated run with every result. Failed Playwright tests show their screenshot, video and replay.", target: "upload-save", saves: true },
    ],
    next: "update-run-sheet",
  },
  {
    id: "update-run-sheet",
    group: "Run tests",
    title: "Bring in results from a spreadsheet",
    sub: "Results tracked in Excel or Google Sheets: a new run, or update one in progress",
    words: "update run from sheet spreadsheet excel google csv xlsx in progress overwrite replace results create a run import tracked by hand bring in manual",
    steps: [
      { text: "In the left menu, under **Testing**, press **Test runs**.", see: "Every run, with **Create a run** at the top right.", target: "menu-runs" },
      { text: "Press **Create a run**.", see: "The **Create a run** box.", target: "run-create" },
      { text: "In an umbrella, pick **What kind of run?**, like **Smoke test**.", see: "The kind you picked, with **Change** next to it.", target: "run-kind" },
      { text: "Under **What to run**, pick **From a spreadsheet**.", see: "A box to drop your sheet in.", target: "run-sheet" },
      { text: "Drop your .csv or .xlsx in the box, or click it to choose a file.", see: "The file's name and how many rows it has.", target: "run-sheet-file", type: true },
      { text: "Under **Where it goes**, pick **Update a run in progress** and the run, or **A new run**.", see: "Your choice lit up.", target: "run-sheet-where" },
      { text: "Press **Next: check the sheet**.", see: "The **Import a run** page with your sheet loaded. Press **Update … results** (or **Create run with … cases**) there. Already in a run? Use **More** → **Bring in results from a sheet** on its page.", target: "run-sheet-next", saves: true },
      { text: "Already on a run's page? Open **More** → **Bring in results from a sheet** (under **Spreadsheet**) instead. **Test runs** → **Bring in results** → **Results from a spreadsheet** goes to the same place.", see: "The same **Import a run** page, set to update that run." },
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
      { text: "In the left menu, under **Results**, press **Repositories**.", see: "Each connected GitHub repo and how its tests are doing.", target: "menu-repos" },
      { text: "Press **⬇ Pull from GitHub**.", see: "The **Pull from GitHub** box with recent workflow runs.", target: "repos-pull" },
      { text: "Pick a workflow run.", see: "The run ticked.", target: "pull-pick" },
      { text: "Press **Next**, then pick where the results go. **+ New test cycle** makes a place for them.", see: "The results checked the same way as an upload.", target: "pull-next" },
      { text: "Press **Save … results**.", see: "A 🤖 Automated run you can open, with failed tests first.", target: "upload-save", saves: true },
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
      { text: "In the left menu, press **Overview**.", see: "The umbrella's home page.", target: "menu-overview" },
      { text: "Press **▶ Create a run**.", see: "The **Create a run** box.", target: "run-create" },
      { text: "Under **What kind of run?**, pick **Release candidate**.", see: "The release box, which makes one test cycle per platform.", target: "run-kind" },
      { text: "Type the release name, like 2.1.", see: "Your release name.", target: "rc-name", type: true },
      { text: "Pick the platforms and what to run, then press **Start** (it names the release, like Start 2.1).", see: "A test cycle and a run for each platform.", target: "rc-go", saves: true },
      { text: "Watch it from **Reports** → **Release status**, or **Release status** under Shortcuts on the Overview.", see: "Where each platform stands for that release.", target: "menu-reports" },
      { text: "Press the **Release status** tab.", see: "Each platform for that release, side by side.", target: "reports-release" },
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
      { text: "Press **📷 Take screenshot** and pick the window or screen to share.", see: "The picture attached to the case.", target: "runner-screenshot" },
      { text: "Press **Record screen**, do what you need, then stop sharing in your browser.", see: "The video attached, ready to add to a bug.", target: "runner-record" },
      { text: "Or press **Attach file to case** to add a file from your computer.", see: "The file listed on the case.", target: "runner-attach" },
    ],
    next: "report-bug",
  },

  {
    id: "edit-run",
    group: "Run tests",
    title: "Change, export or delete a run",
    sub: "Fix its name or release, save it as a spreadsheet, or remove it",
    words: "edit run details rename release build environment notes export spreadsheet excel download delete remove",
    steps: [
      { text: "In the left menu, under **Testing**, press **Test runs**.", see: "The active runs.", target: "menu-runs" },
      { text: "Click the run's name.", see: "The run's page.", target: "run-row" },
      { text: "Open **More** at the top right.", see: "**Edit details**, then **Spreadsheet** with **Download as Excel** and **Send to a Google Sheet**, then **Close run**.", target: "run-more" },
      { text: "Press **Edit details**.", see: "The **Edit run details** box: **Run name**, **Release**, **Environment**, **Build** and **Notes**.", target: "run-edit" },
      { text: "Change what's wrong and press **Save**. Results stay as they are.", see: "The run with its new details.", target: "run-edit-save", saves: true },
      { text: "To save a copy, open **More** again.", see: "**Download as Excel** under **Spreadsheet**.", target: "run-more" },
      { text: "Press **Download as Excel**.", see: "An .xlsx file of the run with every result.", target: "run-export" },
      { text: "To remove the run, open **More** again.", see: "**Delete** at the bottom of the list.", target: "run-more" },
      { text: "Press **Delete**. It asks first, and it can't be undone.", see: "**Test runs** again, without that run.", target: "run-delete", saves: true },
    ],
  },
  {
    id: "take-over",
    group: "Run tests",
    title: "Take over a case someone else is testing",
    sub: "Pick up where a teammate left off, or hand a case back",
    words: "take over assignee someone else on this case stop testing hand back release",
    steps: [
      { text: "In the left menu, under **Testing**, press **Test runs**.", see: "The active runs.", target: "menu-runs" },
      { text: "Click the run's name.", see: "Every case, with who's on it.", target: "run-row" },
      { text: "Press **Start testing**, or **Test** on the case.", see: "The runner. A line at the top says who is on this case.", target: "run-start-testing" },
      { text: "If a teammate is on it, press **Take it over**.", see: "You're on the case now. Your teammate sees that you took it.", target: "take-over" },
      { text: "To hand a case back, press **Stop testing**.", see: "Nobody on the case. Results you marked stay.", target: "stop-testing" },
    ],
  },
  {
    id: "regression",
    group: "Run tests",
    title: "Spot regressions",
    sub: "Tests that passed in an earlier release and fail now",
    words: "regression regressed used to pass broke again compare previous release flag",
    steps: [
      { text: "An Admin turns it on once: in the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Regression flag** and press **Change**.", see: "**Flag tests that passed before and fail now**, **Compare with** and **Jira label**.", target: "settings-regression" },
      { text: "Tick **Flag tests that passed before and fail now**.", see: "The box ticked.", target: "regression-on" },
      { text: "Pick what to **Compare with** and press **Save**.", see: "**On** and what it compares with on the row.", target: "regression-save", saves: true },
      { text: "Now open a run: under **Testing**, press **Test runs** and click the run's name.", see: "A pink **!** on each case that passed before and fails now, and how many regressions above the list.", target: "menu-runs" },
      { text: "Click the run's name.", see: "**… regressions compared with** above the cases.", target: "run-row" },
      { text: "Pick another release in **Compare with** to check against it.", see: "The regressions against that release.", target: "run-compare" },
      { text: "For every run at once, press **Reports** under **Results**, then the **Regression** tab.", see: "Every regression in the release you picked.", target: "menu-reports" },
      { text: "Press the **Regression** tab.", see: "The regressions, newest first.", target: "report-regression" },
    ],
  },
  // ───────────── Bugs ─────────────
  {
    id: "report-bug",
    group: "Start here",
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
    next: "link-bug",
  },
  {
    id: "link-bug",
    group: "Bugs",
    title: "Link a bug that's already filed",
    sub: "When a failed step is a bug someone already found",
    words: "link existing bug duplicate already filed jira key same bug search",
    start: "Start in the runner, on a failed step (see Report a bug from a failed step).",
    steps: [
      { text: "Press **Report bug** under the failed step.", see: "The **Report a bug** box.", target: "runner-report-bug" },
      { text: "Press **Link existing bug** at the top.", see: "A search box, with bugs already found in this run listed first under it, tagged **In this run**.", target: "bug-tab-link" },
      { text: "Type a few words, or paste a Jira key or link like QA-123.", see: "Only the matching bugs from this run and from Jira.", target: "link-bug-search", type: true },
      { text: "Press **Link** on the right bug.", see: "The bug's key on the step. Nothing new is filed." },
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
      { text: "Pick a template. The first one is your team's bug layout from **Settings → Bug templates**; **Plain** is three boxes to write in.", see: "The template's boxes.", target: "write-bug-template" },
      { text: "If you're asked **Is this bug about …?**, press **Yes** to fill in its usual answers (tag, Team, Client/SKUs), or **No, start blank** for a bug about another product.", see: "The answers filled in, or left blank." },
      { text: "Type a short **Summary** that says what's wrong.", see: "Your summary.", target: "bug-summary", type: true },
      { text: "Fill in the template's boxes (with **Plain**: **Steps to reproduce**, **What happened** and **What you expected**), then pick a **Severity**.", see: "Every box filled in. Anything still needed is listed by the save button." },
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
      { text: "In the left menu, under **Results**, press **Bugs**.", see: "Every open bug across your test cycles.", target: "menu-bugs" },
      { text: "Type in **Search bugs, Jira keys or case IDs**, or press a chip like **Critical**, **Written on its own** or a platform.", see: "Only the matching bugs.", target: "bugs-search", type: true },
      { text: "Press **Open** to switch to **Open and closed**.", see: "Fixed and closed bugs too.", target: "bugs-open" },
      { text: "If some bugs aren't in Jira yet, press **Send them to Jira** in the yellow note.", see: "Only the bugs that aren't in Jira.", target: "bugs-send-jira" },
      { text: "Press **Send to Jira** on a bug.", see: "The bug's Jira key on its row.", target: "bug-send-jira" },
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
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Bug templates** and press **Change**.", see: "Your templates, and **New template**.", target: "settings-bug-templates" },
      { text: "Press **New template**.", see: "The **New template** box.", target: "templates-new" },
      { text: "Pick **Start blank**, **Copy one of these templates**, **Copy a Jira bug's layout** or **The ready-made detailed layout**.", see: "Your choice ticked.", target: "template-start" },
      { text: "Give it a **Name**, like Crash or freeze.", see: "Your name in the box.", target: "template-name", type: true },
      { text: "Press **Next**.", see: "The template editor with a live preview.", target: "template-next" },
      { text: "Add headings with **+ Add heading**: text boxes, choices, file slots or tables.", see: "The preview changing as you go.", target: "template-add-heading" },
      { text: "Press **Save template**.", see: "Your template in the list. Bugs filed with it get the same headings, and it says what's missing before sending.", target: "template-save", saves: true },
    ],
    next: "bug-defaults",
  },
  {
    id: "bug-defaults",
    group: "Bugs",
    title: "Set a test cycle's bug starting values",
    sub: "The [TAG] in bug titles, Jira Team, clients and environment",
    words: "bug defaults starting values title tag client tag brackets team client skus oly environment oko layout platform presets",
    steps: [
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your test cycle's settings.", target: "menu-settings" },
      { text: "Find **Bug templates** and press **Change**.", see: "Your templates.", target: "settings-bug-templates" },
      { text: "On the first template, press **Change layout…**. The starting values are part of the OKO bug layout.", see: "**Starting values for bugs from this test cycle**.", target: "template-change-layout" },
      { text: "Type the **Tag at the start of bug titles**, usually the platform, like UNREAL.", see: "The tag in the preview's title.", target: "defaults-tag", type: true },
      { text: "Under **Clients to tick in Jira**, click the clients these bugs are for. Click again to remove one.", see: "A check mark on each one you picked.", target: "defaults-clients" },
      { text: "Check the preview. Testers can still change any of these on each bug, and **Write a bug** asks before using them.", see: "A new bug's title and Jira fields.", target: "defaults-preview" },
      { text: "Press **Save defaults**.", see: "**Saved.** New bugs from this test cycle start with these.", target: "defaults-save", saves: true },
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
      { text: "Open the join link, or press **Join the bash** on the Overview or the bug bash pill in the top bar.", see: "**Pick an area to test**.", target: "bash-join" },
      { text: "Pick an area.", see: "The area ticked, with who else is in it.", target: "bash-pick-area" },
      { text: "Press **Start bashing**.", see: "**Log a bug** in the middle and **Live finds** next to it.", target: "bash-start-bashing", saves: true },
      { text: "Type what went wrong in one line. Change the kind to **Question**, **Note** or **Idea** if it isn't a bug. Press B anywhere to jump back here.", see: "Look-alike finds float up while you type.", target: "bash-log", type: true },
      { text: "Someone already logged it? Press **+1, I see it too** on their find instead.", see: "Their find with one more person who saw it.", target: "bash-plus-one" },
      { text: "Otherwise press **Log bug**.", see: "Your find at the top of **Live finds** for everyone.", target: "bash-log-go", saves: true },
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
      { text: "Open the bash. Whoever started it can press **End early**, or wait for the time to run out.", see: "The bash in **Wrap up**.", target: "bash-end-early" },
      { text: "Check each bug. Untick **File it** to leave one out, change its severity, and merge duplicates.", see: "Only the bugs you want ticked.", target: "wrap-file-it" },
      { text: "Press **File … and wrap up** (or **Wrap up** when there's nothing to file).", see: "The bugs filed, and the bash report with **Bugs by area** and **Worst bugs**.", target: "wrap-go", saves: true },
      { text: "Missed one? Press **File this bug…** on it in the report.", see: "The usual bug box, filled in from the find.", target: "bash-file-this" },
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
      { text: "In the left menu, under **Testing**, press **Risk board**.", see: "A 3 by 3 board: how likely to break, against how much it would hurt.", target: "menu-risk" },
      { text: "Pick a release.", see: "That release's requirements as cards.", target: "risk-release" },
      { text: "Drag a card to the square that fits it, or click it to pick.", see: "The card in its new square, saved for everyone.", target: "risk-card" },
      { text: "Press **Start a bug bash** on the board.", see: "The bash box filled in with the riskiest items first.", target: "bash-start" },
    ],
    next: "reports",
  },

  {
    id: "schedule-bash",
    group: "Bug bashes",
    title: "Change or cancel a planned bug bash",
    sub: "Add it to your calendar, move it, or call it off",
    words: "schedule scheduled planned later calendar invite outlook google move time cancel bug bash",
    steps: [
      { text: "In the left menu, under **Testing**, press **Bug bashes**.", see: "Planned bashes at the top, with their start time.", target: "menu-bashes" },
      { text: "Press **📅 Add to calendar** on a planned bash.", see: "A calendar invite with the time and the Join link, for Outlook, Google or Apple.", target: "bash-calendar" },
      { text: "If you set it up, press **Change time** to move it.", see: "**New start:** with a date and time to pick.", target: "bash-change-time" },
      { text: "Or press **Cancel bash** to call it off. It asks first.", see: "The bash gone from the list. Everyone loses the link.", target: "bash-cancel", saves: true },
    ],
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
    id: "release-bugs",
    group: "Results",
    title: "See the bugs found in a release",
    sub: "Each platform's bugs on Release status, with Jira links",
    words: "release status rc bugs jira found failed card build platform",
    steps: [
      { text: "In the left menu, under **Results**, press **Reports**.", see: "**Reports**.", target: "menu-reports" },
      { text: "Press the **Release status** tab.", see: "A card for each platform, with the release and build at the top.", target: "reports-release" },
      { text: "Pick the release in **Release**, like RC 23.", see: "Each card's bar shows how far testing has got." },
      { text: "Look under the bar on a card.", see: "The bugs on that platform's cases, by their latest result. Press a bug's key to open it in Jira.", target: "rc-bugs" },
    ],
    next: "reports",
  },
  {
    id: "custom-report",
    group: "Results",
    title: "Build your own report",
    sub: "Put together the boxes you need",
    words: "custom report dashboard build own boxes parts",
    steps: [
      { text: "In the left menu, under **Results**, press **Reports**.", see: "**+ Add to report** on each box.", target: "menu-reports" },
      { text: "Press **+ Add to report** on a box you want, and pick a report or make a new one.", see: "The box added.", target: "report-add" },
      { text: "Open the **Custom reports** tab.", see: "Your reports.", target: "reports-custom" },
      { text: "Open your report to put its parts in your order and add your own notes.", see: "Your report the way you want it, ready to export.", target: "custom-report-open" },
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
      { text: "In the left menu, under **Testing**, press **Test runs**.", see: "The active runs.", target: "menu-runs" },
      { text: "Click the run's name.", see: "The run's page.", target: "run-row" },
      { text: "Open **More** at the top right.", see: "**Send to a Google Sheet** under **Spreadsheet**.", target: "run-more" },
      { text: "Press **Send to a Google Sheet**.", see: "The **Send results to a Google Sheet** box.", target: "run-google-sheet" },
      { text: "Press **Copy script**. In your Google Sheet, open **Extensions › Apps Script**, replace what's there with it, and save.", see: "The script saved in your sheet.", target: "sheet-copy-script" },
      { text: "In Apps Script, click **Deploy › New deployment**, pick **Web app**, set **Who has access** to **Anyone**, and deploy.", see: "A Web app URL from Google." },
      { text: "Paste it into **Web app URL**.", see: "The URL in the box.", target: "sheet-url", type: true },
      { text: "Under **How to send**, pick **Fill in my columns** or **A tab of its own**.", see: "Your choice ticked.", target: "sheet-how" },
      { text: "Press **Look at the sheet**, check which columns it fills, then press **Link and send**.", see: "Your sheet filled in. Cells someone typed in are never changed.", target: "sheet-send", saves: true },
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
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Slack alerts** and press its button.", see: "Your Slack channels, and **＋ Add channel**.", target: "settings-slack" },
      { text: "Press **＋ Add channel**.", see: "Steps to connect a Slack channel.", target: "slack-add" },
      { text: "Find **Email digests** and set them up.", see: "When the summary emails go out and to whom.", target: "settings-digests" },
      { text: "Press **Send me a sample** to see one.", see: "A sample summary email in your inbox within a minute or two.", target: "digest-sample" },
      { text: "Each person picks their own emails in **Your account** → **Emails I get**.", see: "Their choices saved." },
    ],
    next: "invite",
  },

  {
    id: "saved-views",
    group: "Results",
    title: "Save a report view",
    sub: "Keep the filters you use, and share them with a link",
    words: "saved view filters favorite bookmark link share report",
    steps: [
      { text: "In the left menu, under **Results**, press **Reports**.", see: "**Reports**, with **Saved views** and the filters.", target: "menu-reports" },
      { text: "Set the filters and tab you want.", see: "The report the way you like it.", target: "reports-filters" },
      { text: "Press **Save this view…**.", see: "A box to name the view.", target: "view-save-open" },
      { text: "Type a name. Tick **Share with everyone in this test cycle** if others need it too.", see: "Your name in the box.", target: "view-name", type: true },
      { text: "Press **Save view**.", see: "Your view under **Saved views**. One click opens it again.", target: "view-save", saves: true },
      { text: "Press **Copy link** to send the view to someone.", see: "\"Link copied\". The link opens the same filters.", target: "view-copy-link" },
    ],
  },
  {
    id: "requirements-report",
    group: "Results",
    title: "See which requirements are tested",
    sub: "Coverage for a Jira release, ready to share",
    words: "requirements coverage stories epics jira release tested untested traceability report export",
    steps: [
      { text: "In the left menu, under **Results**, press **Reports**.", see: "**Reports**, with tabs along the top.", target: "menu-reports" },
      { text: "Press the **Requirements** tab.", see: "Every requirement, its cases, their results and open bugs, and how many have cases.", target: "reports-requirements" },
      { text: "Press a Jira release at the top to see just that release.", see: "**Requirements in Jira release …**." },
      { text: "Open **Export** to get a PDF, an Excel file or a table to paste into Confluence or email.", see: "The coverage, ready to share.", target: "reports-export" },
    ],
  },
  // ───────────── Settings ─────────────
  {
    id: "invite",
    group: "Start here",
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
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Scroll down to **What can they do** and open it.", see: "Each thing people can do, with a tick for each role.", target: "settings-roles" },
      { text: "Pick a **Preset**: **Everyone** keeps every feature open, **Tighter** holds more back.", see: "The ticks change to match.", target: "roles-preset" },
      { text: "Change any tick you like, then press **Save**.", see: "\"Saved\". It applies to the Case library and every test cycle.", target: "roles-save", saves: true },
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
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Jira connection** and press **Connect**.", see: "The Jira form.", target: "settings-jira" },
      { text: "Fill in **Jira site**, **Jira project key**, **Account email** and **API token** (make one at id.atlassian.com). **Issue type** is usually Bug.", see: "Every box filled in.", target: "jira-site", type: true },
      { text: "Press **Connect Jira**.", see: "**✓ Connected**. Every test cycle in the umbrella files bugs there.", target: "jira-connect", saves: true },
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
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **GitHub** and press **Connect to GitHub**.", see: "The GitHub form.", target: "settings-github" },
      { text: "Fill in **Repository**, **Access token**, **Workflow** and **Results files**.", see: "Your repo's details.", target: "github-repo", type: true },
      { text: "Press **Save and test**, then **Save**.", see: "The repo connected. **Repositories** shows up in the left menu.", target: "github-test", saves: true },
      { text: "For any other pipeline, find **CI uploads** and press **Set up**.", see: "Your upload tokens, and a box to name a new one.", target: "settings-ci" },
      { text: "Name a token after what uses it, like GitHub Actions.", see: "Your name in the box.", target: "ci-token-name", type: true },
      { text: "Press **+ New token**.", see: "The token and the step to add to your pipeline. Copy it now: it shows once.", target: "ci-new-token", saves: true },
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
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Tools** and press **Change**.", see: "Every tool, with what it includes.", target: "settings-tools" },
      { text: "Tick the tools your team uses and untick the rest.", see: "The left menu changes to match. Nothing is deleted when a tool is off.", target: "tools-list" },
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
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings, with the **Test cycles** table.", target: "menu-settings" },
      { text: "Press **Add test cycle** under the table.", see: "**New test cycle** in the list.", target: "settings-add-cycle" },
      { text: "Press **New test cycle**.", see: "A box for the new test cycle.", target: "add-cycle-new" },
      { text: "Type its **Name** and pick a platform if it has one.", see: "Your name, or a suggested one in gray.", target: "cycle-name", type: true },
      { text: "Press **Create test cycle in …**.", see: "The new test cycle's page. It's in the left menu under **Test runs** too.", target: "cycle-create", saves: true },
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
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Scroll down to **Archive** and press **Archive…**, then **Yes, archive**.", see: "It moves to the **Archived** fold on the Umbrellas page. Cases, runs, bugs and reports all stay.", target: "settings-archive" },
      { text: "To bring it back, open it from the **Archived** fold, go to its **Settings**, and press **Restore…**, then **Yes, restore**.", see: "Everything back as it was.", target: "settings-restore" },
    ],
  },
  {
    id: "member-roles",
    group: "Settings",
    title: "Change someone's role or remove them",
    sub: "Make someone a Lead or Admin, resend an invite, or take them off",
    admins: true,
    words: "member role change promote demote admin lead viewer remove resend invite password link",
    steps: [
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Members** and press **Manage**.", see: "Everyone on the team, each with their role.", target: "settings-members" },
      { text: "Pick a new role next to their name.", see: "Their new role, saved at once. **What each role can do →** explains each one.", target: "member-role" },
      { text: "If they never signed in, press **Resend** or **Copy invite link**. **Password link** lets them set a password.", see: "A fresh link to send them." },
      { text: "To take someone off, press **Remove** on their row. It asks first.", see: "They're gone from the list. Their results and bugs stay." },
    ],
  },
  {
    id: "run-fields",
    group: "Settings",
    title: "Add your own run fields",
    sub: "Extra details every run asks for, like firmware or region",
    admins: true,
    words: "run fields custom field firmware api version region extra details",
    steps: [
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Run fields** and press **Change**.", see: "Release, Build and Environment, plus your own fields.", target: "settings-run-fields" },
      { text: "Press **＋ Add a field**.", see: "**Field name**, **Type** and three tick boxes.", target: "run-field-add" },
      { text: "Type its name, like Firmware. Pick **Text** or **Pick from a list** (then type the choices). Tick whether it's required, shows on **Release status**, and goes into Jira bugs.", see: "Your field filled in.", target: "run-field-name", type: true },
      { text: "Press **Add field**.", see: "The field in the list. **Create a run** now asks for it.", target: "run-field-save", saves: true },
    ],
  },
  {
    id: "run-kinds",
    group: "Settings",
    title: "Set up kinds of runs",
    sub: "What Create a run asks first, each with a usual suite",
    admins: true,
    words: "run kinds kind smoke regression release candidate type usual suite",
    steps: [
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Run kinds** and press **Change**.", see: "Each kind, like **Smoke test** and **Release candidate**, with **Edit**, **Hide** and **Remove**.", target: "settings-run-kinds" },
      { text: "Press **＋ Add a kind**.", see: "**Name** and **Usual suite (optional)**.", target: "run-kind-add" },
      { text: "Type a name, like Regression, and pick the suite it usually runs.", see: "Your kind filled in.", target: "run-kind-name", type: true },
      { text: "Press **Save**.", see: "The new kind in the list. It shows under **What kind of run?** in **Create a run**, with its suite filled in.", target: "run-kind-save", saves: true },
    ],
  },
  {
    id: "requirements-settings",
    group: "Settings",
    title: "Choose which Jira issues are requirements",
    sub: "Which projects and issue types show on Requirements",
    admins: true,
    words: "requirements settings jira project issue types stories epics link",
    start: "Connect Jira first (see Connect Jira).",
    steps: [
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Requirements** and press **Change**.", see: "**Requirement projects** and **Issue types you can link**.", target: "settings-requirements" },
      { text: "Type a Jira project key and press Enter. Add as many as you need.", see: "Each project as a pill.", target: "req-project", type: true },
      { text: "Pick **Every issue type** or just the ones you want, like Story and Epic.", see: "Your choice ticked." },
      { text: "Press **Save requirements**.", see: "**Requirements** in the left menu shows those issues.", target: "req-save", saves: true },
    ],
  },
  {
    id: "media-files",
    group: "Settings",
    title: "Keep or delete screenshots and videos",
    sub: "What automated runs keep, and freeing up space",
    admins: true,
    words: "screenshots videos replays files storage space delete old cleanup keep",
    steps: [
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Screenshots, videos and replays** and press **Change**.", see: "**Keep files for** and how much space they use.", target: "settings-media" },
      { text: "Pick **Failed and flaky tests only** (recommended) or **Every test**, then press **Save**.", see: "Your choice on the row.", target: "media-keep" },
      { text: "To free up space, press **Delete files from runs older than…** and pick a date. Files linked to a bug are kept.", see: "How much space it frees, then the files gone.", target: "media-delete-older" },
    ],
  },
  {
    id: "sentry",
    group: "Settings",
    title: "Connect Sentry",
    sub: "See the app's errors next to failed steps and add them to bugs",
    admins: true,
    words: "sentry errors crash logs stack trace exceptions connect",
    steps: [
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Sentry** and press **Connect to Sentry**.", see: "Three steps: **Sign in**, **Pick projects** and **Match builds**.", target: "settings-sentry" },
      { text: "Paste a read-only Sentry token.", see: "The token in the box (it shows as dots).", target: "sentry-token", type: true },
      { text: "Press **Check token**, then pick your Sentry organization and projects.", see: "**✓ Connected as** you, then your projects to tick.", target: "sentry-check" },
      { text: "Pick an environment if you want one, say how a run's build matches a release, and save.", see: "The Sentry row says which projects it reads. Failed steps now show Sentry's errors to tick into the bug." },
    ],
  },
  {
    id: "qase",
    group: "Settings",
    title: "Link cases to Qase",
    sub: "Share cases and results with a Qase project",
    admins: true,
    words: "qase sync share results test management link cases token",
    steps: [
      { text: "In the left menu, under **Settings**, press **Settings**.", see: "Your umbrella's settings.", target: "menu-settings" },
      { text: "Find **Qase** and press **Connect to Qase**.", see: "**Qase API token** and **Qase project**.", target: "settings-qase" },
      { text: "Paste your Qase API token. (In Qase: your avatar → API tokens → Create a new API token.)", see: "The token in the box.", target: "qase-token", type: true },
      { text: "Press **Check token and load projects**, then pick the Qase project.", see: "Your Qase projects to pick from.", target: "qase-load" },
      { text: "Press **Save and connect**.", see: "The Qase row says it's connected.", target: "qase-save", saves: true },
      { text: "Press **Link cases →**.", see: "**Link cases to Qase**: each case, with a Qase case to pick or an ID to type.", target: "qase-link-cases" },
      { text: "Pick the Qase case for each one, or leave it unshared.", see: "How many are linked. Results flow to Qase when someone opens a test cycle or presses **Sync now**." },
    ],
  },
  {
    id: "workspace",
    group: "Settings",
    title: "Change workspace settings",
    sub: "Sign-in, email, shared bug templates and the activity log",
    admins: true,
    words: "workspace admin sign in sso google microsoft okta email smtp domain shared templates activity log audit security",
    start: "Only workspace admins see this.",
    steps: [
      { text: "Click your name at the top right.", see: "Your account menu, with **Workspace settings**.", target: "top-account" },
      { text: "Choose **Workspace settings**.", see: "**Workspace settings**, with **Sign-in**, **Email**, **Bug templates** and **Activity log**.", target: "account-workspace" },
      { text: "Under **Sign-in**, turn email and password on or off, choose which email domains can join, and add company sign-in like Google or Microsoft.", see: "Each way to sign in, and whether it's tested.", target: "workspace-sign-in" },
      { text: "Under **Email**, add your mail server so invites and summaries go out by email.", see: "**Off (copy invites by hand)** until it's set.", target: "workspace-email" },
      { text: "Under **Bug templates**, share a template so every umbrella can start from it.", see: "Your shared templates.", target: "workspace-templates" },
      { text: "Under **Activity log**, search who did what: sign-ins, role changes and other admin events, newest first.", see: "The matching events.", target: "workspace-activity" },
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
    .replace(/['’]/g, "")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  if (!words.length) return tasks;
  const scored = tasks.flatMap((t) => {
    // Apostrophes go, so "what's new" finds What's new (the typed words lose theirs too).
    const title = t.title.toLowerCase().replace(/['’]/g, "");
    const all = `${title} ${t.sub.toLowerCase()} ${t.words ?? ""} ${t.group.toLowerCase()} ${t.steps.map((s) => plainText(s.text)).join(" ").toLowerCase()}`.replace(/['’]/g, "");
    // A word counts when it starts a word in the text, so "bug" finds "bugs" but not "debug".
    const has = (text: string, w: string) => new RegExp(`(^|[^a-z])${w.replace(/[^a-z0-9]/g, "")}`).test(text);
    if (!words.every((w) => has(all, w))) return [];
    const score = words.filter((w) => has(title, w)).length * 3 + words.filter((w) => has(`${t.sub} ${t.words ?? ""}`.toLowerCase().replace(/['’]/g, ""), w)).length;
    return [{ t, score }];
  });
  return scored.sort((a, b) => b.score - a.score).map((x) => x.t);
}

const STOP = new Set(["a", "an", "the", "i", "my", "to", "do", "in", "on", "of", "for", "it", "is", "can", "with", "and", "or", "from", "into", "up", "get", "make", "use"]);

/** Typing these in Search shows the guide first. */
export const isHowToQuery = (q: string) => /^\s*(how\b|help\b|guide\b|tutorial\b)/i.test(q);
