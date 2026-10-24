import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtPayload } from './auth-user.interface';
import { AuthSessionService, SignableUser } from './auth-session.service';
import { User } from './user.entity';
import { Invite, InviteStatus } from './invite.entity';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { Workout, WorkoutStatus } from '../workouts/entities/workout.entity';
import { EmailCodePurpose } from '../email-codes/email-code.entity';
import {
  EmailCodeService,
  MAX_CODE_ATTEMPTS,
} from '../email-codes/email-code.service';
import { agreementItems } from '../policies/agreements';
import { PoliciesService } from '../policies/policies.service';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

// What signing in and refreshing return
export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface ClientSummary {
  id: string;
  name: string | null;
  email: string;
  role: User['role'];
  // Workouts this coach assigned the client, and how many are completed
  assignedCount: number;
  completedCount: number;
  // The newest of those the client started (in progress or completed)
  lastWorkout: { date: Date; name: string } | null;
}

// The answer to a code for an account that can't use one, same as a first
// wrong code so it doesn't reveal whether the account exists
function wrongCode(): BadRequestException {
  return new BadRequestException({
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Wrong code',
    attemptsLeft: MAX_CODE_ATTEMPTS - 1,
  });
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Invite)
    private inviteRepository: Repository<Invite>,
    private jwtService: JwtService,
    private emailCodes: EmailCodeService,
    private sessions: AuthSessionService,
    private policies: PoliciesService,
  ) {}

  /** An access token carrying the user's current token version */
  signToken(user: SignableUser): string {
    const payload: JwtPayload = {
      email: user.email,
      name: user.name,
      sub: user.id,
      role: user.role,
      coachId: user.coachId,
      ver: user.tokenVersion,
    };
    return this.jwtService.sign(payload);
  }

  /** An access token plus a refresh token for a new device session */
  async signIn(user: SignableUser): Promise<TokenPair> {
    return {
      access_token: this.signToken(user),
      refresh_token: await this.sessions.start(user),
    };
  }

  /**
   * Rotates the session holding the refresh token and signs a new access
   * token from the current user row; 401 when the session has ended (see
   * AuthSessionService.refresh).
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const { user, refreshToken: next } =
      await this.sessions.refresh(refreshToken);
    return { access_token: this.signToken(user), refresh_token: next };
  }

  /** Ends the session holding the refresh token; unknown tokens are ignored */
  logout(refreshToken: string): Promise<void> {
    return this.sessions.revoke(refreshToken);
  }

  /**
   * Creates the account unverified, with its Terms and Privacy acceptance
   * and consents (400 unless they are current; see agreementItems), and
   * mails it a VERIFY_EMAIL code; the token comes from verifyEmail. When the
   * mail cannot be sent the account is removed again, so signing up can
   * simply be retried.
   */
  async register(
    registerDto: RegisterDto,
  ): Promise<{ verificationRequired: true; email: string }> {
    const agreement = agreementItems(registerDto, { signUp: true });
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(registerDto.password, salt);

    const user = this.usersRepository.create({
      name: registerDto.name,
      email: registerDto.email,
      passwordHash: hashedPassword,
      role: registerDto.role || 'CLIENT',
    });

    try {
      await this.usersRepository.manager.transaction(async (manager) => {
        await manager.save(user);
        await this.policies.record(manager, user.id, agreement, registerDto);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Email already exists');
      }
      throw error;
    }

    try {
      await this.emailCodes.issue(user, EmailCodePurpose.VERIFY_EMAIL);
    } catch (error) {
      await this.usersRepository.delete(user.id);
      throw error;
    }
    return { verificationRequired: true, email: user.email };
  }

  /**
   * Checks the mailed code, marks the email verified and signs in. Errors
   * come from EmailCodeService.verify (400 attemptsLeft, 409); an unknown or
   * already verified email gets the same 400 as a first wrong code.
   */
  async verifyEmail(email: string, code: string): Promise<TokenPair> {
    const user = await this.findForSignIn(email);
    if (!user || user.emailVerifiedAt) throw wrongCode();
    await this.emailCodes.verify(user.id, EmailCodePurpose.VERIFY_EMAIL, code);
    await this.usersRepository.update(user.id, { emailVerifiedAt: new Date() });
    return this.signIn(user);
  }

  /**
   * Mails a new code to an unverified account. Unknown and verified emails
   * get the same silent success; the request limits (429) still apply.
   */
  async resendVerification(email: string): Promise<void> {
    const user = await this.findForSignIn(email);
    if (!user || user.emailVerifiedAt) return;
    try {
      await this.emailCodes.issue(user, EmailCodePurpose.VERIFY_EMAIL);
    } catch (error) {
      if (error instanceof NotFoundException) return;
      throw error;
    }
  }

  /**
   * Mails a password reset code to a verified account. Every email gets the
   * same silent success, also when no code is sent (unknown or unverified
   * account, request limit, mail failure), so the answer never shows whether
   * an account exists.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.findForSignIn(email);
    if (!user?.emailVerifiedAt) return;
    try {
      await this.emailCodes.issue(user, EmailCodePurpose.RESET_PASSWORD);
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      if (error instanceof ServiceUnavailableException) {
        this.logger.warn(`Password reset code not sent to user ${user.id}`);
      }
    }
  }

  /**
   * Sets a new password with the mailed reset code: raises tokenVersion (every
   * earlier token and session stops working), clears the Change password lock
   * and marks the email verified. Code errors come from
   * EmailCodeService.verify (400 attemptsLeft, 409); an unknown email gets the
   * same 400 as a first wrong code.
   */
  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.findForSignIn(email);
    if (!user) throw wrongCode();
    await this.emailCodes.verify(
      user.id,
      EmailCodePurpose.RESET_PASSWORD,
      code,
    );
    const passwordHash = await bcrypt.hash(newPassword, await bcrypt.genSalt());
    await this.usersRepository.manager.transaction(async (manager) => {
      // Re-read under a lock so a concurrent version raise isn't lost
      const row = await manager.findOne(User, {
        where: { id: user.id },
        select: { id: true, tokenVersion: true, emailVerifiedAt: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) return;
      await manager.update(User, user.id, {
        passwordHash,
        tokenVersion: row.tokenVersion + 1,
        failedPasswordAttempts: 0,
        passwordLockedUntil: null,
        emailVerifiedAt: row.emailVerifiedAt ?? new Date(),
      });
    });
  }

  async login(loginDto: LoginDto): Promise<TokenPair> {
    const user = await this.findForSignIn(loginDto.email);

    if (
      !user ||
      !(await bcrypt.compare(loginDto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailVerifiedAt) {
      // A code that can't be sent now (limit, mail down) can be resent later
      await this.emailCodes
        .issue(user, EmailCodePurpose.VERIFY_EMAIL)
        .catch((error: unknown) => {
          if (!(error instanceof HttpException)) throw error;
        });
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Confirm your email to log in.',
        email: user.email,
      });
    }
    return this.signIn(user);
  }

  // The user with the columns needed to check a password and sign a token
  private findForSignIn(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .addSelect('user.tokenVersion')
      .where('user.email = :email', { email })
      .getOne();
  }

  // The coach's clients with a summary of the workouts this coach assigned
  // them, in one grouped query. The last workout is the newest started one
  // (by date, then the later start); both arrays share one order, so its
  // date and name come from the same row.
  async getClients(coachId: string): Promise<ClientSummary[]> {
    const newest =
      'ORDER BY workout.date DESC, workout.startedAt DESC NULLS LAST, workout.id';
    const started = 'FILTER (WHERE workout.status <> :planned)';
    const rows = await this.usersRepository
      .createQueryBuilder('user')
      .leftJoin(
        Workout,
        'workout',
        'workout.userId = user.id AND workout.assignedById = :coachId',
      )
      .select('user.id', 'id')
      .addSelect('user.name', 'name')
      .addSelect('user.email', 'email')
      .addSelect('user.role', 'role')
      .addSelect('COUNT(workout.id)::int', 'assignedCount')
      .addSelect(
        '(COUNT(workout.id) FILTER (WHERE workout.status = :completed))::int',
        'completedCount',
      )
      .addSelect(
        `(ARRAY_AGG(workout.date ${newest}) ${started})[1]`,
        'lastDate',
      )
      .addSelect(
        `(ARRAY_AGG(workout.name ${newest}) ${started})[1]`,
        'lastName',
      )
      .where('user.coachId = :coachId', { coachId })
      .setParameters({
        completed: WorkoutStatus.COMPLETED,
        planned: WorkoutStatus.PLANNED,
      })
      .groupBy('user.id')
      .getRawMany<
        Omit<ClientSummary, 'lastWorkout'> & {
          lastDate: Date | null;
          lastName: string | null;
        }
      >();
    return rows.map(({ lastDate, lastName, ...client }) => ({
      ...client,
      lastWorkout:
        lastDate && lastName ? { date: lastDate, name: lastName } : null,
    }));
  }

  async createInvite(coachId: string, clientEmail: string): Promise<Invite> {
    const existingClient = await this.usersRepository.findOne({
      where: { email: clientEmail },
    });

    if (existingClient && existingClient.coachId) {
      throw new ConflictException('This user is already assigned to a coach');
    }

    const existingInvite = await this.inviteRepository.findOne({
      where: {
        coachId,
        clientEmail,
        status: InviteStatus.PENDING,
      },
    });

    if (existingInvite) {
      throw new ConflictException(
        'A pending invite already exists for this email',
      );
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invite = this.inviteRepository.create({
      coachId,
      clientEmail,
      token: randomUUID(),
      status: InviteStatus.PENDING,
      expiresAt,
    });

    return this.inviteRepository.save(invite);
  }

  async getPendingInvites(coachId: string): Promise<Invite[]> {
    return this.inviteRepository.find({
      where: { coachId, status: InviteStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }

  async acceptInvite(
    token: string,
    clientId: string,
  ): Promise<{ user: User; access_token: string }> {
    const invite = await this.inviteRepository.findOne({
      where: { token },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    if (invite.status !== InviteStatus.PENDING) {
      throw new BadRequestException('Invite is no longer valid');
    }

    if (new Date() > invite.expiresAt) {
      invite.status = InviteStatus.EXPIRED;
      await this.inviteRepository.save(invite);
      throw new BadRequestException('Invite has expired');
    }

    const client = await this.usersRepository.findOne({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException('Client user not found');
    }

    if (client.role !== 'CLIENT') {
      throw new ForbiddenException('Only clients can accept invites');
    }

    if (client.email !== invite.clientEmail) {
      throw new ForbiddenException(
        'This invite was sent to a different email address',
      );
    }

    if (client.coachId) {
      throw new ConflictException('You are already assigned to a coach');
    }

    client.coachId = invite.coachId;
    await this.usersRepository.save(client);

    invite.status = InviteStatus.ACCEPTED;
    await this.inviteRepository.save(invite);

    const { tokenVersion } = await this.usersRepository.findOneOrFail({
      where: { id: client.id },
      select: { id: true, tokenVersion: true },
    });
    delete (client as { passwordHash?: string }).passwordHash;
    return {
      user: client,
      access_token: this.signToken({ ...client, tokenVersion }),
    };
  }

  async removeClient(coachId: string, clientId: string): Promise<void> {
    const client = await this.usersRepository.findOne({
      where: { id: clientId, coachId },
    });

    if (!client) {
      throw new NotFoundException('Client not found or not assigned to you');
    }

    client.coachId = null;
    await this.usersRepository.save(client);
  }
}
