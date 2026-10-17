import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth-user.interface';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user; mails a code to confirm the email',
  })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the email with the mailed code; signs in' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.email, dto.code);
  }

  @Post('resend-verification')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Mail a new confirmation code (same answer for any email)',
  })
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<void> {
    await this.authService.resendVerification(dto.email);
  }

  @Post('forgot-password')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Mail a password reset code to a verified account (same answer for any email)',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Set a new password with the mailed code; signs out every device',
  })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(dto.email, dto.code, dto.newPassword);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Login user; 403 EMAIL_NOT_VERIFIED mails a new code',
  })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'New access and refresh token for a refresh token; 401 when the session ended',
  })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: "End the refresh token's session (same answer for any token)",
  })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refresh_token);
  }

  @Get('clients')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: "Get coach's client list" })
  async getClients(@Request() req: AuthenticatedRequest) {
    return this.authService.getClients(req.user.id);
  }

  @Delete('clients/:clientId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Remove a client' })
  async removeClient(
    @Param('clientId') clientId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.authService.removeClient(req.user.id, clientId);
  }

  @Post('invites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Send an invite to a client' })
  async createInvite(
    @Body() body: { email: string },
    @Request() req: AuthenticatedRequest,
  ) {
    return this.authService.createInvite(req.user.id, body.email);
  }

  @Get('invites')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('COACH')
  @ApiOperation({ summary: 'Get pending invites' })
  async getPendingInvites(@Request() req: AuthenticatedRequest) {
    return this.authService.getPendingInvites(req.user.id);
  }

  @Post('invites/:token/accept')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CLIENT')
  @ApiOperation({ summary: 'Accept a coach invite' })
  async acceptInvite(
    @Param('token') token: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.authService.acceptInvite(token, req.user.id);
  }
}
