/**
 * Minimal stand-in for Cloudflare's HTMLRewriter, which does not exist in Node. It supports only what src/worker uses:
 * `title`, `head` and `meta[...]` selectors (comma lists, `=` and `^=` attribute tests) and the element calls remove,
 * setInnerContent, append, setAttribute and getAttribute, with the same escaping rules (text is escaped unless
 * `{ html: true }`). It is NOT a parser: the real runtime is verified in the sandbox checklist.
 */
interface Handlers {
  element?: (el: FakeElement) => void;
}

const escapeText = (v: string): string => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (v: string): string => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

class FakeElement {
  removed = false;
  inner: string | null = null;
  appended = "";
  constructor(
    readonly tag: string,
    public attrs: Map<string, string>,
  ) {}
  remove(): this {
    this.removed = true;
    return this;
  }
  setInnerContent(content: string, options?: { html?: boolean }): this {
    this.inner = options?.html ? content : escapeText(content);
    return this;
  }
  append(content: string, options?: { html?: boolean }): this {
    this.appended += options?.html ? content : escapeText(content);
    return this;
  }
  setAttribute(name: string, value: string): this {
    this.attrs.set(name, value);
    return this;
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
}

function parseAttrs(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of source.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) attrs.set(m[1] as string, (m[2] as string).replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  return attrs;
}

function matches(selector: string, tag: string, attrs: Map<string, string>): boolean {
  const m = /^([a-z]+)(?:\[([a-z:]+)(\^?=)"([^"]*)"\])?$/.exec(selector.trim());
  if (!m || m[1] !== tag) return false;
  if (!m[2]) return true;
  const value = attrs.get(m[2]);
  return value !== undefined && (m[3] === "^=" ? value.startsWith(m[4] as string) : value === m[4]);
}

function render(el: FakeElement): string {
  return [...el.attrs].map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
}

export class FakeHTMLRewriter {
  private readonly rules: Array<{ selector: string; handlers: Handlers }> = [];

  on(selector: string, handlers: Handlers): this {
    for (const part of selector.split(/,(?![^[]*\])/)) this.rules.push({ selector: part, handlers });
    return this;
  }

  transform(response: Response): Response {
    const rules = this.rules;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let html = await response.text();
        for (const { selector, handlers } of rules) {
          const tag = /^[a-z]+/.exec(selector.trim())?.[0] ?? "";
          const pattern = tag === "title" ? /<title([^>]*)>([\s\S]*?)<\/title>/g : tag === "head" ? /<head([^>]*)>([\s\S]*?)<\/head>/g : new RegExp(`<${tag}\\b([^>]*?)\\s*/?>`, "g");
          html = html.replace(pattern, (whole: string, attrSource: string, inner?: string) => {
            const el = new FakeElement(tag, parseAttrs(attrSource));
            if (!matches(selector, tag, el.attrs)) return whole;
            handlers.element?.(el);
            if (el.removed) return "";
            if (tag === "title") return `<title${render(el)}>${el.inner ?? inner ?? ""}</title>`;
            if (tag === "head") return `<head${render(el)}>${inner ?? ""}${el.appended}</head>`;
            return `<${tag}${render(el)}>`;
          });
        }
        controller.enqueue(new TextEncoder().encode(html));
        controller.close();
      },
    });
    return new Response(body, response);
  }
}

if (!("HTMLRewriter" in globalThis)) Object.defineProperty(globalThis, "HTMLRewriter", { value: FakeHTMLRewriter, configurable: true });
