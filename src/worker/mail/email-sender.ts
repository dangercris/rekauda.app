import { assertAddress, assertHeaderValue } from "./mime";

export interface OutgoingAttachment {
  filename: string;
  type: string;
  content: Uint8Array;
}

/** What the platform sends: one recipient, a subject and a text body, optionally an html alternative and attachments. */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: OutgoingAttachment[];
}

/** Port for outbound mail. Handlers depend on this, never on the vendor binding. */
export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

/**
 * The ONE place that knows the Cloudflare `send_email` binding. UNVERIFIED (beta): this uses the structured message
 * form declared in worker-configuration.d.ts (`send({ from, to, subject, text, html })`). If the sandbox shows it
 * behaves differently (for example only raw MIME through `EmailMessage` is accepted), only this class changes:
 * mail/mime.ts `buildMime` already produces the raw form. Header values are validated here, before the vendor call.
 */
export class CloudflareEmailSender implements EmailSender {
  constructor(
    private readonly binding: SendEmail,
    private readonly from: string,
  ) {
    assertAddress(from);
  }

  async send(email: OutgoingEmail): Promise<void> {
    const message = {
      from: { name: "Rekauda", email: this.from },
      to: assertAddress(email.to),
      subject: assertHeaderValue(email.subject),
      text: email.text,
      ...(email.html === undefined ? {} : { html: email.html }),
      ...(email.attachments === undefined
        ? {}
        : {
            attachments: email.attachments.map((a) => ({
              disposition: "attachment" as const,
              filename: assertHeaderValue(a.filename),
              type: assertHeaderValue(a.type),
              content: a.content,
            })),
          }),
    };
    await this.binding.send(message);
  }
}
