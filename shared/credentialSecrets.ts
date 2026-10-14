/** Provider validation errors may echo a rejected value. Never forward submitted
 * secrets to a renderer, callback page, diagnostic log, or terminal report. */
export function redactCredentialError(message: string, params: object): string {
  for (const [name, value] of Object.entries(params)) {
    if (["token", "value", "client_secret", "refresh_token"].includes(name) && typeof value === "string" && value) {
      message = message.split(value).join("<redacted>");
    }
  }
  return message;
}
