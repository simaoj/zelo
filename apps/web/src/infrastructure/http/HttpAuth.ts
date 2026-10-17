import { routes, type SessionResponse, type SignInRequest, type SignUpRequest } from '@zelo/contracts';
import { DataError, type AuthPort } from '@/shared/data/ports';
import type { HttpClient } from './client';

export class HttpAuth implements AuthPort {
  constructor(private readonly http: HttpClient) {}

  async getSession(): Promise<SessionResponse | null> {
    try {
      return await this.http.request<SessionResponse>('GET', routes.auth.session);
    } catch (e) {
      if (e instanceof DataError && e.status === 401) return null;
      throw e;
    }
  }
  signIn(input: SignInRequest) {
    return this.http.request<SessionResponse>('POST', routes.auth.signIn, { body: input });
  }
  signUp(input: SignUpRequest) {
    return this.http.request<SessionResponse>('POST', routes.auth.signUp, { body: input });
  }
  async signOut() {
    await this.http.request<null>('POST', routes.auth.signOut, { body: {} });
  }
  async requestPasswordReset(email: string) {
    await this.http.request<null>('POST', routes.auth.passwordResetRequest, { body: { email } });
  }
  async confirmPasswordReset(token: string, password: string) {
    await this.http.request<null>('POST', routes.auth.passwordResetConfirm, { body: { token, password } });
  }
}
