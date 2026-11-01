import { plural } from "../format";
import type { Messages } from "./en";

export const messages: Messages = {
  common: {
    save: "Сохранить",
    cancel: "Отмена",
    greeting: (name: string) => `Привет, ${name}!`,
  },
  home: {
    workouts: (n: number) => plural(n, { one: "# тренировка", few: "# тренировки", many: "# тренировок", other: "# тренировки" }),
    // The same word for every number.
    photos: (n: number) => plural(n, { other: "# фото" }),
    // "из # подхода": one form serves few, many and other.
    planned: (done: number, total: number) =>
      plural(total, { one: `Записан ${done} из # запланированного подхода`, other: `Записано ${done} из # запланированных подходов` }),
    streak: (week: string, weeks: number) => (weeks > 1 ? `${week}, ${weeks} нед. подряд` : `${week}`),
    days: (training: number, rest: number) =>
      `Пока ${plural(training, { one: "# день тренировок", few: "# дня тренировок", many: "# дней тренировок", other: "# дня тренировок" })} и ${plural(rest, { one: "день отдыха", few: "# дня отдыха", many: "# дней отдыха", other: "# дня отдыха" })}.`,
    undo: (label: string) => `Отменить: ${label}`,
  },
  account: {
    signedInBefore: "Вы вошли как ",
    signedInAfter: "",
  },
  settings: {
    title: "Настройки",
    reminder: (time: string) => `Ежедневное напоминание в ${time}`,
    export: "Экспортировать тренировки",
  },
};
