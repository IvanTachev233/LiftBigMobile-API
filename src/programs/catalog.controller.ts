import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProgramCatalogService } from './program-catalog.service';

@ApiTags('programs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class CatalogController {
  constructor(private readonly catalog: ProgramCatalogService) {}

  @Get('sports')
  @ApiOperation({ summary: 'List sports with their required lifts' })
  listSports() {
    return this.catalog.listSports();
  }

  @Get('sports/:id/programs')
  @ApiOperation({ summary: 'List the published programs of a sport' })
  listPrograms(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.listPrograms(id);
  }

  @Get('programs/:id')
  @ApiOperation({ summary: 'A published program with its sessions' })
  getProgram(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getProgram(id);
  }
}
