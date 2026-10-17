export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// Sends one mail; rejects when it could not be handed to the provider.
// Also the injection token for the transport in use.
export abstract class MailService {
  abstract send(message: MailMessage): Promise<void>;
}
