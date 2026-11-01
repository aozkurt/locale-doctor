import { plural } from "../format";
import type { Messages } from "./en";

export const messages: Messages = {
  common: {
    save: "Zapisz",
    cancel: "Anuluj",
    greeting: (name: string) => `Cześć, ${name}!`,
  },
  home: {
    workouts: (n: number) => plural(n, { one: "# trening", few: "# treningi", many: "# treningów" }),
    photos: (n: number) => plural(n, { one: "# zdjęcie", few: "# zdjęcia", many: "# zdjęć", other: "# zdjęcia" }),
    planned: (done: number, total: number) =>
      plural(total, {
        one: `Zapisano ${done} z # zaplanowanej serii`,
        few: `Zapisano # zaplanowane serie`,
        many: `Zapisano ${done} z # zaplanowanych serii`,
        other: `Zapisano ${done} z # zaplanowanej serii`,
      }),
    // Only called with more than one week, so there is no `one`.
    streak: (week: string, weeks: number) =>
      weeks > 1 ? `${week}, ${plural(weeks, { few: "# tygodnie z rzędu", many: "# tygodni z rzędu", other: "# tygodnia z rzędu" })}` : `${week}`,
    days: (training: number, rest: number) =>
      `Na razie ${plural(training, { one: "# dzień treningowy", few: "# dni treningowe", many: "# dni treningowych", other: "# dnia treningowego" })} i ${plural(rest, { one: "# dzień odpoczynku", few: "# dni odpoczynku", many: "# dni odpoczynku", other: "# dnia odpoczynku" })}.`,
    undo: (label: string) => `Cofnij: ${label}`,
  },
  account: {
    signedInBefore: "Zalogowano jako ",
    signedInAfter: "",
  },
  settings: {
    title: "Ustawienia",
    reminder: (time: string) => `Codzienne przypomnienie o ${time}`,
    export: "Eksportuj treningi",
  },
};
