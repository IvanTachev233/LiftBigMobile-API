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
import { Repository, LessThanOrEqual } from 'typeorm';
import { User } from './user.entity';
import { Invite, InviteStatus } from './invite.entity';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

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
      email: registerDto.email,
      passwordHash: hashedPassword,
      role: registerDto.role || 'CLIENT',
    });

    try {
      await this.usersRepository.save(user);
    } catch (error) {
      if (error.code === '23505') {
        throw new ConflictException('Email already exists');
      }
      throw error;
    }

    const payload = { email: user.email, sub: user.id, role: user.role };
    return {
      user,
      token: this.jwtService.sign(payload),
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersRepository.findOne({
      where: { email: loginDto.email },
    });

    if (user && (await bcrypt.compare(loginDto.password, user.passwordHash))) {
      const payload = { email: user.email, sub: user.id, role: user.role };
      return {
        access_token: this.jwtService.sign(payload),
      };
    }
    throw new UnauthorizedException('Invalid credentials');
  }

  async getClients(coachId: string): Promise<User[]> {
    return this.usersRepository.find({
      where: { coachId },
      select: ['id', 'email', 'role'],
    });
  }

  async createInvite(
    coachId: string,
    clientEmail: string,
  ): Promise<Invite> {
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
      token: uuidv4(),
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

  async acceptInvite(token: string, clientId: string): Promise<User> {
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

    return client;
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
