import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CONSENT_TEXT_VERSIONS,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from './policy-versions';

@ApiTags('policies')
@Controller('policies')
export class PoliciesController {
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Current Terms, Privacy and consent text versions, to send back when accepting. No auth',
  })
  versions() {
    return {
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      consentTextVersions: CONSENT_TEXT_VERSIONS,
    };
  }
}
