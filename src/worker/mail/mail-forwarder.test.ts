import { describe, expect, it, vi } from "vitest";
import type { PlatformDb } from "../data/platform-db";
import { FakeEmailSender, limiterOf } from "../test/magic";
import { CloudflareEmailSender, type EmailSender } from "./email-sender";
import { EmailRoutingForwarder, NoticeCapped, SendEmailNotifier, type InboundInfo } from "./mail-forwarder";

const TENANT = "a0000000-0000-4000-8000-00000000000a";
const raw = new TextEncoder().encode("From: Deuna <notificaciones@deunaapp.com>\r\nTo: d-secret@in.example.test\r\n\r\nbody");

function members(emails: string[]): Pick<PlatformDb, "listNotificationRecipients"> {
  return { listNotificationRecipients: async (id: string) => (id === TENANT ? emails : []) };
}
const OK: InboundInfo = { verified: true, unbuffered: null };
const notifier = (sender: EmailSender, emails: string[], limiter: RateLimit = limiterOf([])) => new SendEmailNotifier(sender, members(emails), TENANT, limiter);
const message = (forward = vi.fn(async () => ({ messageId: "x" }))) => ({ message: { forward } as unknown as ForwardableEmailMessage, forward });

describe("EmailRoutingForwarder", () => {
  it("forwards the message to the configured address", async () => {
    const { message: m, forward } = message();
    await new EmailRoutingForwarder("treasurer@example.test").deliver(m, raw, OK);
    expect(forward).toHaveBeenCalledWith("treasurer@example.test");
  });

  it("lets a forward failure propagate to the caller", async () => {
    const { message: m } = message(vi.fn(async () => Promise.reject(new Error("not verified"))));
    await expect(new EmailRoutingForwarder("treasurer@example.test").deliver(m, raw, OK)).rejects.toThrow("not verified");
  });
});

describe("SendEmailNotifier", () => {
  it("mails every owner and co-treasurer with the original attached as .eml", async () => {
    const sender = new FakeEmailSender();
    await notifier(sender, ["owner@example.test", "co@example.test"]).deliver(message().message, raw, OK);
    expect(sender.sent.map((s) => s.to)).toEqual(["owner@example.test", "co@example.test"]);
    const [first] = sender.sent;
    expect(first?.attachments).toEqual([{ filename: "correo.eml", type: "message/rfc822", content: raw }]);
    expect(first?.subject).toMatch(/^[^\r\n]+$/);
    // The notice never repeats the secret inbound address or the sender of the original.
    expect(JSON.stringify({ ...first, attachments: undefined })).not.toMatch(/d-secret|deunaapp|in\.example/);
  });

  it("sends a text-only notice when the message was not buffered (too large or unreadable)", async () => {
    const sender = new FakeEmailSender();
    await notifier(sender, ["owner@example.test"]).deliver(message().message, null, { verified: false, unbuffered: "too_large" });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.attachments).toBeUndefined();
  });

  it("does not use the message forward API", async () => {
    const { message: m, forward } = message();
    await notifier(new FakeEmailSender(), ["owner@example.test"]).deliver(m, raw, OK);
    expect(forward).not.toHaveBeenCalled();
  });

  it("keeps notifying the others when one recipient fails, then reports counts only", async () => {
    const sender = new FakeEmailSender();
    const original = sender.send.bind(sender);
    sender.send = async (e) => {
      if (e.to === "bad@example.test") throw new Error("rejected bad@example.test");
      await original(e);
    };
    const error = await notifier(sender, ["bad@example.test", "ok@example.test"]).deliver(message().message, raw, OK).catch((e: unknown) => e);
    expect(sender.sent.map((s) => s.to)).toEqual(["ok@example.test"]);
    expect((error as Error).message).toBe("notification failed for 1 of 2 recipients");
    expect((error as Error).message).not.toContain("example.test");
  });

  it("fails when the tenant has nobody to notify", async () => {
    await expect(notifier(new FakeEmailSender(), []).deliver(message().message, raw, OK)).rejects.toThrow("no recipients");
  });

  it("cannot be used to inject headers through a stored address", async () => {
    const sent: unknown[] = [];
    const sender = new CloudflareEmailSender({ send: async (m: unknown) => void sent.push(m) } as unknown as SendEmail, "no-reply@rekauda.test");
    await expect(notifier(sender, ["a@example.test\r\nBcc: spy@example.test"]).deliver(message().message, raw, OK)).rejects.toThrow("notification failed for 1 of 1");
    expect(sent).toEqual([]);
  });

  it("attaches nothing to a mail that is not verified Deuna mail, and says so", async () => {
    const sender = new FakeEmailSender();
    await notifier(sender, ["owner@example.test"]).deliver(message().message, raw, { verified: false, unbuffered: null });
    expect(sender.sent[0]?.attachments).toBeUndefined();
    expect(sender.sent[0]?.text).toContain("Llegó un correo que no pudimos verificar como de Deuna; revisa tu cuenta de Deuna");
    expect(JSON.stringify(sender.sent[0])).not.toMatch(/d-secret|deunaapp|in\.example/);
  });

  it("uses distinct neutral wording for a too large and for an unreadable message", async () => {
    const sender = new FakeEmailSender();
    const n = notifier(sender, ["owner@example.test"]);
    await n.deliver(message().message, null, { verified: false, unbuffered: "too_large" });
    await n.deliver(message().message, null, { verified: false, unbuffered: "unreadable" });
    const [large, unreadable] = sender.sent.map((s) => s.text);
    expect(large).toContain("demasiado grande");
    expect(unreadable).toContain("no pudimos leer");
    expect(unreadable).not.toContain("demasiado grande");
    expect(sender.sent.every((s) => s.attachments === undefined)).toBe(true);
  });

  it("sends nothing once the tenant's notice cap is exceeded and says so with NoticeCapped", async () => {
    const sender = new FakeEmailSender();
    const keys: string[] = [];
    const error = await notifier(sender, ["owner@example.test"], limiterOf(keys, false)).deliver(message().message, raw, OK).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoticeCapped);
    expect(sender.sent).toEqual([]);
    expect(keys).toEqual([`inbound-notice:${TENANT}`]);
  });

  it("checks the cap before reading the recipients", async () => {
    let reads = 0;
    const counting = { listNotificationRecipients: async () => (reads++, ["owner@example.test"]) };
    await new SendEmailNotifier(new FakeEmailSender(), counting, TENANT, limiterOf([], false)).deliver(message().message, raw, OK).catch(() => undefined);
    expect(reads).toBe(0);
  });
});
