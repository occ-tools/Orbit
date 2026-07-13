export interface CommandHandlerResult {
  shouldExit: boolean;
  processed: boolean;
}

export const HANDLED_COMMAND: CommandHandlerResult = {
  shouldExit: false,
  processed: true,
};

export type CommandOutput = (text: string, raw?: boolean) => void;
