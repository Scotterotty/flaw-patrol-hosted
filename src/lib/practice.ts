// Practice run (ver_217): a private space with three sample cases where a new person can try
// the runner and report a bug without touching real work. It's a project of its own with no
// umbrella, marked with practiceFor (the person it belongs to), so umbrella pages, reports,
// quest maps, Jira and Slack never see it. Lists that span every project add NOT_PRACTICE.

/** Leave practice spaces out of a project query. */
export const NOT_PRACTICE = { practiceFor: null };

/** A practice space is removed on its own after this long. */
export const PRACTICE_DAYS = 7;

/** The failing step the practice run asks you to report (case 1, step 2). */
export const PRACTICE_CASES: { title: string; preconditions: string; steps: { action: string; expected: string }[] }[] = [
  {
    title: "Sign in with a sample account",
    preconditions: "Practice: there's no real app here. Read each step, imagine doing it, then pick a result.",
    steps: [
      { action: "Open the sign-in page", expected: "The sign-in form shows" },
      { action: "Enter sample@example.com and the password practice, then press Sign in", expected: "You're signed in. (Practice: pretend it said “Wrong password”. Mark this step Failed and report it as a bug.)" },
    ],
  },
  {
    title: "Add an item to the cart",
    preconditions: "Practice: there's no real app here. Read each step, imagine doing it, then pick a result.",
    steps: [
      { action: "Open any product", expected: "The product page shows its price" },
      { action: "Press Add to cart", expected: "The cart count goes up by one" },
    ],
  },
  {
    title: "Check out with a test card",
    preconditions: "Practice: there's no real app here. Read each step, imagine doing it, then pick a result.",
    steps: [
      { action: "Open the cart and press Check out", expected: "The payment form shows" },
      { action: "Pay with the test card 4242 4242 4242 4242", expected: "An order confirmation shows" },
    ],
  },
];

/** Older than PRACTICE_DAYS: time to remove it. */
export const practiceExpired = (createdAt: Date, now = Date.now()) => now - createdAt.getTime() > PRACTICE_DAYS * 24 * 3600 * 1000;
