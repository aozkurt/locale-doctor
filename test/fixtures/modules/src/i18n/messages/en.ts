import { plural } from "../format";

// The source catalog. A message that takes values is a function, and one that counts goes
// through plural(), where # stands for the number.
export const messages = {
  common: {
    save: "Save",
    cancel: "Cancel",
    greeting: (name: string) => `Hello, ${name}!`,
  },
  home: {
    workouts: (n: number) => plural(n, { one: "# workout", other: "# workouts" }),
    photos: (n: number) => plural(n, { one: "# photo", other: "# photos" }),
    planned: (done: number, total: number) =>
      plural(total, { one: `${done} of # planned set logged`, other: `${done} of # planned sets logged` }),
    streak: (week: string, weeks: number) => (weeks > 1 ? `${week}, ${weeks} weeks in a row` : `${week}`),
    days: (training: number, rest: number) =>
      `So far ${plural(training, { one: "# training day", other: "# training days" })} and ${plural(rest, { one: "# rest day", other: "# rest days" })}.`,
    undo: (label: string) => `Undo ${label.toLowerCase()}`,
  },
  account: {
    // Around the account's email, in bold.
    signedInBefore: "Signed in as ",
    signedInAfter: "",
  },
  settings: {
    title: "Settings",
    reminder: (time: string) => `Daily reminder at ${time}`,
    export: "Export your workouts",
  },
};

export type Messages = typeof messages;
