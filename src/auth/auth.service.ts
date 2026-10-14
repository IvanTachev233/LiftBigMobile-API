import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { Invite, InviteStatus } from './invite.entity';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { Workout, WorkoutStatus } from '../workouts/entities/workout.entity';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

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

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Invite)
    private inviteRepository: Repository<Invite>,
    private jwtService: JwtService,
  ) {}

  async register(
    registerDto: RegisterDto,
  ): Promise<{ user: User; token: string }> {
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(registerDto.password, salt);

    const user = this.usersRepository.create({
      name: registerDto.name,
      email: registerDto.email,
      passwordHash: hashedPassword,
      role: registerDto.role || 'CLIENT',
    });

    try {
      await this.usersRepository.save(user);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Email already exists');
      }
      throw error;
    }

    const payload = {
      email: user.email,
      name: user.name,
      sub: user.id,
      role: user.role,
      coachId: user.coachId,
    };
    delete (user as { passwordHash?: string }).passwordHash;
    return {
      user,
      token: this.jwtService.sign(payload),
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: loginDto.email })
      .getOne();

    if (user && (await bcrypt.compare(loginDto.password, user.passwordHash))) {
      const payload = {
        email: user.email,
        name: user.name,
        sub: user.id,
        role: user.role,
        coachId: user.coachId,
      };
      return {
        access_token: this.jwtService.sign(payload),
      };
    }
    throw new UnauthorizedException('Invalid credentials');
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

    const payload = {
      email: client.email,
      name: client.name,
      sub: client.id,
      role: client.role,
      coachId: client.coachId,
    };

    delete (client as { passwordHash?: string }).passwordHash;
    return {
      user: client,
      access_token: this.jwtService.sign(payload),
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
