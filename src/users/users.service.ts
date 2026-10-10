import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user.interface';
import { User } from '../auth/user.entity';
import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async me(user: AuthUser) {
    const { id, email, name, role, weightUnit } =
      await this.users.findOneByOrFail({ id: user.id });
    return { id, email, name, role, weightUnit };
  }

  async updateMe(user: AuthUser, dto: UpdateMeDto) {
    await this.users.update({ id: user.id }, { weightUnit: dto.weightUnit });
    return this.me(user);
  }
}
