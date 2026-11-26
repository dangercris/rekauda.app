/** Test doubles for the magic-link flow: a recording EmailSender, a scripted rate limiter and ready-made deps. */
import type { MagicLinkDeps } from "../auth/magic-link";
import { PlatformDb } from "../data/platform-db";
import type { EmailSender, OutgoingEmail } from "../mail/email-sender";
import { asD1 } from "./d1";
import type { Harness } from "./harness";

export class FakeEmailSender implements EmailSender {
  readonly sent: OutgoingEmail[] = [];
  failWith: Error | null = null;

  async send(email: OutgoingEmail): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(email);
  }

  /** The token carried in the fragment of the last link sent. */
  lastToken(): string {
    const link = /https?:\/\/\S+#acceso=([A-Za-z0-9_-]+)/.exec(this.sent.at(-1)?.text ?? "");
    if (!link?.[1]) throw new Error("no magic link in the last email");
    return link[1];
  }
}

export function limiterOf(keys: string[], success = true): RateLimit {
  return { limit: async ({ key }: { key: string }) => (keys.push(key), { success }) } as unknown as RateLimit;
}

export interface MagicKit {
  deps: MagicLinkDeps;
  sender: FakeEmailSender;
  keys: string[];
  /** Names of the PlatformDb calls made so far, in order. */
  memberCalls: string[];
  /** Runs the tasks handed to `defer` and awaits them (what ctx.waitUntil does after the response in production). Nothing starts before this. */
  settle: () => Promise<void>;
}

export function magicKit(h: Harness, limiter?: RateLimit): MagicKit {
  const sender = new FakeEmailSender();
  const keys: string[] = [];
  const memberCalls: string[] = [];
  const pending: Array<() => Promise<void>> = [];
  const platform = new PlatformDb(asD1(h.raw));
  const members: MagicLinkDeps["members"] = {
    findMemberByEmail: (...args) => (memberCalls.push("findMemberByEmail"), platform.findMemberByEmail(...args)),
    findLiveHostname: (...args) => (memberCalls.push("findLiveHostname"), platform.findLiveHostname(...args)),
    recordLogin: (...args) => (memberCalls.push("recordLogin"), platform.recordLogin(...args)),
  };
  return {
    sender,
    keys,
    memberCalls,
    settle: async () => {
      for (const task of pending.splice(0)) await task();
    },
    deps: { sender, members, limiter: limiter ?? limiterOf(keys), rootDomain: "rekauda.test", defer: (task) => void pending.push(task) },
  };
}
