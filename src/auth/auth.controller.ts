import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('clients')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: "Get coach's client list" })
  async getClients(@Request() req) {
    return this.authService.getClients(req.user.id);
  }

  @Delete('clients/:clientId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Remove a client' })
  async removeClient(
    @Param('clientId') clientId: string,
    @Request() req,
  ) {
    return this.authService.removeClient(req.user.id, clientId);
  }

  @Post('invites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Send an invite to a client' })
  async createInvite(@Body() body: { email: string }, @Request() req) {
    return this.authService.createInvite(req.user.id, body.email);
  }

  @Get('invites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Get pending invites' })
  async getPendingInvites(@Request() req) {
    return this.authService.getPendingInvites(req.user.id);
  }

  @Post('invites/:token/accept')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CLIENT')
  @ApiOperation({ summary: 'Accept a coach invite' })
  async acceptInvite(@Param('token') token: string, @Request() req) {
    return this.authService.acceptInvite(token, req.user.id);
  }
}
