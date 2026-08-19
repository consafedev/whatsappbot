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
