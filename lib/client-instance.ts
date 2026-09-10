export interface ClientInstanceConfig {
  clientId: string;
  clientName: string;
  complianceMode: boolean;
  deploymentId: string;
}

function slug(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "default";
}

export function clientInstanceConfig(): ClientInstanceConfig {
  const clientName = String(process.env.VERA_CLIENT_NAME || process.env.CYBRID_CLIENT_NAME || "Client").trim() || "Client";
  return {
    clientId: slug(process.env.VERA_CLIENT_ID || process.env.CYBRID_CLIENT_ID || clientName),
    clientName,
    complianceMode: process.env.VERA_COMPLIANCE_MODE === "1",
    deploymentId: slug(process.env.VERA_DEPLOYMENT_ID || process.env.VERCEL_PROJECT_ID || "local"),
  };
}

export function assertClientScope(requestedClientName?: string): ClientInstanceConfig {
  const config = clientInstanceConfig();
  if (!config.complianceMode) return config;
  if (!process.env.VERA_CLIENT_ID || !process.env.VERA_CLIENT_NAME) {
    throw new Error("CLIENT_INSTANCE_NOT_CONFIGURED: compliance mode requires VERA_CLIENT_ID and VERA_CLIENT_NAME.");
  }
  const requested = String(requestedClientName || config.clientName).trim();
  if (requested && slug(requested) !== slug(config.clientName)) {
    throw new Error(`CLIENT_SCOPE_MISMATCH: this deployment is locked to ${config.clientName}.`);
  }
  return config;
}

export function clientBlobPrefix(kind: string): string {
  const config = clientInstanceConfig();
  return `cybrid-title/clients/${config.clientId}/${slug(kind)}`;
}

export function clientPublicDescriptor() {
  const config = clientInstanceConfig();
  return {
    clientId: config.clientId,
    clientName: config.clientName,
    complianceMode: config.complianceMode,
    deploymentId: config.deploymentId,
    isolation: config.complianceMode ? "dedicated-client-instance" : "development-shared-instance",
  } as const;
}
