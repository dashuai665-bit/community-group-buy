export interface MagicLinkEmail {
  email: string;
  url: string;
  token: string;
}

export interface EmailDeliveryProvider {
  sendMagicLink(message: MagicLinkEmail): Promise<void>;
}

export class EmailDeliveryUnavailableError extends Error {
  constructor() {
    super('Email delivery is unavailable');
    this.name = 'EmailDeliveryUnavailableError';
  }
}

export const unavailableEmailProvider: EmailDeliveryProvider = {
  async sendMagicLink() {
    throw new EmailDeliveryUnavailableError();
  },
};
