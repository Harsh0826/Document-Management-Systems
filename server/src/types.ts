/** Two roles: administrators manage the library and people; employees view and download. */
export type RoleName = 'admin' | 'employee';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: RoleName;
  mfaEnabled: boolean;
  /** The role requires MFA but the user has not enrolled: only self-service auth endpoints are allowed. */
  mfaSetupRequired: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}
