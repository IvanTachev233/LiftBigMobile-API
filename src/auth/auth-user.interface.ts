import type { Request } from 'express';
import { User } from './user.entity';

// Claims signed into the access token (see AuthService)
export interface JwtPayload {
  sub: string;
  email: string;
  name: string | null;
  role: User['role'];
  coachId: string | null;
}

// What JwtStrategy.validate() attaches to req.user
export type AuthUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'coachId'>;

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
