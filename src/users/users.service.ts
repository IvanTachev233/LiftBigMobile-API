import { BadRequestException, Injectable } from '@nestjs/common';
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
    const { id, email, name, role, weightUnit, restSeconds } =
      await this.users.findOneByOrFail({ id: user.id });
    return { id, email, name, role, weightUnit, restSeconds };
  }

  /** Saves the fields sent; a body with none of them is rejected */
  async updateMe(user: AuthUser, dto: UpdateMeDto) {
    const changes: Partial<Pick<User, 'weightUnit' | 'restSeconds'>> = {};
    if (dto.weightUnit !== undefined) changes.weightUnit = dto.weightUnit;
    if (dto.restSeconds !== undefined) changes.restSeconds = dto.restSeconds;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Send weightUnit or restSeconds');
    }
    await this.users.update({ id: user.id }, changes);
    return this.me(user);
  }
}
