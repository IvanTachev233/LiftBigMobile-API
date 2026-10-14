import { Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeleteAccountWithCredentialsDto } from '../users/dto/delete-account-with-credentials.dto';
import { UsersService } from '../users/users.service';
import { DELETE_ACCOUNT_CSP, DELETE_ACCOUNT_HTML } from './delete-account-page';
import { PRIVACY_CSP, privacyPageHtml } from './privacy-page';

const HTML = 'text/html; charset=utf-8';

// Public HTML pages linked from the store listing; no auth
@ApiTags('public pages')
@Controller()
export class PublicPagesController {
  constructor(private readonly users: UsersService) {}

  @Get('privacy')
  @Header('Content-Type', HTML)
  @Header('Content-Security-Policy', PRIVACY_CSP)
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Privacy policy page' })
  privacy(): string {
    return privacyPageHtml(process.env);
  }

  @Get('delete-account')
  @Header('Content-Type', HTML)
  @Header('Content-Security-Policy', DELETE_ACCOUNT_CSP)
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Account deletion page' })
  deleteAccountPage(): string {
    return DELETE_ACCOUNT_HTML;
  }

  @Post('delete-account')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Delete an account by email and password (the deletion page); same 401 for any wrong credentials',
  })
  async deleteAccount(
    @Body() dto: DeleteAccountWithCredentialsDto,
  ): Promise<void> {
    await this.users.deleteAccountWithCredentials(dto.email, dto.password);
  }
}
