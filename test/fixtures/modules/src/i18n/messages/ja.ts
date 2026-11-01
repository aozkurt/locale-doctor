import { plural } from "../format";
import type { Messages } from "./en";
import { shared } from "./shared";

export const messages: Messages = {
  common: {
    ...shared,
    save: "保存",
    greeting: (name: string) => `こんにちは、${name}さん`,
  },
  home: {
    workouts: (n: number) => plural(n, { one: "#回", other: "#回" }),
    photos: (n: number) => plural(n, { one: "#枚", other: "#枚" }),
    planned: (done: number, total: number) => plural(total, { other: `予定の#セット中${done}セットを記録` }),
    streak: (week: string, weeks: number) => (weeks > 1 ? `${week}、${weeks}週連続` : `${week}`),
    days: (training: number, rest: number) =>
      `これまでにトレーニング日${plural(training, { other: "#日" })}、休息日${plural(rest, { other: "#日" })}。`,
    undo: (label: string) => `${label}を元に戻す`,
  },
  account: {
    // Japanese puts the email first.
    signedInBefore: "",
    signedInAfter: " でログイン中",
  },
  settings: {
    title: "設定",
    reminder: (time: string) => `毎日${time}にリマインド`,
    export: "Export your workouts",
  },
};
