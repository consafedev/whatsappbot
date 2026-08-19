import { InboundMessagingProviderAdapter } from "./inbound-provider";
import { MockMessagingProvider } from "./mock-provider";
import {
  type MessagingProvider,
  MessagingProviderError,
  type MockMessagingProviderOptions,
  type ProviderType,
} from "./provider";

export type MessagingProviderChannel = Readonly<{
  providerType: ProviderType | string;
}>;

export type MessagingProviderFactoryOptions = Readonly<{
  mock?: MockMessagingProviderOptions;
}>;

export function canonicalProviderType(value: string): ProviderType | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "mock") return "mock";
  if (normalized === "baileys") return "baileys";
  if (normalized === "wppconnect") return "wppconnect";
  if (normalized === "meta" || normalized === "meta_cloud_api") return "meta";
  return null;
}

export function getMessagingProvider(
  channel: MessagingProviderChannel,
  options: MessagingProviderFactoryOptions = {},
): MessagingProvider {
  const provider = channel.providerType.toLowerCase();
  if (provider === "mock") return new MockMessagingProvider(options.mock);
  throw new MessagingProviderError(
    "UNSUPPORTED_PROVIDER",
    `Provider ${channel.providerType} is not implemented in this release`,
  );
}

export function getMessagingInboundProvider(channel: MessagingProviderChannel): MessagingProvider {
  const provider = canonicalProviderType(channel.providerType);
  if (provider === null) {
    throw new MessagingProviderError(
      "UNSUPPORTED_PROVIDER",
      `Provider ${channel.providerType} is not implemented in this release`,
    );
  }
  return new InboundMessagingProviderAdapter(provider);
}
