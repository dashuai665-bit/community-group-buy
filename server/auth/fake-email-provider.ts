import type { EmailDeliveryProvider, MagicLinkEmail } from './email-provider.ts';

export class FakeEmailProvider implements EmailDeliveryProvider {
  readonly messages: MagicLinkEmail[] = [];

  async sendMagicLink(message: MagicLinkEmail): Promise<void> {
    this.messages.push({ ...message });
  }
}
