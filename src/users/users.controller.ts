import {
  Body,
  Controller,
  Get,
  Patch,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateMeDto } from './dto/update-me.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Profile of the caller' })
  me(@Request() req: AuthenticatedRequest) {
    return this.users.me(req.user);
  }

  @Patch('me')
  @ApiOperation({ summary: "Change the caller's weight unit" })
  updateMe(@Body() dto: UpdateMeDto, @Request() req: AuthenticatedRequest) {
    return this.users.updateMe(req.user, dto);
  }
}
