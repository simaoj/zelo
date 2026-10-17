import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer } from '../../../application/ports/out/index.js';

export class NodemailerMailer implements Mailer {
  private readonly transport: Transporter;
  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async sendPasswordReset(to: string, link: string): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to,
      subject: 'Redefinição de senha do Zelo',
      text: [
        'Olá!',
        '',
        'Recebemos um pedido para redefinir a senha da sua conta no Zelo.',
        `Para criar uma nova senha, acesse: ${link}`,
        '',
        'O link vale por 1 hora e pode ser usado uma única vez.',
        'Se você não fez este pedido, pode ignorar este e-mail.',
      ].join('\n'),
    });
  }
}

/** In-memory mailer for tests. */
export class MemoryMailer implements Mailer {
  readonly sent: { to: string; link: string }[] = [];
  async sendPasswordReset(to: string, link: string): Promise<void> {
    this.sent.push({ to, link });
  }
}
