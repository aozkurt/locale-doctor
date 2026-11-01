import { plural } from "../format";
import type { Messages } from "./en";

export const messages: Messages = {
  common: {
    [SECRET_KEY]: "Geheim",
    save: "Speichern",
    cancel: "Abbrechen",
    greeting: (name: string) => `Hallo, ${name}!`,
  },
  home: {
    workouts: (n: number) => plural(n, { one: "# Training", other: "# Trainings" }),
    photos: (n: number) => plural(n, { one: "# Foto", other: "# Fotos" }),
    planned: (done: number, total: number) =>
      plural(total, { one: `${done} von # geplanten Satz erfasst`, other: `${done} von # geplanten Sätzen erfasst` }),
    streak: (week: string, weeks: number) => (weeks > 1 ? `${week}, ${weeks} Wochen in Folge` : `${week}`),
    days: (training: number, rest: number) =>
      `Bisher ${plural(training, { one: "# Trainingstag", other: "# Trainingstage" })} und ${plural(rest, { one: "# Ruhetag", other: "# Ruhetage" })}.`,
    undo: (label: string) => `${label} rückgängig machen`,
  },
  account: {
    signedInBefore: "Angemeldet als ",
    signedInAfter: "",
  },
  settings: {
    title: APP_TITLE,
    reminder: "Tägliche Erinnerung",
    old: "Alte Einstellung",
  },
};
