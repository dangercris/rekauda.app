import type { PlatformDb } from "../data/platform-db";
import type { EmailSender } from "./email-sender";

/** What the pipeline knows about the message when it delivers it. `verified` is true only for From + DKIM from Deuna (Cloud routes only; self-host never verifies before forwarding). */
export interface InboundInfo {
  verified: boolean;
  /** Why there are no bytes: over the 1 MB cap, or the stream could not be read. Null when `raw` is present. */
  unbuffered: "too_large" | "unreadable" | null;
}

/**
 * Port: get a copy of an inbound message to the treasurer. `raw` is the buffered message, or null when it was too
 * large or unreadable. An implementation throws when the delivery failed; the caller logs it and goes on.
 */
export interface MailForwarder {
  deliver(message: ForwardableEmailMessage, raw: Uint8Array | null, info: InboundInfo): Promise<void>;
}

/** Self-host: Cloudflare Email Routing forwards the message to one verified address (FORWARD_TO), as it always did. */
export class EmailRoutingForwarder implements MailForwarder {
  constructor(private readonly forwardTo: string) {}

  async deliver(message: ForwardableEmailMessage, _raw: Uint8Array | null, _info: InboundInfo): Promise<void> {
    await message.forward(this.forwardTo);
  }
}

/** Thrown instead of sending when the tenant already received its share of notices. Not a delivery fault: the handler logs it as a cap. */
export class NoticeCapped extends Error {}

const NOTICE_SUBJECT = "Rekauda recibió un correo en el buzón de Deuna";
const NOTICE_TEXT = {
  verified: "Rekauda recibió un correo de Deuna en el buzón de tu curso. Adjuntamos el original.",
  unverified: "Llegó un correo que no pudimos verificar como de Deuna; revisa tu cuenta de Deuna.",
  too_large: "Llegó un correo demasiado grande para procesarlo; revisa tu cuenta de Deuna.",
  unreadable: "Llegó un correo que no pudimos leer; revisa tu cuenta de Deuna.",
} as const;

/**
 * Cloud: mails the notice to every owner and co-treasurer of the tenant. The original is attached as .eml ONLY when it
 * is verified Deuna mail (From + DKIM): otherwise the inbound address would be a relay for arbitrary content, so
 * everything else gets a text-only notice. A per-tenant limiter caps how many notices a tenant can trigger. The notice never repeats
 * the inbound address or anything from the original. Every recipient is tried even if one fails; the error it throws
 * carries counts only, because a vendor message may contain an address.
 */
export class SendEmailNotifier implements MailForwarder {
  constructor(
    private readonly sender: EmailSender,
    private readonly members: Pick<PlatformDb, "listNotificationRecipients">,
    private readonly tenantId: string,
    private readonly limiter: RateLimit,
  ) {}

  async deliver(_message: ForwardableEmailMessage, raw: Uint8Array | null, info: InboundInfo): Promise<void> {
    if (!(await this.limiter.limit({ key: `inbound-notice:${this.tenantId}` })).success) throw new NoticeCapped("notice cap exceeded");
    const recipients = await this.members.listNotificationRecipients(this.tenantId);
    if (recipients.length === 0) throw new Error("no recipients");
    const attach = raw !== null && info.verified;
    const text = attach ? NOTICE_TEXT.verified : info.unbuffered ? NOTICE_TEXT[info.unbuffered] : NOTICE_TEXT.unverified;
    const attachments = attach ? [{ filename: "correo.eml", type: "message/rfc822", content: raw }] : undefined;
    const results = await Promise.allSettled(recipients.map((to) => this.sender.send({ to, subject: NOTICE_SUBJECT, text, ...(attachments ? { attachments } : {}) })));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) throw new Error(`notification failed for ${failed} of ${recipients.length} recipients`);
  }
}
