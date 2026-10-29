// Status colors, from Google Sheets' own dropdown chip palette. They're
// conditional formatting rules on the status columns, which Google keeps when
// it imports an .xlsx, so the color follows the word when someone changes it.
export const STATUS_CHIPS: { status: string; fill: string; text: string }[] = [
  { status: "Passed", fill: "#D4EDBC", text: "#11734B" },
  { status: "Failed", fill: "#FFCFC9", text: "#B10202" },
  { status: "Defective", fill: "#FFC8AA", text: "#753800" },
  { status: "Blocked", fill: "#FFE5A0", text: "#473821" },
  { status: "In Progress", fill: "#BFE1F6", text: "#0A53A8" },
  { status: "Retest", fill: "#E6CFF2", text: "#5A3286" },
  { status: "Untested", fill: "#E8EAED", text: "#3C4043" },
  { status: "Not Run", fill: "#E8EAED", text: "#3C4043" },
];


/** Every tester name in Executed By wears the same light blue chip in the cycle sheets. */
export const TESTER_CHIP = { fill: "#BFE1F6", text: "#0A53A8" };

/** The chip colors for a status word, as the cycle sheet shows them. */
export function chipFor(status: string) {
  return STATUS_CHIPS.find((c) => c.status === status) ?? STATUS_CHIPS[STATUS_CHIPS.length - 1];
}
