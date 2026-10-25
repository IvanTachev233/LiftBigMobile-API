import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { appConfigFromEnv, type AppConfig } from './app-config';

@ApiTags('app config')
@Controller('app-config')
export class AppConfigController {
  constructor() {
    // A value it can't read stops the API at startup
    appConfigFromEnv(process.env);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Minimum and latest Android versionCode; the app asks builds below them to update. No auth',
  })
  appConfig(): AppConfig {
    return appConfigFromEnv(process.env);
  }
}
