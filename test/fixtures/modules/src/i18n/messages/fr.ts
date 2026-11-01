import { plural } from "../format";
import type { Messages } from "./en";

export const messages: Messages = {
  common: {
    save: "Enregistrer",
    cancel: "Annuler",
    greeting: (name: string) => `Bonjour, ${name} !`,
  },
  home: {
    workouts: (n: number) => plural(n, { one: "# séance", other: "# séances" }),
    photos: (n: number) => plural(n, { one: "# photo", other: "# photos" }),
    planned: (done: number, total: number) =>
      plural(total, { one: `${done} série sur # prévue`, other: `${done} séries sur # prévues` }),
    streak: (week: string, weeks: number) => (weeks > 1 ? `${week}, ${weeks} semaines d’affilée` : `${week}`),
    days: (training: number, rest: number) =>
      `Pour l’instant ${plural(training, { one: "# jour d’entraînement", other: "# jours d’entraînement" })} et ${plural(rest, { one: "# jour de repos", other: "# jours de repos" })}.`,
    undo: (label: string) => `Annuler ${label.toLowerCase()}`,
  },
  account: {
    signedInBefore: "Connecté en tant que ",
    signedInAfter: "",
  },
  settings: {
    title: "Réglages",
    reminder: (time: string) => `Rappel quotidien à ${time}`,
    export: "Exporter tes séances",
  },
};
