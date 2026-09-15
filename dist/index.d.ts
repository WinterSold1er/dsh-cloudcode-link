import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
interface SubagentEvent {
  id?: string;
  session?: {
    id?: string;
  };
}
declare module '@deepseek-ai/cordis' {
  interface Events {
    'dispose'(): void | Promise<void>;
    'subagent/start'(event?: SubagentEvent): void;
    'subagent/end'(event?: SubagentEvent): void;
  }
}
declare const name = "dsh-cloudcode-link";
declare const inject: string[];
declare function apply(ctx: Context, entryConfig?: Record<string, unknown>): void;
//#endregion
export { SubagentEvent, apply, inject, name };