import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseMailer, resendMailer } from "./mail";

/** A stand-in key for the choice tests; no send reaches Resend. */
const WITH_KEY = { RESEND_API_KEY: "re_x" }; // pragma: allowlist secret

const MESSAGE = { to: "guest@example.com", subject: "Your details for Party", text: "Reply through your own link:\nhttp://localhost:3113/i/ABC?guest=g_1" };

describe("choosing the mailer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs one line with the recipient, the subject, and the link when RESEND_API_KEY is unset", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(chooseMailer({ NODE_ENV: "production" }).send(MESSAGE)).resolves.toBe("logged");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("Mail to guest@example.com: Your details for Party http://localhost:3113/i/ABC?guest=g_1");
  });

  it("logs outside production even with a key unless MAIL_LIVE is 1", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(chooseMailer({ ...WITH_KEY, NODE_ENV: "development" }).send(MESSAGE)).resolves.toBe("logged");
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(chooseMailer({ ...WITH_KEY, NODE_ENV: "development", MAIL_LIVE: "1" }).send(MESSAGE)).resolves.toBe("sent");
    await expect(chooseMailer({ ...WITH_KEY, NODE_ENV: "production" }).send(MESSAGE)).resolves.toBe("sent");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("the Resend mailer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts the message with the bearer key and the sender and reports sent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    await expect(resendMailer("re_x", "Host <host@example.com>").send(MESSAGE)).resolves.toBe("sent");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer re_x" });
    expect(JSON.parse(String(init?.body))).toEqual({ from: "Host <host@example.com>", ...MESSAGE });
  });

  it("throws Resend's message when the API rejects the send", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Invalid `to` field." }), { status: 422 }));
    await expect(resendMailer("re_x").send(MESSAGE)).rejects.toThrow("Invalid `to` field.");
  });
});
