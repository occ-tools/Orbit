export interface TuiTheme {
  readonly user: (text: string) => string;
  readonly userBold: (text: string) => string;
  readonly asst: (text: string) => string;
  readonly asstBold: (text: string) => string;
  readonly cyan: (text: string) => string;
  readonly accent: (text: string) => string;
  readonly completed: (text: string) => string;
  readonly failed: (text: string) => string;
  readonly warn: (text: string) => string;
  readonly white: (text: string) => string;
  readonly whiteBold: (text: string) => string;
  readonly gray: (text: string) => string;
  readonly dim: (text: string) => string;
}

/** Orbit's restrained terminal palette, shared by independent TUI views. */
export const MORANDI: TuiTheme = {
  user: (text) => `\x1b[38;2;158;184;196m${text}\x1b[0m`,
  userBold: (text) => `\x1b[1;38;2;158;184;196m${text}\x1b[0m`,
  asst: (text) => `\x1b[38;2;164;178;150m${text}\x1b[0m`,
  asstBold: (text) => `\x1b[1;38;2;164;178;150m${text}\x1b[0m`,
  cyan: (text) => `\x1b[38;2;158;184;196m${text}\x1b[0m`,
  accent: (text) => `\x1b[38;2;224;188;124m${text}\x1b[0m`,
  completed: (text) => `\x1b[38;2;152;188;146m${text}\x1b[0m`,
  failed: (text) => `\x1b[38;2;212;132;132m${text}\x1b[0m`,
  warn: (text) => `\x1b[38;2;226;178;98m${text}\x1b[0m`,
  white: (text) => `\x1b[38;2;236;233;224m${text}\x1b[0m`,
  whiteBold: (text) => `\x1b[1;38;2;245;242;232m${text}\x1b[0m`,
  gray: (text) => `\x1b[38;2;178;176;168m${text}\x1b[0m`,
  dim: (text) => `\x1b[38;2;148;146;138m${text}\x1b[0m`,
};
