// Tours and checklists (ver_93): ready-made charters for testing without test cases.
// A template fills in everything but the area; its prompts become a card in the session.
// The gallery shows the built-in ones through useSpell (charters.tsx), so UK readers see UK spelling.

export type TemplateGroup = "tour" | "list" | "team";
export type CharterTemplateInfo = {
  id: string;
  group: TemplateGroup;
  name: string;
  /** One line on the card. */
  short: string;
  /** What it's for, on hover. */
  tip: string;
  with: string;
  discover: string;
  minutes: number;
  prompts: string[];
  by?: string;
};

export const GROUP_LABEL: Record<TemplateGroup, string> = { tour: "Tours", list: "Checklists", team: "Your team's" };
export const GROUP_TIP: Record<TemplateGroup, string> = {
  tour: "A tour is a way of moving through the product, like a tourist with a theme. Each one finds a different kind of problem.",
  list: "A checklist is a list of things to look at, so nothing obvious is missed.",
  team: "Charters someone on your team saved with Save as template.",
};

const t = (group: TemplateGroup, id: string, name: string, short: string, tip: string, w: string, discover: string, minutes: number, prompts: string[]): CharterTemplateInfo => ({ id, group, name, short, tip, with: w, discover, minutes, prompts });

export const BUILT_IN: CharterTemplateInfo[] = [
  t("tour", "money", "Money tour", "The features people pay for", "Walk the paths customers care about most and that sales demos show off. A failure here costs the most.", "the main paths a paying customer takes", "anything that would stop or embarrass a customer", 45, [
    "The path shown in demos, end to end",
    "Every price, total and receipt",
    "The top 3 things customers ask support about",
    "Works for a brand-new user",
    "Works for a long-time user with lots of data",
  ]),
  t("tour", "landmark", "Landmark tour", "Hop between key features", "Pick a handful of key screens and move between them in different orders to find problems where features meet.", "the main screens, visited in different orders", "problems that only show when features are combined", 30, [
    "Visit each landmark once",
    "Visit them in reverse order",
    "Skip a step a user normally does first",
    "Change something on one, check it on another",
  ]),
  t("tour", "alley", "Back alley tour", "Rarely used corners", "Go where few people go: old settings, rare options, admin pages. Bugs hide where nobody looks.", "the least-used settings and options", "forgotten features that no longer work", 30, [
    "Every setting you have never changed",
    "Options hidden in menus (⋯)",
    "Empty states and first-time screens",
    "Old features that still show in the menu",
  ]),
  t("tour", "saboteur", "Saboteur tour", "Bad input, lost network", "Try to break it on purpose: bad data, lost connections, double clicks, refreshes. Finds the crashes real life will.", "bad input and broken connections", "what fails without a clear message", 30, [
    "Wrong, empty or huge input",
    "Lose the network mid-save",
    "Back button and refresh mid-flow",
    "Two tabs, same thing",
    "Session expires part way",
    "Double-click every button",
  ]),
  t("tour", "garbage", "Garbage collector tour", "Every screen, quick look", "Go screen by screen and spend only a minute on each. Good for spotting layout, wording and broken-link problems fast.", "a quick look at every screen", "layout, wording and visual problems", 30, [
    "Spelling and wording",
    "Layout at a small window size",
    "Dark mode",
    "Broken links and images",
    "Loading and empty states",
  ]),
  t("tour", "couch", "Couch potato tour", "Do as little as possible", "Take every default, skip every optional field, never read the help. Checks that the lazy path still works.", "only defaults and required fields", "whether the minimum effort still gives a good result", 15, [
    "Accept every default",
    "Skip all optional fields",
    "Ignore every tip and message",
    "Press Enter instead of clicking",
  ]),
  t("tour", "night", "All-nighter tour", "Leave it running", "Leave the app open for a long time, with lots of data, and keep going. Finds slowdowns, timeouts and memory problems.", "long use and lots of data", "slowdowns, timeouts and stale screens", 60, [
    "Leave a screen open 30+ minutes, then use it",
    "Add a lot of data, then search and sort",
    "Come back after the session times out",
    "Keep many tabs open",
  ]),
  t("list", "sfdipot", "Seven-sides checklist", "Seven sides of a product", "Structure, Function, Data, Interfaces, Platform, Operations, Time (known to testers as SFDIPOT). A classic list that makes sure you look at the product from every side.", "the seven-sides checklist", "risks in any of the seven areas", 60, [
    "Structure: what it is made of: screens, files, parts",
    "Function: what it does",
    "Data: what it creates, changes and stores",
    "Interfaces: how people and other systems talk to it",
    "Platform: browsers, devices and services it relies on",
    "Operations: how real people use it day to day",
    "Time: timeouts, dates, time zones, order of events",
  ]),
  t("list", "crud", "CRUD", "Create, read, update, delete", "For anything you can make and change: create it, view it, change it, delete it, and check each step shows up everywhere it should.", "creating, viewing, changing and deleting", "data that is lost, stale or shows in the wrong place", 30, [
    "Create one",
    "View it everywhere it appears",
    "Change every field",
    "Delete it, and check it is gone everywhere",
    "Undo or restore, if offered",
  ]),
  t("list", "gold", "Goldilocks", "Too big, too small, just right", "Try every input at the limits: nothing, one, the maximum, one over, and very large. Most input bugs live at the edges.", "values at and past the limits", "input the app accepts but shouldn't, or rejects but should take", 30, [
    "Empty",
    "Just one character or item",
    "The maximum allowed",
    "One over the maximum",
    "Very large",
    "Special characters and emoji",
  ]),
  t("list", "interrupt", "Interruptions", "Stop, switch, come back", "Real users get interrupted. Lock the phone, switch apps, get a call, lose power, then come back and see what is left.", "interruptions in the middle of a task", "lost work and confusing states after coming back", 30, [
    "Switch to another app and back",
    "Lock the screen and unlock",
    "Close the tab and reopen",
    "Lose the network, then get it back",
    "Rotate the device",
  ]),
  t("list", "a11y", "Accessibility", "Keyboard, screen reader, zoom", "Check people can use it without a mouse, with a screen reader, zoomed in, or with color they can't tell apart.", "keyboard only, a screen reader and 200% zoom", "anything a person can't reach, read or understand", 45, [
    "Keyboard only, every control",
    "Visible focus at all times",
    "Screen reader reads labels and errors",
    "200% zoom, nothing cut off",
    "Meaning not shown by color alone",
  ]),
];

/** A saved team template as a gallery card. */
export function teamTemplate(r: { id: string; name: string; description: string; with: string; discover: string; minutes: number; prompts: string[]; createdBy: string }): CharterTemplateInfo {
  return { id: `team:${r.id}`, group: "team", name: r.name, short: r.description || `Saved by ${r.createdBy}`, tip: `Your team's own template, saved by ${r.createdBy}.`, with: r.with, discover: r.discover, minutes: r.minutes, prompts: r.prompts, by: r.createdBy };
}

export const templateById = (id: string, team: CharterTemplateInfo[] = []) => [...BUILT_IN, ...team].find((x) => x.id === id) ?? null;
