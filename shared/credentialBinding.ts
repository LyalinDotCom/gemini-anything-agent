export interface CredentialBindingOptions {
  useCredential?: boolean;
  credentialId?: string;
  credentialDomain?: string;
}

export function credentialBindingError(options: CredentialBindingOptions): string | null {
  if (!options.useCredential) return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(options.credentialId?.trim() ?? "")) {
    return "Enter a stored credential ID using letters, numbers, hyphens, or underscores.";
  }
  const domain = options.credentialDomain?.trim().toLowerCase() ?? "";
  if (!domain.includes(".") || domain.length > 253 || !domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    return "Enter one API hostname, such as api.example.com, without a scheme, path, or wildcard.";
  }
  return null;
}

/** Network overrides replace existing rules. Keep CLI egress and explicitly
 * remove a previously selected binding when the connection is switched off. */
export function buildCredentialNetwork(options: CredentialBindingOptions): { allowlist: Array<{ domain: string; credential?: string }> } | undefined {
  if (options.useCredential) {
    return { allowlist: [{ domain: options.credentialDomain?.trim().toLowerCase() ?? "", credential: options.credentialId?.trim() ?? "" }, { domain: "*" }] };
  }
  if (options.credentialId || options.credentialDomain) return { allowlist: [{ domain: "*" }] };
  return undefined;
}
