import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  RecordAcceptancesDto,
  SetConsentDto,
} from '../policies/dto/agreement.dto';
import { ConsentPurpose } from '../policies/policy-versions';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
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
  @ApiOperation({
    summary: "Change the caller's name, weight unit or rest time",
  })
  updateMe(@Body() dto: UpdateMeDto, @Request() req: AuthenticatedRequest) {
    return this.users.updateMe(req.user, dto);
  }

  @Post('me/acceptances')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Record the Terms and Privacy versions and consents accepted on the update screen; 400 when a version is out of date',
  })
  recordAcceptances(
    @Body() dto: RecordAcceptancesDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.users.recordAcceptances(req.user, dto);
  }

  @Put('me/consents/:purpose')
  @ApiOperation({
    summary:
      'Give or withdraw one consent; health_data can only be withdrawn by deleting the account',
  })
  setConsent(
    @Param('purpose', new ParseEnumPipe(ConsentPurpose))
    purpose: ConsentPurpose,
    @Body() dto: SetConsentDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.users.setConsent(req.user, purpose, dto);
  }

  @Post('me/password')
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Change the caller's password; returns new tokens and ends other sessions",
  })
  changePassword(
    @Body() dto: ChangePasswordDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.users.changePassword(req.user, dto);
  }

  @Delete('me')
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Delete the caller's account (a coach is anonymised); needs the password",
  })
  async deleteMe(
    @Body() dto: DeleteAccountDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.users.deleteAccount(req.user.id, dto.password);
  }
}
