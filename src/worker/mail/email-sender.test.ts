import { describe, expect, it } from "vitest";
import { CloudflareEmailSender } from "./email-sender";
import { MimeError } from "./mime";

function binding() {
  const sent: unknown[] = [];
  return { sent, send: async (message: unknown) => void sent.push(message) };
}

const email = { to: "madre@example.test", subject: "Tesorería", text: "Hola" };

describe("CloudflareEmailSender", () => {
  it("hands the validated message to the send_email binding with the configured sender", async () => {
    const b = binding();
    await new CloudflareEmailSender(b as unknown as SendEmail, "no-reply@rekauda.test").send(email);
    expect(b.sent).toEqual([{ from: { name: "Rekauda", email: "no-reply@rekauda.test" }, to: "madre@example.test", subject: "Tesorería", text: "Hola" }]);
  });

  it("passes html along only when present", async () => {
    const b = binding();
    await new CloudflareEmailSender(b as unknown as SendEmail, "no-reply@rekauda.test").send({ ...email, html: "<p>Hola</p>" });
    expect(b.sent[0]).toMatchObject({ html: "<p>Hola</p>" });
  });

  it.each([
    ["recipient", { ...email, to: "a@example.test\r\nBcc: spy@example.test" }],
    ["subject", { ...email, subject: "Hola\nBcc: spy@example.test" }],
    ["malformed recipient", { ...email, to: "not-an-address" }],
  ])("refuses a bad %s without calling the binding", async (_name, message) => {
    const b = binding();
    await expect(new CloudflareEmailSender(b as unknown as SendEmail, "no-reply@rekauda.test").send(message)).rejects.toBeInstanceOf(MimeError);
    expect(b.sent).toEqual([]);
  });

  it("refuses to be built with a malformed sender", () => {
    expect(() => new CloudflareEmailSender(binding() as unknown as SendEmail, "bad sender")).toThrow(MimeError);
  });
});
